/** Complete preparations stay in a separate native store until one fenced swap. */
import { equalsJson, cloneJson } from '@jarenjs/core/object';
import type { TransactionStore } from '@jarenjs/db';
import { LIGHTRAG_TABLES, immutableLightRagJson, lightragRevisionOf, lightragMust, lightragFailure,
  validateLightRagShape,
  type LightRagEmbeddedBy, type LightRagOutcome, type LightRagIssue, type GraphProjection, type GraphContribution } from '@tangleai/lightrag';
import type { Embedder } from '@tangleai/models/embed';
import { assertDocumentSource, assertDocumentVersion, type PreparedOutcome, type DocumentCorpusStore, type DocumentSource, type DocumentVersion, type StoredDocumentBundle } from '@tangleai/documents/contracts';
import type { TangleDb } from './db.ts';
import { createDocumentStore } from './document-store.ts';
import { serialDocumentSource } from './document-state.ts';
import { createLightRagStore } from './lightrag-store.ts';
import { createCorpusPromotion, type CorpusGraphPreparationOptions, type CorpusPreparation, type CorpusPromotionRequest } from './corpus-promotion.ts';
import { GRAPH_VECTOR_COLLECTIONS, assertGraphVectorDeclaration, GraphVectorRefusal, type GraphVectorDeclaration } from './graph-vector-model.ts';
import { graphVectorRankQuery, verifyVectorPlan } from './graph-vector-plan.ts';
import { GRAPH_VECTOR_STATE_KEY, readGraphVectorState, validateGraphVectorState, type GraphVectorSource, type GraphVectorState } from './graph-vector-state.ts';

