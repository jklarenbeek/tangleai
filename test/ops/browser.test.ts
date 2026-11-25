/**
 * The browser runtime's pure parts: a held OPFS handle is a handover in
 * progress (retried), never "unavailable"; forgetting deletes the pool's
 * directory and the IndexedDB snapshot; a queue whose runtime does not answer
 * yet is starting (OS0195), not missing; the page's task contract carries the
 * job. The worker, the lock and the handover are measured in a browser
 * (`.e2e/migration/ops-twin.spec.mjs`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileContract } from '@jarenjs/contract';
import { accessHandleHeld, forgetBrowserOps, browserJobQueue, desktopTaskContract } from '@tangleai/ops/browser';
import { JOB_CODES } from '@tangleai/os/jobs';

const named = (name: string, cause?: unknown) => Object.assign(new Error(name), { name, ...(cause ? { cause } : {}) });

describe('the browser runtime', () => {
  it('reads a held OPFS handle anywhere in the cause chain as a handover, and nothing else', () => {
    assert.equal(accessHandleHeld(named('NoModificationAllowedError')), true);
    assert.equal(accessHandleHeld(new Error('install failed', { cause: new Error('open', { cause: named('NoModificationAllowedError') }) })), true);
    assert.equal(accessHandleHeld(new Error('Missing required OPFS APIs.')), false);
    assert.equal(accessHandleHeld(named('NotAllowedError')), false);
    const loop: any = new Error('loop'); loop.cause = loop;
    assert.equal(accessHandleHeld(loop), false);
    assert.equal(accessHandleHeld('NoModificationAllowedError'), false);
  });

  it('forgets the pool directory and the IndexedDB snapshot, and counts a missing directory as forgotten', async () => {
    const removed: [string, unknown][] = [], deleted: string[] = [];
    const idb = (outcome: 'success' | 'blocked') => ({ deleteDatabase(name: string) { deleted.push(name); const request: any = {}; queueMicrotask(() => request[`on${outcome}`]?.()); return request; } });
    const storage = { getDirectory: async () => ({ removeEntry: async (name: string, options: unknown) => { removed.push([name, options]); } }) };
    assert.deepEqual(await forgetBrowserOps({ databaseName: 'ops.db', pool: 'ops', storage, indexedDB: idb('success') }), { opfs: true, indexedDB: true });
    assert.deepEqual(removed, [['.ops', { recursive: true }]]);
    assert.deepEqual(deleted, ['ops.db-snapshot']);
    const missing = { getDirectory: async () => ({ removeEntry: async () => { throw named('NotFoundError'); } }) };
    assert.deepEqual(await forgetBrowserOps({ databaseName: 'ops.db', pool: 'ops', storage: missing, indexedDB: idb('blocked') }), { opfs: true, indexedDB: false });
  });

  it('answers OS0195 while no runtime answers on the channel: starting, not missing', async () => {
    const silent = { postMessage() {}, addEventListener() {}, removeEventListener() {} };
    const queue = browserJobQueue({ channelName: 'unused', channel: silent, timeoutMs: 30 });
    await assert.rejects(queue.counts(), { code: JOB_CODES.starting });
    assert.equal(JOB_CODES.starting, 'OS0195');
  });

  it('gives each page task a command that takes the job, its key and its input', () => {
    const contract: any = desktopTaskContract({ 'ping.send': { doc: 'Send one ping.' } });
    assert.doesNotThrow(() => compileContract(contract));
    const op = contract.operations['ping.send'];
    assert.equal(op.kind, 'command');
    assert.deepEqual(op.input.required, ['job', 'input']);
    assert.deepEqual(Object.keys(op.input.properties.job.properties), ['id', 'attempt', 'kind']);
  });
});
