/** Content addresses bind immutable inputs; commands alone can change lifecycle fields. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { checkShape, checkTime, forecastBytes, DEFAULT_FORECAST_POLICY } from './schema.ts';
import { reject } from './errors.ts';
import type { ForecastQuestion, ForecastSchedule, ForecastCheckpoint, ForecastEvidence, ForecastPrediction, ForecastTrace, CheckpointNote, ForecastHarnessVersion, HarnessRevision, ForecastResolution, RetrospectiveCheck } from './contracts.gen.ts';

export interface ForecastTables {
  questions: ForecastQuestion; schedules: ForecastSchedule; checkpoints: ForecastCheckpoint;
  evidence: ForecastEvidence; predictions: ForecastPrediction; traces: ForecastTrace; notes: CheckpointNote;
  harnesses: ForecastHarnessVersion; revisions: HarnessRevision; resolutions: ForecastResolution; retrospectives: RetrospectiveCheck;
}
export type ForecastTable = keyof ForecastTables;
export const FORECAST_TABLES: readonly ForecastTable[] = ['questions','schedules','checkpoints','evidence','predictions','traces','notes','harnesses','revisions','resolutions','retrospectives'];
export const FORECAST_RECORD_SCHEMAS: Record<ForecastTable, string> = {
  questions: 'forecastQuestion', schedules: 'forecastSchedule', checkpoints: 'forecastCheckpoint', evidence: 'forecastEvidence',
  predictions: 'forecastPrediction', traces: 'forecastTrace', notes: 'checkpointNote', harnesses: 'forecastHarnessVersion',
  revisions: 'harnessRevision', resolutions: 'forecastResolution', retrospectives: 'retrospectiveCheck',
};
/** Not a permission list: only commands can replace an existing record. */
const identityOmissions: Partial<Record<ForecastTable, readonly string[]>> = {
  questions: ['status','latestProvisionalVersionId'], schedules: ['status'],
  checkpoints: ['status','startedAt','endedAt','traceId','noteId','predictionId','evidenceIds','spend','stopReason','failure','noteFailure','decisionId','progress'],
  harnesses: ['status','checkedVersionId'],
  // Candidates refer back to these records. Excluding the forward result links
  // avoids circular hashes; immutable publication still binds every result byte.
  revisions: ['candidateVersionId'],
  retrospectives: ['candidateVersionId','reflect','evaluation','promotion','outcome'],
};
export const forecastRevision = canonicalSha256;
export function forecastRecordId<K extends ForecastTable>(table: K, value: Omit<ForecastTables[K], 'id'> | ForecastTables[K]): Promise<string> {
  const data = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id' && !identityOmissions[table]?.includes(key)));
  return canonicalSha256({ table, ...data });
}
export async function validateForecastRecord<K extends ForecastTable>(table: K, input: unknown): Promise<ForecastTables[K]> {
  if (!FORECAST_TABLES.includes(table)) reject('TFCT1001', 'Unknown forecast table.');
  const value = checkShape<ForecastTables[K]>(FORECAST_RECORD_SCHEMAS[table], input);
  const data = value as unknown as Record<string, unknown>;
  for (const key of ['issuedAt','expectedResolutionAt','scheduledAt','cutoffAt','startedAt','endedAt','availableAt','fetchedAt','claimedPublishedAt','recordedAt','observedAt','receivedAt'])
    if (typeof data[key] === 'string') checkTime(data[key] as string);
  if (await forecastRecordId(table, value) !== value.id) reject('TFCT1002', 'Record identity differs from its immutable fields.', '/id');
  if (table === 'questions') {
    const q = value as ForecastQuestion, p = q.checkpointPolicy;
    if (q.expectedResolutionAt < q.issuedAt || p.ordinals.length !== p.scheduledAt.length || p.ordinals.some((n,i) => n !== i + 1) || p.scheduledAt.some((at,i) => checkTime(at) < q.issuedAt || at > q.expectedResolutionAt || (i > 0 && at <= p.scheduledAt[i - 1])))
      reject('TFCT1001', 'Question checkpoint policy is not a chronological contiguous schedule.');
    if (q.adapter.id === 'numeric/v1' && q.adapter.range[0] >= q.adapter.range[1]) reject('TFCT1001', 'Numeric forecast range must increase.');
  }
  if (table === 'schedules' || table === 'checkpoints') {
    const c = value as ForecastSchedule | ForecastCheckpoint;
    if (c.cutoffAt > c.scheduledAt) reject('TFCT1006', 'The cutoff is later than the scheduled checkpoint.');
  }
  if (table === 'checkpoints') {
    const c = value as ForecastCheckpoint;
    if ((c.inputHarnessVersionId === null) !== (c.inputHarnessDigest === null)) reject('TFCT1002', 'Harness version and digest must both be present or absent.');
    if (['static-harness','evolving-harness'].includes(c.treatment) !== (c.inputHarnessVersionId !== null)) reject('TFCT1002', 'The checkpoint treatment and harness input disagree.');
    if (c.spend.usageKnown !== (c.spend.tokens !== null)) reject('TFCT1001', 'Known usage requires a token count; unknown usage requires null.');
    if (c.startedAt && (c.startedAt < c.scheduledAt || c.endedAt && c.endedAt < c.startedAt)) reject('TFCT1004', 'Checkpoint execution times are out of order.');
    if (c.status === 'planned' && (c.startedAt || c.endedAt || c.traceId || c.noteId || c.predictionId || c.evidenceIds.length || c.progress || c.noteFailure || c.failure || c.stopReason || c.decisionId || c.spend.calls || c.spend.ms || c.spend.tokens !== 0)) reject('TFCT1004', 'A planned checkpoint cannot carry execution artifacts.');
    if (c.status !== 'planned' && !c.startedAt) reject('TFCT1004', 'A started checkpoint requires its start instant.');
    if (c.status === 'running' && (c.endedAt || !c.progress && (c.noteFailure || c.failure || c.traceId || c.noteId || c.predictionId))) reject('TFCT1004', 'A running checkpoint cannot carry final artifacts.');
    if (c.progress) {
      const p = c.progress, receipts = [p.execution,...(p.note ? [p.note] : []),...(p.revision ? [p.revision] : [])];
      if (!c.traceId || !c.stopReason || (c.predictionId === null) === (c.failure === null) || c.predictionId && c.stopReason !== 'stop') reject('TFCT1004','Durable execution progress requires its trace and prediction or failure.');
      if (p.note === null && (c.noteId || c.noteFailure) || p.note && (!c.predictionId || (c.noteId === null) === (c.noteFailure === null))) reject('TFCT1004','Durable note progress and its retained result disagree.');
      if (p.revision && !p.note) reject('TFCT1004','Durable revision progress requires the preceding note stage.');
      if (receipts.some(r => r.spend.usageKnown !== (r.spend.tokens !== null) || r.budgetSpent.turns < r.spend.calls || r.calls.length !== r.spend.calls)) reject('TFCT1001','Stage cost and budget receipts disagree.');
      if (p.note && (p.note.budgetSpent.turns !== p.execution.budgetSpent.turns + p.note.spend.calls || p.note.budgetSpent.tokens < p.execution.budgetSpent.tokens || p.note.budgetSpent.ms < p.execution.budgetSpent.ms)) reject('TFCT1001','Note progress did not continue the execution budget.');
      if (p.revision && (p.revision.budgetSpent.turns !== p.note!.budgetSpent.turns + p.revision.spend.calls || p.revision.budgetSpent.tokens < p.note!.budgetSpent.tokens || p.revision.budgetSpent.ms < p.note!.budgetSpent.ms)) reject('TFCT1001','Revision progress did not continue the note budget.');
      const known = receipts.every(r => r.spend.usageKnown);
      if (c.spend.calls !== receipts.reduce((n,r) => n + r.spend.calls,0) || c.spend.ms !== receipts.reduce((n,r) => n + r.spend.ms,0) || c.spend.usageKnown !== known || c.spend.tokens !== (known ? receipts.reduce((n,r) => n + r.spend.tokens!,0) : null)) reject('TFCT1001','Checkpoint totals differ from its stage receipts.');
    }
    if (c.status === 'finalized' && (!c.endedAt || !c.traceId || (c.noteId === null) === (c.noteFailure === null) || !c.predictionId || c.failure || c.stopReason !== 'stop')) reject('TFCT1004', 'A finalized checkpoint requires a stopped prediction, trace and either a note or its failure.');
    if (c.status === 'failed' && (!c.endedAt || !c.failure || c.predictionId || c.noteId || c.noteFailure)) reject('TFCT1004', 'A failed checkpoint requires its failure and cannot carry a successful prediction or note.');
  }
  if (table === 'evidence') {
    const e = value as ForecastEvidence;
    if (e.admitted === (e.refusal !== null)) reject('TFCT1001', 'Evidence admission explanation differs.');
    if (e.kind === 'live' && (!e.fetchedAt || e.availableAt !== null) || e.kind === 'snapshot' && e.fetchedAt !== null) reject('TFCT1006', 'Evidence provenance mixes live capture and replay availability.');
  }
  if (table === 'traces') {
    const t = value as ForecastTrace;
    if (t.bytes !== forecastBytes({ messages: t.messages, steps: t.steps }) || t.bytes > DEFAULT_FORECAST_POLICY.maxTraceBytes) reject('TFCT1001', 'Trace bytes differ or exceed the retained trace bound.');
  }
  if (table === 'harnesses') {
    const h = value as ForecastHarnessVersion;
    if (Object.values(h.document).some(s => new TextEncoder().encode(s).length > DEFAULT_FORECAST_POLICY.maxComponentBytes) || forecastBytes(h.document) > DEFAULT_FORECAST_POLICY.maxHarnessBytes) reject('TFCT1001', 'Harness exceeds its canonical UTF-8 byte bound.');
    if (h.digest !== await canonicalSha256(h.document)) reject('TFCT1002', 'Harness digest differs from its document.');
    if ((h.status === 'checked-ref') !== (h.checkedVersionId !== null)) reject('TFCT1004', 'Only a checked reference can name an outcome version.');
    if (h.questionId === null && !h.provenance.seed && h.status !== 'checked-ref') reject('TFCT1003', 'A provisional harness requires a question owner.');
  }
  if (table === 'resolutions') {
    const r = value as ForecastResolution;
    if (r.receivedAt < r.observedAt) reject('TFCT1004', 'A resolution cannot be received before it is observed.');
    if (r.losses.some(s => s.utility !== (s.category === 'success' ? 1 : s.category === 'partial' ? .5 : 0))) reject('TFCT1001', 'Resolution category and utility differ.');
  }
  return value;
}
export async function sealForecastRecord<K extends ForecastTable>(table: K, value: Omit<ForecastTables[K], 'id'>): Promise<ForecastTables[K]> {
  if (!FORECAST_TABLES.includes(table)) reject('TFCT1001', 'Unknown forecast table.');
  const checked = checkShape<ForecastTables[K]>(FORECAST_RECORD_SCHEMAS[table], { ...value, id: '0'.repeat(64) });
  return validateForecastRecord(table, { ...checked, id: await forecastRecordId(table, checked) });
}
