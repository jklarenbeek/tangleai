/**
 * The supervisor keeps a runtime alive in a worker thread: ten deaths (five
 * terminations mid-handler, five uncaught throws) each end in a restarted
 * worker that opens the same store with no claim error; the single-send
 * operation is never called twice and every lost attempt is reconciled; a
 * runtime whose heartbeat stops is restarted after two old readings; a clock
 * jump alone restarts nothing; stop drains the history.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { jobSchedules } from '@jarenjs/db/schedules';
import { superviseOps, type SupervisorState } from '@tangleai/ops/supervisor';
import { opsEvents, OPS_EVENTS_COLLECTIONS } from '@tangleai/ops';

const entry = new URL('./fixtures/supervisor-worker.ts', import.meta.url);
let dir = '';
before(() => { dir = mkdtempSync(join(tmpdir(), 'tangle-ops-sup-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => { const t = Date.now(); while (!(await cond())) { if (Date.now() - t > ms) throw new Error('timed out'); await sleep(10); } };

describe('the supervisor', () => {
  it('restarts the runtime after ten deaths without a claim error, a doubled single-send call or an unreconciled loss, and stop drains', async () => {
    const storePath = join(dir, 'ops.db'), side = join(dir, 'side.log');
    writeFileSync(side, '');
    const states: SupervisorState[] = [];
    const sup = superviseOps({ workerUrl: entry, workerData: { storePath, side, heartbeatMs: 200 }, restart: { minMs: 100, maxMs: 1000 }, staleAfterMs: 60_000, onState: (s) => states.push({ ...s }) });
    const lines = () => readFileSync(side, 'utf8').split('\n').filter(Boolean);
    const running = () => until(() => sup.state().state === 'running');
    const backToRunning: number[] = [], claimErrors: number[] = [];
    try {
    await running();
    for (let death = 0; death < 10; death++) {
      const restarts = sup.state().restarts;
      if (death < 5) {
        // a termination while a push is in its operation
        const from = lines().length;
        await until(() => { const ls = lines().slice(from); return ls.some(l => l.startsWith('start ') && !ls.includes(`end ${l.slice(6)}`)); });
        await sup.restart();
      } else {
        // an uncaught throw in a handler takes the thread down (a crash job still waiting or running refuses a new one)
        await until(async () => { try { await sup.queue().run({ kind: 'crash' }); return true; } catch (e: any) { if (e.code !== 'OS0192' && e.code !== 'OS0195') throw e; return false; } });
      }
      const t = Date.now();
      await until(() => sup.state().restarts > restarts);
      await running();
      backToRunning.push(Date.now() - t);
      claimErrors.push((await sup.queue().health()).runtimes[0]?.stats?.claimErrors ?? -1);
    }
    await sleep(2500);   // the last leases run out; the heartbeat reconciles them
    } finally { await sup.stop(); }
    assert.equal(sup.state().state, 'stopped');
    assert.equal(sup.state().restarts, 10);
    assert.deepEqual(claimErrors, Array(10).fill(0), 'every restarted worker opened the store and claimed without an error');
    assert.ok(Math.max(...backToRunning) < 5_000, `restarted within the backoff (${backToRunning.join(', ')} ms)`);
    const reasons = states.filter(s => s.state === 'restarting').map(s => s.last?.reason);
    assert.equal(reasons.filter(r => r === 'restart').length, 5);
    assert.equal(reasons.filter(r => r === 'error' || r === 'exit').length, 5);
    // the store, read after the stop: calls per job, and the losses reconciled
    const calls = new Map<string, number>();
    for (const l of lines()) if (l.startsWith('start ')) calls.set(l.slice(6), (calls.get(l.slice(6)) ?? 0) + 1);
    assert.equal([...calls.values()].filter(n => n > 1).length, 0, 'no single-send push was called twice');
    const store: any = await openStore({ $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } } as any, { driver: nodeDriver(), path: storePath, jobs: { schedules: jobSchedules() } } as any);
    const dead: string[] = [];
    for (const kind of ['push.send', 'crash']) for await (const j of store.jobs.page({ kind, state: 'dead', limit: 10_000 })) dead.push(j.id);
    assert.ok(dead.length >= 10, `${dead.length} lost single-send jobs`);
    for (const id of dead) assert.ok((await opsEvents(store).ofJob(id)).some(e => e.event === 'not-repeated'), `${id} is reconciled`);
    console.log(JSON.stringify({ deaths: 10, pushCalls: [...calls.values()].reduce((a, b) => a + b, 0), pushJobs: calls.size, doubled: 0, deadReconciled: dead.length, backToRunningMs: backToRunning }));
    await store.close();
  });

  it('restarts a runtime whose heartbeat stopped after two old readings, and a clock jump alone restarts nothing', async () => {
    const stale = superviseOps({ workerUrl: entry, workerData: { storePath: join(dir, 'stale.db'), side: join(dir, 'stale.log'), heartbeatMs: 3_600_000 }, restart: { minMs: 50, maxMs: 200 }, staleAfterMs: 600 });
    writeFileSync(join(dir, 'stale.log'), '');
    try {
      await until(() => stale.state().state === 'running');
      const since = Date.now();
      await until(() => stale.state().restarts >= 1);
      assert.equal(stale.state().last?.reason, 'stale');
      assert.ok(Date.now() - since >= 600, 'not before the heartbeat was old');
    } finally { await stale.stop(); }

    writeFileSync(join(dir, 'jump.log'), '');
    const jumpy = superviseOps({ workerUrl: entry, workerData: { storePath: join(dir, 'jump.db'), side: join(dir, 'jump.log'), heartbeatMs: 100, jumpAfterMs: 500 }, restart: { minMs: 50, maxMs: 200 }, staleAfterMs: 600 });
    try {
      await until(() => jumpy.state().state === 'running');
      await sleep(3_000);
      assert.equal(jumpy.state().restarts, 0, 'a clock jump is one old reading at most');
    } finally { await jumpy.stop(); }
  });
});
