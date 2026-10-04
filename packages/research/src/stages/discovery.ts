import { mapConcurrent } from '@jarenjs/core/async';
import { createAttemptBudget } from '@jarenjs/core/retry';
import { equalsJson } from '@jarenjs/core/object';
import type { QueryPlan, InclusionCriteria, DiscoveryReceipt, DiscoveryQuery } from '../contracts.gen.ts';
import type { ResearchTaskTools, ResearchStageOperation, ResearchStageAccess, ResearchStageResult } from '../handlers.ts';
import type { ResearchOutcome } from '../errors.ts';
import { researchRefuse } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf, researchArtifactIdOf } from '../identity.ts';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { discoverOpenalex, discoverCrossref, discoverSemanticScholar, discoverArxiv, discoverSearxng, dedupeLiterature } from '../adapters/index.ts';
import { createResearchProviderDispatcher, jsonArtifact, type ResearchProviderHost, type ResearchAdapterContext, type ScholarlyResult } from '../adapters/runtime.ts';
import { createInclusionCriteria, screenLiterature } from './screening.ts';
import { acquireResearchSources, type ResearchDocumentHost, type ResearchAcquisitionLimits } from './acquire.ts';
import { resolveEvidenceCard } from './cards.ts';

export async function createQueryPlan(input: Omit<QueryPlan, 'id'>): Promise<QueryPlan> {
  const { id: _previous, ...body } = immutableResearchJson(input as QueryPlan);
  const plan = researchValue(validateResearchShape<QueryPlan>('QueryPlan', { ...body, id: 'query-' + await researchRevisionOf(body) }));
  if (new Set(plan.queries.map(q => q.id)).size !== plan.queries.length
    || new Set(plan.queries.map(q => q.provider + ':' + q.text)).size !== plan.queries.length) throw new TypeError('Discovery query identities must be unique.');
  return plan;
}
export interface ResearchDiscoveryOptions {
  plan: QueryPlan;
  criteria: InclusionCriteria;
  acquisition: ResearchAcquisitionLimits;
  extractionPromptRevision: string;
  searxngBaseUrl: string | null;
  provider: ResearchProviderHost;
  documents: ResearchDocumentHost;
}
export function discoveryRevisionOf(options: Pick<ResearchDiscoveryOptions, 'plan' | 'criteria' | 'acquisition' | 'extractionPromptRevision' | 'searxngBaseUrl'>): Promise<string> {
  return researchRevisionOf({ plan: options.plan, criteria: options.criteria, acquisition: options.acquisition,
    extractionPromptRevision: options.extractionPromptRevision, searxngBaseUrl: options.searxngBaseUrl });
}
/** This is called only after the plan artifact has been admitted by the enclosing stage. */
export async function executeScholarlyDiscovery(plan: QueryPlan, host: ResearchProviderHost, signal: AbortSignal, searxngBaseUrl: string | null = null) {
  host = { ...host, licence: immutableResearchJson(host.licence) };
  const pinned = researchValue(validateResearchShape<QueryPlan>('QueryPlan', plan));
  const { id, ...body } = pinned;
  if (id !== (await createQueryPlan(body)).id) throw new TypeError('Query plan identity mismatch.');
  const dispatcher = createResearchProviderDispatcher(host, { concurrency: pinned.concurrency, bytes: pinned.maxBytes });
  const context: ResearchAdapterContext = { signal, budget: createAttemptBudget(pinned.maxRequests), bytes: { remaining: pinned.maxBytes, consumed: 0 }, dispatcher };
  const adapters = { openalex: discoverOpenalex, crossref: discoverCrossref, semanticscholar: discoverSemanticScholar, arxiv: discoverArxiv };
  let results: ScholarlyResult[];
  try { results = await mapConcurrent(pinned.queries, pinned.concurrency, async (query: DiscoveryQuery): Promise<ScholarlyResult> => {
    if (query.provider === 'searxng') {
      if (!searxngBaseUrl) throw new TypeError('SearxNG query requires an injected public endpoint.');
      return discoverSearxng(query, host, context, searxngBaseUrl);
    }
    return adapters[query.provider](query, host, context);
  }); } finally { await dispatcher.close(); }
  const merged = await dedupeLiterature(results.flatMap(r => r.records));
  const candidates = results.flatMap(r => r.candidates).sort((a, b) => a.id.localeCompare(b.id));
  const value = { projectId: pinned.projectId, queryPlanId: pinned.id, criteriaId: pinned.criteriaId, outcomes: results.map(r => r.outcome),
    literatureIds: merged.records.map(r => r.id), candidateIds: candidates.map(c => c.id), dedupe: merged.dedupe };
  const receipt = researchValue(validateResearchShape<DiscoveryReceipt>('DiscoveryReceipt', { ...value, id: 'discovery-' + await researchRevisionOf(value) }));
  return { receipt, literature: merged.records, candidates, artifacts: results.flatMap(r => r.artifacts) };
}

