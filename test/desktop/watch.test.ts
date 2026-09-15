/**
 * The host folder watcher, driven event by event.
 *
 * Both seams are scripted — the filesystem watch and the debounce timer
 * — so a burst, a window that closes mid-pass, an overflow and a
 * platform that refuses a recursive watch are all deterministic here:
 * no disk, no wall clock, no sleep that a slow machine can lose.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createScheduler } from '@jarenjs/core/schedule';

import { createFolderWatcher, type WatchScanOutcome, type WatchTrigger } from '../../apps/desktop/src/watch.ts';
import { FOLDER_ADMISSION } from '../../apps/desktop/src/server.ts';

let tick = 0;
const now = (): string => new Date(Date.UTC(2026, 8, 14) + (tick++) * 1000).toISOString();

/** The debounce timer, under the test's hand. */
function scriptedSleep() {
  const pending: Array<{ resolve: () => void, reject: (error: Error) => void }> = [];
  const sleep = (_ms: number, signal?: AbortSignal): Promise<void> => new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) { reject(new Error('aborted')); return; }
    const entry = {
      resolve,
      reject,
      onAbort: (): void => {
        const index = pending.findIndex((item) => item.resolve === resolve);
        if (index >= 0) pending.splice(index, 1);
        reject(new Error('aborted'));
      },
    };
    signal?.addEventListener('abort', entry.onAbort, { once: true });
    pending.push(entry);
  });
  return {
    sleep,
    armed: (): number => pending.length,
    /** Close the window that is currently armed. */
    fire(): void {
      const entry = pending.shift();
      assert.ok(entry !== undefined, 'no debounce window was armed');
      entry.resolve();
    },
  };
}

/** A filesystem the test types events into. */
function scriptedWatch(options: { fail?: string } = {}) {
  let listener: ((event: string, filename: string | null) => void) | null = null;
  let closes = 0;
  const watch = (_path: string, _watchOptions: { recursive: boolean }, next: (event: string, filename: string | null) => void) => {
    if (options.fail !== undefined) throw new Error(options.fail);
    listener = next;
    return { close: (): void => { closes += 1; listener = null; } };
  };
  return {
    watch,
    closes: (): number => closes,
    emit(count = 1): void {
      for (let i = 0; i < count; i++) listener?.('change', `file-${i}.md`);
    },
  };
}

const settle = async (done: () => boolean, deadlineMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!done() && Date.now() - start < deadlineMs) await new Promise((resolve) => setTimeout(resolve, 1));
};

const ran = (runId: string | null = 'r-1'): WatchScanOutcome => ({ runId, refused: null });

