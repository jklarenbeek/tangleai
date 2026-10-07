/** Domain checks and accounting surround the one injected atomic persistence seam. */
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { checkExperientialRecord, experientialHeadKey, sealExperientialRecord } from './identity.ts';
import { experientialIssue, experientialNativeCause, type ExperientialIssueCode, type ExperientialResult } from './errors.ts';
import { planExperienceTransition, planTrainingTransition, planArtifactTransition, planExperientialActivation, planExperientialRollback, planExperientialHead, checkExperientialHead } from './lifecycle.ts';
import { experientialBaseDigest } from './deployment.ts';
import { routesToCanary } from './canary.ts';
import { EXPERIENTIAL_TABLE_KINDS, EXPERIENTIAL_TABLES, type ExperientialPersistence, type ExperientialTransaction,
  type ExperientialTables, type ExperientialTable, type ExperientialStoreResult, type ExperientialStore, type ExperientialWrite, type ExperientialStoreStats,
  type ExperientialSnapshot } from './store-types.ts';
import { createExperientialMemoryPersistence, type ExperientialMemoryOptions } from './persistence-memory.ts';
import { checkExperientialDataset } from './dataset.ts';
import { checkTrainingBindings, initialTrainingProgress, planExperientialTrainingUpdate } from './training.ts';
import { isVerifiedArtifactReceipt } from './backend.ts';
import { planExperientialEvaluation, recordExperientialEvaluation } from './evaluation.ts';
import { admitExperientialTrigger, experientialTriggerBinding } from './trigger-admission.ts';
import { planExperientialRetention } from './retention.ts';
import type { ExperientialIssue, ExperientialHead, ExperientialArtifact, ExperientialDataset, ExperientialTrainingRun, ExperientialApproval, ExperientialEvaluation } from './contracts.gen.ts';
import type { ExperientialActivationPlan, ExperientialTransitionPlan } from './lifecycle.ts';

class Refusal extends Error {
  readonly issues: ExperientialIssue[];
  constructor(issues: ExperientialIssue[]) { super(issues[0]?.detail ?? 'Experiential operation refused.'); this.issues = issues; }
}
function refuse(code: ExperientialIssueCode, path: string, detail: string): never { throw new Refusal([experientialIssue(code, path, detail)]); }
function checked<T>(result: ExperientialResult<T>): T { if (!result.ok) throw new Refusal(result.issues); return result.value; }
const snapshot = <T>(value: T): T => JSON.parse(canonicalizeJson(value)) as T;
const order = (values: readonly string[]) => [...values].sort();
const stateTable = { experience: 'experiences', trainingRun: 'training_runs', artifact: 'artifacts' } as const;
export interface ExperientialStoreOptions { now: () => string }
interface Context { tx: ExperientialTransaction; writes: number; activations: number; at(): string }

