/** A closed, read-only view of one question through one checkpoint ordinal. */
import { createToolbox } from '@tangleai/agents';
import { cloneJson, deepFreeze, equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { forecastGet, forecastQuery, type ForecastStore } from './store.ts';
import { forecastMust, ForecastRefusal, reject, failure, type ForecastCommandResult } from './errors.ts';
import { validateForecastRecord, forecastRevision } from './identity.ts';
import { checkedHarnessLimits, type HarnessLimits } from './refiner.ts';
import type { ForecastQuestion, ForecastCheckpoint } from './contracts.gen.ts';

export const FORECAST_EDITOR_TOOL_NAMES = ['harness_read','notes_read','revisions_read','trace_read'] as const;
const closed = (properties: Record<string,unknown>,required = Object.keys(properties)) => ({ type: 'object',properties,required,additionalProperties: false });
export async function forecastEditorToolset() {
  const definitions = [
    { name: 'harness_read',description: 'Read this checkpoint\'s immutable input harness; it grants no tools.',inputSchema: closed({}) },
    { name: 'notes_read',description: 'Read this question\'s accumulated notes through this checkpoint, in ordinal order.',inputSchema: closed({ ordinal: { type: 'integer',minimum: 1 } },[]) },
    { name: 'revisions_read',description: 'Read this question\'s earlier provisional revision records.',inputSchema: closed({}) },
    { name: 'trace_read',description: 'Read a bounded character slice of a trace through this checkpoint. Exhaustion is a counted value.',inputSchema: closed({ traceId: { type: 'string',pattern: '^[a-f0-9]{64}$' },cursor: { type: 'integer',minimum: 0 },limit: { type: 'integer',minimum: 1,maximum: 4096 } },['traceId']) },
  ];
  return { definitions: deepFreeze(definitions),names: FORECAST_EDITOR_TOOL_NAMES,revision: await forecastRevision(await Promise.all([...definitions].sort((a,b) => a.name.localeCompare(b.name)).map(async d => ({ name: d.name,description: d.description,inputSchemaRevision: await forecastRevision(d.inputSchema) })))) };
}
export async function createEditorToolbox(options: { store: ForecastStore; question: ForecastQuestion; checkpoint: ForecastCheckpoint; limits?: Partial<HarnessLimits>; retrospective?: { resolutionId: string;harnessId: string } }) {
  const question = await validateForecastRecord('questions',options.question), checkpoint = await validateForecastRecord('checkpoints',options.checkpoint), limits = checkedHarnessLimits(options.limits);
  if (checkpoint.questionId !== question.id) reject('TFCT1003','The editor checkpoint belongs to another question.');
  const retainedQuestion = forecastMust(await forecastGet(options.store,'questions',question.id)), retainedCheckpoint = forecastMust(await forecastGet(options.store,'checkpoints',checkpoint.id));
  if (!equalsJson(retainedQuestion,question) || !equalsJson(retainedCheckpoint,checkpoint)) reject('TFCT1002','Editor inputs differ from retained records.');
  const retrospective = options.retrospective;
  if (retrospective) {
    const resolution = forecastMust(await forecastGet(options.store,'resolutions',retrospective.resolutionId));
    if (!resolution || resolution.questionId !== question.id || resolution.correctionOf) reject('TFCT1003','Retrospective evidence belongs to another question.');
    if (question.status !== 'resolved' || resolution.scoringStatus !== 'complete') reject('TFCT1004','Retrospective reads require the scored original resolution.');
  }
  const checkpoints = forecastMust(await forecastQuery(options.store,'checkpoints',{ questionId: question.id,limit: 1000 })).filter(c => c.ordinal <= checkpoint.ordinal).sort((a,b) => a.ordinal - b.ordinal), allowed = new Map(checkpoints.map(c => [c.id,c]));
  const notes = forecastMust(await forecastQuery(options.store,'notes',{ questionId: question.id,limit: 1000 })).filter(n => allowed.get(n.checkpointId)?.noteId === n.id).sort((a,b) => allowed.get(a.checkpointId)!.ordinal - allowed.get(b.checkpointId)!.ordinal);
  const revisions = forecastMust(await forecastQuery(options.store,'revisions',{ questionId: question.id,limit: 1000 })).filter(r => allowed.has(r.checkpointId) && (retrospective || allowed.get(r.checkpointId)!.ordinal < checkpoint.ordinal)).sort((a,b) => allowed.get(a.checkpointId)!.ordinal - allowed.get(b.checkpointId)!.ordinal);
  const harnessId = retrospective?.harnessId ?? checkpoint.inputHarnessVersionId;
  const harness = harnessId ? forecastMust(await forecastGet(options.store,'harnesses',harnessId)) : null;
  if (!harness || !retrospective && harness.digest !== checkpoint.inputHarnessDigest) reject('TFCT1012','The feedback editor needs its immutable input harness.');
  if (harness.scopeKey !== question.scopeKey || harness.questionId !== question.id && !harness.provenance.seed && harness.status !== 'checked-ref') reject('TFCT1003','The editor harness belongs to another question or scope.');
  const evidence = (await Promise.all(checkpoints.flatMap(c => c.evidenceIds).map(async id => forecastMust(await forecastGet(options.store,'evidence',id))))).filter(e => e?.admitted);
  const sourceIds = [...notes.map(n => 'note:' + n.id),...revisions.map(r => 'revision:' + r.id),...checkpoints.filter(c => c.traceId).map(c => 'trace:' + c.traceId)];
  const metadata = await forecastEditorToolset(), box = createToolbox();
  let reads = 0, exhausted = 0, foreign = 0, stopped = false;
  const excerpts: string[] = [], faults: { code: string;detail: string }[] = [];
  const refused = (code: string,detail: string) => { if (code === 'TFCT1003') foreign++; if (faults.length < 1000) faults.push({ code,detail }); return { error: detail,code }; };
  for (const definition of metadata.definitions) box.add({ ...definition,async execute(input: { ordinal?: number;traceId?: string;cursor?: number;limit?: number }) {
    try {
      if (definition.name === 'harness_read') return cloneJson(harness.document);
      if (definition.name === 'notes_read') {
        if (input.ordinal !== undefined && input.ordinal > checkpoint.ordinal) return refused('TFCT1003','A later checkpoint note is outside the editor view.');
        return cloneJson(notes.filter(n => input.ordinal === undefined || allowed.get(n.checkpointId)!.ordinal === input.ordinal));
      }
      if (definition.name === 'revisions_read') return cloneJson(revisions);
      if (reads >= limits.maxTraceReads) { exhausted++; return { exhausted: true,reads,limit: limits.maxTraceReads }; }
      reads++;
      const trace = forecastMust(await forecastGet(options.store,'traces',input.traceId!));
      if (!trace || allowed.get(trace.checkpointId)?.traceId !== trace.id) return refused('TFCT1003','The trace is outside this question and checkpoint view.');
      const chars = Array.from(canonicalizeJson(trace)), cursor = input.cursor ?? 0, limit = input.limit ?? 2048;
      if (cursor > chars.length) return refused('TFCT1001','The trace cursor is outside the retained text.');
      const excerpt = chars.slice(cursor,cursor + limit).join(''), next = cursor + Array.from(excerpt).length; excerpts.push(excerpt);
      return { traceId: trace.id,excerpt,cursor,nextCursor: next < chars.length ? next : null,totalChars: chars.length };
    } catch (error) { return error instanceof ForecastRefusal ? refused(error.code,error.message) : refused('TFCT1012','The injected editor read failed.'); }
  } });
  if (!equalsJson(box.list().map(d => d.name),FORECAST_EDITOR_TOOL_NAMES)) reject('TFCT1002','The editor tool registry differs from its closed policy.');
  const execute = async (name: string,input: unknown) => {
    try {
      if (stopped) return refused('TFCT1004','The feedback read session is closed.');
      if (!(FORECAST_EDITOR_TOOL_NAMES as readonly string[]).includes(name)) return refused('TFCT1003','The requested tool is outside the editor view.');
      const current = forecastMust(await forecastGet(options.store,'questions',question.id));
      if (current?.status !== (retrospective ? 'resolved' : 'open')) return refused('TFCT1004',retrospective ? 'Retrospective reads require a resolved question.' : 'Feedback reads require an unresolved question.');
      const result = await box.execute(name,input); return result?.error && !result.code ? refused('TFCT1001',String(result.error)) : result;
    } catch (error) { return error instanceof ForecastRefusal ? refused(error.code,error.message) : refused('TFCT1012','The injected editor read failed.'); }
  };
  async function validateSources(sources: readonly string[]): Promise<ForecastCommandResult<true>> {
    try {
      if (!Array.isArray(sources) || sources.length > 1000) reject('TFCT1007','Guidance sources must be bounded.');
      for (const source of sources) {
        if (sourceIds.includes(source)) continue;
        const match = typeof source === 'string' ? /^(note|revision|trace):([a-f0-9]{64})$/.exec(source) : null;
        if (!match) reject('TFCT1007','Guidance cites an invalid record address.','/sources');
        const table = match[1] === 'note' ? 'notes' : match[1] === 'revision' ? 'revisions' : 'traces';
        const record = forecastMust(await forecastGet(options.store,table,match[2]));
        if (record && !allowed.has(record.checkpointId)) reject('TFCT1003','Guidance cites another question or a later checkpoint.','/sources');
        reject('TFCT1007','Guidance cites a record outside the admitted editor input.','/sources');
      }
      return { ok: true,value: true,writes: 0 };
    } catch (error) { return failure(error); }
  }
  return Object.freeze({ questionId: question.id,checkpointId: checkpoint.id,harness,notes: deepFreeze(cloneJson(notes)),revisions: deepFreeze(cloneJson(revisions)),sourceIds: Object.freeze(sourceIds),
    context: () => ({ questionPrompt: question.prompt,adapterOptions: question.adapter.id === 'choice/v1' ? question.adapter.options : [],evidenceExcerpts: evidence.map(e => e!.excerpt),toolResultExcerpts: cloneJson(excerpts),questionId: question.id,checkpointIds: checkpoints.map(c => c.id) }),
    revision: metadata.revision,names: FORECAST_EDITOR_TOOL_NAMES,list: () => deepFreeze(cloneJson(box.list())),toFunctionTools: () => deepFreeze(cloneJson(box.toFunctionTools())),execute,validateSources,
    close: () => { stopped = true; },audit: () => ({ traceReads: reads,traceBudget: exhausted,foreignReads: foreign,refusals: cloneJson(faults) }),
  });
}
export type EditorToolbox = Awaited<ReturnType<typeof createEditorToolbox>>;
