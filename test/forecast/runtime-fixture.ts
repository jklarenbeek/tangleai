import { makeForecastFixture } from './fixtures.ts';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
import { createChatClient } from '@tangleai/models';
import { createMemoryForecastStore, forecastMust, forecastQuestionCreate, forecastHarnessStage, forecastCheckpointPlan, forecastCheckpointStart, sealForecastRecord, forecastPromptRevisions, forecastExecutorToolset, createForecastToolbox, type ForecastCheckpoint } from '@tangleai/forecast';

export function scriptedClient(complete: ReturnType<typeof createChatClient>['complete']) {
  const client = createChatClient({ provider: 'custom', baseUrl: 'https://fixture.invalid/v1', model: 'forecast-script/v1', fetch: async () => { throw Error('Unexpected transport'); } });
  return { endpoint: client.endpoint, requestKey: client.requestKey, complete };
}
export async function runtimeFixture(treatment: ForecastCheckpoint['treatment'] = 'static-harness', overrides: Record<string, unknown> = {}, storeOptions: Parameters<typeof createMemoryForecastStore>[0] = {}) {
  const f = await makeForecastFixture(), corpus = await loadForecastFixtures(), store = createMemoryForecastStore(storeOptions);
  const revisions = await forecastPromptRevisions(), toolset = await forecastExecutorToolset(treatment);
  const question = await sealForecastRecord('questions', { ...f.questions, promptRevision: revisions.executor, toolsetRevision: toolset.revision });
  forecastMust(await forecastQuestionCreate(store, question));
  const harness = treatment === 'static-harness' || treatment === 'evolving-harness' ? f.harnesses : null;
  if (harness) forecastMust(await forecastHarnessStage(store, harness));
  const planned = await sealForecastRecord('checkpoints', { ...f.checkpoints, questionId: question.id, treatment, noteFailure: null, inputHarnessVersionId: harness?.id ?? null, inputHarnessDigest: harness?.digest ?? null, promptRevision: revisions.executor, noteSchemaRevision: revisions.noteSchema, toolsetRevision: toolset.revision });
  forecastMust(await forecastCheckpointPlan(store, planned));
  const checkpoint = forecastMust(await forecastCheckpointStart(store, planned.id, planned.scheduledAt));
  const snapshots = corpus.snapshots.filter(s => corpus.questions[0].checkpoints[0].snapshotIds.includes(s.id)).map(s => ({ ...s, questionId: question.id }));
  const toolbox = await createForecastToolbox({ store, checkpoint, harness, cutoffPolicy: { kind: 'replay', corpus: 'tidewater', snapshots }, now: () => checkpoint.scheduledAt, ...overrides });
  return { store, question, checkpoint, harness, toolbox, snapshots, corpus };
}
