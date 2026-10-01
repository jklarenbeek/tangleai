import { openTangleDb, createForecastStore, createMasStore } from '@tangleai/store';
import { forecastMust, forecastQuery, forecastResolutionBegin, forecastPredictionsScore, type ForecastStore } from '@tangleai/forecast';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
import { fixtureForecastHost, type ForecastScriptCounter } from '../../benchmark/lib/forecast-host-fixture.ts';
import { fixtureForecastOutcome, fixtureForecastResolution } from '../../benchmark/lib/forecast-lifecycle-fixture.ts';
export async function outcomeFixture(options: { store?: ForecastStore; questionCount?: number; beforeResolution?: boolean; applyProbe?: (step: string) => void } = {}) {
  const db = await openTangleDb({ jobs: {} }), fixture = await loadForecastFixtures(), store = options.store ?? createForecastStore(db,{ applyProbe: options.applyProbe }), counters: ForecastScriptCounter[] = [], questions: (Awaited<ReturnType<typeof fixtureForecastHost>> & { outcome: Awaited<ReturnType<typeof fixtureForecastOutcome>>;input: import('@tangleai/forecast').ForecastResolutionInput | null;lifecycle: Awaited<ReturnType<typeof fixtureForecastResolution>> })[] = [];
  let instant = fixture.questions[0].issuedAt;
  const now = () => instant, setNow = (value: string) => { instant = value; };
  try {
    for (const [questionIndex,registered] of fixture.questions.slice(0,options.questionCount ?? 1).entries()) {
      instant = registered.issuedAt;
      const host = await fixtureForecastOutcome({ db,store,fixture,scopeKey: registered.scopeKey,instant: now }), active = await host.checked();
      const f = await fixtureForecastHost({ db,fixture,questionIndex,forecastStore: store,counters,evolving: true,instant: now,outcomeAdmission: host,outcomeHost: () => host,startedFromCheckedVersionId: active?.versionId ?? null });
      for (const checkpoint of registered.checkpoints) { instant = checkpoint.scheduledAt; const tick = await f.host.tick(instant); if (tick.failed.length || tick.refused.length) throw Error(JSON.stringify(tick)); }
      const fact = fixture.resolutions.find(r => r.questionId === registered.id), evidence = fact?.evidence.map(id => { const s = fixture.snapshots.find(s => s.id === id)!; return { address: { corpus: fixture.manifest.registrationId,snapshotId: id },sha256: s.sha256,excerpt: s.excerpt }; }) ?? [];
      const input = fact ? { questionId: f.question.id,observedAt: fact.observedAt,receivedAt: fact.observedAt,outcome: fact.outcome,evidence } : null;
      if (fact) instant = fact.observedAt;
      const lifecycle = fact && !options.beforeResolution ? await fixtureForecastResolution({ db,fixture,host,masStore: f.masStore,question: f.question,registeredId: registered.id,instant: now,counters }) : null;
      questions.push({ ...f,outcome: host,input,lifecycle });
    }
    return { db,fixture,store,counters,questions,now,setNow,async begin(index = 0) { const q = questions[index]; if (!q.input) throw Error('Pending question'); return forecastMust(await forecastResolutionBegin(q.outcome,q.input)); },async score(id: string,index = 0) { return forecastMust(await forecastPredictionsScore(questions[index].outcome,id)); } };
  } catch (error) { await db.close(); throw error; }
}