const JOURNAL_KEY = 'lightrag:vector:stage';
const COPY_TABLES = [...LIGHTRAG_TABLES.map(table => 'lightrag_' + table), 'sources', 'document_versions', 'document_elements', 'document_chunks', 'document_parents'];
interface PreparedReference {
  source: DocumentSource; version: DocumentVersion; hasParents: boolean; projectionId: string;
  expectedHead: Extract<CorpusPreparation, { status: 'prepared' }>['expectedHead'];
  profilePolicy: 'prepared' | 'retained-evidence';
  rebaseKey?: string;
}
interface StageSource extends GraphVectorSource { status: 'pending' | 'running' | 'failed' | 'complete'; attempts: number; prepared?: PreparedReference }
interface StageReservation {
  document: 'graph-vector-stage-reservation'; id: string; baseline: string; widths: number[];
  status: 'pending' | 'promoted' | 'abandoned'; reason?: string;
}
export interface GraphVectorStageJournal {
  id: string; operationKey: string; at: string; baseline: string;
  before: GraphVectorState | null; active: LightRagEmbeddedBy; target: LightRagEmbeddedBy;
  sources: StageSource[]; copiedRows: number; failed: number; interrupted: number;
}
export interface GraphVectorStageWork {
  staged: number; skipped: number; failed: number; interrupted: number; writes: number;
  embeddingCalls: number; embeddingTexts: number;
}
export interface GraphVectorStageProgress {
  status: 'complete' | 'incomplete'; journal: GraphVectorStageJournal; work: GraphVectorStageWork; failure?: LightRagIssue[];
}
export interface GraphVectorSwapReceipt {
  id: string; before: LightRagEmbeddedBy; after: LightRagEmbeddedBy; revision: number;
  documentWrites: number; graphWrites: number; swaps: number; replayed: boolean;
}
type Scope = TangleDb | TransactionStore;
const all = { $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r' };
async function inventory(scope: Scope) {
  const projections: Array<Pick<GraphProjection, 'id' | 'sourceId' | 'versionId' | 'status' | 'head' | 'identities' | 'contributionRevision'>> = [];
  for await (const row of scope.collection('lightrag_projections').query<typeof projections[number]>({ $for: { r: '$[*]' }, $orderby: '$r.id',
    $return: { id: '$r.id', sourceId: '$r.sourceId', versionId: '$r.versionId', status: '$r.status', head: '$r.payload.head',
      identities: '$r.payload.identities', contributionRevision: '$r.payload.contributionRevision' } })) projections.push(row);
  const active = projections.filter(row => row.status === 'active'), sources: GraphVectorSource[] = [];
  if (!active.length || active.length > 128 || new Set(active.map(row => row.sourceId)).size !== active.length)
    throw new GraphVectorRefusal('TVEC1003', 'Staging requires one to 128 distinct active graph sources.');
  for (const projection of active) {
    const source = await scope.collection<DocumentSource>('sources').get(projection.sourceId);
    const version = await scope.collection<DocumentVersion>('document_versions').get(projection.versionId);
    if (source?.status !== 'ready' || source.activeVersionId !== projection.versionId || version?.status !== 'active'
      || version.sourceId !== source.id || !equalsJson(version.embeddedBy, projection.identities.embedder))
      throw new GraphVectorRefusal('TVEC1003', 'The complete document and graph identity differs.');
    sources.push({ source, version, head: projection.head });
  }
  sources.sort((a, b) => a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0);
  const state = await readGraphVectorState(scope), identity = sources[0].version.embeddedBy;
  if (sources.some(row => !equalsJson(row.version.embeddedBy, identity)) || state && !equalsJson(state.active, identity))
    throw new GraphVectorRefusal('TVEC1001', 'A graph migration cannot start from mixed settled identities.');
  return { sources, state, identity, revision: await lightragRevisionOf({ projections, sources, state }) };
}
const complete = (journal: GraphVectorStageJournal) => journal.sources.every(source => source.status === 'complete' && source.prepared);
const natural = (value: number) => Number.isSafeInteger(value) && value >= 0;
function closed(value: object, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new GraphVectorRefusal('TVEC1003', 'Graph staging metadata has missing or unknown fields.');
}
const capture = async <T>(task: () => Promise<T>): Promise<LightRagOutcome<T>> => {
  try { return { valid: true, value: await task() }; } catch (cause) { return lightragFailure(cause); }
};

export function createGraphVectorStage(options: { db: TangleDb; staging: TangleDb; declaration: GraphVectorDeclaration;
  embedder: Embedder; operationKey: string; now: () => string; applyProbe?: (step: string) => void | Promise<void> }) {
  const { db, staging, embedder, operationKey, now, applyProbe } = options, declaration = assertGraphVectorDeclaration(options.declaration);
  if (db === staging || !operationKey.trim()) throw new TypeError('A graph stage requires a distinct disposable store and operation key.');
  const target = { model: embedder.model, dims: embedder.dims } as LightRagEmbeddedBy;
  if (![declaration.active, ...declaration.retained].some(identity => equalsJson(identity, target)))
    throw new GraphVectorRefusal('TVEC1001', 'The target embedder is not a settled declared graph identity.');
  async function read(scope: Scope = staging): Promise<GraphVectorStageJournal | null> {
    const row = await scope.collection<{ key: string; value: GraphVectorStageJournal }>('settings').get(JOURNAL_KEY);
    if (!row) return null;
    const value = row.value;
    closed(value, ['id', 'operationKey', 'at', 'baseline', 'before', 'active', 'target', 'sources', 'copiedRows', 'failed', 'interrupted']);
    if (!value || value.operationKey !== operationKey || !equalsJson(value.target, target) || !Array.isArray(value.sources)
      || !value.sources.length || value.sources.length > 128
      || !/^[a-f0-9]{64}$/.test(value.baseline) || !Number.isFinite(Date.parse(value.at))
      || !natural(value.copiedRows) || !natural(value.failed) || !natural(value.interrupted)
      || value.id !== await lightragRevisionOf({ operationKey: value.operationKey, baseline: value.baseline, target: value.target }))
      throw new GraphVectorRefusal('TVEC1003', 'The staging journal differs from the requested immutable preparation.');
    if (value.before !== null) validateGraphVectorState(value.before);
    lightragMust(validateLightRagShape('lightRagEmbeddedBy', value.active));
    for (const source of value.sources) {
      closed(source, ['source', 'version', 'head', 'status', 'attempts'], ['prepared']);
      assertDocumentSource(source.source); assertDocumentVersion(source.version); lightragMust(validateLightRagShape('lightRagHead', source.head));
      if (!['pending', 'running', 'failed', 'complete'].includes(source.status) || !natural(source.attempts)
        || source.source.id !== source.version.sourceId || source.source.activeVersionId !== source.version.id
        || !equalsJson(source.version.embeddedBy, value.active) || (source.status === 'complete') !== !!source.prepared)
        throw new GraphVectorRefusal('TVEC1003', 'A staging source differs from its retained identity or completion.');
      if (source.prepared) {
        const prepared = source.prepared;
        closed(prepared, ['source', 'version', 'hasParents', 'projectionId', 'expectedHead', 'profilePolicy'], ['rebaseKey']);
        assertDocumentSource(prepared.source); assertDocumentVersion(prepared.version); lightragMust(validateLightRagShape('lightRagHead', prepared.expectedHead));
        if (prepared.source.id !== source.source.id || prepared.version.sourceId !== source.source.id || !equalsJson(prepared.version.embeddedBy, target)
          || typeof prepared.hasParents !== 'boolean' || !/^[a-f0-9]{64}$/.test(prepared.projectionId)
          || !['prepared', 'retained-evidence'].includes(prepared.profilePolicy)
          || prepared.rebaseKey !== undefined && !/^lightrag:vector:rebase:[a-f0-9]{64}$/.test(prepared.rebaseKey))
          throw new GraphVectorRefusal('TVEC1003', 'A completed staging reference differs from its requested source.');
      }
    }
    if (new Set(value.sources.map(source => source.source.id)).size !== value.sources.length)
      throw new GraphVectorRefusal('TVEC1003', 'The staging journal repeats a source.');
    return value;
  }
  const write = (scope: Scope, journal: GraphVectorStageJournal) => scope.collection('settings').put({ key: JOURNAL_KEY, value: journal });
  const reservationKey = (journal: GraphVectorStageJournal) => 'lightrag:vector:reservation:' + journal.id;
  const reservation = async (scope: Scope, journal: GraphVectorStageJournal) => {
    const value = (await scope.collection<{ key: string; value: StageReservation }>('settings').get(reservationKey(journal)))?.value;
    if (!value) return undefined;
    closed(value, ['document', 'id', 'baseline', 'widths', 'status'], ['reason']);
    if (value.document !== 'graph-vector-stage-reservation' || value.id !== journal.id || value.baseline !== journal.baseline
      || !equalsJson(value.widths, [...new Set([journal.active.dims, journal.target.dims])].sort((a, b) => a - b))
      || !['pending', 'promoted', 'abandoned'].includes(value.status)
      || value.status === 'abandoned' && (typeof value.reason !== 'string' || !value.reason.trim())
      || value.status !== 'abandoned' && value.reason !== undefined)
      throw new GraphVectorRefusal('TVEC1003', 'The primary graph reservation differs from its retained journal.');
    return value;
  };
  async function reserve(scope: Scope, journal: GraphVectorStageJournal) {
    const current = await reservation(scope, journal);
    if (current) {
      if (current.id !== journal.id || current.baseline !== journal.baseline || current.status === 'abandoned')
        throw new GraphVectorRefusal('TVEC1003', 'The primary staging reservation differs or was abandoned.');
      return 0;
    }
    if ((await inventory(scope)).revision !== journal.baseline)
      throw new GraphVectorRefusal('TVEC1003', 'The corpus changed before its staging reservation was retained.');
    await scope.collection('settings').put({ key: reservationKey(journal), value: { document: 'graph-vector-stage-reservation',
      id: journal.id, baseline: journal.baseline, widths: [...new Set([journal.active.dims, journal.target.dims])].sort((a, b) => a - b), status: 'pending' } });
    return 1;
  }
  const owner = (scope: Scope) => createCorpusPromotion({ db: scope, documents: createDocumentStore(scope), lightrag: createLightRagStore(scope), compactGraphPreparations: true, applyProbe });
  async function request(scope: Scope, reference: PreparedReference): Promise<CorpusPromotionRequest> {
    const documents = createDocumentStore(scope), projection = await createLightRagStore(scope).getProjection(reference.projectionId);
    if (!projection?.prepared) throw new GraphVectorRefusal('TVEC1003', 'A staged graph contribution is missing.');
    const contribution = reference.rebaseKey
      ? (await scope.collection<{ key: string; value: GraphContribution }>('settings').get(reference.rebaseKey))?.value : projection.prepared;
    if (!contribution) throw new GraphVectorRefusal('TVEC1003', 'The exact staged rebase is missing.');
    const document: StoredDocumentBundle = { source: reference.source, version: reference.version,
      elements: await documents.listElements(reference.version.id), chunks: await documents.listChunks(reference.version.id),
      ...(reference.hasParents ? { parents: await documents.listParents(reference.version.id) } : {}) };
    return { document, contribution, expectedHead: reference.expectedHead, profilePolicy: reference.profilePolicy };
  }
  return {
    inspect: () => read(),
    initialize: (): Promise<LightRagOutcome<{ journal: GraphVectorStageJournal; copiedRows: number; writes: number }>> => capture(async () => {
      const prior = await read(); if (prior) return { journal: prior, copiedRows: 0,
        writes: await db.transaction(scope => reserve(scope, prior), { mode: 'immediate' }) };
      for (const table of COPY_TABLES) if (Number(await staging.collection(table).execute({ $count: '$[*]' })) !== 0)
        throw new GraphVectorRefusal('TVEC1003', 'The staging store must begin with an empty document and graph corpus.');
      for (const scope of [db, staging]) for (const identity of [declaration.active, target]) for (const table of GRAPH_VECTOR_COLLECTIONS)
        verifyVectorPlan(await scope.collection(table).explain(graphVectorRankQuery(identity, 1), {
          externals: { q: [1, ...Array(identity.dims - 1).fill(0)] } }), identity.dims);
      return db.transaction(async source => {
        const result = await staging.transaction(async destination => {
        if (await read(destination)) throw new GraphVectorRefusal('TVEC1003', 'Another initializer already owns this staging store.');
        const baseline = await inventory(source);
        if (!equalsJson(baseline.identity, declaration.active) || equalsJson(baseline.identity, target))
          throw new GraphVectorRefusal('TVEC1001', 'Staging must change the current settled graph identity.');
        const sourceIds = new Set(baseline.sources.map(row => row.source.id));
        const journal: GraphVectorStageJournal = { id: await lightragRevisionOf({ operationKey, baseline: baseline.revision, target }),
          operationKey, at: now(), baseline: baseline.revision, before: baseline.state,
          active: baseline.identity, target, sources: baseline.sources.map(row => ({ ...row, status: 'pending', attempts: 0 })), copiedRows: 0, failed: 0, interrupted: 0 };
        let writes = 0, chunks = 0;
        for (const table of COPY_TABLES) for await (const row of source.collection(table).query<{ id: string; sourceId?: string }>(all)) {
          if (!table.startsWith('lightrag_') && !sourceIds.has(table === 'sources' ? row.id : row.sourceId!)) continue;
          if (table === 'document_chunks' && ++chunks > 100000) throw new GraphVectorRefusal('TVEC1003', 'The bounded stage exceeds 100,000 retained document chunks.');
          await destination.collection(table).put(row); journal.copiedRows++; writes++;
        }
        const promotion = owner(destination);
        for (const source of journal.sources) {
          const retired = lightragMust(await promotion.retract(source.source.id, { expectedHead: source.head, at: journal.at }));
          writes += retired.documentWrites + (retired.graph?.writes ?? 0);
        }
        await destination.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY,
          value: { revision: baseline.state?.revision ?? 0, active: target, retained: baseline.state?.retained ?? [] } }); writes++;
        await write(destination, journal); writes++; await applyProbe?.('stage:initialize');
        return { journal, copiedRows: journal.copiedRows, writes };
        }, { mode: 'immediate' });
        result.writes += await reserve(source, result.journal);
        return result;
      }, { mode: 'immediate' });
    }),
    stage: (input: {
      prepareDocument: (source: GraphVectorSource, context: { documents: DocumentCorpusStore; embedder: Embedder }) => Promise<PreparedOutcome>;
      graph: (source: GraphVectorSource, document: StoredDocumentBundle) => Omit<CorpusGraphPreparationOptions, 'embedder'> | Promise<Omit<CorpusGraphPreparationOptions, 'embedder'>>;
      /** The host has stopped the prior attempt; its journal fence still applies. */
      resumeInterrupted?: boolean;
    }): Promise<LightRagOutcome<GraphVectorStageProgress>> => capture(() => serialDocumentSource(staging, JOURNAL_KEY, async () => {
      const loaded = await read(); if (!loaded) throw new GraphVectorRefusal('TVEC1003', 'Initialize the bounded stage before preparing it.');
      let journal: GraphVectorStageJournal = loaded;
      const reserved = await reservation(db, journal);
      if (!reserved || reserved.status === 'abandoned' || reserved.status === 'promoted' && !complete(journal))
        throw new GraphVectorRefusal('TVEC1003', 'The graph stage has no current primary reservation.');
      const work: GraphVectorStageWork = { staged: 0, skipped: 0, failed: 0, interrupted: 0, writes: 0, embeddingCalls: 0, embeddingTexts: 0 };
      const counted: Embedder = { ...embedder, embed: async (...args) => { work.embeddingCalls++; work.embeddingTexts += args[0].length; return embedder.embed(...args); } };
      for (let index = 0; index < journal.sources.length; index++) {
        const source = journal.sources[index];
        if (source.status === 'complete') { work.skipped++; continue; }
        if (source.status === 'running' && input.resumeInterrupted !== true)
          throw new GraphVectorRefusal('TVEC1003', 'The host must stop and explicitly resume the interrupted staging attempt.');
        const claimed = cloneJson(journal);
        if (source.status === 'running') { claimed.interrupted++; work.interrupted++; }
        claimed.sources[index].status = 'running'; claimed.sources[index].attempts++;
        await staging.transaction(async scope => {
          if (!equalsJson(await read(scope), journal)) throw new GraphVectorRefusal('TVEC1003', 'Another staging attempt changed the claim fence.');
          await write(scope, claimed);
        }, { mode: 'immediate' }); journal = claimed; work.writes++;
        await applyProbe?.('stage:claimed');
        try {
          const document = await input.prepareDocument(source, { documents: createDocumentStore(staging), embedder: counted });
          if (document.status !== 'prepared' || document.bundle.source.id !== source.source.id
            || document.bundle.version.contentHash !== source.version.contentHash
            || document.bundle.version.chunkerVersion !== source.version.chunkerVersion
            || !equalsJson(document.bundle.version.chunkerConfig, source.version.chunkerConfig)
            || !equalsJson(document.bundle.version.embeddedBy, target))
            throw new GraphVectorRefusal('TVEC1003', 'Identity staging requires the same complete source content and chunker through document preparation.');
          const prepared = lightragMust(await owner(staging).prepare({ document, graph: { ...await input.graph(source, document.bundle), embedder: counted } }));
          if (prepared.status !== 'prepared') throw new GraphVectorRefusal('TVEC1003', 'The staged graph preparation is incomplete.');
          const committed = await staging.transaction(async scope => {
            const current = await read(scope);
            if (!current || !equalsJson(current, claimed)) throw new GraphVectorRefusal('TVEC1003', 'A concurrent staging attempt changed the journal.');
            const result = lightragMust(await owner(scope).promote(prepared));
            const next = cloneJson(claimed), nextSource = next.sources[index];
            const rebaseKey = prepared.reused ? 'lightrag:vector:rebase:' + prepared.contribution.plan.revision : undefined;
            if (rebaseKey) await scope.collection('settings').put({ key: rebaseKey, value: prepared.contribution });
            nextSource.status = 'complete'; nextSource.prepared = { source: prepared.document.source, version: prepared.document.version,
              hasParents: prepared.document.parents !== undefined, projectionId: result.graph.projectionId,
              expectedHead: prepared.expectedHead, profilePolicy: prepared.profilePolicy, ...(rebaseKey ? { rebaseKey } : {}) };
            await write(scope, next); await applyProbe?.('stage:source');
            return { next, writes: result.documentWrites + result.graph.writes + 1 + Number(!!rebaseKey) };
          }, { mode: 'immediate' }); journal = committed.next; work.writes += committed.writes; work.staged++;
        } catch (cause) {
          const failed = cloneJson(claimed); failed.sources[index].status = 'failed'; failed.failed++;
          await staging.transaction(async scope => {
            if (!equalsJson(await read(scope), claimed)) throw new GraphVectorRefusal('TVEC1003', 'A superseded staging attempt cannot overwrite its successor.');
            await write(scope, failed);
          }, { mode: 'immediate' }); journal = failed; work.failed++; work.writes++;
          const refusal = lightragFailure(cause); if (refusal.valid) throw new TypeError('Expected a staging refusal.');
          return { status: 'incomplete', journal: immutableLightRagJson(journal), work, failure: refusal.issues };
        }
      }
      return { status: 'complete', journal: immutableLightRagJson(journal), work };
    })),
    promote: (): Promise<LightRagOutcome<GraphVectorSwapReceipt>> => capture(async () => {
      const journal = await read(); if (!journal || !complete(journal)) throw new GraphVectorRefusal('TVEC1003', 'Every source must finish before the joint identity swap.');
      const requests: CorpusPromotionRequest[] = [];
      for (const source of journal.sources) requests.push(await request(staging, source.prepared!));
      const targetInventory = await staging.transaction(scope => inventory(scope), { mode: 'deferred' });
      if (!equalsJson(targetInventory.identity, target) || !equalsJson(targetInventory.sources.map(row => row.source.id), journal.sources.map(row => row.source.id)))
        throw new GraphVectorRefusal('TVEC1003', 'The staged target is not the complete registered joint corpus.');
      return db.transaction(async scope => {
        const operationKey = 'lightrag:vector:swap:' + journal.id;
        const applied = await scope.collection<{ key: string; value: GraphVectorSwapReceipt }>('settings').get(operationKey);
        if (applied) return { ...applied.value, documentWrites: 0, graphWrites: 0, swaps: 0, replayed: true };
        const reserved = await reservation(scope, journal);
        if (reserved?.status !== 'pending') throw new GraphVectorRefusal('TVEC1003', 'The joint swap requires its pending primary reservation.');
        const current = await inventory(scope);
        if (current.revision !== journal.baseline || !equalsJson(current.identity, journal.active)
          || !equalsJson(current.sources, journal.sources.map(({ source, version, head }) => ({ source, version, head }))))
          throw new GraphVectorRefusal('TVEC1003', 'Source heads or the settled identity changed during staging.');
        if ((current.state?.retained.length ?? 0) >= 32) throw new GraphVectorRefusal('TVEC1003', 'Dispose an explicitly reviewed rollback before adding to the bounded retention set.');
        const promotion = owner(scope); let documentWrites = 0, graphWrites = 0;
        const graph = createLightRagStore(scope), profiles = [
          ...(await graph.listEntities()).map(row => ({ kind: 'entity' as const, id: row.id, claimIds: row.supportClaimIds, profile: row.profile })),
          ...(await graph.listRelations()).map(row => ({ kind: 'relation' as const, id: row.id, claimIds: row.supportClaimIds, profile: row.profile })),
        ];
        for (const source of journal.sources) {
          const retired = lightragMust(await promotion.retract(source.source.id, { expectedHead: source.head, at: journal.at }));
          documentWrites += retired.documentWrites; graphWrites += retired.graph?.writes ?? 0;
        }
        const revision = (current.state?.revision ?? 0) + 1;
        await scope.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: { revision, active: target,
          retained: [...(current.state?.retained ?? []), { id: journal.id, identity: journal.active,
            sources: journal.sources.map(({ source, version, head }) => ({ source, version, head })), profiles }] } });
        for (const prepared of requests) {
          const result = lightragMust(await promotion.promote(prepared)); documentWrites += result.documentWrites; graphWrites += result.graph.writes;
        }
        if (!equalsJson((await inventory(scope)).identity, target)) throw new GraphVectorRefusal('TVEC1003', 'The joint identity did not settle completely.');
        const receipt: GraphVectorSwapReceipt = { id: journal.id, before: journal.active, after: target, revision,
          documentWrites, graphWrites, swaps: 1, replayed: false };
        await scope.collection('settings').put({ key: operationKey, value: receipt }); await applyProbe?.('swap:commit');
        await scope.collection('settings').put({ key: reservationKey(journal), value: { ...reserved, status: 'promoted' } });
        return immutableLightRagJson(receipt);
      }, { mode: 'immediate' });
    }),
    abandon: (reason: string): Promise<LightRagOutcome<{ writes: number }>> => capture(async () => {
      if (!reason.trim()) throw new GraphVectorRefusal('TVEC1003', 'Abandoning a stage requires a reason.');
      const journal = await read(); if (!journal) throw new GraphVectorRefusal('TVEC1003', 'The stage is missing.');
      return db.transaction(async scope => {
        const reserved = await reservation(scope, journal);
        if (!reserved || reserved.status === 'promoted') throw new GraphVectorRefusal('TVEC1003', 'Only an unpromoted stage can be abandoned.');
        if (reserved.status === 'abandoned') {
          if (reserved.reason !== reason) throw new GraphVectorRefusal('TVEC1003', 'The retained abandonment reason cannot change.');
          return { writes: 0 };
        }
        await scope.collection('settings').put({ key: reservationKey(journal), value: { ...reserved, status: 'abandoned', reason } });
        return { writes: 1 };
      }, { mode: 'immediate' });
    }),
  };
}
