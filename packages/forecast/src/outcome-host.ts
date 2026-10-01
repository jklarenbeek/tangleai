/** Trusted forecast evidence and paired registrations consume the outcome service exclusively. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createOutcomeService, scopeIdOf, outcomeRevision, domainValidator, type OutcomeHost, type OutcomeStore, type OutcomePrincipal, type OutcomeService, type OutcomeRecord, type Source, type EvaluationSlot, type Head, type Json, type Result, type HistoryPage } from '@tangleai/outcomes';
import { createForecastHarnessAdapter, type ForecastOutcomeInput } from './outcome-adapter.ts';
import { forecastGet, forecastQuery, forecastCommandTransaction, type ForecastStore } from './store.ts';
import { forecastRevision, sealForecastRecord } from './identity.ts';
import { forecastMust, ForecastRefusal, issue, reject } from './errors.ts';
import { checkShape, checkTime } from './schema.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastResolution, ForecastHarnessVersion, HarnessDocument } from './contracts.gen.ts';

export function forecastOutcomeValue<T>(result: Result): T {
  if (!result.ok) throw new ForecastRefusal([{ ...issue(result.issues.some(i => i.code === 'OUTC1007') ? 'TFCT1004' : 'TFCT1011',result.issues.map(i => i.detail).join(' '),'',result.issues.some(i => i.retryable)),cause: result.issues.map(i => ({ ...i })) }]);
  return result.value as unknown as T;
}
export interface ForecastOutcomeHostOptions {
  store: ForecastStore; outcomeStore: OutcomeStore; scopeKey: string; subject: string; principal: OutcomePrincipal;
  now: () => string; configurationRegistry?: OutcomeHost['resolveConfiguration'];
  /** Trusted replay data; the actual executed digest must reproduce its retained prediction. */
  pairedPredictions?: (checkpoint: ForecastCheckpoint,question: ForecastQuestion) => Promise<Record<string,string|number>>;
}
export async function createForecastOutcomeHost(options: ForecastOutcomeHostOptions) {
  if (typeof options.now !== 'function') throw new TypeError('Inject the forecast outcome clock.');
  const scope = { namespace: 'forecast',domain: options.scopeKey,subject: options.subject }, scopeId = await scopeIdOf(scope), artifactKey = 'harness', adapter = await createForecastHarnessAdapter();
  const authority = await forecastRevision({ resolver: 'forecast/v1' }), evaluatorRevision = await forecastRevision({ slot: 'paired-held-out/v1' });
  let service: OutcomeService;
  const envelope = () => ({ scopeId,artifactKey });
  const command = (requestKey: string,input: object,at = options.now()) => ({ ...envelope(),requestKey,at: checkTime(at),input });
  async function inspect<T extends OutcomeRecord = OutcomeRecord>(id: string): Promise<T> { return forecastOutcomeValue<T>(await service.inspect({ ...envelope(),input: { id } })); }
  async function history() {
    const records: OutcomeRecord[] = []; let cursor: HistoryPage['cursor'] = null;
    do { const page: HistoryPage = forecastOutcomeValue(await service.history({ ...envelope(),input: { cursor,pageSize: 100 } })); records.push(...page.entries.map(e => e.record)); cursor = page.cursor; } while (cursor);
    return records;
  }
  async function question(id: string) {
    const q = forecastMust(await forecastGet(options.store,'questions',id));
    if (!q) reject('TFCT1002','The forecast question is missing.');
    if (q.scopeKey !== options.scopeKey) reject('TFCT1003','The forecast question belongs to another outcome scope.');
    return q;
  }
  async function source(resolutionId: string,decisionId: string | null,checkpointId?: string): Promise<Source | undefined> {
    const r = forecastMust(await forecastGet(options.store,'resolutions',resolutionId));
    if (!r || r.correctionOf) return undefined;
    const q = forecastMust(await forecastGet(options.store,'questions',r.questionId));
    if (!q || q.scopeKey !== options.scopeKey) return undefined;
    const checkpoints = forecastMust(await forecastQuery(options.store,'checkpoints',{ questionId: q.id }));
    const checkpoint = decisionId ? checkpoints.find(c => c.decisionId === decisionId) : checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint || !checkpoint.decisionId || checkpoint.status !== 'finalized') return undefined;
    const decision = await inspect(checkpoint.decisionId);
    if (decision.kind !== 'decision' || decision.decisionKey !== checkpoint.id || (decision.input as unknown as ForecastOutcomeInput).questionId !== q.id) return undefined;
    const bytes = { sourceId: resolutionId + ':' + (decisionId ?? 'held:' + checkpoint.id),scopeId,subject: scope.subject,issuer: 'forecast-resolution',observedAt: r.observedAt,payload: { outcome: r.outcome },decisionId };
    return { ...bytes,digest: await outcomeRevision(bytes) };
  }
  const resolver: OutcomeHost['resolver'] = { revision: authority,async resolve(ref,wantedScope) {
    if (!equalsJson(scope,wantedScope)) return undefined;
    const parts = ref.sourceId.split(':');
    if (parts.length !== 2 && !(parts.length === 3 && parts[1] === 'held')) return undefined;
    if (![parts[0],parts.at(-1)].every(id => /^[a-f0-9]{64}$/.test(id!))) return undefined;
    const value = await source(parts[0],parts[1] === 'held' ? null : parts[1],parts[2]);
    return value?.digest === ref.digest ? value : undefined;
  } };
  async function predictionBundle(checkpoint: ForecastCheckpoint, suppliedQuestion?: ForecastQuestion): Promise<ForecastOutcomeInput> {
    const q = suppliedQuestion ?? await question(checkpoint.questionId);
    if (checkpoint.questionId !== q.id || q.scopeKey !== options.scopeKey) reject('TFCT1003','Prediction bundle crosses its question or outcome scope.');
    if (checkpoint.status !== 'finalized' || !checkpoint.predictionId || !checkpoint.inputHarnessDigest) reject('TFCT1004','A forecast decision requires a finalized harness prediction.');
    const prediction = forecastMust(await forecastGet(options.store,'predictions',checkpoint.predictionId));
    if (!prediction || prediction.checkpointId !== checkpoint.id) reject('TFCT1002','The finalized prediction is missing.');
    const predictions = options.pairedPredictions ? cloneJson(await options.pairedPredictions(checkpoint,q)) : { [checkpoint.inputHarnessDigest]: prediction.normalized };
    if (predictions[checkpoint.inputHarnessDigest] !== prediction.normalized) reject('TFCT1002','The paired bundle does not reproduce the executed prediction.');
    const input = { questionId: q.id,checkpointId: checkpoint.id,ordinal: checkpoint.ordinal,cutoffAt: checkpoint.cutoffAt,adapter: q.adapter,usedHarnessDigest: checkpoint.inputHarnessDigest,predictions };
    return domainValidator(adapter.schemas.input)(input) as unknown as ForecastOutcomeInput;
  }
  async function checked() {
    const result = await service.injectChecked({ ...envelope(),input: {} });
    if (!result.ok && result.issues.length === 1 && result.issues[0].code === 'OUTC1004') return null;
    return forecastOutcomeValue<{ payload: HarnessDocument;versionId: string;evaluationId: string;activationEventId: string;head: Head }>(result);
  }
  async function evaluationSlot(slotId: string, versionId: string,wantedScope: typeof scope): Promise<EvaluationSlot | undefined> {
    if (!equalsJson(scope,wantedScope) || !slotId.startsWith('retro:')) return undefined;
    const retro = forecastMust(await forecastGet(options.store,'retrospectives',slotId.slice(6)));
    if (!retro || retro.reflect?.versionId !== versionId) return undefined;
    const trainingQuestion = await question(retro.questionId), version = await inspect(versionId);
    if (version.kind !== 'artifactVersion') return undefined;
    const reflection = await inspect(version.reflectionId);
    if (reflection.kind !== 'reflection') return undefined;
    const parent = version.parentVersionId ? await inspect(version.parentVersionId) : null;
    if (parent && parent.kind !== 'artifactVersion') return undefined;
    const parentDigest = await forecastRevision(parent?.payload ?? adapter.staticPayload), candidateDigest = await forecastRevision(version.payload);
    const used = new Set<string>();
    for (const record of await history()) if (record.kind === 'evaluationRegistration' && record.versionId !== versionId) for (const item of record.cases) used.add(await outcomeRevision({ domain: item.domain,input: item.input,outcome: item.source.payload }));
    const cases: EvaluationSlot['cases'] = [], resolutions = forecastMust(await forecastQuery(options.store,'resolutions',{ scopeKey: options.scopeKey,limit: 10000 })).filter(r => !r.correctionOf && r.scoringStatus === 'complete' && r.questionId !== trainingQuestion.id && r.receivedAt <= options.now()).sort((a,b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
    for (const r of resolutions) {
      if ((await question(r.questionId)).status !== 'resolved') continue;
      const checkpoints = forecastMust(await forecastQuery(options.store,'checkpoints',{ questionId: r.questionId })).sort((a,b) => a.ordinal - b.ordinal);
      for (const cp of checkpoints) {
        if (cp.status !== 'finalized' || !cp.decisionId || cp.endedAt! > r.observedAt || !r.losses.some(loss => loss.checkpointId === cp.id)) continue;
        if (cp.cutoffAt >= r.observedAt) reject('TFCT1011','Held-out checkpoints must precede their source observation.');
        const decision = await inspect(cp.decisionId); if (decision.kind !== 'decision') continue;
        const input = decision.input as unknown as ForecastOutcomeInput;
        if (!Object.hasOwn(input.predictions,parentDigest) || !Object.hasOwn(input.predictions,candidateDigest)) continue;
        const evidence = await source(r.id,null,cp.id); if (!evidence) continue;
        const item = { id: cp.id,domain: options.scopeKey,input: decision.input,source: evidence }, digest = await outcomeRevision({ domain: item.domain,input: item.input,outcome: evidence.payload });
        if (used.has(digest)) continue; used.add(digest); cases.push(item);
        if (cases.length === 128) break;
      }
      if (cases.length === 128) break;
    }
    if (!cases.length) reject('TFCT1011','No paired held-out checkpoints.');
    return { slotId,versionId,expectedHead: version.expectedHead,trainingScoreIds: reflection.scoreIds,evaluatorRevision,gatePolicyId: service.gatePolicyId,maxPhysicalRequests: 0,maxCost: null,cases };
  }
  const host: OutcomeHost = { scope,principal: options.principal,adapters: [adapter],resolver,authorizeMemoryIds: async ids => ({ allowed: ids.length === 0,authorizationId: authority }),evaluationSlot,...(options.configurationRegistry ? { resolveConfiguration: options.configurationRegistry } : {}) };
  service = await createOutcomeService({ ...host,store: options.outcomeStore });
  async function publishChecked(retrospectiveId: string) {
    const active = await checked(); if (!active) reject('TFCT1011','No checked forecast harness is active.');
    const event = await inspect(active.activationEventId), retro = forecastMust(await forecastGet(options.store,'retrospectives',retrospectiveId));
    if (event.kind !== 'activationEvent' || event.action !== 'promote' || event.versionId !== active.versionId || !equalsJson(event.nextHead,active.head) || !retro || retro.reflect?.versionId !== active.versionId) reject('TFCT1011','Checked forecast publication differs from the retained outcome activation.');
    const q = await question(retro.questionId);
    const version = await sealForecastRecord('harnesses',{ scopeKey: q.scopeKey,questionId: q.id,parentVersionId: retro.parentHarnessId ?? null,document: active.payload,digest: await forecastRevision(active.payload),status: 'staged',checkedVersionId: null,provenance: { revisionId: null,retrospectiveId,seed: false },recordedAt: event.recordedAt });
    return forecastCommandTransaction(options.store,async tx => {
      const previous = await tx.get('harnesses',version.id);
      if (previous) {
        if (previous.status !== 'checked-ref' || previous.checkedVersionId !== active.versionId) reject('TFCT1010','The checked forecast address contains different activation bytes.');
        return previous;
      }
      await tx.put('harnesses',version);
      const next: ForecastHarnessVersion = { ...version,status: 'checked-ref',checkedVersionId: active.versionId };
      await tx.replace('harnesses',version,next); return next;
    });
  }
  return Object.freeze({ host,service,adapter,scopeId,artifactKey,store: options.store,now: options.now,command,envelope,inspect,history,question,source,predictionBundle,checked,publishChecked });
}
export type ForecastOutcomeHost = Awaited<ReturnType<typeof createForecastOutcomeHost>>;
