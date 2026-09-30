/** Keyless model seams consume only registered visible inputs and authored responses. */
import { createChatClient } from '@tangleai/models';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createMemoryForecastStore, forecastMust, forecastQuestionCreate, forecastHarnessStage, forecastCheckpointPlan, forecastCheckpointStart, forecastCheckpointFinalize, forecastCheckpointFail, sealForecastRecord, forecastPromptRevisions, forecastExecutorToolset, createForecastToolbox, createForecastExecutor, createNoteBuilder, combineForecastSpend, forecastQuery, FORECAST_TABLES, type ForecastCheckpoint, type ForecastChatClient } from '@tangleai/forecast';
import type { ForecastFixtures } from './forecast-fixtures.ts';
import type { Row, Case } from './forecast.types.ts';
import { scoreForecast } from './forecast-oracle.ts';

export type ForecastScriptInputs = Pick<ForecastFixtures,'predictions'|'notes'|'questions'|'snapshots'>;
export type ForecastNegative = 'future' | 'length' | 'tool-limit' | 'malformed' | 'budget-turns';
export const SCRIPTED_FORECAST_CONFIGURATION = { provider: 'custom',baseUrl: 'https://forecast.fixture.invalid/v1',model: 'forecast-script/v1',maxTokens: 1024,retry: { attempts: 1 } } as const;
export function createScriptedForecastClient(fixture: ForecastScriptInputs, treatment: ForecastCheckpoint['treatment'], binding: { checkpointId: string; fixtureCheckpointId: string; harnessDigest: string | null }, negative?: ForecastNegative) {
  let physicalCalls = 0;
  const wire = createChatClient({ ...SCRIPTED_FORECAST_CONFIGURATION,fetch: async () => { physicalCalls++; throw Error('Scripted forecast reached transport.'); } });
  let calls = 0;
  const client: ForecastChatClient = { endpoint: wire.endpoint,requestKey: wire.requestKey,async complete(request) {
    const visible = request.messages.map((m: any) => { try { return m.role === 'user' ? JSON.parse(m.content) : null; } catch { return null; } }).find(m => m?.checkpointId === binding.checkpointId);
    if (!visible) throw Error('Scripted forecast has no bound checkpoint input.');
    const checkpoint = fixture.questions.flatMap(q => q.checkpoints).find(c => c.id === binding.fixtureCheckpointId)!;
    const pool = fixture.snapshots.filter(s => checkpoint.snapshotIds.includes(s.id));
    const key = binding.harnessDigest ?? treatment, prediction = fixture.predictions[binding.fixtureCheckpointId]?.[key];
    if (prediction === undefined) throw Error('No authored forecast response for the bound checkpoint and harness.');
    calls++;
    const tool = (name: string,args: unknown) => ({ id: `${name}-${calls}`,name,arguments: JSON.stringify(args) });
    let toolCalls: any[] | null = null, content = '';
    if (calls === 1) toolCalls = [...(binding.harnessDigest ? [tool('harness_read',{})] : []),tool('web_search',{ query: 'Tidewater' })];
    else if (calls === 2 || negative === 'tool-limit') {
      const snapshot = negative === 'future' ? pool.find(s => s.availableAt! > checkpoint.cutoffAt) : pool.find(s => checkpoint.decisiveSnapshotIds.includes(s.id));
      if (!snapshot) throw Error('The authored evidence script has no source.');
      toolCalls = [tool('web_read',{ url: snapshot.url })];
    } else content = negative === 'malformed' ? String(prediction) : '\\boxed{' + prediction + '}';
    return { message: { role: 'assistant',content,toolCalls },finishReason: toolCalls ? 'tool_calls' : negative === 'length' ? 'length' : 'stop',usage: { prompt_tokens: 20,completion_tokens: 10,total_tokens: 30 } };
  } };
  return { client,calls: () => calls,physicalCalls: () => physicalCalls };
}
export function createScriptedNoteClient(fixture: Pick<ForecastFixtures,'notes'>, binding: { checkpointId: string; fixtureCheckpointId: string }) {
  let physicalCalls = 0;
  const wire = createChatClient({ ...SCRIPTED_FORECAST_CONFIGURATION,fetch: async () => { physicalCalls++; throw Error('Scripted note reached transport.'); } });
  let calls = 0;
  const client: ForecastChatClient = { endpoint: wire.endpoint,requestKey: wire.requestKey,async complete(request) {
    const artifact = request.messages.find((m: any) => m.role === 'user');
    if (!artifact || JSON.parse(artifact.content).checkpointId !== binding.checkpointId) throw Error('The note script has no bound checkpoint artifact.');
    const sections = fixture.notes[binding.fixtureCheckpointId]; if (!sections) throw Error('No authored note exists for this checkpoint.');
    calls++;
    return { message: { role: 'assistant',content: JSON.stringify(sections),toolCalls: null },finishReason: 'stop',usage: { total_tokens: 40 } };
  } };
  return { client,calls: () => calls,physicalCalls: () => physicalCalls };
}

