import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalClient } from '@jarenjs/contract/local';
import { openHttpClient } from '@jarenjs/contract/client';
import { serveHttp, type Handler } from '@jarenjs/contract/http';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { createForecastContract, forecastContractDocument, createForecastReadHandlers, type ForecastReadHandlerBinding } from '@tangleai/forecast/contract';
import { createForecastStoreAdapter, forecastMust, forecastQuery, forecastGet, forecastPut, sealForecastRecord, forecastRevision } from '@tangleai/forecast';
import { outcomeFixture } from './outcome-fixture.ts';

const missing = 'f'.repeat(64), names = Object.keys(forecastContractDocument.operations);
const contract = createForecastContract();
function client(transport: 'local' | 'http',binding: ForecastReadHandlerBinding | undefined, override: Record<string,Handler> = {}) {
  const handlers = { ...createForecastReadHandlers({ resolveHost: context => transport === 'local' || context.host === binding ? binding : undefined }),...override };
  if (transport === 'local') return openLocalClient(contract,handlers,{ validateOutput: 'always' });
  const handler = toFetchHandler(serveHttp(contract,handlers,{ validateOutput: 'always',identify: () => ({ host: binding }),trace: () => 'forecast-test',now: () => 0,ledger: null }));
  return openHttpClient(contract,{ fetch: (url: string | URL | Request,init?: RequestInit) => handler(new Request(new URL(String(url),'http://forecast.invalid'),init)),keys: () => { throw Error('A read must not request an idempotency key.'); },now: () => 0 });
}
function domain(result: unknown): any {
  const outer = result as any;assert.equal(outer.ok,true,JSON.stringify(result));return outer.value;
}
function value(result: unknown): any { const r = domain(result);assert.equal(r.ok,true,JSON.stringify(result));assert.equal(r.writes,0);return r.value; }
function refusal(result: unknown,code = 'TFCT1003') { const r = domain(result);assert.equal(r.ok,false);assert.equal(r.issues[0].code,code); }

