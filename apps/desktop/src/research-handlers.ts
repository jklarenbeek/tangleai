/** Research reads expose retained facts; only the instrument owns comparisons. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { JarenValidator } from '@jarenjs/validate';
import type { createScheduler } from '@jarenjs/core/schedule';
import { dagToMermaid } from '@tangleai/pipeline';
import { createResearchDbPersistence, createResearchStore, researchRunLogId, asRows, type RunLog, type TangleDb } from '@tangleai/store';
import { researchLessonArtifactKey, researchLessonOutcomeScope, type ResearchStore, type ResearchStoreOutcome,
  type ResearchSnapshot, type ResearchLessonV2, type ResearchCost } from '@tangleai/research';
import { scopeIdOf, validateRecord, outcomesSchema, type HeadRow, type StoredRecord } from '@tangleai/outcomes';
import { desktopResearchReport, readResearchReport, type ResearchReportReader } from './research-report.ts';

type Provenance = Array<{ field: string; recordId: string; path: string }>;
const source = (field: string, recordId: string, path: string): Provenance[number] => ({ field, recordId, path });
function retained<T>(result: ResearchStoreOutcome<T>): T {
  if (!result.ok) throw Object.assign(new Error(result.issue.detail), { issue: result.issue });
  return result.value;
}
function spendOf(snapshot: ResearchSnapshot): ResearchCost {
  return snapshot.attempts.reduce((sum, row) => ({ calls: sum.calls + row.attempt.spend.calls, tokens: sum.tokens + row.attempt.spend.tokens,
    ms: sum.ms + row.attempt.spend.ms, physical: sum.physical + row.attempt.spend.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 });
}
function lineage(snapshot: ResearchSnapshot): string {
  const nodes: Record<string, object> = { project: { kind: 'input' } }, edges: Array<{ from: string; to: string }> = [];
  const keys = new Map([[snapshot.project.id, 'project']]);
  for (const [i, artifact] of snapshot.artifacts.entries()) {
    const key = 'artifact_' + i; keys.set(artifact.id, key); nodes[key] = { kind: 'task', run: artifact.artifact.id };
  }
  for (const artifact of snapshot.artifacts) for (const parent of artifact.parents) {
    const from = keys.get(parent.admissionId ?? parent.artifactId), to = keys.get(artifact.id);
    if (from && to) edges.push({ from, to });
  }
  for (const [i, receipt] of snapshot.attempts.entries()) {
    const key = 'attempt_' + i + '_' + receipt.attempt.stage, state = 'state_' + receipt.nextState.revision + '_' + receipt.nextState.status;
    nodes[key] = { kind: 'task', run: receipt.attempt.id }; nodes[state] = { kind: 'output' };
    edges.push({ from: 'project', to: key }, { from: key, to: state });
    for (const id of receipt.artifactAdmissionIds) if (keys.has(id)) edges.push({ from: key, to: keys.get(id)! });
  }
  return dagToMermaid({ $dag: '0.1', nodes, edges });
}

/** Schema and content checks on the stored head do not replay or activate it. */
const headValidator = new JarenValidator({ collectErrors: true }).compile({ ...outcomesSchema, $ref: '#/$defs/headRow' });
async function storedOutcome(db: TangleDb, lesson: ResearchLessonV2) {
  if (lesson.promotion === null) return null;
  const scopeId = await scopeIdOf(researchLessonOutcomeScope(lesson.scope)), artifactKey = researchLessonArtifactKey(lesson.scope);
  return db.transaction(async tx => {
    const rows = asRows(await tx.collection<HeadRow>('outcome_heads').execute<HeadRow>({ $for: { r: '$[*]' },
      $where: { $and: [{ $eq: ['$r.scopeId', { $const: scopeId }] }, { $eq: ['$r.artifactKey', { $const: artifactKey }] }] }, $return: '$r' }));
    if (rows.length !== 1 || !headValidator(rows[0]).valid) throw new Error('The stored outcome head is absent or corrupt.');
    const row = rows[0]!;
    const headId = await canonicalSha256({ scopeId, kind: 'head', value: artifactKey });
    if (row.id !== headId || row.head.versionId === null || row.eventId === null) throw new Error('The stored outcome head has no activation binding.');
    const read = async (id: string) => {
      const stored = await tx.collection<StoredRecord>('outcome_records').get(id);
      if (!stored) throw new Error('A stored outcome record is missing.');
      const record = await validateRecord(stored.record);
      if (record.id !== id || record.scopeId !== scopeId || record.artifactKey !== artifactKey) throw new Error('The outcome record belongs to another scope.');
      return record;
    };
    const event = await read(row.eventId), version = await read(row.head.versionId);
    if (event.kind !== 'activationEvent' || version.kind !== 'artifactVersion' || event.versionId !== row.head.versionId
      || event.nextHead.revision !== row.head.revision || event.nextHead.versionId !== row.head.versionId)
      throw new Error('The stored head differs from its activation record.');
    return { versionId: row.head.versionId, head: row.head, activationEventId: row.eventId };
  });
}

