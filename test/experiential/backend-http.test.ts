import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { createMemoryLedger } from '@jarenjs/contract/ledger';
import { compileDag } from '@jarenjs/flow';
import { createHttpTrainingBackend, verifyArtifactReceipt, trainingSpecDigest,
  createExperientialMemoryStore, createExperientialTrainingTasks, EXPERIENTIAL_TRAINING_DAG, planExperientialTraining,
  type ArtifactReceipt, type BackendJob, type ExperientialRuntime, type HttpTrainingBudget, type TrainingSpec } from '@tangleai/experiential';
import document from '@tangleai/experiential/schemas/training-service' with { type: 'json' };
import { accepted } from './identity-fixtures.ts';
import { trainingFixture } from './pipeline-fixtures.ts';
import { SELECTION_TIME } from './selection-fixtures.ts';

const credential = 'training-credential-sentinel';
const budget: HttpTrainingBudget = { maxRequests: 64, maxJobs: 4, maxBytes: 4096, maxResponseBytes: 16384, maxWallMs: 60000, maxSpend: 10 };
interface Exchange {
  request: { method: string; path: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; body?: unknown; bytes?: number[] };
}
interface Fixture {
  base: string; runtime: ExperientialRuntime; spec: TrainingSpec; job: BackendJob; receipt: ArtifactReceipt;
  physicalRequests: number; exchanges: Exchange[];
}
async function fixture(name = 'happy'): Promise<Fixture> {
  return JSON.parse(await readFile(new URL('../fixtures/experiential/training-service/' + name + '.json', import.meta.url), 'utf8'));
}
async function scripted(name = 'happy', overrides: Partial<HttpTrainingBudget> = {}) {
  const f = await fixture(name); let offset = 0, at = 0;
  const requests: Exchange['request'][] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const entry = f.exchanges[offset++]; assert.ok(entry, 'unexpected scripted request');
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.equal(headers.get('authorization'), 'Bearer ' + credential);
    const projected = { method: init?.method ?? 'GET', path: url.pathname,
      headers: Object.fromEntries(Object.keys(entry.request.headers).map(key => [key, key === 'authorization' ? 'Bearer <redacted>' : headers.get(key)])),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
    assert.deepEqual(projected, entry.request);
    requests.push(projected as Exchange['request']);
    return new Response(entry.response.bytes ? new Uint8Array(entry.response.bytes) : JSON.stringify(entry.response.body),
      { status: entry.response.status, headers: entry.response.headers });
  };
  const backend = accepted(createHttpTrainingBackend({ base: f.base, runtime: f.runtime, budget: { ...budget, ...overrides },
    clock: () => at, credential: async () => credential, fetch }));
  return { f, backend, requests, fetch, clock: () => at, advance: (ms: number) => { at += ms; }, consumed: () => offset };
}
const issue = (result: { ok: boolean; issues?: { code: string }[] }, code = 'TEXP1008') => {
  assert.equal(result.ok, false); assert.equal(result.issues?.[0]?.code, code);
};

it('the native training contract and scripted transport verify bytes with one concurrent submission', async () => {
  const contract = compileContract(document), h = await scripted();
  assert.equal(Object.keys(contract.operations).length, 5);
  assert.equal((await h.backend.capabilities()).trainable, true);
  const replies = await Promise.all(Array.from({ length: 20 }, () => h.backend.submit(h.f.spec)));
  for (const reply of replies) assert.deepEqual(accepted(reply), h.f.job);
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
  for (const state of ['preparing', 'training', 'materializing', 'complete']) assert.equal(accepted(await h.backend.inspect(h.f.job.id)).state, state);
  const receipt = accepted(await h.backend.materialize(h.f.job.id));
  assert.equal(accepted(await verifyArtifactReceipt(receipt, { spec: h.f.spec, job: h.f.job, runtime: h.f.runtime,
    maxBytes: budget.maxBytes, readBytes: h.backend.readBytes })).verifiedBytes, receipt.sizeBytes);
  assert.equal(h.backend.stats().verifiedArtifacts, 1); assert.equal(h.backend.stats().submissions, 1);
  assert.equal(h.backend.stats().requests, h.f.exchanges.length); assert.equal(h.consumed(), h.f.exchanges.length);
  assert.equal(JSON.stringify({ receipt, requests: h.requests, stats: h.backend.stats(), jobs: replies }).includes(credential), false);
  assert.equal(h.f.physicalRequests, 0);
});