/** Compose discovery into the existing CREATE and DISCOVERY tasks, preserving the native topology. */
export async function createDiscoveryStageTools(base: ResearchTaskTools, options: ResearchDiscoveryOptions): Promise<ResearchTaskTools> {
  const { provider, documents, ...data } = options, pinned = immutableResearchJson(data);
  const host = { ...provider, licence: immutableResearchJson(provider.licence) };
  const docHost: ResearchDocumentHost = { ingester: { ingest: documents.ingester.ingest.bind(documents.ingester) },
    store: { getVersion: documents.store.getVersion.bind(documents.store), listElements: documents.store.listElements.bind(documents.store) },
    readSourceBytes: documents.readSourceBytes.bind(documents) };
  const execute = base.execute, verify = base.verify, revision = await discoveryRevisionOf(pinned);
  const { id: planId, ...planBody } = pinned.plan;
  const { id: _criteriaId, revision: _criteriaRevision, ...criteriaBody } = pinned.criteria;
  if (!equalsJson(await createQueryPlan(planBody), pinned.plan) || pinned.plan.criteriaId !== pinned.criteria.id
    || !equalsJson(await createInclusionCriteria(criteriaBody), pinned.criteria)
    || pinned.plan.projectId !== base.contract.projectId || !base.binding.toolVersions.some(t => t.name === 'scholarly-discovery' && t.version === revision))
    throw new TypeError('Discovery plan, criteria and tool revision must be pinned before workflow preparation.');
  const planArtifact = jsonArtifact(pinned.plan), criteriaArtifact = jsonArtifact(pinned.criteria);
  const planHash = await researchArtifactIdOf(planArtifact.bytes), criteriaHash = await researchArtifactIdOf(criteriaArtifact.bytes);
  async function inputs(op: ResearchStageOperation, access: ResearchStageAccess) {
    for (const [hash, expected] of [[planHash, pinned.plan], [criteriaHash, pinned.criteria]] as const) {
      const ref = op.frame.artifacts.find(a => a.artifactId === hash);
      if (!ref || !equalsJson(JSON.parse(new TextDecoder().decode(await access.readArtifact(ref))), expected))
        researchFail('TRSH1005', '/queryPlan', 'Discovery needs its exact committed query plan and criteria.');
    }
  }
  return { ...base,
    async execute(op, access) {
      if (op.stage === 'create') {
        const result = await execute(op, access);
        return { ...result, artifacts: [...result.artifacts, planArtifact, criteriaArtifact],
          records: [...result.records, { kind: 'QueryPlan', value: pinned.plan }, { kind: 'InclusionCriteria', value: pinned.criteria }] };
      }
      if (op.stage !== 'discovery') return execute(op, access);
      await inputs(op, access);
      const discovered = await executeScholarlyDiscovery(pinned.plan, host, access.signal, pinned.searxngBaseUrl);
      const screening = await screenLiterature(op.frame.projectId, pinned.criteria, discovered.literature);
      const acquired = await acquireResearchSources(discovered.literature, screening, docHost,
        { signal: access.signal, promptRevision: pinned.extractionPromptRevision, limits: pinned.acquisition });
      const result: ResearchStageResult = { spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
        records: [{ kind: 'DiscoveryReceipt', value: discovered.receipt },
          ...discovered.literature.map(value => ({ kind: 'LiteratureRecord' as const, value })),
          ...discovered.candidates.map(value => ({ kind: 'DiscoveryCandidate' as const, value })),
          ...screening.map(value => ({ kind: 'ScreeningDecision' as const, value })),
          ...acquired.acquisitions.map(value => ({ kind: 'SourceAcquisition' as const, value })),
          ...acquired.cards.map(value => ({ kind: 'EvidenceCard' as const, value }))],
        artifacts: [...discovered.artifacts, ...acquired.artifacts] };
      result.artifacts.push(jsonArtifact({ kind: 'discovery-records', value: result.records }));
      return result;
    },
    async verify(op, result, access): Promise<ResearchOutcome<null>> {
      if (op.stage === 'create') {
        const hashes = await Promise.all(result.artifacts.slice(-2).map(a => researchArtifactIdOf(a.bytes)));
        if (!equalsJson(hashes, [planHash, criteriaHash]) || !equalsJson(result.records.slice(-2),
          [{ kind: 'QueryPlan', value: pinned.plan }, { kind: 'InclusionCriteria', value: pinned.criteria }]))
          return researchRefuse('TRSH1005', '/queryPlan', 'CREATE did not retain the frozen plan and criteria.');
        return verify(op, { ...result, artifacts: result.artifacts.slice(0, -2), records: result.records.slice(0, -2) }, access);
      }
      if (op.stage !== 'discovery') return verify(op, result, access);
      await inputs(op, access);
      const artifacts = new Map(await Promise.all(result.artifacts.map(async a => [await researchArtifactIdOf(a.bytes), a.bytes] as const)));
      const records = result.records.filter(r => r.kind === 'LiteratureRecord').map(r => r.value);
      const receipts = result.records.filter(r => r.kind === 'DiscoveryReceipt').map(r => r.value);
      if (!artifacts.has(await researchArtifactIdOf(jsonArtifact({ kind: 'discovery-records', value: result.records }).bytes)))
        return researchRefuse('TRSH1005', '/records', 'The admitted discovery artifact must contain the exact committed record set.');
      if (receipts.length !== 1 || receipts[0].queryPlanId !== planId || receipts[0].criteriaId !== pinned.criteria.id
        || !equalsJson(receipts[0].literatureIds, records.map(r => r.id))
        || !equalsJson(receipts[0].candidateIds, result.records.filter(r => r.kind === 'DiscoveryCandidate').map(r => r.value.id))
        || !equalsJson(receipts[0].outcomes.map(o => [o.queryId, o.provider]), pinned.plan.queries.map(q => [q.id, q.provider])))
        return researchRefuse('TRSH1005', '/receipt', 'Discovery record census differs from its plan.');
      const prefixes: Record<string, string> = { LiteratureRecord: 'lit-', DiscoveryCandidate: 'candidate-', DiscoveryReceipt: 'discovery-',
        ScreeningDecision: 'screen-', SourceAcquisition: 'acquisition-', EvidenceCard: 'card-' };
      for (const row of result.records) {
        const checked = validateResearchShape(row.kind, row.value); if (!checked.valid) return checked as ResearchOutcome<null>;
        const { id, ...body } = row.value as { id: string };
        if (id !== prefixes[row.kind] + await researchRevisionOf(body)) return researchRefuse('TRSH1002', '/records/id', 'Discovery content address does not recompute.');
      }
      for (const outcome of receipts[0].outcomes) if (!artifacts.has(outcome.observationArtifactId)
        || outcome.rawHashes.some(h => !artifacts.has('art-' + h)) || outcome.state !== 'complete' && !outcome.issues.length)
        return researchRefuse('TRSH1005', '/outcomes', 'Discovery observation or failure evidence is missing.');
      for (const row of records) if (!row.rawHashes.length || row.rawHashes.some(h => !artifacts.has('art-' + h.sha256)))
        return researchRefuse('TRSH1005', '/rawHashes', 'Literature lacks retained raw response bytes.');
      for (const row of records) if (row.rawHashes.some(h => !receipts[0].outcomes.some(o =>
        o.provider === h.source && o.state === 'complete' && o.rawHashes.includes(h.sha256))))
        return researchRefuse('TRSH1005', '/literature', 'Literature must come from complete registered provider observations.');
      for (const row of result.records.filter(r => r.kind === 'DiscoveryCandidate').map(r => r.value))
        if (!receipts[0].outcomes.some(o => o.queryId === row.queryId && o.provider === 'searxng' && o.state === 'complete' && o.rawHashes.includes(row.rawHash)))
          return researchRefuse('TRSH1005', '/candidates', 'Candidate does not belong to a registered successful broad-web query.');
      const expected = await screenLiterature(op.frame.projectId, pinned.criteria, records);
      if (!equalsJson(expected, result.records.filter(r => r.kind === 'ScreeningDecision').map(r => r.value)))
        return researchRefuse('TRSH1005', '/screening', 'Screening differs from the frozen rule reviewer.');
      const kept = expected.filter(s => s.decision === 'keep').map(s => s.literatureId).sort();
      const acquisitions = result.records.filter(r => r.kind === 'SourceAcquisition').map(r => r.value);
      if (!equalsJson(acquisitions.map(a => a.literatureId).sort(), kept))
        return researchRefuse('TRSH1005', '/acquisitions', 'Each included source needs exactly one acquisition outcome.');
      for (const row of acquisitions) if (row.status === 'resolved'
        ? !row.versionId || !row.contentHash || row.artifactId !== 'art-' + row.contentHash || !artifacts.has(row.artifactId)
        : !row.issues.length || row.versionId !== null || row.contentHash !== null || row.artifactId !== null)
        return researchRefuse('TRSH1005', '/acquisitions', 'Source acquisition does not retain its version and bytes or explicit failure.');
      for (const card of result.records.filter(r => r.kind === 'EvidenceCard').map(r => r.value)) {
        if (!kept.includes(card.literatureId) || !acquisitions.some(a => a.literatureId === card.literatureId && a.status === 'resolved'
          && a.versionId === card.versionId && a.contentHash === card.contentHash && a.artifactId === card.artifactId))
          return researchRefuse('TRSH1005', '/cards', 'Evidence card does not belong to an included, acquired source.');
        const resolved = await resolveEvidenceCard(card, docHost.store, async id => {
          const bytes = artifacts.get(id); if (!bytes) throw new TypeError('Missing full-source artifact.'); return bytes;
        });
        if (!resolved.valid) return resolved as ResearchOutcome<null>;
      }
      return { valid: true, value: null };
    } };
}