describe('forecast public read contract',() => {
  let fixture: Awaited<ReturnType<typeof outcomeFixture>>, binding: ForecastReadHandlerBinding, inputs: Record<string,object>, privateVersion: string;
  let writes = 0;
  const originalFetch = globalThis.fetch;
  before(async () => {
    globalThis.fetch = async () => { throw Error('Network is forbidden in forecast read tests.'); };
    fixture = await outcomeFixture({ questionCount: 4,applyProbe: step => { if (step.startsWith('put:')) writes++; } });
    const q = fixture.questions[1], cp = forecastMust(await forecastQuery(fixture.store,'checkpoints',{ questionId: q.question.id })).sort((a,b) => a.ordinal-b.ordinal)[1];
    const rev = forecastMust(await forecastQuery(fixture.store,'revisions',{ checkpointId: cp.id }))[0], retro = forecastMust(await forecastQuery(fixture.store,'retrospectives',{ questionId: q.question.id }))[0];
    binding = { store: fixture.store,scopeKey: q.question.scopeKey,questionIds: [q.question.id],outcomeHost: q.outcome,allowScope: () => true };
    const other = fixture.questions[0].question, h = await sealForecastRecord('harnesses',{ scopeKey: other.scopeKey,questionId: other.id,parentVersionId: null,document: fixture.fixture.seed,digest: fixture.fixture.manifest.seedHarnessDigest,status: 'staged',checkedVersionId: null,provenance: { revisionId: null,retrospectiveId: null,seed: false },recordedAt: other.issuedAt });
    forecastMust(await forecastPut(fixture.store,'harnesses',h));privateVersion = h.id;
    inputs = { 'forecast.questions.list': { limit: 10 },'forecast.question.get': { id: q.question.id },'forecast.checkpoints.list': { questionId: q.question.id },'forecast.checkpoint.get': { id: cp.id },'forecast.note.get': { id: cp.noteId },'forecast.evidence.list': { checkpointId: cp.id },'forecast.trace.get': { id: cp.traceId,limit: 50 },'forecast.revision.get': { id: rev.id },'forecast.harness.version.get': { id: cp.inputHarnessVersionId },'forecast.harness.head': { scopeKey: q.question.scopeKey },'forecast.resolution.get': { questionId: q.question.id },'forecast.retrospective.get': { id: retro.id },'forecast.due.list': { now: fixture.now(),limit: 10 } };
  });
  after(async () => { globalThis.fetch = originalFetch;await fixture?.db.close(); });
  it('compiles thirteen read operations with no command, subscribe or idempotency policy',async () => {
    assert.equal(names.length,13);assert.deepEqual([...names].sort(),Object.keys(inputs).sort());
    for (const op of Object.values(forecastContractDocument.operations)) { assert.equal(op.kind,'read');assert.equal('policy' in op,false); }
    assert.match(await contract.revision(),/^[a-f0-9]{64}$/);
  });
  for (const transport of ['local','http'] as const) {
    it(`${transport}: every read shows the retained lifecycle without writes`,async () => {
      const beforeWrites = writes,c = client(transport,binding);assert.equal(c.capabilities.idempotency,transport === 'http');
      for (const name of names) { const out = value(await c.invoke(name,inputs[name]));assert.notEqual(out,null,name); }
      const list = value(await c.invoke('forecast.questions.list',{ limit: 10 }));assert.deepEqual(list.map((q:any) => q.id),binding.questionIds);
      const detail = value(await c.invoke('forecast.question.get',inputs['forecast.question.get']));assert.equal(detail.harnessLineageIds.includes(fixture.questions[0].harness.id),false,'an unrelated seed is not part of this question lineage');
      const head = value(await c.invoke('forecast.harness.head',inputs['forecast.harness.head']));const active = await binding.outcomeHost!.checked();assert.equal(head.versionId,active!.versionId);assert.equal(head.digest,await forecastRevision(active!.payload));assert.equal(head.revision,1);
      const r = value(await c.invoke('forecast.resolution.get',inputs['forecast.resolution.get']));assert.equal(r.scoringStatus,'complete');assert.equal(r.losses.length,3);assert.equal(r.disputed,false);
      const rev = value(await c.invoke('forecast.revision.get',inputs['forecast.revision.get']));const retro = value(await c.invoke('forecast.retrospective.get',inputs['forecast.retrospective.get']));assert.ok(retro.verdicts.some((v:any) => rev.committedGuidance.some((g:any) => g.guidanceRef === v.guidanceRef)));
      const trace = value(await c.invoke('forecast.trace.get',inputs['forecast.trace.get']));assert.equal('messages' in trace,false);assert.ok(Array.from(trace.excerpt).length <= 50);assert.equal(writes,beforeWrites);
    });
    it(`${transport}: malformed input and native transport faults remain distinct from TFCT values`,async () => {
      const c = client(transport,binding), malformed = await c.invoke('forecast.question.get',{ id: 'invalid' });assert.equal(malformed.ok,false);assert.match(JSON.stringify(malformed),/JC2050/);
      const invalidExtra = await c.invoke('forecast.question.get',{ ...inputs['forecast.question.get'],secret: true });assert.match(JSON.stringify(invalidExtra),/JC2050/);
      for (const [index,bad] of [() => ({ ok: true,value: { invented: true },writes: 0 }),() => { throw Error('broken'); },() => ({ ok: true }),() => ({ ok: false,issues: [{ code: 'TFCT1003',path: '',detail: 'denied',retryable: false }],value: null,writes: 0 })].entries()) {
        const r = await client(transport,binding,{ 'forecast.question.get': bad }).invoke('forecast.question.get',inputs['forecast.question.get']);assert.equal(r.ok,false);assert.match(JSON.stringify(r),transport === 'local' ? /JC2070/ : index === 1 ? /JC2008/ : /JC2010/);
      }
      refusal(await client(transport,{ ...binding,allowScope: () => false }).invoke('forecast.question.get',inputs['forecast.question.get']));
      refusal(await c.invoke('forecast.due.list',{ now: '2025-02-30T00:00:00.000Z',limit: 1 }),'TFCT1001');
    });
    it(`${transport}: the host authority refuses before any read`,async () => {
      let reads = 0;
      const store = createForecastStoreAdapter({ async transaction(task) { return task({ async get() { reads++;throw Error('denied read'); },async query() { reads++;throw Error('denied query'); },async put() { throw Error('read operation wrote'); } }); } });
      const denied = client(transport,{ ...binding,store,allowScope: () => false });
      for (const name of names) refusal(await denied.invoke(name,inputs[name]));
      assert.equal(reads,0);
      for (const name of names) refusal(await client(transport,undefined).invoke(name,inputs[name]));
      refusal(await client(transport,{ ...binding,store }).invoke('forecast.questions.list',{ scopeKey: 'foreign',limit: 1 }));assert.equal(reads,0);
    });
    it(`${transport}: a foreign question version and scope are TFCT1003, and unknown ids are null`,async () => {
      const c = client(transport,binding);
      refusal(await c.invoke('forecast.harness.version.get',{ id: privateVersion }));
      refusal(await c.invoke('forecast.question.get',{ id: fixture.questions[0].question.id }));
      refusal(await c.invoke('forecast.harness.head',{ scopeKey: fixture.questions[3].question.scopeKey }));
      const foreign = forecastMust(await forecastQuery(fixture.store,'harnesses',{ scopeKey: fixture.questions[3].question.scopeKey }))[0];refusal(await c.invoke('forecast.harness.version.get',{ id: foreign.id }));
      for (const name of names.filter(n => !['forecast.questions.list','forecast.harness.head','forecast.due.list'].includes(n))) {
        const input = Object.fromEntries(Object.entries(inputs[name]).map(([k,v]) => [k,['id','checkpointId','questionId'].includes(k) ? missing : v]));assert.equal(value(await c.invoke(name,input)),null,name);
      }
      refusal(await client(transport,{ ...binding,outcomeHost: undefined }).invoke('forecast.harness.head',inputs['forecast.harness.head']),'TFCT1012');
      const empty = client(transport,{ store: fixture.store,scopeKey: fixture.questions[3].question.scopeKey,outcomeHost: fixture.questions[3].outcome,allowScope: () => true });assert.equal(value(await empty.invoke('forecast.harness.head',{ scopeKey: fixture.questions[3].question.scopeKey })),null);
      const checked = forecastMust(await forecastQuery(fixture.store,'harnesses',{ status: 'checked-ref' }))[0];refusal(await empty.invoke('forecast.harness.version.get',{ id: checked.id }));
    });
  }
  it('public v1 is frozen and the gate actually refuses output field removal and enum narrowing',async () => {
    assert.deepEqual(JSON.parse(await readFile('scripts/fixtures/forecast-contract-v1.json','utf8')),forecastContractDocument);
    const dir = await mkdtemp(join(tmpdir(),'forecast-contract-'));
    try {
      for (const change of ['field','enum']) {
        const altered = structuredClone(forecastContractDocument);
        if (change === 'field') { delete (altered.$defs.forecastReadQuestionSummary.properties as Record<string,unknown>).status;altered.$defs.forecastReadQuestionSummary.required = altered.$defs.forecastReadQuestionSummary.required.filter(k => k !== 'status'); }
        else altered.$defs.questionsListQuery.properties.status.enum = ['open'];
        const path = join(dir,change + '.json');await writeFile(path,JSON.stringify(altered));
        const r = spawnSync('node_modules/.bin/jaren-contract',['diff','--from','scripts/fixtures/forecast-contract-v1.json','--to',path,'--fail-on','breaking'],{ encoding: 'utf8' });assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/breaking/i);
      }
    } finally { await rm(dir,{ recursive: true,force: true }); }
  });
  it('two generator runs preserve exact bundle bytes and check mode agrees',async () => {
    const before = await readFile('packages/forecast/schemas/forecast.contract.json','utf8');
    for (let n=0;n<2;n++) { execFileSync(process.execPath,['scripts/forecast-contract.ts'],{ stdio: 'pipe' });assert.equal(await readFile('packages/forecast/schemas/forecast.contract.json','utf8'),before);execFileSync(process.execPath,['scripts/forecast-contract.ts','--check'],{ stdio: 'pipe' }); }
  });
});