it('recorded wire pairs use the exact closed native operation validators', async () => {
  const contract = compileContract(document);
  for (const name of ['happy', 'cancel', 'transport', 'malformed', 'inference-only', 'checksum', 'ancestry', 'unknown-cost', 'over-budget', 'credential-echo']) {
    const f = await fixture(name);
    for (const { request, response } of f.exchanges) {
      if (response.bytes) continue;
      const op = request.path.endsWith('/capabilities') ? 'capabilities' : request.path.endsWith('/cancel') ? 'cancel'
        : request.path.endsWith('/artifact') ? 'materialize' : request.method === 'POST' ? 'submit' : 'inspect';
      const compiled = contract.operations['training.' + op]!;
      const input = op === 'capabilities' ? {} : op === 'submit' ? request.body : { jobId: f.job.id };
      assert.equal(compiled.input!.validate(input).valid, true, name + ':' + op);
      if (response.status === 200) assert.equal(compiled.output!.validate(response.body).valid,
        !(name === 'malformed' && op === 'inspect'), name + ':' + op);
    }
  }
});

it('cancellation is visible and a transient failure cannot reset an observed job to queued', async () => {
  const c = await scripted('cancel'); accepted(await c.backend.submit(c.f.spec));
  assert.equal(accepted(await c.backend.inspect(c.f.job.id)).state, 'training');
  assert.equal(accepted(await c.backend.cancel(c.f.job.id)).state, 'cancelled');
  const h = await scripted('transport'); accepted(await h.backend.submit(h.f.spec));
  assert.equal(accepted(await h.backend.inspect(h.f.job.id)).state, 'unknown');
  assert.equal(h.backend.stats().failures.transport, 1); assert.equal(h.backend.stats().retryAfterUntil, 2000);
  h.advance(1999); assert.equal(accepted(await h.backend.inspect(h.f.job.id)).state, 'unknown'); assert.equal(h.consumed(), 3);
  h.advance(1); assert.equal(accepted(await h.backend.inspect(h.f.job.id)).state, 'unknown');
  assert.equal(accepted(await h.backend.inspect(h.f.job.id)).state, 'training');
  assert.equal(h.backend.stats().failures.backoff, 1); assert.equal(h.consumed(), 5);
  const dated = await scripted('transport');
  dated.f.exchanges[2]!.response.headers['retry-after'] = new Date(2000).toUTCString();
  accepted(await dated.backend.submit(dated.f.spec)); accepted(await dated.backend.inspect(dated.f.job.id));
  assert.equal(dated.backend.stats().retryAfterUntil, 2000);
  dated.advance(1999); accepted(await dated.backend.inspect(dated.f.job.id)); assert.equal(dated.consumed(), 3);
});

it('closed replies, ancestry, byte digests, spend and secret echoes refuse before materialization', async () => {
  for (const name of ['malformed', 'checksum', 'ancestry', 'unknown-cost', 'over-budget', 'credential-echo']) {
    const h = await scripted(name); accepted(await h.backend.submit(h.f.spec));
    const observed = await h.backend.inspect(h.f.job.id);
    const result = ['checksum', 'ancestry'].includes(name) ? await h.backend.materialize(h.f.job.id) : observed;
    issue(result); assert.equal(h.backend.stats().verifiedArtifacts, 0, name);
    assert.equal(h.consumed(), h.f.exchanges.length, name);
    assert.equal(JSON.stringify({ result, stats: h.backend.stats(), requests: h.requests }).includes(credential), false);
  }
  const h = await scripted('inference-only'); assert.equal((await h.backend.capabilities()).trainable, false);
  issue(await h.backend.submit(h.f.spec)); assert.equal(h.backend.stats().inferenceOnly, true);
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  const explicit = await scripted('inference-only');
  explicit.f.exchanges[0]!.response = { status: 200, headers: {}, body: { methods: [], baseModels: [], resumable: false, artifactKinds: [], trainable: false } };
  issue(await explicit.backend.submit(explicit.f.spec)); assert.equal(explicit.backend.stats().requests, 1);
});

