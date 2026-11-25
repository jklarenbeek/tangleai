/**
 * A `JobQueue` over a port client of the `job_queue` contract: the page of a
 * browser twin and the supervisor of a worker thread both read the runtime
 * this way. The contract's declared answers become their codes; no answer in
 * time is `OS0195` (the runtime is starting or restarting, not missing); any
 * other failure is `OS0190`.
 */
import { compileContract } from '@jarenjs/contract';
import { openPortClient } from '@jarenjs/contract/port';
import { JOB_CODES, JOB_QUEUE_CONTRACT, type JobQueue } from '@tangleai/os/jobs';

let compiled: any = null;
/** The compiled `job_queue` contract, shared by every port client and server. */
export const compiledJobQueueContract = () => (compiled ??= compileContract(JOB_QUEUE_CONTRACT as any));

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
const DECLARED: Record<string, string> = { unknown: JOB_CODES.unknown, refused: JOB_CODES.refused, held: JOB_CODES.held, scope: JOB_CODES.scope, starting: JOB_CODES.starting };

/** The queue a port client reaches; `client` is `openPortClient(compiledJobQueueContract(), { channel, timeoutMs })`. */
export function portJobQueue(client: { invoke(op: string, input: unknown): Promise<any> }, options: { what?: string } = {}): JobQueue {
  const what = options.what ?? 'the background runtime';
  const invoke = async (op: string, input: unknown) => {
    let outcome: any;
    try { outcome = await client.invoke(op, input ?? {}); }
    catch (error: any) { throw coded(JOB_CODES.starting, `${what} is starting: ${String(error?.message ?? error).slice(0, 200)}`); }
    if (outcome.ok) return outcome.value;
    const code = outcome.error?.code;
    const detail = String(outcome.error?.details?.detail ?? outcome.error?.message ?? outcome.kind);
    if (outcome.kind === 'failure' && DECLARED[code]) throw coded(DECLARED[code], detail);
    if (code === 'JC2072') throw coded(JOB_CODES.starting, `${what} is starting`);
    throw coded(JOB_CODES.unconfigured, `${what} did not answer: ${detail}`);
  };
  return {
    counts: (i) => invoke('jobs.counts', i), page: (i) => invoke('jobs.page', i), get: (i) => invoke('jobs.get', i),
    schedules: (i) => invoke('jobs.schedules', i), cancel: (i) => invoke('jobs.cancel', i), requeue: (i) => invoke('jobs.requeue', i),
    unschedule: (i) => invoke('jobs.unschedule', i), events: (i) => invoke('jobs.events', i), health: (i) => invoke('jobs.health', i),
    registry: (i) => invoke('jobs.registry', i), run: (i) => invoke('jobs.run', i),
  };
}

/** A port client of the `job_queue` contract over `channel`. */
export const jobQueuePortClient = (channel: any, timeoutMs: number): { invoke(op: string, input: unknown): Promise<any>, close?(): void } =>
  openPortClient(compiledJobQueueContract(), { channel, timeoutMs }) as any;
