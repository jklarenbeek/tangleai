/**
 * The host's folder watcher — a configured folder stays synchronized
 * without a click.
 *
 * Watching a filesystem is host policy, so it lives here and not in the
 * document packages: the suite ships no file watcher, and a corpus
 * package that reached for `node:fs` would stop being portable.
 *
 * What it does is coalesce, not dispatch. Filesystem events are a
 * SIGNAL that something changed, never a list of files to read: every
 * admitted pass is a full folder walk, so a burst is one pass, a rename
 * is a removal plus a new file, and a missed event is repaired by the
 * next pass. Restart safety is the same idea — a full scan at start,
 * not a persisted cursor, because the content hash already makes a
 * scan idempotent.
 *
 * Nothing here runs a pass itself. `onScan` is the injected seam that
 * asks the host's bounded admission for one; its answer is a value, and
 * every answer that is not "a pass ran" is counted in the state this
 * module publishes.
 */

import { watch as nodeWatch } from 'node:fs';

import { createLatestDelivery } from '@jarenjs/core/async';
import { sleep as abortableSleep } from '@jarenjs/core/retry';

import type { SyncTrigger } from './ingest.ts';
import { ADMISSION_REFUSALS, type AdmissionRefusal } from './issues.ts';

/** What the watcher itself can ask for; a click is the host's `manual`. */
export type WatchTrigger = Exclude<SyncTrigger, 'manual'>;

/** The bounded admission's own refusals, as this host names them. */
export type WatchAdmissionReason = AdmissionRefusal;

/** Why an admitted pass could not run anyway. */
export const WATCH_UNSCANNED_REASONS = ['no-folder', 'bad-folder', 'config-refused', 'failed'] as const;
export type WatchUnscannedReason = typeof WATCH_UNSCANNED_REASONS[number];

/** What `onScan` answers: the run a pass recorded, or why none did. */
export interface WatchScanOutcome {
  runId: string | null;
  refused: WatchAdmissionReason | WatchUnscannedReason | null;
}