export function createResearchHandlers(seams: { db: TangleDb; runLog: RunLog; report?: ResearchReportReader; store?: ResearchStore;
  scheduler: ReturnType<typeof createScheduler> }) {
  const { db, runLog } = seams, store = seams.store ?? createResearchStore(db), persistence = createResearchDbPersistence(db);
  const call = (fn: (input: any, ctx: any) => Promise<any>) => async (input: any, ctx: any) => {
    try { return await seams.scheduler.run(() => fn(input, ctx)); }
    catch (cause: any) { return ctx.fail('research-refused', {}, { failures: 1, issues: [cause?.issue ??
      { code: 'research-read-failed', path: '/research', detail: cause instanceof Error ? cause.message : 'The stored research record could not be read.' }] }); }
  };
  const report = async (ctx: any) => {
    const result = await readResearchReport(seams.report ?? desktopResearchReport);
    return result.ok ? result.report : ctx.fail('report-invalid', {}, { failures: result.failures, issues: result.issues });
  };
  return {
    'research.runs.list': call(async input => {
      const ids = await persistence.transaction(tx => tx.scopes('projects')), rows = [];
      for (const id of ids) {
        const snapshot = retained(await store.snapshot(id)); if (!snapshot) continue;
        if (input.profileId !== undefined && input.profileId !== snapshot.project.domainProfile
          || input.status !== undefined && input.status !== snapshot.state.status) continue;
        const injected = retained(await store.lessons.listInjections(id)), hashes = [...new Set(injected.map(row => row.lessonSetHash))];
        const runId = await researchRunLogId(db, id), run = runId === null ? undefined : await runLog.getRun(runId);
        if (!run) throw new Error('The research project has no retained run-log association.');
        rows.push({ projectId: id, profileId: snapshot.project.domainProfile, status: snapshot.state.status, stage: snapshot.state.status,
          attempts: snapshot.attempts.length, spend: spendOf(snapshot), identityStatus: run.run.identityStatus,
          lessonSetHash: hashes.length === 1 ? hashes[0]! : null, provenance: [source('projectId', id, '/id'), source('profileId', id, '/domainProfile'),
            ...['status', 'stage'].map(field => source(field, id, '/state/status')), source('attempts', id, '/attempts'),
            source('identityStatus', run.run.id, '/identityStatus'), source('lessonSetHash', id, '/lessonInjections/*/lessonSetHash'),
            ...snapshot.attempts.map(row => source('spend', row.attempt.id, '/spend')), ...(!snapshot.attempts.length ? [source('spend', id, '/attempts')] : [])] });
        if (rows.length >= (input.limit ?? 50)) break;
      }
      return rows;
    }),
    'research.runs.get': call(async ({ projectId }, ctx) => {
      const snapshot = retained(await store.snapshot(projectId)); if (!snapshot) return ctx.fail('not-found');
      const byKind = <K extends ResearchSnapshot['records'][number]['kind']>(kind: K) => snapshot.records.filter(row => row.kind === kind)
        .map(row => row.value) as Array<Extract<ResearchSnapshot['records'][number], { kind: K }>['value']>;
      const interventions = byKind('Intervention'), claims = byKind('ResearchClaim'), verification = byKind('ResearchDraftVerification');
      const proposed = retained(await store.lessons.list({ projectId })), injected = retained(await store.lessons.listInjections(projectId));
      const states = [...new Map([...snapshot.attempts.map(row => row.nextState), snapshot.state].map(row => [row.revision, row])).values()].sort((a, b) => a.revision - b.revision);
      const fields: Record<string, string> = { project: '/project', states: '/attempts/*/nextState,/state', attempts: '/attempts', artifacts: '/artifacts',
        branches: '/records/ExperimentBranch', gates: '/records/Intervention', interventions: '/records/Intervention', claims: '/records/ResearchClaim',
        verification: '/records/ResearchDraftVerification', verificationFailures: '/records/ResearchDraftVerification', lessons: '/lessonInjections,/lessons', spend: '/attempts/*/attempt/spend',
        mermaid: '/artifacts/*/parents,/attempts', reproduce: '/records/ResearchManifest', execution: '/records/ExecutionManifest', capabilities: '/@projection', limitations: '/state,/attempts,/records/ResearchManifest' };
      return { project: snapshot.project, states, attempts: snapshot.attempts, artifacts: snapshot.artifacts, branches: byKind('ExperimentBranch'),
        gates: interventions, interventions, claims, verification, verificationFailures: verification.filter(row => row.state === 'refused'), lessons: { injected, proposed },
        spend: spendOf(snapshot), mermaid: lineage(snapshot), reproduce: [], execution: byKind('ExecutionManifest'), capabilities: { live: true },
        limitations: ['States include retained stage receipts and the current state; transitions without a retained receipt have no historical state row.',
          'The stored manifests do not retain shell reproduction commands. Execution manifests below preserve the recorded entrypoint, parameters and seed.',
          'Spend sums committed stage attempts. Uncommitted external work is not inferred.', 'Gates show retained intervention records; an empty list does not assert approval.'],
        provenance: Object.entries(fields).map(([field, path]) => source(field, projectId, path)) };
    }),
    'research.lessons.list': call(async input => retained(await store.lessons.list()).filter(lesson =>
      (input.profileId === undefined || input.profileId === lesson.scope.domainProfileId) && (input.state === undefined || input.state === lesson.validation.state))
      .slice(0, input.limit ?? 50).map(lesson => ({ lesson, provenance: [source('lesson', lesson.id, '')] }))),
    'research.lessons.get': call(async ({ id }, ctx) => {
      const lesson = retained(await store.lessons.get(id)); if (!lesson) return ctx.fail('not-found');
      const validationRuns = retained(await store.lessons.listValidations(lesson.scope)).filter(row => row.proposalIds.includes(id) || lesson.validation.validationRunIds.includes(row.id));
      const outcome = await storedOutcome(db, lesson);
      return { lesson, validationRuns, outcome, provenance: [source('lesson', id, ''), source('validationRuns', id, '/validation/validationRunIds'),
        source('outcome', outcome?.activationEventId ?? id, outcome ? '/nextHead' : '/promotion')] };
    }),
    'research.reports.get': call(async (_input, ctx) => {
      const value = await report(ctx); if (!value?.ablation) return value;
      return { reportId: value.reportId, generatedFrom: value.source.sha256, rows: value.ablation.rows, pairs: value.ablation.pairs, gate: value.ablation.gate,
        audit: value.audit.runs.map((row: any) => ({ rowId: row.id, checked: row.checked, resolved: row.resolved, unresolved: row.unresolved,
          fabricated: row.fabricated, missing: row.missing, auditDisagreements: row.auditDisagreements })), document: 'docs/RESEARCH_BENCHMARK.md',
        limitations: value.ablation.limitations, provenance: Object.entries({ reportId: '/reportId', generatedFrom: '/source/sha256', rows: '/ablation/rows',
          pairs: '/ablation/pairs', gate: '/ablation/gate', audit: '/audit/runs', document: '/benchmark', limitations: '/ablation/limitations' })
          .map(([field, path]) => source(field, value.reportId, path)) };
    }),
    'research.ablation.get': call(async ({ pairId }, ctx) => {
      const value = await report(ctx); if (!value?.ablation) return value;
      const index = value.ablation.pairs.findIndex((row: any) => row.id === pairId), pair = value.ablation.pairs[index];
      if (!pair) return ctx.fail('not-found');
      return { pair, delta: pair.delta, interval: pair.interval, comparable: pair.comparable, refusals: pair.refusals,
        provenance: ['pair', 'delta', 'interval', 'comparable', 'refusals'].map(field => source(field, value.reportId, '/ablation/pairs/' + index + (field === 'pair' ? '' : '/' + field))) };
    }),
    'research.runs.live': call(async ({ projectId, afterSeq = 0 }, ctx) => {
      if (!retained(await store.getProject(projectId))) return ctx.fail('not-found');
      const id = await researchRunLogId(db, projectId); if (id === null || !await runLog.getRun(id)) return ctx.fail('not-found');
      const live = await runLog.subscribeRun(id);
      return { ...live, snapshot: () => ({ rows: (live.snapshot() as { rows: Array<{ seq: number }> }).rows.filter(row => row.seq > afterSeq) }),
        replay: (after: number, options: Parameters<RunLog['replayPage']>[2]) => runLog.replayPage(id, Math.max(after, afterSeq), options) };
    }),
  };
}