it('restored jobs retain exact bindings and ambiguous submission never triggers another POST', async () => {
  const f = await fixture(); let calls = 0;
  const backend = accepted(createHttpTrainingBackend({ base: f.base, runtime: f.runtime, budget, clock: () => 0, credential: async () => null,
    fetch: async () => { calls++; throw Error(credential); } }));
  accepted(await backend.bindJob(f.spec, f.job)); assert.deepEqual(accepted(await backend.submit(f.spec)), f.job); assert.equal(calls, 0);
  issue(await backend.bindJob({ ...f.spec, seed: 2 }, f.job));
  issue(await backend.bindJob(f.spec, { ...f.job, id: 'different' }));
  assert.equal(accepted(await backend.inspect(f.job.id)).state, 'unknown'); assert.equal(calls, 1);
  let posts = 0;
  const failed = accepted(createHttpTrainingBackend({ base: f.base, runtime: f.runtime, budget, clock: () => 0, credential: async () => credential,
    fetch: async (_url, init) => {
      if (init?.method === 'POST') { posts++; throw Error(credential); }
      return Response.json(f.exchanges[0]!.response.body);
    } }));
  for (const result of await Promise.all(Array.from({ length: 10 }, () => failed.submit(f.spec)))) issue(result);
  issue(await failed.submit(f.spec)); assert.equal(posts, 1); assert.equal(failed.stats().failures.transport, 1);
});

it('URL policy, request and byte caps, clock regressions and capacity refuse without hidden dispatches', async () => {
  const f = await fixture(); let calls = 0;
  const common = { runtime: f.runtime, budget, clock: () => 0, credential: async () => credential,
    fetch: async () => { calls++; throw Error('must not dispatch'); } };
  for (const base of ['https://name:secret@training.example', 'https://training.example?key=x', 'file:///trainer', 'invalid'])
    issue(createHttpTrainingBackend({ ...common, base }), 'TEXP1001');
  assert.equal(calls, 0);
  const bounded = await scripted('happy', { maxRequests: 1 }); await bounded.backend.capabilities(); issue(await bounded.backend.submit(f.spec)); assert.equal(bounded.consumed(), 1);
  const clock = await scripted('happy'); accepted(await clock.backend.submit(f.spec)); clock.advance(-1); issue(await clock.backend.inspect(f.job.id)); assert.equal(clock.consumed(), 2);
  const wall = await scripted('happy'); accepted(await wall.backend.submit(f.spec)); wall.advance(60000); issue(await wall.backend.inspect(f.job.id)); assert.equal(wall.consumed(), 2);
  const tiny = await scripted('happy', { maxResponseBytes: 8 }); await assert.rejects(tiny.backend.capabilities(), /TEXP1008/); assert.equal(tiny.backend.stats().failures.shape, 1);
  const cap = accepted(createHttpTrainingBackend({ ...common, base: f.base, budget: { ...budget, maxJobs: 1 } }));
  accepted(await cap.bindJob(f.spec, f.job));
  const other = { ...f.spec, seed: 2 }, digest = accepted(await trainingSpecDigest(other));
  issue(await cap.bindJob(other, { id: 'second', specDigest: digest })); assert.deepEqual(accepted(await cap.submit(f.spec)), f.job); assert.equal(calls, 0);
  await assert.rejects(cap.readBytes({ ...f.receipt, storageUri: 'https://foreign.example/artifact' }, 4096)); assert.equal(calls, 0);
  let at = 0, delayedRequests = 0;
  const delayed = accepted(createHttpTrainingBackend({ ...common, base: f.base, clock: () => at,
    fetch: async () => { delayedRequests++; at = f.spec.budget.maxWallMs; return Response.json(f.exchanges[0]!.response.body); } }));
  issue(await delayed.submit(f.spec)); assert.equal(delayedRequests, 1, 'preparation time consumes the shorter specification deadline');
  const before = delayedRequests;
  issue(await delayed.submit({ ...f.spec, budget: { ...f.spec.budget, maxSpend: null } })); assert.equal(delayedRequests, before);
});

