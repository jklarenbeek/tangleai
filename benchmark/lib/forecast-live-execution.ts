/** Authorized live models use the public host against frozen evidence, never scripted replies. */
import { openTangleDb, createForecastStore, createMasStore, createOutcomeStore } from '@tangleai/store';
import { createForecastHost, createForecastOutcomeHost, createForecastLifecycleHost, forecastQuestionCreate, forecastQuestionCreateFromOutcome, forecastHarnessStage, forecastRevision, forecastPromptRevisions, forecastExecutorToolset, sealForecastRecord, forecastMust, forecastQuery, forecastGet, combineForecastSpend, type ForecastChatClient } from '@tangleai/forecast';
import { chatClientFor } from '../../apps/desktop/src/settings.ts';
import { chatSettingsOf, envConfigIdentity, type AiEnv } from './ai-env.ts';
import { loadForecastFixtures } from './forecast-fixtures.ts';
import { manualForecastSegments } from './forecast-host-fixture.ts';
import { scoreForecast } from './forecast-oracle.ts';
import type { LivePlan } from './forecast-live.types.ts';

export async function executeForecastLive(plan: LivePlan, options: { env: AiEnv;fetch: typeof globalThis.fetch;root?: string;databasePath?: string }) {
  const fixture = await loadForecastFixtures(options.root), identity = await envConfigIdentity(options.env,null);
  let physicalRequests = 0,logicalCalls = 0,rowRequests = 0,activeCeiling = 0;
  const rows = [];
  const settings = { ...chatSettingsOf(options.env),maxTokens: plan.limits.maxOutputTokens };
  const wire = chatClientFor(settings,{ retry: { attempts: plan.limits.retryAttempts },reasoning: { enabled: false },fetch: async (input,init) => {
    if (physicalRequests >= plan.maxFreshTotal || physicalRequests >= options.env.maxCalls || rowRequests >= activeCeiling) throw Error('The frozen forecasting request ceiling is exhausted.');
    physicalRequests++; rowRequests++; return options.fetch(input,init);
  } });
  const request = (value: Parameters<typeof wire.complete>[0]) => ({ ...value,maxTokens: plan.limits.maxOutputTokens,reasoning: { enabled: false },stream: false });
  const client: ForecastChatClient = { endpoint: wire.endpoint,requestKey: value => wire.requestKey(request(value)),async complete(value) { logicalCalls++;return wire.complete(request(value)); } };
  for (const row of plan.rows) {
    activeCeiling = row.maxFreshCalls; rowRequests = 0;
    const db = await openTangleDb({ ...(options.databasePath ? { path: options.databasePath+'.'+row.id+'.sqlite' } : {}),jobs: {} });
    let instant = fixture.questions[0].issuedAt;
    const store = createForecastStore(db), masStore = createMasStore(db,{ now: () => instant }), segments = manualForecastSegments(db,masStore), evolving = row.id === 'evolving-harness';
    const cases = [], failures: { questionId: string;stage: string;code: string }[] = [];
    const outcomeHosts = new Map<string,Awaited<ReturnType<typeof createForecastOutcomeHost>>>();
    try {
      for (const registered of fixture.questions) {
        instant = registered.issuedAt;
        const prompts = await forecastPromptRevisions(row.id), tools = await forecastExecutorToolset(row.id);
        const input = { scopeKey: registered.scopeKey,prompt: registered.prompt,issuedAt: registered.issuedAt,expectedResolutionAt: registered.expectedResolutionAt,adapter: { ...registered.adapter,version: '1' },checkpointPolicy: { ordinals: registered.checkpoints.map(c => c.ordinal),scheduledAt: registered.checkpoints.map(c => c.scheduledAt) },promptRevision: prompts.executor,toolsetRevision: tools.revision };
        const outcome = evolving ? await createForecastOutcomeHost({ store,outcomeStore: createOutcomeStore(db),scopeKey: registered.scopeKey,subject: 'live-frozen-fixture',principal: { id: 'registered-forecast-gate',authorityId: await forecastRevision({ planId: plan.planId }),approve: true,reconcile: false },now: () => instant,configurationRegistry: async id => id === identity.identityId ? identity : undefined }) : null;
        if (outcome) outcomeHosts.set(registered.scopeKey,outcome);
        // Only the executed prediction is registered. Unbought future candidate pairs stay unavailable.
        const question = outcome ? forecastMust(await forecastQuestionCreateFromOutcome(outcome,input)) : forecastMust(await forecastQuestionCreate(store,await sealForecastRecord('questions',{ ...input,status: 'open',startedFromCheckedVersionId: null,latestProvisionalVersionId: null })));
        const seed = await sealForecastRecord('harnesses',{ scopeKey: question.scopeKey,questionId: null,parentVersionId: null,document: fixture.seed,digest: fixture.manifest.seedHarnessDigest,status: 'staged',checkedVersionId: null,provenance: { seed: true,revisionId: null,retrospectiveId: null },recordedAt: question.issuedAt });
        forecastMust(await forecastHarnessStage(store,seed));
        const host = await createForecastHost({ forecastStore: store,masStore,segments,profile: 'forecast-live',now: () => instant,clock: () => Math.floor(performance.now()),policy: () => ({ treatment: row.id,configuration: { kind: 'model',identityId: identity.identityId },budget: { turns: plan.limits.checkpointCalls,ms: plan.limits.checkpointMs },revise: evolving }),outcomeHost: outcome ? () => outcome : undefined,
          executor: ({ checkpoint }) => ({ client,cutoffPolicy: { kind: 'replay',corpus: fixture.manifest.registrationId,snapshots: fixture.snapshots.filter(s => registered.checkpoints[checkpoint.ordinal-1].snapshotIds.includes(s.id)).map(s => ({ ...s,questionId: question.id })) } }),noteBuilder: () => ({ client }),feedbackEditor: evolving ? () => ({ client }) : undefined });
        for (const scheduled of registered.checkpoints) {
          instant = scheduled.scheduledAt;
          const tick = await host.tick(instant);
          if (tick.failed.length || tick.refused.length) failures.push({ questionId: registered.id,stage: 'checkpoint',code: 'workflow-refused' });
          const checkpoint = forecastMust(await forecastQuery(store,'checkpoints',{ questionId: question.id })).find(c => c.ordinal === scheduled.ordinal), prediction = checkpoint?.predictionId ? forecastMust(await forecastGet(store,'predictions',checkpoint.predictionId)) : null, resolution = fixture.resolutions.find(r => r.questionId === registered.id);
          const score = resolution && prediction ? scoreForecast(registered.adapter,prediction.normalized,resolution.outcome) : null;
          cases.push({ questionId: registered.id,checkpointId: scheduled.id,checkpoint: checkpoint ?? null,prediction,utility: score?.utility ?? null,pending: !resolution });
        }
        const fact = fixture.resolutions.find(r => r.questionId === registered.id);
        if (fact && outcome) {
          instant = fact.observedAt;
          const evidence = fact.evidence.map(id => { const s = fixture.snapshots.find(s => s.id === id)!;return { address: { corpus: fixture.manifest.registrationId,snapshotId: s.id },sha256: s.sha256,excerpt: s.excerpt }; });
          const lifecycle = await createForecastLifecycleHost({ outcomeHost: outcome,masStore,segments,profile: 'forecast-live',now: () => instant,clock: () => Math.floor(performance.now()),retrospectiveEditor: () => ({ client }) });
          const delivered = forecastMust(await lifecycle.deliver({ resolution: { questionId: question.id,observedAt: fact.observedAt,receivedAt: fact.observedAt,outcome: fact.outcome,evidence },budget: { turns: plan.limits.retrospectiveCalls,ms: plan.limits.retrospectiveMs } }));
          await lifecycle.drain(); const run = await masStore.getRun(delivered.runId);
          if (run?.status !== 'completed') failures.push({ questionId: registered.id,stage: 'resolution',code: 'workflow-failed' });
        }
      }
      const retrospectives = forecastMust(await forecastQuery(store,'retrospectives',{ limit: 1000 })), resolutions = forecastMust(await forecastQuery(store,'resolutions',{ limit: 1000 }));
      const artifacts = { traces: forecastMust(await forecastQuery(store,'traces',{ limit: 1000 })),evidence: forecastMust(await forecastQuery(store,'evidence',{ limit: 1000 })),notes: forecastMust(await forecastQuery(store,'notes',{ limit: 1000 })),revisions: forecastMust(await forecastQuery(store,'revisions',{ limit: 1000 })),harnesses: forecastMust(await forecastQuery(store,'harnesses',{ limit: 1000 })) };
      const outcomes = (await Promise.all([...outcomeHosts.values()].map(h => h.history()))).flat();
      rows.push({ id: row.id,cases,failures,physicalRequests: rowRequests,cost: combineForecastSpend(...cases.flatMap(c => c.checkpoint ? [c.checkpoint.spend] : []),...retrospectives.flatMap(r => r.receipt ? [r.receipt.spend] : [])),resolutions,retrospectives,artifacts,outcomes });
    } finally { await db.close(); }
  }
  const content = { planId: plan.planId,identity,rows,physicalRequests,logicalCalls,quality: 'Unmeasured on a real forecasting domain; these model replies address the fictional registered fixture.',pairedEvaluation: 'Only executed digests are retained; unseen candidate pairs are ineligible. No prediction bag is backfilled.' };
  return { ...content,executionId: await forecastRevision(content) };
}
