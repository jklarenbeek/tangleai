/**
 * The single-send guard under kills: the operations runtime (`@tangleai/ops`)
 * runs in a child process with two scheduled kinds, a `single-send` push and a
 * `safe-read` pull, each firing every second; the parent kills the child 40
 * times (20 while a push is in its operation), runs it once cleanly, then
 * requeues every dead push (the person's Run again) and runs once more.
 *
 * The measurement: how often each push's operation was called (the guard says
 * at most once until the person requeues, then exactly once more), how many
 * pulls repeated (allowed), and whether every lost push left `not-repeated`
 * in the history.
 *
 *   node benchmark/ops-guard.ts [--kills 40] [--out benchmark/results/ops-guard.json]
 */
import { fork } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { jobSchedules } from '@jarenjs/db/schedules';
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { createOpsRuntime, opsEvents, OPS_EVENTS_COLLECTIONS, type JobRegistry } from '../packages/ops/src/index.ts';

const MODEL = { $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } };
const midnight = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); };
const REGISTRY = (): JobRegistry => ({
  $registry: '0.1', name: 'guard', jobs: [
    { kind: 'push.send', title: { en: 'Send' }, handler: { code: 'send' }, safety: 'single-send', limits: { leaseMs: 1000 }, schedule: { utc: midnight(), rrule: 'FREQ=SECONDLY' } },
    { kind: 'read.pull', title: { en: 'Read' }, handler: { code: 'pull' }, safety: 'safe-read', limits: { leaseMs: 1000 }, schedule: { utc: midnight(), rrule: 'FREQ=SECONDLY' } },
  ],
});
const open = (path: string) => openStore(MODEL as any, { driver: nodeDriver(), path, runtime: createRuntime({ zoneProvider: createIntlZoneProvider({ revision: 'host ICU' }) }), jobs: { schedules: jobSchedules() } } as any) as Promise<any>;

if (process.argv[2] === '--child') {
  const [, , , path, side] = process.argv;
  const store = await open(path);
  const step = (name: string) => async (_p: unknown, { job }: any) => {
    appendFileSync(side, `start ${name} ${job.id}\n`);
    await new Promise(r => setTimeout(r, 150));
    appendFileSync(side, `end ${name} ${job.id}\n`);
  };
  const runtime = createOpsRuntime({ store, registry: REGISTRY(), handlers: { send: step('send'), pull: step('pull') }, id: 'guard@child', worker: { pollInterval: 50, leaseMs: 1000, concurrency: 2 } });
  await runtime.start();
  process.send?.('ready');
  process.on('SIGTERM', () => { void runtime.stop({ graceMs: 1000 }).then(() => store.close()).then(() => process.exit(0)); });
} else {
  const { values: args } = parseArgs({ options: { kills: { type: 'string', default: '40' }, out: { type: 'string', default: 'benchmark/results/ops-guard.json' } } });
  const dir = mkdtempSync(join(tmpdir(), 'tangle-ops-guard-'));
  const path = join(dir, 'guard.db'), side = join(dir, 'side.log');
  writeFileSync(side, '');
  const self = fileURLToPath(import.meta.url);
  const lines = () => readFileSync(side, 'utf8').split('\n').filter(Boolean);
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const child = () => { const c = fork(self, ['--child', path, side], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }); return new Promise<any>(r => c.once('message', () => r(c))); };
  const kills = Number(args.kills);
  let midCall = 0;
  for (let n = 0; n < kills; n++) {
    const c = await child();
    if (n % 2 === 0) {
      const from = lines().length, t0 = Date.now();
      while (Date.now() - t0 < 4000) {
        const ls = lines().slice(from);
        const open = ls.filter(l => l.startsWith('start send ')).map(l => l.split(' ')[2]).filter(id => !ls.includes(`end send ${id}`));
        if (open.length) { midCall++; break; }
        await sleep(5);
      }
    } else await sleep(300 + Math.floor(Math.random() * 1700));
    c.kill('SIGKILL'); await new Promise(r => c.once('exit', r));
  }
  const clean = async (ms: number) => { const c = await child(); await sleep(ms); c.kill('SIGTERM'); await new Promise(r => c.once('exit', r)); };
  await clean(4000);
  const calls = () => { const m = new Map<string, number>(); for (const l of lines()) { const [w, name, id] = l.split(' '); if (w === 'start') m.set(`${name} ${id}`, (m.get(`${name} ${id}`) ?? 0) + 1); } return m; };
  let store = await open(path);
  const pushes: any[] = []; for await (const j of store.jobs.page({ kind: 'push.send', limit: 100000 })) pushes.push(j);
  const before = calls();
  const sendCalls = pushes.map(j => before.get(`send ${j.id}`) ?? 0);
  const dead = pushes.filter(j => j.state === 'dead').map(j => j.id);
  const deadWithNote = [];
  for (const id of dead) if ((await opsEvents(store).ofJob(id)).some(e => e.event === 'not-repeated')) deadWithNote.push(id);
  const pullRepeats = [...before.entries()].filter(([k, n]) => k.startsWith('pull ') && n > 1).length;
  for (const id of dead) await store.jobs.requeue(id);
  await store.close();
  await clean(5000);
  store = await open(path);
  const after = calls();
  const settled: Record<string, number> = {};
  for (const id of dead) { const s = (await store.jobs.get(id))?.state ?? 'missing'; settled[s] = (settled[s] ?? 0) + 1; }
  await store.close();
  rmSync(dir, { recursive: true, force: true });
  const report = {
    $comment: 'The operations runtime under kills: a single-send operation is called at most once per job until the person requeues it, then exactly once more; a safe-read may repeat.',
    generated: { at: new Date().toISOString(), node: process.version, kills, midCall },
    summary: {
      pushJobs: pushes.length,
      pushCalls: sendCalls.reduce((a, b) => a + b, 0),
      pushesCalledTwiceBeforeRequeue: sendCalls.filter(n => n > 1).length,
      deadPushes: dead.length,
      deadPushesWithNotRepeated: deadWithNote.length,
      requeued: dead.length,
      requeuedCalledExactlyOnceMore: dead.filter(id => (after.get(`send ${id}`) ?? 0) === (before.get(`send ${id}`) ?? 0) + 1).length,
      requeuedCalledMoreThanOnceMore: dead.filter(id => (after.get(`send ${id}`) ?? 0) > (before.get(`send ${id}`) ?? 0) + 1).length,
      requeuedStates: settled,
      pullsRepeated: pullRepeats,
    },
  };
  writeFileSync(new URL(`../${args.out}`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 1));
}