export function createExperientialStoreAdapter(persistence: ExperientialPersistence, options: ExperientialStoreOptions): ExperientialStore {
  if (typeof persistence?.transaction !== 'function' || typeof options?.now !== 'function') throw new TypeError('Atomic persistence and an injected clock are required.');
  const stats: ExperientialStoreStats = { transactions: 0, writes: 0, activations: 0 };
  function known(table: ExperientialTable) { if (!EXPERIENTIAL_TABLES.includes(table)) throw new TypeError('Unknown experiential table.'); }
  async function record<K extends ExperientialTable>(table: K, value: unknown): Promise<ExperientialTables[K]> {
    known(table);
    return checked(await checkExperientialRecord(EXPERIENTIAL_TABLE_KINDS[table], value)) as unknown as ExperientialTables[K];
  }
  async function get<K extends ExperientialTable>(tx: ExperientialTransaction, table: K, id: string): Promise<ExperientialTables[K] | null> {
    known(table);
    if (!/^[a-f0-9]{64}$/.test(id)) refuse('TEXP1001', '/id', 'Expected a content address.');
    const raw = await tx.get(table, id);
    if (raw === undefined) return null;
    const row = await record(table, raw);
    if (row.id !== id) refuse('TEXP1002', '/id', 'The retained record differs from its storage address.');
    return row;
  }
  async function list<K extends ExperientialTable>(tx: ExperientialTransaction, table: K, scope: string): Promise<ExperientialTables[K][]> {
    known(table);
    if (typeof scope !== 'string' || !scope.trim() || scope.length > 256) refuse('TEXP1001', '/scope', 'Expected a bounded nonempty scope.');
    const rows: ExperientialTables[K][] = [], seen = new Set<string>();
    for (const raw of await tx.list(table, scope)) {
      const row = await record(table, raw);
      if (row.scope !== scope || seen.has(row.id)) refuse('TEXP1002', '/scope', 'A retained scope contains a foreign or duplicate record.');
      seen.add(row.id); rows.push(row);
    }
    return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  async function requireRow<K extends ExperientialTable>(tx: ExperientialTransaction, table: K, id: string, scope: string): Promise<ExperientialTables[K]> {
    const row = await get(tx, table, id);
    if (!row) refuse('TEXP1004', '/' + table + '/' + id, 'The lineage reference is missing.');
    if (row.scope !== scope) refuse('TEXP1005', '/' + table + '/' + id, 'The reference belongs to another scope.');
    return row;
  }
  async function write<K extends ExperientialTable>(ctx: Context, table: K, value: ExperientialTables[K]) { await ctx.tx.put(table, value); ctx.writes++; }
  async function event(ctx: Context, scope: string, kind: string, recordId: string, detail: string): Promise<ExperientialTables['events']> {
    const prior = await list(ctx.tx, 'events', scope), seq = prior.reduce((n, row) => Math.max(n, row.seq), 0) + 1;
    if (!Number.isSafeInteger(seq)) refuse('TEXP1009', '/events/seq', 'The event sequence capacity is exhausted.');
    const row = checked(await sealExperientialRecord('event', { document: 'experiential-event', schemaVersion: 1,
      scope, recordedAt: ctx.at(), seq, kind, recordId, runId: null, detail }));
    await write(ctx, 'events', row); return row;
  }
  async function operation<T>(task: (ctx: Context) => Promise<T>): Promise<ExperientialStoreResult<T>> {
    let context: Context | undefined;
    stats.transactions++;
    try {
      const value = await persistence.transaction(async tx => {
        let at: string | undefined;
        context = { tx, writes: 0, activations: 0, at: () => at ??= options.now() };
        return task(context);
      });
      stats.writes += context!.writes; stats.activations += context!.activations;
      return { ok: true, value, writes: context!.writes, replayed: context!.writes === 0 };
    } catch (error) {
      return { ok: false, issues: error instanceof Refusal ? error.issues : [experientialIssue('TEXP1009', '', 'The storage operation failed before publication.', experientialNativeCause(error))] };
    }
  }
  function copied<I, T>(input: I, task: (ctx: Context, value: I) => Promise<T>): Promise<ExperientialStoreResult<T>> {
    let value: I;
    try { value = snapshot(input); }
    catch { return Promise.resolve({ ok: false, issues: [experientialIssue('TEXP1001', '', 'Only finite JSON data is accepted.')] }); }
    return operation(ctx => task(ctx, value));
  }
  async function dataset(tx: ExperientialTransaction, row: ExperientialDataset) {
    const ids = row.selectedIds, splitIds = Object.values(row.splits).flat();
    if (!equalsJson(order(ids), order(splitIds)) || new Set(splitIds).size !== splitIds.length
      || !equalsJson(order(ids), order(row.groupKeys.map(group => group.experienceId))) || new Set(row.groupKeys.map(group => group.experienceId)).size !== ids.length)
      refuse('TEXP1011', '/splits', 'Every selected experience must occur in exactly one split and grouping row.');
    if (row.assessmentIds.length !== ids.length) refuse('TEXP1004', '/assessmentIds', 'Each selected experience requires its exact assessment.');
    const reviewed = new Set<string>();
    for (const id of row.assessmentIds) {
      const a = await requireRow(tx, 'assessments', id, row.scope);
      if (!ids.includes(a.experienceId) || reviewed.has(a.experienceId)) refuse('TEXP1004', '/assessmentIds', 'Assessment bindings do not cover the selected experiences exactly.');
      if (!a.generalizable || (a.author.kind !== 'model' && a.inclusion !== 'include') || a.duplicateOf || a.contradiction === 'unresolved')
        refuse('TEXP1005', '/assessmentIds', 'The pinned assessment does not admit this experience.');
      reviewed.add(a.experienceId);
    }
    for (const id of ids) {
      const e = await requireRow(tx, 'experiences', id, row.scope);
      if (e.state !== 'selected') refuse('TEXP1006', '/selectedIds', 'A dataset can retain only selected experiences.');
    }
    if (Object.values(row.exclusions.byReason).reduce((a, b) => a + b, 0) !== row.exclusions.total)
      refuse('TEXP1001', '/exclusions', 'Exclusion counts do not reconcile.');
    checked(await checkExperientialDataset(row, await Promise.all(ids.map(id => requireRow(tx, 'experiences', id, row.scope))),
      await Promise.all(row.assessmentIds.map(id => requireRow(tx, 'assessments', id, row.scope))), {
        experiences: await Promise.all((row.groupingExperienceIds ?? []).map(id => requireRow(tx, 'experiences', id, row.scope))),
        assessments: await Promise.all((row.groupingAssessmentIds ?? []).map(id => requireRow(tx, 'assessments', id, row.scope))),
      }));
  }
  async function artifact(tx: ExperientialTransaction, row: ExperientialArtifact) {
    if (row.kind === 'base') {
      if (row.baseArtifactId !== null || row.trainingRunId !== null || row.method !== null) refuse('TEXP1004', '/baseArtifactId', 'A registered base has no training ancestry.');
    } else {
      if (!row.baseArtifactId || !row.trainingRunId || !row.method) refuse('TEXP1004', '/trainingRunId', 'A learned artifact requires its base and completed training run.');
      await requireRow(tx, 'artifacts', row.baseArtifactId, row.scope);
      const run = await requireRow(tx, 'training_runs', row.trainingRunId, row.scope);
      if (run.state !== 'complete' || run.baseArtifactId !== row.baseArtifactId || run.method !== row.method)
        refuse('TEXP1006', '/trainingRunId', 'Only completed matching training may register an artifact.');
      if (run.spec && (run.progress?.artifactId !== row.id || run.progress.stage !== 'registered'
        || run.progress.receipt?.sha256 !== row.checksum || run.progress.verifiedBytes !== row.sizeBytes
        || !equalsJson(run.progress.receipt.runtime, row.runtime) || run.progress.receipt.storageUri !== row.storageUri))
        refuse('TEXP1008', '/trainingRunId', 'Managed training can register only its independently verified artifact.');
    }
  }
  async function bindings<K extends ExperientialTable>(ctx: Context, table: K, row: ExperientialTables[K]) {
    if (table === 'heads' || table === 'events') refuse('TEXP1006', '/table', 'Heads and events belong to checked commands.');
    if (table === 'experiences' && (row as ExperientialTables['experiences']).state !== 'observed') refuse('TEXP1006', '/state', 'A new experience starts observed.');
    if (table === 'assessments') {
      const a = row as ExperientialTables['assessments']; await requireRow(ctx.tx, 'experiences', a.experienceId, a.scope);
      if (a.duplicateOf) { if (a.duplicateOf === a.experienceId) refuse('TEXP1005', '/duplicateOf', 'An experience cannot duplicate itself.'); await requireRow(ctx.tx, 'experiences', a.duplicateOf, a.scope); }
    }
    if (table === 'datasets') await dataset(ctx.tx, row as ExperientialDataset);
    if (table === 'training_runs') {
      const run = row as ExperientialTrainingRun;
      const selected = await requireRow(ctx.tx, 'datasets', run.datasetId, run.scope), base = await requireRow(ctx.tx, 'artifacts', run.baseArtifactId, run.scope);
      if (run.state !== 'queued' || run.startedAt || run.finishedAt || run.submissions || run.logRefs.length || run.metricsRef || run.stopReason)
        refuse('TEXP1006', '/state', 'A new training run starts queued without operational results.');
      if (run.spec || run.progress || run.pipelineRevision || run.runtime) {
        checked(await checkTrainingBindings(run, selected, base));
        if (!equalsJson(run.progress, initialTrainingProgress(run.recordedAt)))
          refuse('TEXP1006', '/progress', 'Managed training starts with empty dispatch, polling and verification facts.');
      }
      for (const prior of await list(ctx.tx, 'training_runs', run.scope)) if (prior.idempotencyKey === run.idempotencyKey && prior.id !== run.id)
        refuse('TEXP1002', '/idempotencyKey', 'An idempotency key already names different training inputs.');
    }
    if (table === 'artifacts') { const a = row as ExperientialArtifact; if (a.state !== 'staged' || a.evaluationRegistration) refuse('TEXP1006', '/state', 'A new artifact starts staged without an evaluation registration.'); await artifact(ctx.tx, a); }
    if (table === 'evaluations') refuse('TEXP1006', '/evaluation', 'Evaluation results and artifact states must be recorded together.');
    if (table === 'approvals') {
      const approval = row as ExperientialApproval, a = await requireRow(ctx.tx, 'artifacts', approval.artifactId, approval.scope), e = await requireRow(ctx.tx, 'evaluations', approval.evaluationId, approval.scope);
      if (e.artifactId !== a.id || !e.passed || e.failures.length || !approval.reason.trim()) refuse('TEXP1006', '/evaluationId', 'Approval requires a passing evaluation of the exact target.');
      if (a.evaluationRegistration?.id !== e.registrationId || approval.profile !== e.profile
        || approval.action !== 'rollback' && !equalsJson(approval.expectedHead, e.expectedHead))
        refuse('TEXP1002', '/evaluationId', 'Approval must bind the frozen evaluation registration, profile and expected head.');
      const deployment = await currentDeployment(ctx, approval.deploymentId, approval.scope);
      if (approval.profile !== deployment.profile) refuse('TEXP1005', '/profile', 'The approval names another deployment profile.');
    }
    if (table === 'deployments') {
      const d = row as ExperientialTables['deployments'];
      if (d.activeArtifactId !== null || d.canaryArtifactId !== null || d.rolloutFraction !== 0 || d.expectedParentArtifactId !== null || d.approvalId !== null || d.revision !== 0 || d.headRevision !== 0 || d.rollbackReason !== null)
        refuse('TEXP1006', '/deployment', 'Ordinary persistence may register only an inactive base deployment.');
      if ((await list(ctx.tx, 'deployments', d.scope)).some(prior => prior.profile === d.profile)) refuse('TEXP1006', '/profile', 'A profile already has a registered deployment.');
      if ((await currentHead(ctx, d.profile, d.scope)).head.versionId !== null) refuse('TEXP1006', '/profile', 'A base deployment cannot replace an active head.');
      const base = await requireRow(ctx.tx, 'artifacts', d.baseArtifactId, d.scope);
      if (base.kind !== 'base' || d.base.digest !== await experientialBaseDigest(d.base)
        || base.runtime.provider !== d.base.provider || base.runtime.base !== d.base.base || base.runtime.servedModel !== d.base.model)
        refuse('TEXP1004', '/base', 'The deployment must bind a registered base artifact and its exact runtime.');
    }
    if (table === 'pins') refuse('TEXP1006', '/pin', 'Inference pins belong to the checked pin command.');
    if (table === 'retention_decisions') {
      const r = row as ExperientialTables['retention_decisions'];
      if (r.decision === 'archive') refuse('TEXP1012', '/decision', 'Archival decisions belong to the checked retention command.');
      if (r.dependentArtifactId) await requireRow(ctx.tx, 'artifacts', r.dependentArtifactId, r.scope);
    }
  }
  async function put<K extends ExperientialTable>(ctx: Context, table: K, raw: ExperientialTables[K]): Promise<ExperientialTables[K]> {
    const row = await record(table, raw), prior = await get(ctx.tx, table, row.id);
    if (prior) {
      if (!equalsJson(prior, row)) refuse('TEXP1002', '/id', 'An immutable re-put cannot change retained bytes, state or observation metadata.');
      return prior;
    }
    await bindings(ctx, table, row);
    await write(ctx, table, row);
    await event(ctx, row.scope, 'record-admitted', row.id, table);
    return row;
  }
  async function currentHead(ctx: Context, profile: string, scope: string): Promise<ExperientialHead> {
    const id = await experientialHeadKey(profile, scope), row = await get(ctx.tx, 'heads', id);
    if (row) {
      if (row.profile !== profile || row.scope !== scope) refuse('TEXP1002', '/head', 'The head address differs from its partition.');
      if (!row.eventId || !row.head.versionId || row.head.revision < 1) refuse('TEXP1002', '/head', 'A retained head requires its activation event.');
      const audit = await requireRow(ctx.tx, 'events', row.eventId, scope), target = await requireRow(ctx.tx, 'artifacts', row.head.versionId, scope);
      let detail: { profile?: string; after?: unknown };
      try { detail = JSON.parse(audit.detail); }
      catch { refuse('TEXP1002', '/head/eventId', 'The activation event has invalid transition details.'); }
      if (!['artifact-activated', 'artifact-rolled-back'].includes(audit.kind) || audit.recordId !== target.id || target.state !== 'active'
        || detail?.profile !== profile || !equalsJson(detail?.after, row.head)) refuse('TEXP1002', '/head/eventId', 'The head does not reproduce its retained activation event.');
      return row;
    }
    return checked(await sealExperientialRecord('head', { document: 'experiential-head', schemaVersion: 1, scope,
      recordedAt: ctx.at(), profile, head: { versionId: null, revision: 0 }, eventId: null }));
  }
  async function currentDeployment(ctx: Context, id: string, scope: string) {
    const d = await requireRow(ctx.tx, 'deployments', id, scope), h = await currentHead(ctx, d.profile, scope);
    if (d.base.digest !== await experientialBaseDigest(d.base) || d.activeArtifactId !== h.head.versionId || d.headRevision !== h.head.revision)
      refuse('TEXP1002', '/deployment', 'The retained deployment differs from its base or head.');
    if (d.revision === 0) {
      if (d.activeArtifactId !== null || d.canaryArtifactId !== null || d.rolloutFraction !== 0 || d.expectedParentArtifactId !== null || d.approvalId !== null || d.rollbackReason !== null)
        refuse('TEXP1002', '/deployment', 'An initial deployment has unexpected serving state.');
    } else {
      const history = await list(ctx.tx, 'events', scope);
      const matched = history.some(row => {
        if (!['artifact-canaried', 'artifact-activated', 'artifact-rolled-back'].includes(row.kind)) return false;
        try { const detail = JSON.parse(row.detail); return detail.profile === d.profile && equalsJson(detail.deploymentAfter, d); }
        catch { return false; }
      });
      if (!matched) refuse('TEXP1002', '/deployment', 'The retained deployment has no exact transition event.');
    }
    return d;
  }
  async function applyActivation(ctx: Context, requested: ExperientialActivationPlan, operation: 'activate' | 'rollback') {
    if (!requested || typeof requested !== 'object') refuse('TEXP1001', '/plan', 'An activation plan is required.');
    const reproduce = (input: Parameters<typeof planExperientialActivation>[0], reason: string | null) => operation === 'activate'
      ? planExperientialActivation(input) : planExperientialRollback({ ...input, reason: reason as string });
    const original = checked(reproduce({ head: await record('heads', requested.head), deployment: await record('deployments', requested.deployment),
      artifact: await record('artifacts', requested.artifact), evaluation: await record('evaluations', requested.evaluation),
      approval: await record('approvals', requested.approval) }, requested.reason));
    if (!equalsJson(original, requested)) refuse('TEXP1006', '/plan', 'The activation plan does not reproduce from its inputs.');
    const h = await currentHead(ctx, requested.head.profile, requested.head.scope), approval = await requireRow(ctx.tx, 'approvals', requested.approval.id, h.scope);
    const a = await requireRow(ctx.tx, 'artifacts', approval.artifactId, h.scope), e = await requireRow(ctx.tx, 'evaluations', approval.evaluationId, h.scope);
    const history = await list(ctx.tx, 'events', h.scope), action = requested.action;
    const eventKind = action === 'canary' ? 'artifact-canaried' : action === 'activate' ? 'artifact-activated' : 'artifact-rolled-back';
    const detail = canonicalizeJson({ profile: h.profile, approvalId: approval.id, evaluationId: e.id,
      before: requested.head.head, after: requested.nextHead, deploymentBefore: requested.deployment,
      deploymentAfter: requested.nextDeployment, reason: requested.reason });
    const applied = history.find(row => row.kind === eventKind && row.recordId === a.id && row.detail === detail);
    if (applied) {
      if (!equalsJson(requested.artifact, { ...a, state: requested.artifact.state }) || !equalsJson(requested.evaluation, e) || !equalsJson(requested.approval, approval))
        refuse('TEXP1006', '/plan', 'The replay differs from the retained activation records.');
      if (action === 'canary') return requested.head;
      return checked(await sealExperientialRecord('head', { document: 'experiential-head', schemaVersion: 1, scope: h.scope,
        recordedAt: applied.recordedAt, profile: h.profile, head: requested.nextHead, eventId: applied.id }));
    }
    const deployment = await currentDeployment(ctx, approval.deploymentId, h.scope);
    const retainedHead = h.eventId === null ? { ...h, recordedAt: requested.head.recordedAt } : h;
    const plan = checked(reproduce({ head: retainedHead, deployment, artifact: a, evaluation: e, approval }, requested.reason));
    if (!equalsJson(plan, requested)) refuse('TEXP1006', '/plan', 'Activation must reproduce from the retained records.');
    if (action === 'rollback' && !history.some(row => ['artifact-activated', 'artifact-rolled-back'].includes(row.kind)
      && row.recordId === a.id && JSON.parse(row.detail).profile === h.profile))
      refuse('TEXP1006', '/artifactId', 'The rollback target has no activation history in this profile.');
    for (const other of await list(ctx.tx, 'deployments', h.scope)) if (other.id !== deployment.id
      && [other.activeArtifactId, other.canaryArtifactId].includes(a.id))
      refuse('TEXP1005', '/profile', 'This artifact is already served by another deployment profile.');
    if (action !== 'canary' && h.head.versionId && h.head.versionId !== a.id) {
      const previous = await requireRow(ctx.tx, 'artifacts', h.head.versionId, h.scope);
      if (previous.state !== 'active') refuse('TEXP1006', '/head', 'The retained head does not name an active artifact.');
      await write(ctx, 'artifacts', await record('artifacts', { ...previous, state: 'archived' }));
    }
    if (action === 'rollback' && deployment.canaryArtifactId && deployment.canaryArtifactId !== a.id) {
      const failed = await requireRow(ctx.tx, 'artifacts', deployment.canaryArtifactId, h.scope);
      if (failed.state !== 'canary') refuse('TEXP1006', '/canaryArtifactId', 'The failed canary is not retained in its serving state.');
      await write(ctx, 'artifacts', await record('artifacts', { ...failed, state: 'archived' }));
    }
    await write(ctx, 'artifacts', await record('artifacts', { ...a, state: action === 'canary' ? 'canary' : 'active' }));
    await write(ctx, 'deployments', await record('deployments', plan.nextDeployment));
    const audit = await event(ctx, h.scope, eventKind, a.id, detail);
    if (action === 'canary') return plan.head;
    const next = checked(await sealExperientialRecord('head', { document: 'experiential-head', schemaVersion: 1, scope: h.scope,
      recordedAt: ctx.at(), profile: h.profile, head: plan.nextHead, eventId: audit.id }));
    await write(ctx, 'heads', next); ctx.activations++; return next;
  }
  const store: ExperientialStore = {
    stats: () => ({ ...stats }),
    snapshot: scope => operation(async ctx => Object.fromEntries(await Promise.all(EXPERIENTIAL_TABLES.map(async table =>
      [table, await list(ctx.tx, table, scope)]))) as ExperientialSnapshot),
    retain: plan => copied(plan, async (ctx, request) => {
      if (!request?.input) refuse('TEXP1001', '/plan', 'A captured retention plan is required.');
      const original = checked(await planExperientialRetention(request.input));
      if (!equalsJson(original, request)) refuse('TEXP1012', '/plan', 'The retention plan does not reproduce from its captured dependency census.');
      const scope = original.input.deployment.scope;
      const retained = await Promise.all(original.decisions.map(decision => get(ctx.tx, 'retention_decisions', decision.id)));
      if (retained.some(Boolean)) {
        if (!retained.every((row, index) => row && equalsJson(row, original.decisions[index])))
          refuse('TEXP1012', '/decisions', 'The retained decision set differs from the atomic plan.');
        for (const change of original.changes) if (!equalsJson(await requireRow(ctx.tx, 'experiences', change.after.id, scope), change.after))
          refuse('TEXP1012', '/experiences', 'The retained archived source no longer matches its decision.');
        return original;
      }
      const at = Date.parse(ctx.at());
      if (!Number.isSafeInteger(at) || at < original.input.now) refuse('TEXP1012', '/now', 'The store clock is invalid or earlier than the retention observation.');
      const fresh = checked(await planExperientialRetention({ ...original.input,
        deployment: await currentDeployment(ctx, original.input.deployment.id, scope), artifacts: await list(ctx.tx, 'artifacts', scope),
        lineage: { experiences: await list(ctx.tx, 'experiences', scope), assessments: await list(ctx.tx, 'assessments', scope),
          datasets: await list(ctx.tx, 'datasets', scope), trainingRuns: await list(ctx.tx, 'training_runs', scope), events: await list(ctx.tx, 'events', scope) } }));
      if (!equalsJson(fresh, original)) refuse('TEXP1012', '/lineage', 'The retained dependencies changed; prepare another retention plan.');
      for (const decision of fresh.decisions) await write(ctx, 'retention_decisions', await record('retention_decisions', decision));
      for (const change of fresh.changes) await write(ctx, 'experiences', await record('experiences', change.after));
      const changesDigest = await canonicalSha256(fresh.changes.map(change => ({ id: change.after.id, before: change.before.state, after: change.after.state })));
      for (const decision of fresh.decisions) await event(ctx, scope, 'retention-applied', decision.id,
        canonicalizeJson({ policyRevision: fresh.input.policy.revision, decision: decision.decision, changesDigest }));
      return fresh;
    }),
    schedule: request => copied(request, async (ctx, input) => checked(await admitExperientialTrigger({
      list: (table, scope) => list(ctx.tx, table, scope),
      get: (table, id, scope) => requireRow(ctx.tx, table, id, scope),
      deployment: (id, scope) => currentDeployment(ctx, id, scope), at: ctx.at,
      putRun: async run => { await put(ctx, 'training_runs', run); },
      cancel: async run => {
        const plan = checked(await planExperientialTrainingUpdate(run, { kind: 'cancel' }, ctx.at()));
        await write(ctx, 'training_runs', await record('training_runs', plan.after));
        await event(ctx, run.scope, 'training-cancel', run.id, canonicalizeJson({ revision: plan.after.progress!.revision, state: 'cancelled' }));
      },
      event: async (scope, kind, id, detail) => { await event(ctx, scope, kind, id, detail); },
    }, input))),
    get: (table, id) => operation(ctx => get(ctx.tx, table, id)),
    list: (table, scope) => operation(ctx => list(ctx.tx, table, scope)),
    put: (table, value) => copied(value, (ctx, row) => put(ctx, table, row)),
    putBatch: writes => copied(writes, async (ctx, input) => {
      if (!Array.isArray(input) || input.length > 4096) refuse('TEXP1001', '/writes', 'A bounded array of record writes is required.');
      const result: ExperientialWrite[] = [];
      for (const item of input) {
        if (!item || typeof item !== 'object' || !equalsJson(Object.keys(item).sort(), ['table', 'value'])) refuse('TEXP1001', '/writes', 'A write contains only table and value.');
        result.push({ table: item.table, value: await put(ctx, item.table, item.value) } as ExperientialWrite);
      }
      return result;
    }),
    transition: (plan, options = {}) => copied({ plan, options }, async (ctx, request) => {
      if (!request.plan || typeof request.plan !== 'object' || !request.plan.after || typeof request.plan.after !== 'object'
        || !request.options || typeof request.options !== 'object') refuse('TEXP1001', '/plan', 'A transition plan and options are required.');
      const table = stateTable[request.plan.kind];
      if (!table) refuse('TEXP1006', '/kind', 'Only a declared lifecycle may transition.');
      const proposedBefore = await record(table, request.plan.before);
      if (request.plan.kind === 'trainingRun' && (proposedBefore as ExperientialTrainingRun).spec)
        refuse('TEXP1006', '/state', 'Managed training transitions require checked effect commands.');
      let validated: ExperientialTransitionPlan;
      if (request.plan.kind === 'experience') validated = checked(planExperienceTransition(proposedBefore as ExperientialTables['experiences'], (request.plan.after as ExperientialTables['experiences']).state));
      else if (request.plan.kind === 'trainingRun') validated = checked(planTrainingTransition(proposedBefore as ExperientialTrainingRun, (request.plan.after as ExperientialTrainingRun).state));
      else validated = checked(planArtifactTransition(proposedBefore as ExperientialArtifact, (request.plan.after as ExperientialArtifact).state));
      if (!equalsJson(validated, request.plan)) refuse('TEXP1006', '/plan', 'The transition changed fields outside its declared state edge.');
      const before = await requireRow(ctx.tx, table, proposedBefore.id, proposedBefore.scope);
      const replayed = equalsJson(before, request.plan.after);
      if (!replayed && !equalsJson(before, proposedBefore)) refuse('TEXP1006', '/before', 'The retained state changed; prepare another transition.');
      if (table === 'artifacts') {
        refuse('TEXP1006', '/state', 'Artifact states belong to registered evaluation and approved deployment commands.');
      }
      if (replayed) return validated;
      await write(ctx, table, await record(table, validated.after));
      await event(ctx, before.scope, 'state-transition', before.id, canonicalizeJson({ table, from: before.state, to: validated.after.state }));
      return validated;
    }),
    training: (runId, expectedRevision, command) => {
      // Keep the verifier's process-local authority across the JSON snapshot.
      const verified = command?.kind !== 'verified' || isVerifiedArtifactReceipt(command.verification);
      return copied({ runId, expectedRevision, command }, async (ctx, request) => {
        if (!verified) refuse('TEXP1008', '/verification', 'An independent byte verification result is required.');
        const before = await get(ctx.tx, 'training_runs', request.runId);
        if (!before) refuse('TEXP1004', '/runId', 'The managed training run is missing.');
        if (!Number.isSafeInteger(request.expectedRevision) || before.progress?.revision !== request.expectedRevision)
          refuse('TEXP1006', '/expectedRevision', 'Training progress changed; reread before reserving another effect.');
        if (['begin', 'selected', 'rendered', 'reserve'].includes(request.command.kind) && before.progress?.dispatch === 'none') {
          const admission = (await list(ctx.tx, 'events', before.scope)).filter(row => row.recordId === before.id
            && ['training-trigger-admitted', 'training-trigger-rebased'].includes(row.kind)).sort((a, b) => b.seq - a.seq)[0];
          if (admission) {
            const binding = checked(await experientialTriggerBinding(admission));
            const deployment = await currentDeployment(ctx, binding.deploymentId, before.scope);
            const head = { versionId: deployment.activeArtifactId, revision: deployment.headRevision };
            if (!checkExperientialHead(head, binding.head).ok) {
              const cancelled = checked(await planExperientialTrainingUpdate(before, { kind: 'cancel' }, ctx.at()));
              await write(ctx, 'training_runs', await record('training_runs', cancelled.after));
              await event(ctx, before.scope, 'training-trigger-cancelled', before.id, canonicalizeJson({
                trigger: binding.trigger, expectedHead: binding.head, actualHead: head, reason: 'stale-parent', policyRevision: binding.policy.revision }));
              return cancelled;
            }
          }
        }
        checked(await checkTrainingBindings(before,
          await requireRow(ctx.tx, 'datasets', before.datasetId, before.scope),
          await requireRow(ctx.tx, 'artifacts', before.baseArtifactId, before.scope)));
        const plan = checked(await planExperientialTrainingUpdate(before, request.command, ctx.at()));
        await write(ctx, 'training_runs', plan.after);
        if (plan.artifact) await put(ctx, 'artifacts', plan.artifact);
        await event(ctx, before.scope, 'training-' + request.command.kind, before.id,
          canonicalizeJson({ revision: plan.after.progress!.revision, stage: plan.after.progress!.stage, state: plan.after.state }));
        return plan;
      });
    },
    startEvaluation: plan => copied(plan, async (ctx, request) => {
      if (!request?.registration) refuse('TEXP1001', '/plan', 'A frozen evaluation plan is required.');
      const { evaluatorRevision, questionSetId, sampleCount, recordedAt, migrationExperiment } = request.registration;
      const reproduced = checked(await planExperientialEvaluation({ artifact: request.before, baseline: request.baseline,
        dataset: request.dataset, policy: request.policy, head: request.head, evaluatorRevision, questionSetId, sampleCount, recordedAt, migrationExperiment }));
      if (!equalsJson(reproduced, request)) refuse('TEXP1002', '/plan', 'The evaluation plan does not reproduce from its captured inputs.');
      const current = await requireRow(ctx.tx, 'artifacts', request.before.id, request.before.scope);
      const policy = await requireRow(ctx.tx, 'gate_policies', request.policy.id, current.scope);
      const dataset = await requireRow(ctx.tx, 'datasets', request.dataset.id, current.scope);
      if (!equalsJson(policy, request.policy) || !equalsJson(dataset, request.dataset))
        refuse('TEXP1002', '/registration', 'The retained policy or dataset differs from the captured registration.');
      if (equalsJson(current, request.after)) return reproduced;
      const head = await currentHead(ctx, request.head.profile, current.scope);
      checked(planExperientialHead(head.head, request.head.head, current.id));
      const baseline = await requireRow(ctx.tx, 'artifacts', request.baseline.id, current.scope);
      if (!equalsJson(current, request.before) || !equalsJson(baseline, request.baseline))
        refuse('TEXP1006', '/artifact', 'The retained candidate or baseline changed before evaluation started.');
      if (!current.trainingRunId) refuse('TEXP1004', '/trainingRunId', 'A candidate requires completed training ancestry.');
      const training = await requireRow(ctx.tx, 'training_runs', current.trainingRunId, current.scope);
      if (training.datasetId !== dataset.id || training.state !== 'complete')
        refuse('TEXP1002', '/datasetId', 'The evaluation must name the dataset that produced the candidate.');
      await write(ctx, 'artifacts', await record('artifacts', reproduced.after));
      await event(ctx, current.scope, 'evaluation-registered', current.id, canonicalizeJson(reproduced.registration));
      return reproduced;
    }),
    recordEvaluation: evaluation => copied(evaluation, async (ctx, raw) => {
      const row = await record('evaluations', raw);
      const current = await requireRow(ctx.tx, 'artifacts', row.artifactId, row.scope);
      const prior = await get(ctx.tx, 'evaluations', row.id);
      if (prior && !equalsJson(prior, row)) refuse('TEXP1002', '/id', 'An evaluation re-put cannot change observations under one identity.');
      const plan = checked(await recordExperientialEvaluation({ artifact: prior ? { ...current, state: 'evaluating' } : current,
        baseline: await requireRow(ctx.tx, 'artifacts', row.baselineArtifactId, row.scope),
        dataset: await requireRow(ctx.tx, 'datasets', row.datasetId, row.scope),
        policy: await requireRow(ctx.tx, 'gate_policies', row.gatePolicyId, row.scope), evaluation: row }));
      if (prior) return plan;
      if ((await list(ctx.tx, 'evaluations', row.scope)).some(retained => retained.registrationId === row.registrationId))
        refuse('TEXP1006', '/registrationId', 'A frozen evaluation registration has already been consumed.');
      await write(ctx, 'evaluations', row);
      await write(ctx, 'artifacts', await record('artifacts', plan.after));
      await event(ctx, row.scope, 'evaluation-recorded', current.id, canonicalizeJson({ evaluationId: row.id,
        registrationId: row.registrationId, state: plan.after.state, failures: row.failures }));
      return plan;
    }),
    pin: value => copied(value, async (ctx, raw) => {
      const pin = await record('pins', raw);
      // A native run id is global even when the logical scope or profile differs.
      for (const prior of await ctx.tx.list('pins', null)) if (prior.runId === pin.runId) {
        await record('pins', prior);
        refuse('TEXP1006', '/runId', 'A run already has an immutable inference pin.');
      }
      const d = await currentDeployment(ctx, pin.deploymentId, pin.scope);
      checked(checkExperientialHead({ versionId: d.id, revision: d.revision }, { versionId: pin.deploymentId, revision: pin.deploymentRevision }));
      const canary = await routesToCanary(d, pin.runId), artifactId = canary ? d.canaryArtifactId : d.activeArtifactId;
      if (pin.canary !== canary || pin.artifactId !== artifactId)
        refuse('TEXP1006', '/artifactId', 'The pin must use the registered deployment assignment.');
      if (!pin.capability.trainable && (d.activeArtifactId !== null || d.canaryArtifactId !== null))
        refuse('TEXP1008', '/capability', 'An inference-only binding cannot serve a learned deployment.');
      let model = d.base.model;
      if (artifactId) {
        const artifact = await requireRow(ctx.tx, 'artifacts', artifactId, d.scope);
        if (artifact.state !== (canary ? 'canary' : 'active')) refuse('TEXP1006', '/artifact/state', 'The artifact is not in its selected serving state.');
        if (artifact.runtime.provider !== d.base.provider || artifact.runtime.base !== d.base.base)
          refuse('TEXP1008', '/artifact/runtime', 'The serving artifact differs from its registered endpoint.');
        model = artifact.runtime.servedModel;
      }
      if (model !== pin.servedModel) refuse('TEXP1002', '/servedModel', 'The pin names a different serving model.');
      await write(ctx, 'pins', pin);
      await event(ctx, pin.scope, 'inference-pinned', pin.id, canonicalizeJson({ runId: pin.runId, deploymentId: d.id, deploymentRevision: d.revision }));
      return pin;
    }),
    head: (profile, scope) => operation(ctx => currentHead(ctx, profile, scope)),
    activate: plan => copied(plan, (ctx, input) => applyActivation(ctx, input, 'activate')),
    rollback: plan => copied(plan, (ctx, input) => applyActivation(ctx, input, 'rollback')),
  };
  return Object.freeze(store);
}

export function createExperientialMemoryStore(options: ExperientialMemoryOptions & ExperientialStoreOptions): ExperientialStore & { close(): Promise<void> } {
  const persistence = createExperientialMemoryPersistence(options);
  return Object.freeze({ ...createExperientialStoreAdapter(persistence, options), close: () => persistence.close() });
}
