/** The harness's page: this tab's worker, the queue every tab reads, and the single-send task that counts its calls. */
import { startTwin, browserJobQueue, type TaskCall } from '../../../packages/ops/src/browser.ts';
import { CHANNEL, LOCK, TASKS } from './shared.ts';

const w = window as any;
w.states = [];
w.twin = startTwin({
  workerUrl: new URL('./worker.js', location.href), channelName: CHANNEL, lockName: LOCK, taskContract: TASKS,
  tasks: {
    // counted synchronously at entry, in storage every tab shares: a closed tab cannot lose a count
    'ping.send': async ({ job }: TaskCall) => {
      const key = `calls:${job.id}`;
      localStorage.setItem(key, String(Number(localStorage.getItem(key) ?? 0) + 1));
      await new Promise(r => setTimeout(r, 150));
      return {};
    },
  },
  onState: (state) => w.states.push({ ...state, at: Date.now() }),
});
w.queue = browserJobQueue({ channelName: CHANNEL, timeoutMs: 3000 });
w.lastState = () => w.states.at(-1);
/** Every job of a kind in the store, paged. */
w.allJobs = async (kind: string) => {
  const out: any[] = [];
  for (let after: string | undefined; ;) {
    const page = await w.queue.page({ kind, limit: 200, ...(after ? { after } : {}) });
    out.push(...page.items);
    if (!page.next) return out;
    after = page.next;
  }
};
/** The measurement: fires per kind, single-send calls per job, and whether the store and the queue agree. */
w.tally = async () => {
  const pings = await w.allJobs('ping.send'), reads = await w.allJobs('tick.read');
  const calls = new Map<string, number>();
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('calls:')) calls.set(k.slice(6), Number(localStorage.getItem(k))); }
  const sample = pings.filter((j: any) => j.state === 'done').slice(0, 10);
  let withHistory = 0;
  for (const job of sample) if ((await w.queue.events({ jobId: job.id })).events.some((e: any) => e.event === 'started')) withHistory++;
  return {
    pings: pings.length, reads: reads.length,
    pingIdsDistinct: new Set(pings.map((j: any) => j.id)).size,
    pingCalls: [...calls.values()].reduce((a, b) => a + b, 0),
    pingsCalledTwice: [...calls.values()].filter(n => n > 1).length,
    pingStates: pings.reduce((m: any, j: any) => (m[j.state] = (m[j.state] ?? 0) + 1, m), {}),
    sampledWithHistory: `${withHistory}/${sample.length}`,
    health: await w.queue.health(),
  };
};
