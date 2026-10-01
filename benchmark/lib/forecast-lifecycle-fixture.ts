/** Authored retrospective replies are fixed independently of the measured outcome gate. */
import { createChatClient } from '@tangleai/models';
import { createForecastOutcomeHost, createForecastLifecycleHost, forecastMust, forecastQuery, forecastRevision, type ForecastLifecycleOptions, type ForecastOutcomeHost, type ForecastStore, type ForecastQuestion, type CommittedGuidance } from '@tangleai/forecast';
import { createOutcomeStore, type TangleDb } from '@tangleai/store';
import type { MasStore } from '@tangleai/mas';
import type { ForecastFixtures } from './forecast-fixtures.ts';
import { manualForecastSegments, type ForecastScriptCounter } from './forecast-host-fixture.ts';
import { SCRIPTED_FORECAST_CONFIGURATION } from './forecast-scripted.ts';

export const SCRIPTED_RETROSPECTIVES = Object.freeze({
  q01: { evidenceHandling: 'validate',uncertaintyHandling: 'validate',candidate: null },
  q02: { evidenceHandling: 'refine',uncertaintyHandling: 'reject',candidate: 0 },
  q03: { evidenceHandling: 'validate',uncertaintyHandling: 'refine',candidate: 1 },
  q04: { evidenceHandling: 'reject',uncertaintyHandling: 'reject',candidate: null },
  q05: { evidenceHandling: 'validate',uncertaintyHandling: 'refine',candidate: 1 },
} as const);
export function createScriptedRetrospectiveClient(fixture: ForecastFixtures,registeredId: keyof typeof SCRIPTED_RETROSPECTIVES,questionId: string) {
  let calls = 0, physical = 0;
  const wire = createChatClient({ ...SCRIPTED_FORECAST_CONFIGURATION,fetch: async () => { physical++; throw Error('Scripted retrospective reached transport.'); } });
  return { calls: () => calls,physicalCalls: () => physical,client: { endpoint: wire.endpoint,requestKey: wire.requestKey,async complete(request: Parameters<typeof wire.complete>[0]) {
    calls++;
    const data = request.messages.flatMap((m: any) => { try { return m.role === 'user' ? [JSON.parse(m.content)] : []; } catch { return []; } }).find(d => d.question?.id === questionId);
    if (!data || data.resolution.questionId !== questionId) throw Error('Retrospective fixture has no bound resolved question.');
    const script = SCRIPTED_RETROSPECTIVES[registeredId];
    const verdicts = (data.guidance as (CommittedGuidance & { guidanceRef: string })[]).map(item => {
      const verdict = item.component === 'factorTracking' ? 'validate' : script[item.component];
      return { guidanceRef: item.guidanceRef,verdict,refinedText: verdict === 'refine' ? item.text : null,reason: verdict === 'reject' ? 'The observed trajectory does not support transferring this procedure.' : 'Retain the bounded procedural instruction for independent held-out assessment.',sources: item.sources };
    });
    return { message: { role: 'assistant',content: JSON.stringify({ verdicts,candidate: script.candidate === null ? null : fixture.candidates[script.candidate].document }) },finishReason: 'stop',usage: { total_tokens: 60 } };
  } } };
}
export async function fixtureForecastOutcome(options: { db: TangleDb;store: ForecastStore;fixture: ForecastFixtures;scopeKey: string;instant: () => string;applyProbe?: (step: string) => void }) {
  return createForecastOutcomeHost({ store: options.store,outcomeStore: createOutcomeStore(options.db,{ applyProbe: options.applyProbe }),scopeKey: options.scopeKey,subject: 'scripted-fixture',principal: { id: 'fixture-reviewer',authorityId: await forecastRevision({ authority: 'forecast-scripted-independent-gate' }),approve: true,reconcile: false },now: options.instant,
    pairedPredictions: async (checkpoint,question) => {
      const registered = options.fixture.questions.find(q => q.prompt === question.prompt && q.issuedAt === question.issuedAt && q.scopeKey === question.scopeKey);
      if (!registered) throw Error('The paired forecast question is unregistered.');
      const values = options.fixture.predictions[registered.checkpoints[checkpoint.ordinal - 1].id];
      return Object.fromEntries([options.fixture.manifest.seedHarnessDigest,...options.fixture.manifest.candidateDigests].filter(digest => Object.hasOwn(values,digest)).map(digest => [digest,values[digest]]));
    },
  });
}
export async function fixtureForecastResolution(options: { db: TangleDb;fixture: ForecastFixtures;host: ForecastOutcomeHost;masStore: MasStore;question: ForecastQuestion;registeredId: string;instant: () => string;counters: ForecastScriptCounter[];afterStage?: ForecastLifecycleOptions['afterStage'];resolutionInput?: import('@tangleai/forecast').ForecastResolutionInput }) {
  const fact = options.fixture.resolutions.find(r => r.questionId === options.registeredId); if (!fact) return null;
  const evidence = fact.evidence.map(id => { const snapshot = options.fixture.snapshots.find(s => s.id === id)!; return { address: { corpus: options.fixture.manifest.registrationId,snapshotId: snapshot.id },sha256: snapshot.sha256,excerpt: snapshot.excerpt }; });
  const resolution = options.resolutionInput ?? { questionId: options.question.id,observedAt: fact.observedAt,receivedAt: fact.observedAt,outcome: fact.outcome,evidence };
  const lifecycle = await createForecastLifecycleHost({ outcomeHost: options.host,masStore: options.masStore,segments: manualForecastSegments(options.db,options.masStore),profile: 'forecast-scripted',now: options.instant,clock: () => Date.parse(options.instant()),afterStage: options.afterStage,
    retrospectiveEditor: () => { const script = createScriptedRetrospectiveClient(options.fixture,options.registeredId as keyof typeof SCRIPTED_RETROSPECTIVES,options.question.id); options.counters.push(script); return { client: script.client }; },
  });
  const request = { resolution,budget: { turns: 8,ms: 1000 } }, delivered = forecastMust(await lifecycle.deliver(request));
  await lifecycle.drain();
  const run = await options.masStore.getRun(delivered.runId);
  if (run?.status !== 'completed') throw Error('Forecast resolution workflow failed: ' + JSON.stringify(run?.failure));
  const retrospective = forecastMust(await forecastQuery(options.host.store,'retrospectives',{ questionId: options.question.id }))[0];
  return { lifecycle,request,delivered,retrospective };
}
