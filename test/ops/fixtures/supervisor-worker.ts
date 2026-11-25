/** The supervisor test's worker entry: a single-send push every second, a kind that crashes the thread, a movable clock. */
import { parentPort, workerData } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { runOpsWorker } from '@tangleai/ops/supervisor';

const { storePath, side, heartbeatMs, jumpAfterMs } = workerData as any;
let offset = 0;
if (jumpAfterMs) setTimeout(() => { offset += 3_600_000; }, jumpAfterMs);
const midnight = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); })();
await runOpsWorker({
  storePath, heartbeatMs, id: 'sup@test',
  registry: { $registry: '0.1', name: 'sup', jobs: [
    { kind: 'push.send', title: { en: 'Send' }, handler: { code: 'send' }, safety: 'single-send', limits: { leaseMs: 1000 }, schedule: { utc: midnight, rrule: 'FREQ=SECONDLY' } },
    { kind: 'crash', title: { en: 'Crash' }, handler: { code: 'crash' }, safety: 'single-send', limits: { leaseMs: 1000 } },
    { kind: 'hold', title: { en: 'Hold' }, handler: { code: 'hold' }, safety: 'safe-read' },
  ] },
  handlers: {
    send: async (_p, { job }) => { appendFileSync(side, `start ${job.id}\n`); await new Promise(r => setTimeout(r, 300)); appendFileSync(side, `end ${job.id}\n`); },
    hold: async (_p, { signal }) => { await new Promise<void>(r => { if (signal?.aborted) r(); signal?.addEventListener('abort', () => r()); }); },
    crash: async () => { setTimeout(() => { throw new Error('an uncaught failure in a handler'); }, 10); await new Promise(r => setTimeout(r, 2000)); },
  },
  now: () => Date.now() + offset,
  worker: { pollInterval: 50, leaseMs: 1000, concurrency: 2 },
});
parentPort?.postMessage({ ops: 'fixture-ready' });
