/** Cross-service commands retain immutable facts before attaching durable outcome receipts. */
import { equalsJson } from '@jarenjs/core/object';
import { type Decision, type Score } from '@tangleai/outcomes';
import { forecastCommandTransaction, forecastGet, forecastQuery, type ForecastStore } from './store.ts';
import { sealForecastRecord, validateForecastRecord } from './identity.ts';
import { forecastOutcomeValue, type ForecastOutcomeHost } from './outcome-host.ts';
import { forecastMust, reject, failure, type ForecastCommandResult } from './errors.ts';
import { forecastQuestionCreate } from './commands.ts';
import { planQuestionTransition } from './transitions.ts';
import { checkTime } from './schema.ts';
import type { ForecastCheckpoint, ForecastResolution, ForecastResolutionCorrection } from './contracts.gen.ts';

export type ForecastResolutionInput = Pick<ForecastResolution,'questionId'|'observedAt'|'receivedAt'|'outcome'|'evidence'>;
export async function forecastDecisionRecord(host: ForecastOutcomeHost, checkpointId: string): Promise<ForecastCommandResult<ForecastCheckpoint>> {
  try {
    const checkpoint = forecastMust(await forecastGet(host.store,'checkpoints',checkpointId));
    if (!checkpoint) reject('TFCT1002','The forecast checkpoint is missing.');
    const question = await host.question(checkpoint.questionId);
    if (checkpoint.decisionId) {
      const prior = await host.inspect<Decision>(checkpoint.decisionId);
      if (prior.kind !== 'decision' || prior.decisionKey !== checkpoint.id) reject('TFCT1002','The retained decision differs from its checkpoint.');
      return { ok: true,value: checkpoint,writes: 0 };
    }
    if (question.status !== 'open') reject('TFCT1004','A new decision requires an unresolved question.');
    const input = await host.predictionBundle(checkpoint,question), harness = forecastMust(await forecastGet(host.store,'harnesses',checkpoint.inputHarnessVersionId!));
    if (!harness || harness.digest !== checkpoint.inputHarnessDigest) reject('TFCT1002','The executed harness is missing.');
    const result = await host.service.create(host.command('decision:' + checkpoint.id,{ decisionKey: checkpoint.id,adapter: host.adapter.identity,input,output: await host.adapter.interpret(input as unknown as import('@tangleai/outcomes').Json,harness.document as unknown as import('@tangleai/outcomes').Json),decidedAt: checkpoint.endedAt!,cutoffAt: checkpoint.cutoffAt,expectedResolutionAt: question.expectedResolutionAt,memoryIds: [],configuration: checkpoint.configuration,usedVersionId: harness.status === 'checked-ref' ? harness.checkedVersionId : null,staticPayload: host.adapter.staticPayload },checkpoint.endedAt!));
    const { decisionId } = forecastOutcomeValue<{ decisionId: string }>(result);
    const saved = await forecastCommandTransaction(host.store,async tx => {
      const current = await tx.get('checkpoints',checkpoint.id);
      if (!current || current.decisionId && current.decisionId !== decisionId) reject('TFCT1010','The checkpoint decision changed during publication.');
      if (!equalsJson({ ...current,decisionId: null },{ ...checkpoint,decisionId: null })) reject('TFCT1010','The checkpoint changed during outcome recording.');
      const next = { ...current,decisionId }; await tx.replace('checkpoints',current,next); return next;
    });
    return saved.ok ? { ...saved,writes: saved.writes + (result.ok ? result.writes : 0) } : saved;
  } catch (error) { return failure(error); }
}
export async function forecastResolutionBegin(host: ForecastOutcomeHost, input: ForecastResolutionInput) {
  try {
    checkTime(input.observedAt); checkTime(input.receivedAt);
    const question = await host.question(input.questionId);
    if (input.observedAt < question.issuedAt || input.receivedAt > host.now()) reject('TFCT1004','Resolution observation or receipt is outside the injected chronology.');
    const resolution = await sealForecastRecord('resolutions',{ ...input,scorerId: host.adapter.identity.id,scorerVersion: host.adapter.identity.scorerRevision,losses: [],skipped: [],protocol: 'outcome/v1',scoringStatus: 'pending' });
    return await forecastCommandTransaction(host.store,async tx => {
      const current = await tx.get('questions',question.id); if (!current) reject('TFCT1002','The resolution question is missing.');
      const earlier = (await tx.query('resolutions',{ questionId: question.id })).find(r => !r.correctionOf);
      if (earlier) {
        if (earlier.id !== resolution.id) reject('TFCT1004','Resolution conflicts with earlier record ' + earlier.id + '.','/outcome');
        return earlier;
      }
      if (current.status !== 'open') reject('TFCT1004','Only an unresolved question can accept its first outcome.');
      if ((await tx.query('checkpoints',{ questionId: question.id })).some(c => c.status === 'running')) reject('TFCT1004','Finish running checkpoints before accepting the outcome.');
      await tx.put('resolutions',resolution);
      await tx.replace('questions',current,{ ...current,status: 'resolved',latestProvisionalVersionId: null });
      for (const version of await tx.query('harnesses',{ questionId: question.id })) if (version.status === 'provisional') await tx.replace('harnesses',version,{ ...version,status: 'archived' });
      return resolution;
    });
  } catch (error) { return failure(error); }
}
export async function forecastPredictionsScore(host: ForecastOutcomeHost, resolutionId: string): Promise<ForecastCommandResult<ForecastResolution>> {
  try {
    const resolution = forecastMust(await forecastGet(host.store,'resolutions',resolutionId));
    if (!resolution || resolution.correctionOf || resolution.protocol !== 'outcome/v1') reject('TFCT1004','Scoring requires its retained original outcome fact.');
    const question = await host.question(resolution.questionId);
    if (resolution.scoringStatus === 'complete') return { ok: true,value: resolution,writes: 0 };
    if (question.status !== 'resolved') reject('TFCT1004','A disputed outcome cannot create new scores.');
    const checkpoints = forecastMust(await forecastQuery(host.store,'checkpoints',{ questionId: question.id })).sort((a,b) => a.ordinal - b.ordinal);
    const losses: ForecastResolution['losses'] = [], skipped: ForecastResolution['skipped'] = []; let writes = 0;
    for (const checkpoint of checkpoints) {
      if (checkpoint.endedAt && checkpoint.endedAt > resolution.observedAt) { skipped.push({ checkpointId: checkpoint.id,reason: 'post-resolution' }); continue; }
      if (checkpoint.status === 'failed') { skipped.push({ checkpointId: checkpoint.id,reason: 'failed' }); continue; }
      if (checkpoint.status !== 'finalized' || !checkpoint.decisionId) { skipped.push({ checkpointId: checkpoint.id,reason: 'no-decision' }); continue; }
      const source = await host.source(resolution.id,checkpoint.decisionId); if (!source) reject('TFCT1011','The resolver cannot attest this checkpoint outcome.');
      const resolved = await host.service.resolve(host.command('resolve:' + checkpoint.id,{ decisionId: checkpoint.decisionId,evidence: [{ sourceId: source.sourceId,digest: source.digest }],receivedAt: resolution.receivedAt },resolution.receivedAt));
      const resultId = forecastOutcomeValue<{ resolutionId: string }>(resolved).resolutionId; if (resolved.ok) writes += resolved.writes;
      const scored = await host.service.score(host.command('score:' + checkpoint.id,{ resolutionId: resultId },resolution.receivedAt));
      const scoreId = forecastOutcomeValue<{ scoreId: string }>(scored).scoreId; if (scored.ok) writes += scored.writes;
      const score = await host.inspect<Score>(scoreId);
      if (score.kind !== 'score' || score.decisionId !== checkpoint.decisionId || score.resolutionId !== resultId) reject('TFCT1002','The retained score differs from its decision.');
      losses.push({ checkpointId: checkpoint.id,decisionId: checkpoint.decisionId,resolutionId: resultId,scoreId,category: score.outcome,utility: score.utility as 0 | .5 | 1 });
    }
    const saved = await forecastCommandTransaction(host.store,async tx => {
      const current = await tx.get('resolutions',resolution.id), owner = await tx.get('questions',question.id);
      if (!current || owner?.status !== 'resolved') reject('TFCT1004','The outcome changed before score publication.');
      const next: ForecastResolution = { ...resolution,losses,skipped,scoringStatus: 'complete' };
      if (current.scoringStatus === 'complete') { if (!equalsJson(current,next)) reject('TFCT1010','Scoring receipt differs from retained bytes.'); return current; }
      await tx.replace('resolutions',current,next); return next;
    });
    return saved.ok ? { ...saved,writes: saved.writes + writes } : saved;
  } catch (error) { return failure(error); }
}
/** Corrections preserve original scored evidence and never modify outcome records. */
export async function forecastResolutionCorrect(store: ForecastStore,input: ForecastResolutionCorrection) {
  try {
    const correction = await validateForecastRecord('resolutions',input);
    if (!correction.correctionOf || correction.losses.length || correction.skipped.length || correction.protocol) reject('TFCT1004','Corrections carry evidence only and cannot rewrite scoring receipts.');
    return await forecastCommandTransaction(store,async tx => {
      const earlier = await tx.get('resolutions',correction.correctionOf!), question = await tx.get('questions',correction.questionId);
      if (!earlier || earlier.correctionOf || !question) reject('TFCT1002','The original resolution or question is missing.');
      if (correction.receivedAt < earlier.receivedAt || correction.observedAt < earlier.observedAt) reject('TFCT1004','A correction cannot precede its original evidence.');
      const plan = forecastMust(planQuestionTransition(question,{ type: 'resolution.correct',resolution: correction,earlier }));
      await tx.put('resolutions',correction); await tx.replace('questions',question,plan.after); return correction;
    });
  } catch (error) { return failure(error); }
}
/** Capture the scope's verified checked head once when the host admits a question. */
export async function forecastQuestionCreateFromOutcome(host: ForecastOutcomeHost,input: Omit<import('./contracts.gen.ts').ForecastQuestion,'id'|'status'|'latestProvisionalVersionId'|'startedFromCheckedVersionId'>) {
  try {
    if (input.scopeKey !== host.host.scope.domain) reject('TFCT1003','Question creation crosses the outcome scope.');
    if (input.issuedAt > host.now()) reject('TFCT1004','The forecast question is not issued yet.');
    const same = forecastMust(await forecastQuery(host.store,'questions',{ scopeKey: input.scopeKey })).filter(q => q.prompt === input.prompt && q.issuedAt === input.issuedAt);
    if (same.length) {
      const { id: _id,status: _status,latestProvisionalVersionId: _latest,startedFromCheckedVersionId: _started,...before } = same[0];
      if (same.length !== 1 || !equalsJson(before,input)) reject('TFCT1010','The retained question has different immutable creation inputs.');
      return { ok: true as const,value: same[0],writes: 0 };
    }
    const checked = await host.checked();
    if (checked) {
      const event = await host.inspect(checked.activationEventId);
      if (event.recordedAt > host.now()) reject('TFCT1004','The checked harness comes from a future activation.');
      const references = forecastMust(await forecastQuery(host.store,'harnesses',{ scopeKey: input.scopeKey,status: 'checked-ref' }));
      if (!references.some(v => v.checkedVersionId === checked.versionId && equalsJson(v.document,checked.payload))) reject('TFCT1012','The checked outcome needs its retained forecast reference before question admission.');
    }
    const question = await sealForecastRecord('questions',{ ...input,status: 'open',latestProvisionalVersionId: null,startedFromCheckedVersionId: checked?.versionId ?? null });
    return await forecastQuestionCreate(host.store,question);
  } catch (error) { return failure(error); }
}