/** A `node:fs` watch handle as this module uses it. */
export interface WatchHandle {
  close(): void;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface FolderWatchSeams {
  /** `node:fs`'s watch, injected so a test scripts events without touching a disk. */
  watch?: (path: string, options: { recursive: boolean, signal?: AbortSignal },
           listener: (event: string, filename: string | null) => void) => WatchHandle;
  /** The debounce timer, spelled as the scheduler spells it. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => string;
}

export interface FolderWatchOptions extends FolderWatchSeams {
  /** A host that constructs no watcher still holds one that says so. */
  enabled?: boolean;
  debounceMs?: number;
  maxEventsPerWindow?: number;
  /** The explicit fallback where a recursive watch is refused; never an implicit poll. */
  tickMs?: number | null;
  /**
   * Ask the host for one pass. `admitted` is called the moment the pass
   * opens its run, so what this module publishes has moved before the
   * run's own frames reach a reader — a surface refreshed by a frame can
   * never read a count from before the pass it is looking at.
   */
  onScan: (trigger: WatchTrigger, admitted: (runId: string) => void) => Promise<WatchScanOutcome>;
}

/**
 * Every member is a counted value; none is a boolean dressed as health.
 * `scans` counts passes that were admitted and opened a run, `refused`
 * the requests bounded admission would not take, and `unscanned` the
 * ones that produced no complete pass — a pass that opened a run and
 * then failed is in both `scans` and `unscanned.failed`.
 */
export interface FolderWatchState {
  enabled: boolean;
  folder: string | null;
  mode: 'recursive' | 'tick' | 'unavailable';
  startedAt: string | null;
  events: number;
  windows: number;
  scans: Record<WatchTrigger, number>;
  overflows: number;
  refused: Record<WatchAdmissionReason, number>;
  unscanned: Record<WatchUnscannedReason, number>;
  lastRunId: string | null;
  lastError: string | null;
  issues: Array<{ code: string, path: string, detail: string }>;
}

export interface FolderWatcher {
  /** Full scan first — restart safety — then watch. Answers the observed capability. */
  start(folder: string): Promise<FolderWatchState>;
  /** Retarget on a settings change: stop, then start the new folder. */
  retarget(folder: string | null): Promise<FolderWatchState>;
  state(): FolderWatchState;
  close(): Promise<void>;
}

const DEBOUNCE_MS = 400;
const MAX_EVENTS_PER_WINDOW = 1000;

const isAdmissionReason = (reason: string): reason is WatchAdmissionReason =>
  (ADMISSION_REFUSALS as readonly string[]).includes(reason);

export function createFolderWatcher(options: FolderWatchOptions): FolderWatcher {
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const maxEventsPerWindow = options.maxEventsPerWindow ?? MAX_EVENTS_PER_WINDOW;
  const tickMs = options.tickMs ?? null;
  const openWatch = options.watch ?? ((path, watchOptions, listener) => nodeWatch(path, watchOptions, listener));
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now;

  let folder: string | null = null;
  let mode: FolderWatchState['mode'] = 'unavailable';
  let startedAt: string | null = null;
  let events = 0;
  let windows = 0;
  let overflows = 0;
  let lastRunId: string | null = null;
  let lastError: string | null = null;
  const scans: Record<WatchTrigger, number> = { start: 0, change: 0, overflow: 0, tick: 0 };
  const refused: Record<WatchAdmissionReason, number> = { 'queue-full': 0, closed: 0, cancelled: 0, deadline: 0 };
  const unscanned: Record<WatchUnscannedReason, number> = { 'no-folder': 0, 'bad-folder': 0, 'config-refused': 0, failed: 0 };
  const issues: Array<{ code: string, path: string, detail: string }> = [];

  let handle: WatchHandle | null = null;
  let closed = false;
  let windowEvents = 0;
  let dirty = false;
  let wake: AbortController | null = null;
  let ticker: AbortController | null = null;
  /** The pass this watcher is waiting on; a close waits for it to settle. */
  let running: Promise<void> | null = null;
  /** Bumped on detach, so a window queued for the previous folder is dropped. */
  let generation = 0;

  const issue = (detail: string): void => {
    if (!issues.some((entry) => entry.detail === detail)) issues.push({ code: 'TDSK1005', path: '/folder', detail });
  };

  const state = (): FolderWatchState => ({
    enabled,
    folder,
    mode,
    startedAt,
    events,
    windows,
    scans: { ...scans },
    overflows,
    refused: { ...refused },
    unscanned: { ...unscanned },
    lastRunId,
    lastError,
    issues: issues.map((entry) => ({ ...entry })),
  });

  const track = (scan: Promise<void>): Promise<void> => {
    running = scan;
    void scan.then(() => { if (running === scan) running = null; });
    return scan;
  };

  /**
   * One pass at a time, and at most one window waiting behind it: a
   * burst can never become a queue of walks over the same folder.
   */
  const passes = createLatestDelivery((request: { trigger: WatchTrigger, generation: number }) =>
    request.generation === generation ? track(requestScan(request.trigger)) : undefined);

  function pump(trigger: WatchTrigger): void {
    if (!closed) passes.notify({ trigger, generation });
  }

  async function requestScan(trigger: WatchTrigger): Promise<void> {
    let admitted = false;
    const outcome = await options.onScan(trigger, (runId) => {
      admitted = true;
      scans[trigger] += 1;
      lastRunId = runId;
    }).then(
      (answer) => answer,
      (error): WatchScanOutcome => {
        // `onScan` is meant to answer values; one that throws is still a
        // number here rather than an unhandled rejection nobody sees
        lastError = error instanceof Error ? error.message : String(error);
        return { runId: null, refused: 'failed' };
      });
    if (outcome.refused === null) {
      if (!admitted) {
        scans[trigger] += 1;
        if (outcome.runId !== null) lastRunId = outcome.runId;
      }
      return;
    }
    if (!isAdmissionReason(outcome.refused)) {
      unscanned[outcome.refused] += 1;
      return;
    }
    refused[outcome.refused] += 1;
    // the change that asked for this pass has not been seen yet; a
    // closed host is the one refusal nothing can follow
    if (outcome.refused !== 'closed') { dirty = true; arm(); }
  }

  /** (Re)start the one debounce window. Events keep pushing it out. */
  function arm(): void {
    if (closed || folder === null) return;
    wake?.abort();
    const controller = new AbortController();
    wake = controller;
    void (async () => {
      const waited = await sleep(debounceMs, controller.signal).then(() => true, (error: unknown) => {
        if (controller.signal.aborted) return false; // re-armed, or the watcher closed
        lastError = error instanceof Error ? error.message : String(error);
        return false;
      });
      if (!waited || controller.signal.aborted || closed) return;
      if (wake === controller) wake = null;
      closeWindow('change');
    })();
  }

  function closeWindow(trigger: 'change' | 'overflow'): void {
    windows += 1;
    windowEvents = 0;
    if (trigger === 'overflow') {
      overflows += 1;
      issue(`more than ${maxEventsPerWindow} filesystem events arrived in one window; a full scan answers them`);
    }
    // a window that closed with nothing outstanding is not a reason to walk
    if (!dirty) return;
    dirty = false;
    pump(trigger);
  }

  function onEvent(): void {
    if (closed || folder === null) return;
    events += 1;
    windowEvents += 1;
    dirty = true;
    if (windowEvents > maxEventsPerWindow) {
      wake?.abort();
      wake = null;
      closeWindow('overflow');
      return;
    }
    arm();
  }

  /** Open the handle and answer what the platform gave us. */
  function attach(path: string): FolderWatchState['mode'] {
    try {
      handle = openWatch(path, { recursive: true }, () => onEvent());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      lastError = detail;
      handle = null;
      if (tickMs !== null) {
        issue(`a recursive watch is unavailable on ${process.platform}; the configured tick interval scans instead: ${detail}`);
        return 'tick';
      }
      issue(`a recursive watch is unavailable on ${process.platform} and no tick interval is configured: ${detail}`);
      return 'unavailable';
    }
    handle.on?.('error', (error: Error) => {
      lastError = error.message;
      issue(`the folder watch reported an error; a full scan answers it: ${error.message}`);
      onEvent();
    });
    return 'recursive';
  }

  function startTicker(): void {
    if (tickMs === null || mode !== 'tick') return;
    const controller = new AbortController();
    ticker = controller;
    void (async () => {
      while (!closed && !controller.signal.aborted) {
        const waited = await sleep(tickMs, controller.signal).then(() => true, () => false);
        if (!waited || controller.signal.aborted || closed) return;
        pump('tick');
      }
    })();
  }

  function detach(): void {
    wake?.abort();
    wake = null;
    ticker?.abort();
    ticker = null;
    handle?.close();
    handle = null;
    windowEvents = 0;
    dirty = false;
    generation += 1;
  }

  async function startWatching(next: string): Promise<FolderWatchState> {
    if (!enabled || closed) return state();
    detach();
    folder = next;
    startedAt = now();
    mode = attach(next);
    startTicker();
    // the start scan is a pass like any other: a host closing under it
    // waits for it, and a window opened during it queues exactly one more.
    // Retargeting under a pass still in flight starts beside it, as before,
    // so the new folder's start scan is never coalesced into a change pass.
    await (passes.pending() === 0 ? (pump('start'), running) : track(requestScan('start')));
    return state();
  }

  return {
    start: startWatching,

    async retarget(next: string | null): Promise<FolderWatchState> {
      if (!enabled || closed) return state();
      if (next === null) {
        detach();
        folder = null;
        mode = 'unavailable';
        startedAt = null;
        return state();
      }
      return startWatching(next);
    },

    state,

    async close(): Promise<void> {
      closed = true;
      detach();
      passes.close();
      // an admitted pass keeps the store it is writing to alive until it
      // settles; closing under one is how a half-written run happens
      await running;
      running = null;
    },
  };
}
