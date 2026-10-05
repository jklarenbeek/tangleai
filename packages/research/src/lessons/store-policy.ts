import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { compileJSONPointer, JSONPOINTER_NOTHING } from '@jarenjs/json/pointer';
import { validateClaimEvidence } from '@tangleai/context';
import { draftsOf, sealSkillBundle, validateTrace2SkillShape, type SkillSnapshot } from '@tangleai/trace2skill';
import type { ArtifactAdmission, LessonInjection, LessonSetRecord, LessonValidationRun, ResearchLessonScope,
  ResearchLessonV2, ResearchProject } from '../contracts.gen.ts';
import type { ResearchCode, ResearchOutcome } from '../errors.ts';
import { researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import type { ResearchStoreOutcome, ResearchTables, ResearchTransaction } from '../store.ts';
import { checkLessonRecord, lessonInputHash, lessonOriginContext, lessonScopeKey, lessonValidity } from './records.ts';
import type { LessonStore } from './store.ts';
import { bindLessonStore } from './access.ts';
import type { ResearchRecordKind, ResearchRecordMap } from '../records.ts';
import type { StageCommitReceipt } from '../contracts.gen.ts';

export interface LessonPersistenceHost {
  apply<I, T>(input: I, body: (tx: ResearchTransaction, input: I) => Promise<{ value: T; replayed?: boolean }>): Promise<ResearchStoreOutcome<T>>;
  project(tx: ResearchTransaction, id: string): Promise<ResearchProject | null>;
  origins(tx: ResearchTransaction, projectId: string): Promise<Array<{ admission: ArtifactAdmission; bytes: Uint8Array }>>;
  record<K extends ResearchRecordKind>(tx: ResearchTransaction, projectId: string, kind: K, id: string): Promise<ResearchRecordMap[K] | null>;
  receipts(tx: ResearchTransaction, projectId: string): Promise<StageCommitReceipt[]>;
  refuse(code: ResearchCode, path: string, detail: string, cause?: unknown): never;
  checked<T>(value: ResearchOutcome<T>): T;
}
const sorted = (items: readonly string[]) => [...items].sort();

/** Policy runs inside the research owner's transaction, including native skill writes. */
export function createLessonStore(host: LessonPersistenceHost): LessonStore {
  const { apply, checked } = host;
  function refuse(code: ResearchCode, path: string, detail: string, cause?: unknown): never { return host.refuse(code, path, detail, cause); }
  const scope = (value: ResearchLessonScope) => checked(validateResearchShape<ResearchLessonScope>('ResearchLessonScope', value));
  async function find<K extends 'lessons' | 'lessonValidations' | 'lessonSets' | 'lessonInjections'>(tx: ResearchTransaction, table: K, id: string) {
    checked(validateResearchShape('Sha256', id));
    let found: ResearchTables[K] | undefined;
    for (const key of await tx.scopes(table)) {
      const row = await tx.get(table, key, id);
      if (!row) continue;
      if (found) refuse('TRSH2001', '/id', 'An immutable lesson address occurs in more than one scope.');
      const expected = table === 'lessons' || table === 'lessonInjections'
        ? (row as ResearchLessonV2 | LessonInjection).projectId : lessonScopeKey((row as LessonValidationRun | LessonSetRecord).scope);
      if (key !== expected || row.id !== id) refuse('TRSH2001', '/id', 'The lesson row differs from its storage address.');
      found = row;
    }
    return found ?? null;
  }
  async function proposal(tx: ResearchTransaction, id: string): Promise<ResearchLessonV2 | null> {
    const row = await find(tx, 'lessons', id);
    return row ? checked(await checkLessonRecord<ResearchLessonV2>('ResearchLessonV2', row)) : null;
  }
  async function procedure(snapshot: SkillSnapshot): Promise<SkillSnapshot> {
    const bundle = validateTrace2SkillShape<SkillSnapshot['bundle']>('skillBundle', snapshot?.bundle);
    if (!bundle.valid || !Array.isArray(snapshot.files)) refuse('TRSH2001', '/bundle', 'Expected a complete native skill snapshot.');
    if (bundle.value.status !== 'staged') refuse('TRSH2007', '/bundle/status', 'Research authority comes from outcomes; its skill snapshot stays staged.');
    for (const file of snapshot.files) if (!validateTrace2SkillShape('skillFile', file).valid)
      refuse('TRSH2001', '/files', 'A native skill file is malformed.');
    if (snapshot.files.some(file => file.encoding !== 'utf-8'))
      refuse('TRSH2001', '/files', 'Reusable research procedure requires self-contained text files.');
    const sealed = await sealSkillBundle(draftsOf(snapshot.files), { scopeKey: bundle.value.scopeKey, mode: bundle.value.mode,
      origin: bundle.value.origin, parentId: bundle.value.parentId, status: 'staged' });
    if (!sealed.valid || !equalsJson(sealed.value, snapshot))
      refuse('TRSH2001', '/bundle', 'The native bundle and every file must reproduce from their retained content.');
    return sealed.value;
  }
  async function storedProcedure(tx: ResearchTransaction, id: string, required = false): Promise<SkillSnapshot | null> {
    checked(validateResearchShape('Sha256', id));
    const existing = await tx.skills.getBundle(id);
    if (!existing.valid) {
      if (existing.issues.some(issue => issue.code !== 'TT2S1001') || required)
        refuse('TRSH2004', '/bundleHash', 'The referenced native procedure is absent or invalid.');
      return null;
    }
    const snapshot = await tx.skills.getSnapshot(id);
    if (!snapshot.valid) refuse('TRSH2004', '/bundleHash', 'The native procedure is missing a retained file.');
    if (snapshot.value.bundle.id !== id) refuse('TRSH2001', '/bundleHash', 'The native procedure address differs from its content.');
    return procedure(snapshot.value);
  }
  async function origin(tx: ResearchTransaction, lesson: ResearchLessonV2) {
    const owner = await host.project(tx, lesson.projectId);
    if (!owner || lesson.origin.runId !== owner.id) refuse('TRSH2002', '/origin/runId', 'The origin must name its actual research run.');
    const context = checked(await lessonOriginContext(owner));
    if (!equalsJson(context.scope, lesson.scope)) refuse('TRSH2003', '/scope', 'The lesson belongs to another domain or task family.');
    if (!equalsJson(sorted(context.topicIds), sorted(lesson.origin.topicIds))
      || !equalsJson(sorted(context.topicContentHashes), sorted(lesson.origin.topicContentHashes)))
      refuse('TRSH2002', '/origin/topicIds', 'Origin topics and content must reproduce from the immutable project input.');
    const admissions = await host.origins(tx, lesson.projectId), envelope = lesson.origin.envelope;
    if (lesson.origin.artifactIds.length !== lesson.origin.hashes.length
      || !equalsJson(sorted(lesson.origin.artifactIds), sorted(envelope.artifacts.map(row => row.id))))
      refuse('TRSH2002', '/origin/artifactIds', 'The origin must bind exactly its admitted evidence artifacts.');
    const allowed: Array<{ id: string; kind: string; locator: string; digest: string }> = [];
    const content = new Map<string, string>();
    for (let index = 0; index < lesson.origin.artifactIds.length; index++) {
      const id = lesson.origin.artifactIds[index], descriptor = envelope.artifacts.find(row => row.id === id);
      const found = admissions.find(row => row.admission.artifact.id === id && row.admission.id === descriptor?.locator);
      if (!found || found.admission.artifact.verification !== 'verified' || id !== 'art-' + lesson.origin.hashes[index]) {
        const native = validateClaimEvidence(envelope, { artifacts: admissions.filter(row => row.admission.artifact.verification === 'verified')
          .map(row => ({ id: row.admission.artifact.id, kind: lesson.origin.kind, locator: row.admission.id, digest: row.admission.artifact.id.slice(4) })) });
        refuse('TRSH2002', '/origin/artifactIds/' + index, 'Origin evidence must have a committed verified admission with exact bytes.', native.errors[0]);
      }
      allowed.push({ id, kind: lesson.origin.kind, locator: found.admission.id, digest: lesson.origin.hashes[index] });
      try { content.set(id, new TextDecoder('utf-8', { fatal: true }).decode(found.bytes)); }
      catch { refuse('TRSH2002', '/origin/artifactIds/' + index, 'Lesson evidence must be retained UTF-8 content.'); }
    }
    const valid = validateClaimEvidence(envelope, { artifacts: allowed });
    if (!valid.valid || !envelope.evidence.length || !envelope.claims.length
      || envelope.claims.some(row => row.status !== 'supported' || !row.evidence.length))
      refuse('TRSH2002', '/origin/envelope', 'The origin must contain supported claims bound to visible admitted evidence.', valid.valid ? undefined : valid.errors[0]);
    for (const evidence of envelope.evidence) {
      const text = content.get(evidence.artifact);
      if (text === undefined || !evidence.quote) refuse('TRSH2002', '/origin/envelope/evidence', 'Every evidence item must retain its exact quotation.');
      if (evidence.selector) {
        let selected: unknown;
        try { selected = compileJSONPointer(evidence.selector)(JSON.parse(text)); }
        catch { refuse('TRSH2002', '/origin/envelope/evidence', 'The JSON evidence selector cannot be resolved in its artifact.'); }
        if (selected === JSONPOINTER_NOTHING || (typeof selected === 'string' ? selected : canonicalizeJson(selected)) !== evidence.quote)
          refuse('TRSH2002', '/origin/envelope/evidence', 'The quotation differs from its exact selected content.');
      } else if (!text.includes(evidence.quote)) refuse('TRSH2002', '/origin/envelope/evidence', 'The quotation does not occur in its admitted artifact.');
    }
    if (lesson.decay.observedAtRun !== owner.id) refuse('TRSH2002', '/decay/observedAtRun', 'The initial observation belongs to its actual origin run.');
    if (new Set(lesson.decay.relevanceRows.map(row => row.runId)).size !== lesson.decay.relevanceRows.length)
      refuse('TRSH2004', '/decay/relevanceRows', 'A run has only one retained relevance observation.');
    if (new TextEncoder().encode(canonicalizeJson(lesson.proposal)).length > 8192)
      refuse('TRSH2001', '/proposal', 'A lesson proposal exceeds the registered 8 KiB bound.');
    const base = await storedProcedure(tx, lesson.proposal.baseHash, true);
    if (base!.bundle.scopeKey !== lessonScopeKey(lesson.scope)) refuse('TRSH2003', '/proposal/baseHash', 'The frozen procedure belongs to another lesson scope.');
  }
  async function validation(tx: ResearchTransaction, input: LessonValidationRun) {
    const run = checked(await checkLessonRecord<LessonValidationRun>('LessonValidationRun', input));
    if (Date.parse(run.finishedAt) < Date.parse(run.startedAt)) refuse('TRSH2004', '/finishedAt', 'Validation cannot finish before it starts.');
    const origins: ResearchLessonV2[] = [];
    for (const id of run.proposalIds) {
      const lesson = await proposal(tx, id);
      if (!lesson) refuse('TRSH2004', '/proposalIds', 'The validation names an unknown proposal.');
      await origin(tx, lesson);
      if (!equalsJson(lesson.scope, run.scope)) refuse('TRSH2003', '/scope', 'Validation and proposals must share a scope.');
      if (lesson.proposal.baseHash !== run.baseBundleHash || lesson.validation.state !== 'proposed')
        refuse('TRSH2004', '/baseBundleHash', 'Validation binds the original proposals and their exact frozen base.');
      origins.push(lesson);
    }
    const base = await storedProcedure(tx, run.baseBundleHash, true), candidate = await storedProcedure(tx, run.bundleHash, true);
    if (base!.bundle.scopeKey !== lessonScopeKey(run.scope) || candidate!.bundle.scopeKey !== base!.bundle.scopeKey)
      refuse('TRSH2003', '/bundleHash', 'Validation procedures must share the proposal scope.');
    if (!equalsJson(sorted(run.topicIds), sorted(run.rows.map(row => row.topicId))))
      refuse('TRSH2004', '/topicIds', 'Every held-out topic needs exactly one retained row.');
    const inputs = new Map<string, string>();
    for (const row of run.rows) {
      const canonical = canonicalizeJson(row.input);
      if (inputs.has(row.inputHash)) refuse('TRSH2004', '/rows/inputHash', 'Duplicate or colliding held-out input addresses are refused.');
      inputs.set(row.inputHash, canonical);
      if (row.inputHash !== lessonInputHash(row.input) || row.topicContentHash !== await researchRevisionOf(row.input))
        refuse('TRSH2004', '/rows/inputHash', 'Both input identities must reproduce from the complete retained input.');
      if (origins.some(lesson => lesson.origin.topicIds.includes(row.topicId) || lesson.origin.topicContentHashes.includes(row.topicContentHash)))
        refuse('TRSH2005', '/rows/topicId', 'Held-out topic ids and content must be disjoint from every training origin.');
      if (row.score !== lessonValidity(row.output) || row.baselineScore !== lessonValidity(row.baselineOutput))
        refuse('TRSH2004', '/rows/score', 'Validity scores must reproduce from the recorded output factors.');
    }
    for (const prior of await tx.list('lessonValidations', lessonScopeKey(run.scope))) {
      const retained = checked(await checkLessonRecord<LessonValidationRun>('LessonValidationRun', prior));
      for (const row of retained.rows) {
        const fresh = run.rows.find(item => item.inputHash === row.inputHash || item.topicId === row.topicId);
        if (fresh && (fresh.inputHash !== row.inputHash || fresh.topicId !== row.topicId || !equalsJson(fresh.input, row.input)))
          refuse('TRSH2004', '/rows/inputHash', 'A retained held-out address cannot identify different topic content.');
      }
    }
    const decay = origins[0].decay.hypothesisId;
    if (origins.some(lesson => lesson.decay.hypothesisId !== decay)) refuse('TRSH2011', '/decayHypothesisId', 'A candidate set binds one registered decay hypothesis.');
    const payload = { bundleHash: run.bundleHash, lessonIds: run.proposalIds, decayHypothesisId: decay,
      rows: Object.fromEntries(run.rows.map(row => [row.inputHash, row.output])) };
    if (run.lessonSetHash !== await researchRevisionOf(payload))
      refuse('TRSH2004', '/lessonSetHash', 'Validation must bind its original proposal set, procedure and exact recorded outputs.');
    return run;
  }
  const store: LessonStore = {
    putProposal: lesson => apply(lesson, async (tx, input) => {
      const value = checked(await checkLessonRecord<ResearchLessonV2>('ResearchLessonV2', input));
      if (value.validation.state !== 'proposed' || value.validation.validationRunIds.length || value.validation.issues.length || value.parentId || value.promotion)
        refuse('TRSH2007', '/validation', 'Proposal admission cannot mint validation, lifecycle or activation authority.');
      await origin(tx, value);
      const prior = await proposal(tx, value.id);
      if (prior && !equalsJson(prior, value)) refuse('TRSH2001', '/id', 'A lesson identity cannot replace retained content.');
      if (!prior) await tx.put('lessons', value.projectId, value.id, value);
      return { value, replayed: prior !== null };
    }),
    get: id => apply({ id }, async (tx, value) => ({ value: await proposal(tx, value.id) })),
    list: query => apply(query ?? {}, async (tx, value) => {
      if (value.scope) scope(value.scope);
      const rows: ResearchLessonV2[] = [];
      for (const key of await tx.scopes('lessons')) for (const raw of await tx.list('lessons', key)) {
        const row = checked(await checkLessonRecord<ResearchLessonV2>('ResearchLessonV2', raw));
        if (row.projectId !== key) refuse('TRSH2001', '/projectId', 'The lesson row differs from its storage scope.');
        if ((!value.projectId || value.projectId === row.projectId) && (!value.scope || equalsJson(value.scope, row.scope))) rows.push(row);
      }
      return { value: rows.sort((a, b) => a.id < b.id ? -1 : 1) };
    }),
    putValidation: run => apply(run, async (tx, input) => {
      const value = await validation(tx, input), prior = await find(tx, 'lessonValidations', value.id);
      if (prior && !equalsJson(prior, value)) refuse('TRSH2001', '/id', 'A validation identity cannot replace retained content.');
      if (!prior) await tx.put('lessonValidations', lessonScopeKey(value.scope), value.id, value);
      return { value, replayed: prior !== null };
    }),
    getValidation: id => apply({ id }, async (tx, value) => {
      const raw = await find(tx, 'lessonValidations', value.id);
      return { value: raw ? await validation(tx, raw) : null };
    }),
    listValidations: input => apply(input, async (tx, value) => {
      scope(value); const rows: LessonValidationRun[] = [];
      for (const raw of await tx.list('lessonValidations', lessonScopeKey(value))) {
        if (!equalsJson(raw.scope, value)) refuse('TRSH2003', '/scope', 'The validation row differs from its storage scope.');
        rows.push(await validation(tx, raw));
      }
      return { value: rows };
    }),
    getSet: id => apply({ id }, async (tx, value) => {
      const raw = await find(tx, 'lessonSets', value.id);
      return { value: raw ? checked(await checkLessonRecord<LessonSetRecord>('LessonSetRecord', raw)) : null };
    }),
    getInjection: id => apply({ id }, async (tx, value) => {
      const raw = await find(tx, 'lessonInjections', value.id);
      return { value: raw ? checked(await checkLessonRecord<LessonInjection>('LessonInjection', raw)) : null };
    }),
    listInjections: projectId => apply({ projectId }, async (tx, value) => {
      await host.project(tx, value.projectId); const rows: LessonInjection[] = [];
      for (const raw of await tx.list('lessonInjections', value.projectId)) {
        const row = checked(await checkLessonRecord<LessonInjection>('LessonInjection', raw));
        if (row.projectId !== value.projectId) refuse('TRSH2003', '/projectId', 'The injection belongs to another project.');
        rows.push(row);
      }
      return { value: rows };
    }),
    putProcedure: input => apply(input, async (tx, value) => {
      const snapshot = await procedure(value), prior = await storedProcedure(tx, snapshot.bundle.id);
      if (prior && !equalsJson(prior, snapshot)) refuse('TRSH2001', '/bundle', 'A procedure identity cannot replace retained content.');
      if (!prior) {
        const written = await tx.skills.putSnapshot(snapshot);
        if (!written.valid) refuse('TRSH2001', '/bundle', 'The native skill store refused the procedure.');
      }
      return { value: snapshot, replayed: prior !== null };
    }),
    getProcedure: id => apply({ id }, async (tx, value) => ({ value: await storedProcedure(tx, value.id) })),
  };
  bindLessonStore(store, { ...host, proposal, origin, validation, procedure, storedProcedure });
  return store;
}
