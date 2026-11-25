/**
 * merge: TEMPORARY — stands in for `@tangleai/ops/browser` (built in parallel) with the exact signatures of the
 * order's binding API, so the Pages half typechecks before the merge. Every import of it is marked
 * `// merge: @tangleai/ops/browser`; at the merge each import moves to the package and this file is deleted.
 */
import type { JobQueue } from '@tangleai/os/jobs';
import type { JobRegistry } from '@tangleai/ops';

const notMerged = (): never => { throw new Error('not merged: @tangleai/ops/browser'); };

export function startBrowserOps(_options: { scope: any, initialize: () => Promise<any>, registry: JobRegistry,
  channelName: string, lockName: string, databaseName: string, pool: string, taskContract?: object,
  now?: () => number }): { stop(): Promise<void> } { return notMerged(); }

export function browserJobQueue(_options: { channelName: string, timeoutMs?: number }): JobQueue { return notMerged(); }

export function startTwin(_options: { workerUrl: URL, channelName: string, lockName: string,
  tasks?: Record<string, (input: any) => Promise<unknown>>, onState?: (state: any) => void }): { stop(): void } { return notMerged(); }

export function forgetBrowserOps(_options: { databaseName: string, pool: string }): Promise<void> { return notMerged(); }