it('the native server and client agree on all five operation bindings without sockets', async () => {
  const f = await fixture(), capabilities = f.exchanges[0]!.response.body;
  const state = { jobId: f.job.id, state: 'complete', stopReason: null, logRefs: [], metricsRef: null, spend: 0.25 };
  const seen: string[] = [];
  const contract = compileContract(document);
  const handler = toFetchHandler(serveHttp(contract, {
    'training.capabilities': () => capabilities,
    'training.submit': (input) => { assert.deepEqual(input, f.spec); return f.job; },
    'training.inspect': input => { assert.deepEqual(input, { jobId: f.job.id }); return state; },
    'training.cancel': () => ({ ...state, state: 'cancelled' }),
    'training.materialize': () => f.receipt,
  }, { validateOutput: 'always', ledger: createMemoryLedger({ now: () => 0 }), now: () => 0, trace: () => 'training-conformance' }));
  const backend = accepted(createHttpTrainingBackend({ base: 'https://training.example', runtime: f.runtime, budget, clock: () => 0,
    credential: async () => null, fetch: async (url, init) => {
      seen.push(new URL(String(url)).pathname);
      if (String(url) === f.receipt.storageUri) return new Response(new Uint8Array(f.exchanges.at(-1)!.response.bytes!));
      return handler(new Request(url, init));
    } }));
  await backend.capabilities(); accepted(await backend.submit(f.spec)); accepted(await backend.inspect(f.job.id)); accepted(await backend.materialize(f.job.id));
  // A completed job cannot later change terminal state; the server's contrary response is refused.
  issue(await backend.cancel(f.job.id));
  assert.deepEqual(seen, ['/capabilities', '/jobs', '/jobs/fixture-job', '/jobs/fixture-job/artifact', '/v1/artifacts/fixture.bin', '/jobs/fixture-job/cancel']);
});

it('spend reservations are atomic across distinct submissions and invalid observations invalidate cached completion', async () => {
  const f = await fixture(); let posts = 0, inspections = 0, artifacts = 0;
  const host = accepted(createHttpTrainingBackend({ base: f.base, runtime: f.runtime, budget, clock: () => 0, credential: async () => null,
    fetch: async (url, init) => {
      if (String(url).endsWith('/capabilities')) return Response.json(f.exchanges[0]!.response.body);
      if (init?.method === 'POST') {
        posts++; const spec = JSON.parse(String(init.body));
        return Response.json({ id: 'job-' + spec.seed, specDigest: accepted(await trainingSpecDigest(spec)) });
      }
      if (String(url).endsWith('/artifact')) { artifacts++; return Response.json(f.receipt); }
      inspections++; const jobId = new URL(String(url)).pathname.split('/').at(-1)!;
      return Response.json({ jobId, state: 'complete', logRefs: [], metricsRef: null, stopReason: null, spend: jobId === 'job-2' ? .5 : inspections === 1 ? .25 : null });
    } }));
  const results = await Promise.all([1, 2, 3].map(seed => host.submit({ ...f.spec, seed, budget: { ...f.spec.budget, maxSpend: 4 } })));
  assert.equal(results.filter(r => r.ok).length, 2); assert.equal(posts, 2); issue(results[2]!);
  assert.equal(accepted(await host.inspect('job-1')).state, 'complete');
  issue(await host.materialize('job-1')); assert.equal(artifacts, 0, 'unobserved cost of the second job is not free');
  issue(await host.inspect('job-1')); issue(await host.materialize('job-1'));
  assert.equal(artifacts, 0); assert.equal(inspections, 3, 'cached completion did not bypass a new observation');
  accepted(await host.inspect('job-2')); assert.equal(host.stats().observedSpend, null);
  issue(await host.materialize('job-2')); assert.equal(artifacts, 0);
});

