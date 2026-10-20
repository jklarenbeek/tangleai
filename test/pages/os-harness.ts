/**
 * A running Radiant OS for tests (Pages, Tangle edition): `createOs` over
 * the DOM stub with timers the test turns by hand, a key target it
 * presses, a memory database that records every call and a host that
 * records what the OS hands back (themes, downloads, preferences).
 */
import assert from 'node:assert/strict';

import { createStubHost, serialize } from '../assistant/dom.stub.ts';
import { createOs } from '../../apps/pages/src/os/app/createOs.ts';
import type { OsOptions } from '../../apps/pages/src/os/app/createOs.ts';
import { createMemoryStore } from '../../apps/pages/src/os/kernel/store.ts';

/** Timers the test turns by hand. */
export function fakeTimers() {
  let now = 0;
  let next = 1;
  const jobs = new Map<number, { fn: () => void, at: number, every: number }>();
  return {
    jobs,
    get now() { return now; },
    setTimeout: (fn: () => void, ms: number) => { jobs.set(next, { fn, at: now + ms, every: 0 }); return next++; },
    clearTimeout: (id: number) => { jobs.delete(id); },
    setInterval: (fn: () => void, ms: number) => { jobs.set(next, { fn, at: now + ms, every: ms }); return next++; },
    clearInterval: (id: number) => { jobs.delete(id); },
    /** Run every job due within `ms`, in time order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let due: [number, { fn: () => void, at: number, every: number }] | null = null;
        for (const entry of jobs) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        const [id, job] = due;
        now = job.at;
        if (job.every) job.at += job.every;
        else jobs.delete(id);
        job.fn();
      }
      now = end;
    },
  };
}

/** A key target the keys subscription listens on. */
export function keyTarget() {
  const listeners = new Set<(e: any) => void>();
  return {
    listeners,
    addEventListener: (_type: string, fn: (e: any) => void) => { listeners.add(fn); },
    removeEventListener: (_type: string, fn: (e: any) => void) => { listeners.delete(fn); },
    press(key: string, extra: Record<string, any> = {}) {
      const event = { key, target: { tagName: 'BODY' }, prevented: false, preventDefault() { event.prevented = true; }, ...extra };
      for (const fn of listeners) fn(event);
      return event;
    },
  };
}

/** A memory database behind the outcome shape the page's port client answers with, recording every call. */
export function recordingStore() {
  const handlers = createMemoryStore();
  const calls: Array<[string, any]> = [];
  return {
    calls,
    invoke: async (op: string, input?: any) => { calls.push([op, input]); return { ok: true, value: await handlers[op](input) }; },
  };
}

export function findNode(node: any, test: (n: any) => boolean): any {
  if (test(node)) return node;
  for (const child of node.childNodes ?? []) {
    const hit = findNode(child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Every node under `node` that passes `test`. */
export function findAll(node: any, test: (n: any) => boolean): any[] {
  const out: any[] = [];
  if (test(node)) out.push(node);
  for (const child of node.childNodes ?? []) out.push(...findAll(child, test));
  return out;
}

/** A running OS over the stub DOM. */
export function bootOs(options: Partial<OsOptions> = {}) {
  const { document, container } = createStubHost();
  const timers = fakeTimers();
  const keys = keyTarget();
  const store = recordingStore();
  const prefs: any[] = [];
  const os = createOs({
    node: container, document,
    edition: 'test edition', title: 'Radiant OS',
    store,
    savePrefs: (p) => prefs.push(p),
    keys,
    timers,
    now: () => timers.now,
    schedule: (flush) => flush(),
    onError: (error) => { throw error; },
    ...options,
  });
  const state = () => os.app.getState();
  /** Let effects, awaits and the council's run settle. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  /** Wait until a condition holds, turning the clock a little each time. */
  const until = async (test: () => boolean, what: string) => {
    for (let i = 0; i < 3000; i++) {
      if (test()) return;
      timers.advance(20);
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  /** The first node wearing the class `name`. */
  const find = (name: string) => findNode(container, (n) => (n.getAttribute?.('class') ?? '').split(' ').includes(name));
  return { os, container, document, timers, keys, store, prefs, state, settle, until, find, html: () => serialize(container), dispatch: os.app.dispatch };
}

/**
 * A widget host on a window whose frames, clock and listeners the test
 * drives: `flush()` runs every pending animation frame at `win.time`.
 */
export function windowHost(options: { raf?: boolean } = { raf: true }) {
  const frames = new Map<number, (t: number) => void>();
  const listeners = new Map<string, Set<Function>>();
  let nextFrame = 1;
  const win: any = {
    devicePixelRatio: 1,
    time: 1000,
    performance: { now: () => win.time },
    addEventListener: (type: string, fn: Function) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)?.add(fn); },
    removeEventListener: (type: string, fn: Function) => { listeners.get(type)?.delete(fn); },
    listeners,
    frames,
    /** Fire a window event. */
    fire(type: string, event: any) { for (const fn of listeners.get(type) ?? []) fn(event); },
    /** Run every pending frame at the window's time. */
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(win.time);
    },
  };
  if (options.raf) {
    win.requestAnimationFrame = (fn: (t: number) => void) => { frames.set(nextFrame, fn); return nextFrame++; };
    win.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  }
  const { document } = createStubHost();
  (document as any).defaultView = win;
  const host: any = document.createElement('div');
  host.clientWidth = 800;
  host.clientHeight = 500;
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  return { win, document, host };
}