describe('the folder watcher', () => {
  it('coalesces a burst into exactly one pass', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async (trigger) => { scans.push(trigger); return ran(`r-${scans.length}`); },
    });

    const started = await watcher.start('/corpus');
    assert.equal(started.mode, 'recursive', 'the platform accepted a recursive watch');
    assert.deepEqual(scans, ['start'], 'a start scan is the restart safety, before any event');

    fs.emit(12);
    assert.equal(timer.armed(), 1, 'twelve events keep pushing ONE window out, never twelve');
    assert.equal(watcher.state().events, 12);

    timer.fire();
    await settle(() => watcher.state().scans.change === 1);
    assert.deepEqual(scans, ['start', 'change'], 'one window, one pass');

    const state = watcher.state();
    assert.equal(state.windows, 1);
    assert.deepEqual(state.scans, { start: 1, change: 1, overflow: 0, tick: 0 });
    assert.equal(state.lastRunId, 'r-2', 'the pass names the run a reader can open');
    assert.equal(state.overflows, 0);
    assert.deepEqual(state.issues, []);
    await watcher.close();
  });

  it('schedules exactly one more pass for events that arrive during one', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    const scans: WatchTrigger[] = [];
    let release = (): void => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async (trigger) => {
        scans.push(trigger);
        if (scans.length === 2) await held;
        return ran();
      },
    });

    await watcher.start('/corpus');
    fs.emit(1);
    timer.fire();
    await settle(() => scans.length === 2);

    // the pass is in flight; five more events arrive and close their window
    fs.emit(5);
    await settle(() => timer.armed() === 1);
    timer.fire();
    await settle(() => watcher.state().windows === 2);
    assert.deepEqual(scans, ['start', 'change'], 'nothing starts beside a running pass');

    release();
    await settle(() => watcher.state().scans.change === 2);
    assert.deepEqual(scans, ['start', 'change', 'change'], 'exactly one more pass, after the one in flight');
    assert.equal(timer.armed(), 0, 'nothing is left armed behind the pair');
    assert.equal(watcher.state().scans.change, 2, 'a burst behind a pass is one pass, never a queue of them');
    await watcher.close();
  });

  it('answers a window that overflowed with one full scan, counted', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async (trigger) => { scans.push(trigger); return ran(); },
    });

    await watcher.start('/corpus');
    fs.emit(1001);
    await settle(() => watcher.state().scans.overflow === 1);

    const state = watcher.state();
    assert.deepEqual(scans, ['start', 'overflow'], 'the window closes at once; the pass is a full scan either way');
    assert.equal(state.overflows, 1);
    assert.equal(state.events, 1001);
    assert.equal(state.scans.overflow, 1);
    assert.equal(state.scans.change, 0, 'an overflowed window does not also close as a change');
    assert.equal(timer.armed(), 0, 'the armed window was abandoned, not left to fire again');
    assert.deepEqual(state.issues.map((issue) => issue.code), ['TDSK1005']);
    assert.match(state.issues[0].detail, /1000 filesystem events/);
    await watcher.close();
  });

  it('names a platform that refuses a recursive watch instead of polling behind its back', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch({ fail: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      tickMs: null,
      onScan: async (trigger) => { scans.push(trigger); return ran(); },
    });

    const state = await watcher.start('/corpus');
    assert.equal(state.mode, 'unavailable');
    assert.deepEqual(state.issues.map((issue) => issue.code), ['TDSK1005']);
    assert.match(state.issues[0].detail, /no tick interval is configured/);
    assert.equal(state.lastError, 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM');
    assert.equal(state.scans.start, 1, 'the start scan still happened — it is what restart safety is');
    assert.equal(state.scans.change, 0);
    assert.equal(state.scans.tick, 0, 'no tick interval, no implicit poll');
    assert.equal(timer.armed(), 0);
    await watcher.close();
  });

  it('scans on the explicit tick where a recursive watch is unavailable', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch({ fail: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      tickMs: 30_000,
      onScan: async (trigger) => { scans.push(trigger); return ran(); },
    });

    const state = await watcher.start('/corpus');
    assert.equal(state.mode, 'tick');
    assert.match(state.issues[0].detail, /tick interval scans instead/);
    await settle(() => timer.armed() === 1);
    timer.fire();
    await settle(() => watcher.state().scans.tick === 1);
    assert.deepEqual(scans, ['start', 'tick']);
    assert.equal(watcher.state().scans.tick, 1);
    await watcher.close();
  });

  it('counts a refused pass and keeps the change that asked for it', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    const answers: WatchScanOutcome[] = [
      ran(),
      { runId: null, refused: 'queue-full' },
      { runId: null, refused: 'config-refused' },
      ran('r-late'),
    ];
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async (trigger) => { scans.push(trigger); return answers[scans.length - 1]; },
    });

    await watcher.start('/corpus');
    fs.emit(1);
    timer.fire();
    await settle(() => scans.length === 2);
    // admission refused the pass; the change is still unseen, so one more
    // window is armed rather than dropped
    await settle(() => timer.armed() === 1);
    assert.equal(watcher.state().refused['queue-full'], 1);

    timer.fire();
    await settle(() => watcher.state().unscanned['config-refused'] === 1);
    assert.equal(watcher.state().unscanned['config-refused'], 1,
      'a pass a bad configuration stopped is not an admission refusal');
    assert.equal(timer.armed(), 0, 'a configuration refusal is not repaired by asking again');

    fs.emit(1);
    timer.fire();
    await settle(() => watcher.state().scans.change === 1);
    const state = watcher.state();
    assert.equal(state.scans.start, 1);
    assert.equal(state.scans.change, 1, 'of the three windows, one ran a pass and two were refused');
    assert.equal(state.lastRunId, 'r-late');
    assert.deepEqual(state.refused, { 'queue-full': 1, closed: 0, cancelled: 0, deadline: 0 });
    assert.deepEqual(state.unscanned, { 'no-folder': 0, 'bad-folder': 0, 'config-refused': 1, failed: 0 });
    await watcher.close();
  });

  it('counts a pass that threw rather than losing it to an unhandled rejection', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    let calls = 0;
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async () => { calls += 1; throw new Error('the store went away'); },
    });

    await watcher.start('/corpus');
    assert.equal(calls, 1);
    const state = watcher.state();
    assert.equal(state.unscanned.failed, 1);
    assert.equal(state.lastError, 'the store went away');
    assert.equal(state.scans.start, 0, 'a pass that threw is not a pass that ran');
    await watcher.close();
  });

  it('retargets on a new folder and stops watching on none', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async (trigger) => { scans.push(trigger); return ran(); },
    });

    await watcher.start('/one');
    const moved = await watcher.retarget('/two');
    assert.equal(moved.folder, '/two');
    assert.equal(moved.scans.start, 2, 'the new folder gets its own full scan');
    assert.equal(fs.closes(), 1, 'the old watch handle is released');

    const stopped = await watcher.retarget(null);
    assert.equal(stopped.folder, null);
    assert.equal(stopped.mode, 'unavailable');
    assert.equal(fs.closes(), 2);
    assert.deepEqual(scans, ['start', 'start'], 'unsetting the folder scans nothing');
    await watcher.close();
  });

  it('says it is off when the host constructed no watch', async () => {
    const scans: WatchTrigger[] = [];
    const watcher = createFolderWatcher({
      enabled: false,
      now,
      onScan: async (trigger) => { scans.push(trigger); return ran(); },
    });
    const state = await watcher.start('/corpus');
    assert.equal(state.enabled, false);
    assert.equal(state.folder, null);
    assert.deepEqual(scans, [], 'a disabled watcher asks for nothing');
    await watcher.close();
  });

  it('closes after the pass it admitted, and asks for nothing afterwards', async () => {
    const timer = scriptedSleep();
    const fs = scriptedWatch();
    const scheduler = createScheduler({ ...FOLDER_ADMISSION });
    const scans: WatchTrigger[] = [];
    let release = (): void => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let settled = false;
    const watcher = createFolderWatcher({
      watch: fs.watch,
      sleep: timer.sleep,
      now,
      onScan: async (trigger) => scheduler.run(async () => {
        scans.push(trigger);
        if (scans.length === 2) { await held; settled = true; }
        return ran();
      }, { scope: 'folder' }),
    });

    await watcher.start('/corpus');
    fs.emit(1);
    timer.fire();
    await settle(() => scans.length === 2);

    let closed = false;
    const closing = watcher.close().then(() => { closed = true; });
    await settle(() => false, 20);
    assert.equal(closed, false, 'closing waits for the pass it admitted');
    release();
    await closing;
    assert.equal(settled, true, 'the admitted pass ran to its end');
    await scheduler.close();
    assert.equal(scheduler.stats().active, 0, 'nothing is still running behind the closed watcher');
    assert.equal(timer.armed(), 0, 'no window is left armed');
    assert.equal(fs.closes(), 1, 'the watch handle is released');

    fs.emit(3);
    assert.equal(watcher.state().events, 1, 'a closed watcher observes nothing more');
    assert.deepEqual(scans, ['start', 'change']);
  });
});
