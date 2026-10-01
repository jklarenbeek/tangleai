/** Scripted fixture inputs end at authored predictions and notes; no resolution reaches a client. */
import { createForecastHost, forecastMust, forecastQuestionCreate, forecastQuestionCreateFromOutcome, type ForecastOutcomeHost, forecastHarnessStage, sealForecastRecord, forecastPromptRevisions, forecastExecutorToolset, forecastRevision, type ForecastSegments, type ForecastHandlerOptions, type ForecastHostPolicy, type ForecastStore } from '@tangleai/forecast';
import { createForecastStore, createMasStore, createMasSegmentHandlers, enqueueMasSegment, ensurePendingMasSegments, type TangleDb } from '@tangleai/store';
import type { MasStore, MasRuntime } from '@tangleai/mas';
import { loadForecastFixtures, type ForecastFixtures } from './forecast-fixtures.ts';
import { createScriptedForecastClient, createScriptedNoteClient, createScriptedFeedbackClient, SCRIPTED_FORECAST_CONFIGURATION } from './forecast-scripted.ts';

export function manualForecastSegments(db: TangleDb, store: MasStore): ForecastSegments {
  return {
    enqueue: run => enqueueMasSegment(db,{ runId: run.id,segment: 0,workflowVersionId: run.workflowVersionId,registryRevision: run.registryRevision,executableRevision: run.executableRevision }),
    reconcile: () => ensurePendingMasSegments(db,store),
    async drain(runtime: MasRuntime) {
      const handlers = createMasSegmentHandlers(store,{ executableRevisions: [runtime.plan.executableRevision],execute: s => runtime.executeSegment(s),owner: 'forecast-fixture' }), kind = Object.keys(handlers)[0], jobs = db.jobs!;
      for (let n = 0; n < 100; n++) {
        const job = await jobs.claim({ kinds: [kind],owner: 'forecast-fixture',leaseMs: 60000 });
        if (!job) return;
        try { const result = await handlers[kind](job.payload,{ job,checkpoints: jobs.checkpointsFor(job),signal: new AbortController().signal }); await jobs.complete(job.lease,result ?? null); }
        catch (error) { await jobs.fail(job.lease,error); throw error; }
      }
      throw Error('Forecast fixture exceeded its bounded queue pass.');
    },
  };
}
export interface ForecastScriptCounter { calls: () => number; physicalCalls: () => number; }
export async function fixtureForecastHost(options: {
  db: TangleDb; instant: () => string; masStore?: MasStore; forecastStore?: ForecastStore;
  counters?: ForecastScriptCounter[]; afterStage?: ForecastHandlerOptions['afterStage'];
  executor?: ForecastHandlerOptions['executor'];
  feedbackEditor?: ForecastHandlerOptions['feedbackEditor']; outcomeHost?: ForecastHandlerOptions['outcomeHost']; outcomeAdmission?: ForecastOutcomeHost; startedFromCheckedVersionId?: string | null; evolving?: boolean;
  fixture?: ForecastFixtures; questionIndex?: number;
  policy?: Partial<ForecastHostPolicy>; segments?: (store: MasStore) => ForecastSegments;
}) {
  const fixture = options.fixture ?? await loadForecastFixtures(), registered = fixture.questions[options.questionIndex ?? 0];
  const treatment = options.policy?.treatment ?? (options.evolving ? 'evolving-harness' : 'static-harness'), tools = await forecastExecutorToolset(treatment), budget = options.policy?.budget ?? { turns: 8,ms: 1000 };
  const prompts = await forecastPromptRevisions(treatment);
  const registrationId = treatment === 'evolving-harness' ? fixture.manifest.registrationId : fixture.manifest.baseline!.registrationId;
  const policy: ForecastHostPolicy = { treatment,budget,revise: true,configuration: { kind: 'scripted',revision: await forecastRevision({ ...SCRIPTED_FORECAST_CONFIGURATION,registrationId,treatment,budget }) },...options.policy };
  const store = options.forecastStore ?? createForecastStore(options.db), masStore = options.masStore ?? createMasStore(options.db,{ now: options.instant });
  let question = await sealForecastRecord('questions',{ scopeKey: registered.scopeKey,prompt: registered.prompt,issuedAt: registered.issuedAt,expectedResolutionAt: registered.expectedResolutionAt,status: 'open',adapter: { ...registered.adapter,version: '1' },checkpointPolicy: { ordinals: registered.checkpoints.map(c => c.ordinal),scheduledAt: registered.checkpoints.map(c => c.scheduledAt) },startedFromCheckedVersionId: options.startedFromCheckedVersionId ?? null,latestProvisionalVersionId: null,promptRevision: prompts.executor,toolsetRevision: tools.revision });
  if (options.outcomeAdmission) { const { id: _id,status: _status,startedFromCheckedVersionId: _started,latestProvisionalVersionId: _latest,...input } = question; question = forecastMust(await forecastQuestionCreateFromOutcome(options.outcomeAdmission,input)); }
  else forecastMust(await forecastQuestionCreate(store,question));
  const harness = await sealForecastRecord('harnesses',{ scopeKey: question.scopeKey,questionId: null,parentVersionId: null,document: fixture.seed,digest: fixture.manifest.seedHarnessDigest,status: 'staged',checkedVersionId: null,provenance: { seed: true,revisionId: null,retrospectiveId: null },recordedAt: question.issuedAt });
  forecastMust(await forecastHarnessStage(store,harness));
  const scripts = { questions: fixture.questions,snapshots: fixture.snapshots,predictions: fixture.predictions,notes: fixture.notes }, counters = options.counters ?? [];
  const host = await createForecastHost({ forecastStore: store,masStore,profile: 'forecast-scripted',policy: () => policy,now: options.instant,clock: () => Date.parse(options.instant()),afterStage: options.afterStage,outcomeHost: options.outcomeHost,segments: options.segments?.(masStore) ?? manualForecastSegments(options.db,masStore),
    executor: options.executor ?? (({ checkpoint }) => {
      const scheduled = registered.checkpoints[checkpoint.ordinal - 1], client = createScriptedForecastClient(scripts,treatment,{ checkpointId: checkpoint.id,fixtureCheckpointId: scheduled.id,harnessDigest: checkpoint.inputHarnessDigest }); counters.push(client);
      return { client: client.client,cutoffPolicy: { kind: 'replay',corpus: registrationId,snapshots: fixture.snapshots.filter(s => scheduled.snapshotIds.includes(s.id)).map(s => ({ ...s,questionId: question.id })) } };
    }),
    noteBuilder: ({ checkpoint }) => { const client = createScriptedNoteClient({ notes: scripts.notes },{ checkpointId: checkpoint.id,fixtureCheckpointId: registered.checkpoints[checkpoint.ordinal - 1].id }); counters.push(client); return { client: client.client }; },
    feedbackEditor: options.feedbackEditor ?? (options.evolving ? (({ checkpoint }) => { const client = createScriptedFeedbackClient({ feedback: fixture.feedback },{ checkpointId: checkpoint.id,ordinal: checkpoint.ordinal,harnessDigest: checkpoint.inputHarnessDigest!,noteId: checkpoint.noteId! }); counters.push(client); return { client: client.client }; }) : undefined),
  });
  return { host,store,masStore,question,harness,registered,counters,policy };
}
