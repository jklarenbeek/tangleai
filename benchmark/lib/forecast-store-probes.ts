/** The same adversarial lifecycle census runs against every persistence adapter. */
import assert from 'node:assert/strict';
import { FORECAST_TABLES, createMemoryForecastStore, forecastQuestionCreate, forecastHarnessStage, forecastCheckpointPlan, forecastCheckpointStart, forecastCheckpointFinalize,
  forecastHarnessProvisional, forecastHarnessArchive, forecastResolutionRecord, forecastTransaction, forecastPut, forecastGet, forecastQuery, sealForecastRecord,
  type ForecastStore, type ForecastCommandResult, type ForecastTables } from '@tangleai/forecast';
import { makeForecastFixture,must,at,end,hash } from './forecast-store-fixture.ts';

export interface ForecastProbeHost { store: ForecastStore; peer: ForecastStore; failAt: string | null; reopen(): Promise<void>; close(): Promise<void>; }
export function createMemoryForecastProbeHost(): ForecastProbeHost {
  const host: ForecastProbeHost = { store: null!,peer: null!,failAt: null,async reopen() {},async close() {} };
  host.store = host.peer = createMemoryForecastStore({ applyProbe: step => { if (host.failAt === step) throw Error('Injected forecast persistence fault.'); } });
  return host;
}
const code = (r: ForecastCommandResult<unknown>) => r.ok ? null : r.issues[0].code;
function finalization(f: ForecastTables) { return { checkpointId: f.checkpoints.id,at: end,prediction: f.predictions,trace: f.traces,note: f.notes,evidence: [f.evidence],spend: { calls: 2,tokens: 40,ms: 1000,usageKnown: true },stopReason: 'stop' as const }; }
async function start(host: ForecastProbeHost,f: ForecastTables) {
  must(await forecastQuestionCreate(host.store,f.questions)); must(await forecastHarnessStage(host.store,f.harnesses));
  must(await forecastCheckpointPlan(host.store,f.checkpoints)); must(await forecastCheckpointStart(host.store,f.checkpoints.id,at));
}
async function dump(store: ForecastStore) {
  return Object.fromEntries(await Promise.all(FORECAST_TABLES.map(async table => [table,must(await forecastQuery(store,table,{ limit: 10000 }))] as const)));
}
async function lifecycle(store: ForecastStore,f: ForecastTables) {
  let writes = 0;
  const take = <T>(r: ForecastCommandResult<T>): T => { const value = must(r); if (r.ok) writes += r.writes; return value; };
  take(await forecastQuestionCreate(store,f.questions)); take(await forecastHarnessStage(store,f.harnesses));
  const checkpoint = take(await forecastCheckpointPlan(store,f.checkpoints));
  if (checkpoint.status === 'planned') take(await forecastCheckpointStart(store,f.checkpoints.id,at));
  take(await forecastCheckpointFinalize(store,finalization(f)));
  take(await forecastPut(store,'revisions',f.revisions));
  const candidate = await sealForecastRecord('harnesses',{ ...f.harnesses,questionId: f.questions.id,parentVersionId: f.harnesses.id,provenance: { seed: false,revisionId: f.revisions.id,retrospectiveId: null } });
  const retained = take(await forecastHarnessStage(store,candidate));
  if (retained.status === 'staged') take(await forecastHarnessProvisional(store,candidate.id));
  take(await forecastResolutionRecord(store,f.resolutions)); take(await forecastHarnessArchive(store,candidate.id));
  take(await forecastPut(store,'retrospectives',f.retrospectives));
  return writes;
}
export async function runForecastStoreProbes(createHost: () => Promise<ForecastProbeHost> | ForecastProbeHost) {
  const cases: string[] = [], f = await makeForecastFixture();
  let recordIds: Record<string,string[]> = {}, counts: Record<string,number> = {}, repeatWrites = -1;
  const probe = async (name: string,task: (host: ForecastProbeHost) => Promise<void>) => {
    const host = await createHost();
    try { await task(host); cases.push(name); } finally { host.failAt = null; await host.close(); }
  };
  await probe('lifecycle-reopen-and-zero-write-replay',async host => {
    assert.ok(await lifecycle(host.store,f) > 0);
    const before = await dump(host.store); await host.reopen(); assert.deepEqual(await dump(host.store),before);
    repeatWrites = await lifecycle(host.store,f); assert.equal(repeatWrites,0); assert.deepEqual(await dump(host.store),before);
    recordIds = Object.fromEntries(Object.entries(before).map(([table,rows]) => [table,rows.map(row => row.id)]));
    counts = Object.fromEntries(Object.entries(before).map(([table,rows]) => [table,rows.length]));
    assert.equal(Object.values(counts).reduce((a,b) => a+b,0),14);
  });
  await probe('immutable-equal-put-writes-zero',async host => {
    const first = await forecastPut(host.store,'questions',f.questions),second = await forecastPut(host.store,'questions',f.questions);
    assert.ok(first.ok && first.writes === 1); assert.ok(second.ok && second.writes === 0);
  });
  await probe('immutable-different-bytes-refused',async host => {
    must(await forecastPut(host.store,'questions',f.questions));
    assert.equal(code(await forecastPut(host.store,'questions',{ ...f.questions,prompt: 'Changed under an existing id.' })),'TFCT1010');
    assert.deepEqual(must(await forecastGet(host.store,'questions',f.questions.id)),f.questions);
  });
  await probe('forged-new-address-refused',async host => {
    assert.equal(code(await forecastPut(host.store,'questions',{ ...f.questions,id: hash })),'TFCT1002');
    assert.equal(must(await forecastQuery(host.store,'questions')).length,0);
  });
  await probe('caught-refusal-invalidates-transaction',async host => {
    const r = await forecastTransaction(host.store,async tx => {
      await tx.put('questions',f.questions);
      try { await tx.put('questions',{ ...f.questions,prompt: 'Conflicting id.' }); } catch {}
      return 'attempt to commit a caught refusal';
    });
    assert.equal(code(r),'TFCT1010'); assert.equal(must(await forecastQuery(host.store,'questions')).length,0);
  });
  for (const step of ['put:forecast_notes','put:forecast_checkpoints','commit']) await probe('finalization-rollback-' + step,async host => {
    await start(host,f); host.failAt = step;
    assert.equal(code(await forecastCheckpointFinalize(host.store,finalization(f))),'TFCT1012'); host.failAt = null;
    for (const table of ['predictions','traces','notes','evidence'] as const) assert.equal(must(await forecastQuery(host.store,table)).length,0);
    assert.equal(must(await forecastGet(host.store,'checkpoints',f.checkpoints.id))!.status,'running');
    assert.equal(must(await forecastQuery(host.store,'schedules',{ status: 'running' })).length,1);
    assert.equal(must(await forecastCheckpointFinalize(host.store,finalization(f))).status,'finalized');
  });
  await probe('twenty-input-contenders-one-ordinal-winner',async host => {
    must(await forecastQuestionCreate(host.store,f.questions)); must(await forecastHarnessStage(host.store,f.harnesses));
    const records = await Promise.all(Array.from({ length: 20 },(_,i) => sealForecastRecord('checkpoints',{ ...f.checkpoints,configuration: { kind: 'scripted',revision: i.toString(16).padStart(64,'0') } })));
    const results = await Promise.all(records.map((record,i) => forecastCheckpointPlan(i % 2 ? host.store : host.peer,record)));
    assert.equal(results.filter(r => r.ok).length,1); assert.equal(results.filter(r => code(r) === 'TFCT1004').length,19);
    assert.equal(must(await forecastQuery(host.store,'checkpoints')).length,1);
  });
  await probe('scoped-indexes-and-stable-cursor',async host => {
    const other = await sealForecastRecord('questions',{ ...f.questions,scopeKey: 'other-scope' });
    must(await forecastQuestionCreate(host.store,f.questions)); must(await forecastQuestionCreate(host.store,other));
    assert.deepEqual(must(await forecastQuery(host.store,'questions',{ scopeKey: 'other-scope' })).map(q => q.id),[other.id]);
    const rows = must(await forecastQuery(host.store,'questions',{ limit: 1 })),next = must(await forecastQuery(host.store,'questions',{ after: rows[0].id,limit: 1 }));
    assert.equal(rows.length,1); assert.equal(next.length,1); assert.notEqual(rows[0].id,next[0].id);
    assert.equal(must(await forecastQuery(host.store,'questions',{ limit: 0 })).length,0);
    assert.equal(code(await forecastQuery(host.store,'questions',{ limit: -1 })),'TFCT1001');
  });
  await probe('indexed-note-ownership-is-derived',async host => {
    await start(host,f); must(await forecastCheckpointFinalize(host.store,finalization(f)));
    for (const query of [{ scopeKey: f.questions.scopeKey },{ questionId: f.questions.id },{ checkpointId: f.checkpoints.id }]) assert.deepEqual(must(await forecastQuery(host.store,'notes',query)).map(n => n.id),[f.notes.id]);
    const queried = must(await forecastQuery(host.store,'notes',{ scopeKey: 'other-scope' })); assert.deepEqual(queried,[]);
  });
  await probe('missing-and-cross-question-references-refused',async host => {
    assert.equal(code(await forecastPut(host.store,'evidence',f.evidence)),'TFCT1002');
    await start(host,f);
    const other = (await makeForecastFixture(' foreign')).questions; must(await forecastQuestionCreate(host.store,other));
    const revision = await sealForecastRecord('revisions',{ ...f.revisions,questionId: other.id });
    assert.equal(code(await forecastPut(host.store,'revisions',revision)),'TFCT1003');
    assert.equal(must(await forecastQuery(host.store,'revisions')).length,0);
  });
  await probe('direct-put-cannot-duplicate-checkpoint-ordinal',async host => {
    await start(host,f);
    const other = await sealForecastRecord('checkpoints',{ ...f.checkpoints,configuration: { kind: 'scripted',revision: hash } });
    assert.equal(code(await forecastPut(host.store,'checkpoints',other)),'TFCT1004');
    assert.equal(must(await forecastQuery(host.store,'checkpoints')).length,1);
  });
  await probe('direct-put-cannot-start-or-check-a-record',async host => {
    must(await forecastQuestionCreate(host.store,f.questions));
    const running = await sealForecastRecord('checkpoints',{ ...f.checkpoints,status: 'running',startedAt: at });
    assert.equal(code(await forecastPut(host.store,'checkpoints',running)),'TFCT1004');
    const checked = await sealForecastRecord('harnesses',{ ...f.harnesses,status: 'checked-ref',checkedVersionId: hash });
    assert.equal(code(await forecastPut(host.store,'harnesses',checked)),'TFCT1004');
  });
  await probe('direct-put-cannot-skip-ordinal-or-cross-harness-scope',async host => {
    must(await forecastQuestionCreate(host.store,f.questions)); must(await forecastHarnessStage(host.store,f.harnesses));
    const scheduledAt = f.questions.checkpointPolicy.scheduledAt[1];
    const later = await sealForecastRecord('checkpoints',{ ...f.checkpoints,ordinal: 2,scheduledAt,cutoffAt: scheduledAt });
    assert.equal(code(await forecastPut(host.store,'checkpoints',later)),'TFCT1004');
    const foreign = await sealForecastRecord('harnesses',{ ...f.harnesses,scopeKey: 'foreign-scope' });
    must(await forecastHarnessStage(host.store,foreign));
    const crossed = await sealForecastRecord('checkpoints',{ ...f.checkpoints,inputHarnessVersionId: foreign.id,inputHarnessDigest: foreign.digest });
    assert.equal(code(await forecastPut(host.store,'checkpoints',crossed)),'TFCT1003');
    assert.equal(must(await forecastQuery(host.store,'checkpoints')).length,0);
  });
  await probe('public-transaction-has-no-replacement-authority',async host => {
    must(await forecastTransaction(host.store,async tx => { assert.equal('replace' in tx,false); assert.ok(Object.isFrozen(tx)); return null; }));
    assert.deepEqual(Object.keys(host.store),['atomic']); assert.ok(Object.isFrozen(host.store));
  });
  await probe('caller-read-mutation-does-not-edit-storage',async host => {
    must(await forecastQuestionCreate(host.store,f.questions)); const q = must(await forecastGet(host.store,'questions',f.questions.id))!;
    q.prompt = 'changed detached copy'; q.checkpointPolicy.ordinals[0] = 99;
    assert.deepEqual(must(await forecastGet(host.store,'questions',f.questions.id)),f.questions);
  });
  return { cases,passed: cases.length,failed: 0,physicalRequests: 0,recordIds,counts,repeatWrites };
}