export async function measureForecastTreatment(fixture: ForecastFixtures, treatment: 'no-harness' | 'static-harness', negative?: ForecastNegative) {
  const store = createMemoryForecastStore(), prompts = await forecastPromptRevisions(), tools = await forecastExecutorToolset(treatment);
  const scripts: ForecastScriptInputs = { predictions: fixture.predictions,notes: fixture.notes,questions: fixture.questions,snapshots: fixture.snapshots };
  const configuration = { kind: 'scripted' as const,revision: await canonicalSha256({ ...SCRIPTED_FORECAST_CONFIGURATION,registrationId: fixture.manifest.registrationId,treatment,budget: { turns: 8,ms: 1000 } }) };
  const cases: Case[] = [], retained: any[] = [], spends: ReturnType<typeof combineForecastSpend>[] = [], stops: Record<string,number> = {};
  const runtimeQuestions = negative ? fixture.questions.slice(0,1) : fixture.questions;
  let logicalCalls = 0, physicalCalls = 0;
  for (const registered of runtimeQuestions) {
    const question = await sealForecastRecord('questions',{ scopeKey: registered.scopeKey,prompt: registered.prompt,issuedAt: registered.issuedAt,expectedResolutionAt: registered.expectedResolutionAt,status: 'open',adapter: { ...registered.adapter,version: '1' },checkpointPolicy: { ordinals: registered.checkpoints.map(c => c.ordinal),scheduledAt: registered.checkpoints.map(c => c.scheduledAt) },startedFromCheckedVersionId: null,latestProvisionalVersionId: null,promptRevision: prompts.executor,toolsetRevision: tools.revision });
    forecastMust(await forecastQuestionCreate(store,question));
    const harness = treatment === 'static-harness' ? await sealForecastRecord('harnesses',{ scopeKey: question.scopeKey,questionId: null,parentVersionId: null,document: fixture.seed,digest: fixture.manifest.seedHarnessDigest,status: 'staged',checkedVersionId: null,provenance: { seed: true,revisionId: null,retrospectiveId: null },recordedAt: question.issuedAt }) : null;
    if (harness) forecastMust(await forecastHarnessStage(store,harness));
    for (const scheduled of (negative ? registered.checkpoints.slice(0,1) : registered.checkpoints)) {
      const planned = await sealForecastRecord('checkpoints',{ questionId: question.id,ordinal: scheduled.ordinal,scheduledAt: scheduled.scheduledAt,cutoffAt: scheduled.cutoffAt,startedAt: null,endedAt: null,inputHarnessVersionId: harness?.id ?? null,inputHarnessDigest: harness?.digest ?? null,traceId: null,noteId: null,predictionId: null,evidenceIds: [],spend: { calls: 0,tokens: 0,ms: 0,usageKnown: true },stopReason: null,status: 'planned',failure: null,noteFailure: null,treatment,configuration,promptRevision: prompts.executor,toolsetRevision: tools.revision,noteSchemaRevision: prompts.noteSchema,decisionId: null });
      forecastMust(await forecastCheckpointPlan(store,planned));
      const checkpoint = forecastMust(await forecastCheckpointStart(store,planned.id,scheduled.scheduledAt)), now = () => Date.parse(scheduled.scheduledAt);
      const snapshots = fixture.snapshots.filter(s => scheduled.snapshotIds.includes(s.id)).map(s => ({ ...s,questionId: question.id }));
      const toolbox = await createForecastToolbox({ store,checkpoint,harness,cutoffPolicy: { kind: 'replay',corpus: fixture.manifest.registrationId,snapshots },now: () => scheduled.scheduledAt });
      const binding = { checkpointId: checkpoint.id,fixtureCheckpointId: scheduled.id,harnessDigest: harness?.digest ?? null }, executorClient = createScriptedForecastClient(scripts,treatment,binding,negative), noteClient = createScriptedNoteClient({ notes: scripts.notes },binding);
      const budget = { turns: negative === 'budget-turns' ? 0 : 8,ms: 1000 };
      const execution = await createForecastExecutor({ client: executorClient.client,toolbox,harness,budget,now,limits: { maxToolRounds: negative === 'tool-limit' ? 1 : 25 } }).run({ question,checkpoint });
      const note = execution.prediction ? await createNoteBuilder({ client: noteClient.client,now }).build({ question,checkpoint,trace: execution.trace,evidence: execution.evidence,finalMessage: execution.finalMessage,stopReason: 'stop' },{ ...budget,spent: execution.budgetSpent }) : { note: null,noteFailure: null,spend: { calls: 0,tokens: 0,ms: 0,usageKnown: true },calls: [] };
      const spend = combineForecastSpend(execution.spend,note.spend); spends.push(spend); logicalCalls += executorClient.calls() + noteClient.calls(); physicalCalls += executorClient.physicalCalls() + noteClient.physicalCalls(); stops[execution.stopReason] = (stops[execution.stopReason] ?? 0) + 1;
      const common = { checkpointId: checkpoint.id,at: scheduled.scheduledAt,trace: execution.trace,evidence: execution.evidence,spend };
      const completed = execution.prediction ? forecastMust(await forecastCheckpointFinalize(store,{ ...common,prediction: execution.prediction,note: note.note,noteFailure: note.noteFailure,stopReason: 'stop' })) : forecastMust(await forecastCheckpointFail(store,{ ...common,stopReason: execution.stopReason,failure: execution.failure! }));
      retained.push({ fixtureCheckpointId: scheduled.id,question,harness,checkpoint: completed,evidence: execution.evidence,prediction: execution.prediction,trace: execution.trace,note: note.note,executorCalls: execution.calls,noteCalls: note.calls,refusals: execution.audit.refusals,tools: { names: toolbox.names,revision: toolbox.revision } });
      // Outcomes first enter here, after execution, note and immutable publication.
      const resolution = fixture.resolutions.find(r => r.questionId === registered.id), score = resolution && execution.prediction ? scoreForecast(registered.adapter,execution.prediction.normalized,resolution.outcome) : null;
      cases.push({ questionId: registered.id,checkpointId: scheduled.id,ordinal: scheduled.ordinal,scopeKey: question.scopeKey,cutoffAt: scheduled.cutoffAt,available: !!resolution,status: !resolution ? 'pending' : execution.prediction ? 'scored' : 'failed',failure: execution.failure,prediction: execution.prediction?.normalized ?? null,outcome: resolution?.outcome ?? null,category: score?.category ?? null,utility: score?.utility ?? null,evidenceAdmitted: execution.evidence.filter(e => e.admitted).map(e => e.citationId),evidenceRefused: { postCutoff: execution.audit.postCutoff,undated: execution.audit.undated },refused: execution.evidence.filter(e => !e.admitted).map(e => ({ id: e.citationId,reason: e.refusal!.reason as 'post-cutoff' | 'undated' })) });
    }
  }
  const records = Object.fromEntries(await Promise.all(FORECAST_TABLES.map(async table => [table,forecastMust(await forecastQuery(store,table))])));
  return { cases,retained,cost: combineForecastSpend(...spends),logicalCalls,physicalCalls,stops,records,identity: { configuration,toolset: { names: tools.names,revision: tools.revision },promptRevision: prompts.executor,noteSchemaRevision: prompts.noteSchema,notePromptRevision: prompts.note,noteToolsetRevision: await canonicalSha256([]),scorer: 'forecast-utility/v1',cutoffPolicy: 'available-at-lte-cutoff/v1' } satisfies Row['identity'] };
}