it('resolution reads find the original beyond a full page of correction evidence',async () => {
  const f = await outcomeFixture();
  try {
    const original = forecastMust(await forecastQuery(f.store,'resolutions'))[0], q = forecastMust(await forecastGet(f.store,'questions',original.questionId))!;
    const originalId = 'f'.repeat(64), records = [...Array.from({ length: 1001 },(_v,i) => ({ ...original,id: i.toString(16).padStart(64,'0'),correctionOf: originalId })),{ ...original,id: originalId }];
    const store = createForecastStoreAdapter({ async transaction(task) { return task({ async get(table,id) { return table === 'questions' && id === q.id ? { id: q.id,kind: table,questionId: q.id,scopeKey: q.scopeKey,checkpointId: null,ordinal: null,status: q.status,payload: q } as any : undefined; },async query(table,query) { return table === 'resolutions' ? records.filter(r => query.after === undefined || r.id > query.after).slice(0,query.limit).map(r => ({ id: r.id,kind: table,questionId: r.questionId,scopeKey: q.scopeKey,checkpointId: null,ordinal: null,status: null,payload: r })) as any : []; },async put() { throw Error('read operation wrote'); } }); } });
    const c = client('local',{ store,scopeKey: q.scopeKey,allowScope: () => true });
    const result = value(await c.invoke('forecast.resolution.get',{ questionId: q.id }));assert.ok(result);assert.equal(result.id,originalId);assert.equal(result.corrections.length,1000);assert.equal(result.correctionsTruncated,true);
  } finally { await f.db.close(); }
});
