import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sleep } from '@jarenjs/core/retry';
import { openTangleDb, createEvolveEffectStore } from '@tangleai/store';
import { buildExecutionManifest, researchExecutionRequest, researchExecutionResponse, researchRefuse } from '@tangleai/research';
import { createResearchRunner, type ResearchRunnerBackend } from '../../apps/research-runner/src/host.ts';
import { createFencedResearchBackend } from '../../apps/research-runner/src/effects.ts';
import { RESEARCH_RUNNER_IMAGE } from '../../apps/research-runner/src/image.ts';
import { executionFixture } from '../research/execution-fixtures.ts';
import { checked } from '../research/fixtures.ts';

test('network, digest and repository mount refusals occur before any engine operation', async () => {
  const f = await executionFixture(), manifest = checked(await buildExecutionManifest({ ...f.input, imageDigest: RESEARCH_RUNNER_IMAGE.digest }));
  const wire = checked(await researchExecutionRequest(manifest, f.workspace, f.context)); let calls = 0;
  const backend: ResearchRunnerBackend = { capability: async () => { calls++; throw Error('Must not probe'); }, run: async () => { calls++; throw Error('Must not run'); } };
  const host = createResearchRunner({ hostname: '127.0.0.1', imageDigests: [RESEARCH_RUNNER_IMAGE.digest], backend, now: Date.now, sleep, timeoutSignal: AbortSignal.timeout });
  try {
    for (const [name, input, expected] of [
      ['network-during-measured', { ...wire, manifest: { ...manifest, network: { setup: 'off', measured: 'on' } } }, 'TRSH1010'],
      ['mismatched-digest', checked(await researchExecutionRequest(f.manifest, f.workspace, f.context)), 'TRSH1007'],
      ['repository-mount', { ...wire, mounts: [{ source: process.cwd(), destination: '/repo' }] }, 'TRSH1010'],
    ] as const) {
      const response = await host.fetch(new Request('http://localhost/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
      assert.equal(response.status, 200, name);
      const value = await response.json(); assert.equal(value.outcome.valid, false, name); assert.equal(value.outcome.issues[0].code, expected, name);
    }
    assert.equal(calls, 0);
  } finally { await host.close(); }
});
test('capability reports engine absence and non-loopback admission requires the configured token', async () => {
  const unavailable = { available: false, kind: 'container' as const, engine: null, version: null, imageDigests: [], reason: 'Neither Docker nor Podman answered.' };
  const backend: ResearchRunnerBackend = { capability: async () => unavailable, run: async () => { throw Error('Unused'); } };
  const options = { hostname: '0.0.0.0', backend, imageDigests: [RESEARCH_RUNNER_IMAGE.digest], now: Date.now, sleep, timeoutSignal: AbortSignal.timeout };
  assert.throws(() => createResearchRunner(options), /token/);
  const host = createResearchRunner({ ...options, token: 'fixture-token' });
  try {
    assert.equal((await host.fetch(new Request('http://localhost/capability'))).status, 401);
    const response = await host.fetch(new Request('http://localhost/capability', { headers: { authorization: 'Bearer fixture-token' } }));
    assert.deepEqual(await response.json(), unavailable);
  } finally { await host.close(); }
});
test('the existing fenced effect store persists intent before dispatch and replays settled domain refusals', async () => {
  const f = await executionFixture(), db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } }); let calls = 0;
  try {
    const engine: ResearchRunnerBackend = { capability: async () => { throw Error('Unused'); }, run: async request => {
      calls++;
      const held = await createEvolveEffectStore(db).get('research/' + f.manifest.executionManifestHash);
      assert.equal(held.legs[0].state, 'sending');
      return researchExecutionResponse(request.manifest.executionManifestHash, researchRefuse('TRSH1010', '/fixture', 'Known pre-execution refusal.'));
    } };
    const backend = createFencedResearchBackend({ db, engine, owner: 'test' });
    const first = await backend.run(f, f.context.signal), second = await backend.run(f, f.context.signal);
    assert.equal(first.settlement, 'not-started'); assert.deepEqual(second, first); assert.equal(calls, 1);
  } finally { await db.close(); }
});
test('a lost engine result stays unresolved and never automatically repeats the effect', async () => {
  const f = await executionFixture(), db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } }); let calls = 0;
  try {
    const engine: ResearchRunnerBackend = { capability: async () => { throw Error('Unused'); }, run: async () => { calls++; throw Error('lost result'); } };
    const backend = createFencedResearchBackend({ db, engine, owner: 'test' });
    assert.equal((await backend.run(f, f.context.signal)).settlement, 'unresolved');
    assert.equal((await backend.run(f, f.context.signal)).settlement, 'unresolved');
    assert.equal(calls, 1);
    assert.equal((await createEvolveEffectStore(db).get('research/' + f.manifest.executionManifestHash)).legs[0].state, 'unresolved');
  } finally { await db.close(); }
});
test('a stalled body is cancelled by the injected body deadline before engine admission', async () => {
  const controller = new AbortController(); let calls = 0, cancelled = false;
  const backend: ResearchRunnerBackend = { capability: async () => { throw Error('Unused'); }, run: async () => { calls++; throw Error('Must not run'); } };
  const host = createResearchRunner({ hostname: 'localhost', imageDigests: [RESEARCH_RUNNER_IMAGE.digest], backend,
    now: Date.now, sleep, timeoutSignal: ms => { assert.equal(ms, 10000); return controller.signal; } });
  try {
    const body = new ReadableStream({ pull() { controller.abort(Error('Fixture body deadline')); }, cancel() { cancelled = true; } });
    const result = await host.fetch(new Request('http://localhost/run', { method: 'POST', headers: { 'content-type': 'application/json' },
      body, duplex: 'half' } as RequestInit));
    assert.equal(result.status, 400); assert.equal(calls, 0); assert.equal(cancelled, true);
  } finally { await host.close(); }
});
test('independent host workers fence concurrent dispatch and replay after SQLite reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'research-host-fence-')), f = await executionFixture();
  const options = { path: join(directory, 'state.sqlite'), jobs: { now: Date.now, random: () => 0.5 } };
  const firstDb = await openTangleDb(options), secondDb = await openTangleDb(options);
  let release!: () => void, entered!: () => void, calls = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }), dispatched = new Promise<void>(resolve => { entered = resolve; });
  const engine: ResearchRunnerBackend = { capability: async () => { throw Error('Unused'); }, run: async request => {
    calls++; entered(); await hold;
    return researchExecutionResponse(request.manifest.executionManifestHash, researchRefuse('TRSH1010', '/fixture', 'Known pre-execution refusal.'));
  } };
  try {
    const first = createFencedResearchBackend({ db: firstDb, owner: 'first-worker', engine }).run(f, f.context.signal);
    await dispatched;
    const concurrent = await createFencedResearchBackend({ db: secondDb, owner: 'second-worker', engine }).run(f, f.context.signal);
    assert.equal(concurrent.settlement, 'unresolved'); assert.equal(calls, 1);
    release(); const settled = await first; assert.equal(settled.settlement, 'not-started');
    await firstDb.close(); await secondDb.close();
    const reopened = await openTangleDb(options);
    try {
      assert.deepEqual(await createFencedResearchBackend({ db: reopened, owner: 'reopened-worker', engine }).run(f, f.context.signal), settled);
      assert.equal(calls, 1);
    } finally { await reopened.close(); }
  } finally { release(); await firstDb.close(); await secondDb.close(); await rm(directory, { recursive: true, force: true }); }
});
