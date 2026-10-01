/** Authenticated reads over existing stores; no transport owns lifecycle state. */
import type { Handler, RequestContext } from '@jarenjs/contract/http';
import { forecastTransaction, type ForecastStore, type ForecastTransaction, type ForecastQuery } from './store.ts';
import type { ForecastTable, ForecastTables } from './identity.ts';
import { forecastRevision } from './identity.ts';
import { ForecastRefusal, forecastMust, reject, refuse } from './errors.ts';
import type { ForecastOutcomeHost } from './outcome-host.ts';
import { dueCheckpoints, visibleHarness } from './transitions.ts';
import { checkTime } from './schema.ts';
import type { ForecastQuestion, ForecastSchedule, ForecastResolution } from './contracts.gen.ts';
import * as project from './projections.ts';

export interface ForecastReadHandlerBinding {
  store: ForecastStore;
  scopeKey: string;
  /** Omit for the whole authenticated scope; an empty list grants no questions. */
  questionIds?: readonly string[];
  /** Required only for the current head: retained references can outlive rollback. */
  outcomeHost?: ForecastOutcomeHost;
  allowScope(scopeKey: string, context: RequestContext): boolean | Promise<boolean>;
}
export interface ForecastReadHandlerOptions {
  resolveHost(context: RequestContext): ForecastReadHandlerBinding | undefined | Promise<ForecastReadHandlerBinding | undefined>;
}
interface ReadInput { id: string;questionId: string;checkpointId: string;scopeKey?: string;status?: string;now: string;cursor?: number;limit: number; }
const allowedQuestion = (binding: ForecastReadHandlerBinding,id: string) => binding.questionIds === undefined || binding.questionIds.includes(id);
async function question(tx: ForecastTransaction,binding: ForecastReadHandlerBinding,id: string): Promise<ForecastQuestion | null> {
  const q = await tx.get('questions',id);
  if (!q) return null;
  if (q.scopeKey !== binding.scopeKey || !allowedQuestion(binding,q.id)) reject('TFCT1003','The question is outside the authenticated forecast view.');
  return q;
}
async function checkpoint(tx: ForecastTransaction,binding: ForecastReadHandlerBinding,id: string) {
  const c = await tx.get('checkpoints',id);
  if (c && !await question(tx,binding,c.questionId)) reject('TFCT1002','The checkpoint question is missing.');
  return c ?? null;
}
async function* scan<K extends ForecastTable>(tx: ForecastTransaction,table: K,query: ForecastQuery) {
  let after: string | undefined;
  for (;;) {
    const rows: ForecastTables[K][] = await tx.query(table,{ ...query,after,limit: 1000 });
    for (const row of rows) yield row;
    if (rows.length < 1000) return;
    after = rows.at(-1)!.id;
  }
}
async function rows<K extends ForecastTable>(tx: ForecastTransaction,table: K,query: ForecastQuery,limit = 10000) {
  const found: ForecastTables[K][] = [];
  for await (const row of scan(tx,table,query)) { found.push(row);if (found.length === limit) break; }
  return found;
}
type Read = (tx: ForecastTransaction,binding: ForecastReadHandlerBinding,input: ReadInput) => Promise<unknown>;
const reads: Record<string,Read> = {
  'forecast.questions.list': async (tx,b,i) => {
    const output = [];
    for await (const q of scan(tx,'questions',{ scopeKey: b.scopeKey,...(i.status ? { status: i.status } : {}) })) {
      if (!allowedQuestion(b,q.id)) continue;
      output.push(project.projectQuestionSummary(q,await rows(tx,'checkpoints',{ questionId: q.id },1000)));
      if (output.length === i.limit) break;
    }
    return output;
  },
  'forecast.question.get': async (tx,b,i) => {
    const q = await question(tx,b,i.id);if (!q) return null;
    const checkpoints = await rows(tx,'checkpoints',{ questionId: q.id },1000), lineage = new Map((await rows(tx,'harnesses',{ questionId: q.id })).map(h => [h.id,h]));
    for (const id of new Set(checkpoints.flatMap(c => c.inputHarnessVersionId ? [c.inputHarnessVersionId] : []))) {
      if (lineage.has(id)) continue;
      const h = await tx.get('harnesses',id);if (h) lineage.set(id,h);
    }
    return project.projectQuestion(q,checkpoints,[...lineage.values()]);
  },
  'forecast.checkpoints.list': async (tx,b,i) => await question(tx,b,i.questionId) ? (await rows(tx,'checkpoints',{ questionId: i.questionId },1000)).sort((a,c) => a.ordinal-c.ordinal).map(project.projectCheckpointSummary) : null,
  'forecast.checkpoint.get': async (tx,b,i) => {
    const c = await checkpoint(tx,b,i.id);if (!c) return null;
    return project.projectCheckpoint(c,c.predictionId ? await tx.get('predictions',c.predictionId) ?? null : null,await rows(tx,'evidence',{ checkpointId: c.id }),await rows(tx,'revisions',{ checkpointId: c.id }));
  },
  'forecast.note.get': async (tx,b,i) => {
    const n = await tx.get('notes',i.id);if (!n) return null;
    if (!await checkpoint(tx,b,n.checkpointId)) reject('TFCT1002','The note checkpoint is missing.');
    return project.projectNote(n);
  },
  'forecast.evidence.list': async (tx,b,i) => await checkpoint(tx,b,i.checkpointId) ? (await rows(tx,'evidence',{ checkpointId: i.checkpointId })).map(project.projectEvidence) : null,
  'forecast.trace.get': async (tx,b,i) => {
    const t = await tx.get('traces',i.id);if (!t) return null;
    if (!await checkpoint(tx,b,t.checkpointId)) reject('TFCT1002','The trace checkpoint is missing.');
    return project.projectTrace(t,i.cursor,i.limit);
  },
  'forecast.revision.get': async (tx,b,i) => {
    const r = await tx.get('revisions',i.id);if (!r) return null;
    if (!await question(tx,b,r.questionId)) reject('TFCT1002','The revision question is missing.');
    return project.projectRevision(r);
  },
  'forecast.harness.version.get': async (tx,b,i) => {
    const h = await tx.get('harnesses',i.id);if (!h) return null;
    if (h.scopeKey !== b.scopeKey) reject('TFCT1003','The harness belongs to another scope.');
    if (h.status === 'checked-ref' || h.questionId === null && h.provenance.seed) return project.projectHarness(h);
    if (!h.questionId) reject('TFCT1003','The harness has no visible question owner.');
    const q = await question(tx,b,h.questionId);if (!q) reject('TFCT1002','The harness question is missing.');
    // Historical own-question records are auditable without granting execution.
    if (!['archived','rejected'].includes(h.status)) forecastMust(visibleHarness(q,h));
    return project.projectHarness(h);
  },
  'forecast.harness.head': async (_tx,b) => {
    if (!b.outcomeHost || b.outcomeHost.store !== b.store || b.outcomeHost.host.scope.domain !== b.scopeKey || b.outcomeHost.host.scope.namespace !== 'forecast') reject('TFCT1012','Bind the authenticated outcome host to read the active harness.');
    const active = await b.outcomeHost.checked();
    return project.projectHead(active ? { versionId: active.versionId,digest: await forecastRevision(active.payload),revision: active.head.revision } : null);
  },
  'forecast.resolution.get': async (tx,b,i) => {
    const q = await question(tx,b,i.questionId);if (!q) return null;
    let original: ForecastResolution | undefined;const corrections: ForecastResolution[] = [];
    for await (const r of scan(tx,'resolutions',{ questionId: q.id })) {
      if (!r.correctionOf) original ??= r;
      else if (corrections.length < 1001) corrections.push(r);
    }
    return original ? project.projectResolution(original,q.status === 'disputed',corrections) : null;
  },
  'forecast.retrospective.get': async (tx,b,i) => {
    const r = await tx.get('retrospectives',i.id);if (!r) return null;
    if (!await question(tx,b,r.questionId)) reject('TFCT1002','The retrospective question is missing.');
    return project.projectRetrospective(r);
  },
  'forecast.due.list': async (tx,b,i) => {
    checkTime(i.now);
    let due: ForecastSchedule[] = [];
    // Retain only the earliest requested schedules while scanning the scoped index.
    for await (const s of scan(tx,'schedules',{ scopeKey: b.scopeKey,status: 'due' })) {
      if (!allowedQuestion(b,s.questionId)) continue;
      due = forecastMust(dueCheckpoints([...due,s],i.now)).slice(0,i.limit);
    }
    return due.map(project.projectDue);
  },
};
export function createForecastReadHandlers(options: ForecastReadHandlerOptions): Record<string,Handler> {
  return Object.fromEntries(Object.entries(reads).map(([id,read]) => [id,async (input: unknown,context: RequestContext) => {
    const b = await options.resolveHost(context), i = input as ReadInput;
    if (!b || i.scopeKey !== undefined && i.scopeKey !== b.scopeKey || !await b.allowScope(b.scopeKey,context)) return refuse('TFCT1003','The authenticated host refused scope access.');
    // Head injection owns an outcome-store transaction, so avoid nesting it in a forecast transaction.
    if (id === 'forecast.harness.head') {
      try { return { ok: true,value: await read(undefined as never,b,i),writes: 0 }; }
      catch (error) { if (error instanceof ForecastRefusal) return { ok: false,issues: error.issues };throw error; }
    }
    return forecastTransaction(b.store,tx => read(tx,b,i));
  }]));
}