it('the HTTP backend composes with the durable DAG and invalid receipts or secret echoes never register an artifact', async () => {
  for (const mode of ['complete', 'checksum', 'ancestry', 'secret'] as const) {
    const clock = { value: Date.parse(SELECTION_TIME) };
    const store = createExperientialMemoryStore({ now: () => new Date(clock.value).toISOString() });
    try {
      const f = await trainingFixture(store, clock, { budget: { maxSpend: 10 } });
      let original: ArtifactReceipt | null = null, requests = 0;
      const http = accepted(createHttpTrainingBackend({ base: 'https://training.example', runtime: f.base.runtime, budget,
        clock: () => clock.value, credential: async () => credential, fetch: async (url, init) => {
          requests++; const path = new URL(String(url)).pathname;
          assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + credential);
          if (path === '/capabilities') return Response.json(await f.backend.capabilities());
          if (path === '/jobs') return Response.json(accepted(await f.backend.submit(JSON.parse(String(init?.body)))));
          if (path.endsWith('/artifact')) {
            original = accepted(await f.backend.materialize(decodeURIComponent(path.split('/')[2]!)));
            return Response.json({ ...original, storageUri: 'https://training.example/bytes',
              ...(mode === 'checksum' ? { sha256: 'f'.repeat(64) } : mode === 'ancestry' ? { baseChecksum: 'f'.repeat(64) } : {}) });
          }
          if (path === '/bytes') return new Response(new Uint8Array(await f.backend.readBytes(original!, budget.maxBytes)));
          const observed = accepted(await f.backend.inspect(decodeURIComponent(path.split('/')[2]!)));
          return Response.json(mode === 'secret' ? { ...observed, stopReason: credential } : observed);
        } }));
      const plan = accepted(await planExperientialTraining({ dataset: f.data.dataset, base: f.base, spec: f.plan.run.spec!,
        backendIdentity: http.identity, runtime: f.base.runtime, recordedAt: SELECTION_TIME }));
      accepted(await store.put('training_runs', plan.run));
      const values: Record<string, unknown> = {};
      const dag = compileDag(EXPERIENTIAL_TRAINING_DAG, { tasks: createExperientialTrainingTasks({ ...f.context, backend: http, readBytes: http.readBytes }),
        checkpoint: { load: () => ({ values: structuredClone(values) }), save: (_run, node, value) => { values[node] = structuredClone(value); }, complete: () => {} } });
      for (let attempt = 0; attempt < 16; attempt++) {
        try { await dag.run(plan.input, { runId: plan.run.id }); break; }
        catch (error) { if (!String(error).includes('pending')) throw error; if (attempt === 15) throw error; }
      }
      const run = accepted(await store.get('training_runs', plan.run.id))!;
      const artifacts = accepted(await store.list('artifacts', run.scope));
      assert.equal(run.state, mode === 'complete' ? 'complete' : 'failed', mode);
      assert.equal(artifacts.length, mode === 'complete' ? 2 : 1, mode); assert.equal(store.stats().activations, 0);
      assert.equal(run.submissions, 1); assert.ok(requests > 0); assert.equal(f.backend.stats().submissions, 1);
      const tables = ['experiences', 'assessments', 'datasets', 'training_runs', 'artifacts', 'evaluations', 'gate_policies', 'deployments', 'approvals', 'retention_decisions', 'pins', 'events', 'heads'] as const;
      const state = await Promise.all(tables.map(async table => accepted(await store.list(table, run.scope))));
      assert.equal(JSON.stringify({ state, values, stats: http.stats() }).includes(credential), false);
    } finally { await store.close(); }
  }
});
