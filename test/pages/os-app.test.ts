/**
 * Radiant OS as one app document (Pages, Tangle edition): `createOs`
 * over the DOM stub with fake timers and a memory database — the chrome,
 * the clock, a council session decided from the keyboard with the
 * scripted oracle in its seat, the Machine, Source, Exports and Gallery
 * apps, autosave and the restore of a saved session.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createStubHost, fire, serialize } from '../assistant/dom.stub.ts';
import { createOs, describeFailure, AUTOSAVE_MS } from '../../apps/pages/src/os/app/createOs.ts';
import type { OsOptions } from '../../apps/pages/src/os/app/createOs.ts';
import { viewModel } from '../../apps/pages/src/os/app/viewmodel.ts';
import { DOCUMENTS } from '../../apps/pages/src/os/app/documents.ts';
import { initialState, restoreState, sessionSlice } from '../../apps/pages/src/os/app/state.ts';
import { createMemoryStore } from '../../apps/pages/src/os/kernel/store.ts';
import { createOracleSeat } from '../../apps/pages/src/os/kernel/oracle.ts';

function fakeTimers() {
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

function boot(options: Partial<OsOptions> = {}) {
  const { document, container } = createStubHost();
  const timers = fakeTimers();
  const listeners = new Set<(e: any) => void>();
  const handlers = createMemoryStore() as any;
  const calls: Array<[string, any]> = [];
  const store = { invoke: async (op: string, input?: any) => { calls.push([op, input]); return { ok: true, value: await handlers[op](input) }; } };
  const downloads: any[] = [];
  const os = createOs({
    node: container, document, edition: 'tangle edition', title: 'Radiant OS',
    store, oracle: createOracleSeat().oracle,
    download: (file) => downloads.push(file),
    keys: { addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) },
    timers, now: () => timers.now, schedule: (flush) => flush(), onError: (error) => { throw error; },
    ...options,
  });
  const state = () => os.app.getState();
  const until = async (test: () => boolean, what: string) => {
    for (let i = 0; i < 2000; i++) {
      if (test()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  const press = (key: string) => { for (const fn of listeners) fn({ key, target: { tagName: 'BODY' }, preventDefault() {} }); };
  const find = (test: (n: any) => boolean, node: any = container): any => {
    if (test(node)) return node;
    for (const child of node.childNodes ?? []) {
      const hit = find(test, child);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return { os, container, timers, calls, downloads, state, until, press, find, html: () => serialize(container as any) };
}

describe('the OS document', () => {
  it('renders the desk and dances on its clock', async () => {
    const t = boot();
    assert.match(t.html(), /<span class="os-edition">tangle edition<\/span>/);
    assert.match(t.html(), /class="os-stage-svg"/);
    for (let i = 0; i < 50; i++) { t.timers.advance(20); await new Promise((resolve) => setImmediate(resolve)); }
    assert.ok(t.state().world.tick >= 10, `ticks: ${t.state().world.tick}`);
    t.os.app.dispatch('os/oracle', { label: 'scripted' });
    assert.match(t.html(), /<span class="os-pill-label">oracle<\/span> <span class="os-pill-value">scripted<\/span>/);
    t.os.destroy();
  });

  it('holds a session with the scripted oracle in its seat, and takes the human’s verdict from the keyboard', async () => {
    const t = boot();
    const { dispatch } = t.os.app;
    dispatch('machine/run', false);
    const input = t.find((n) => n.getAttribute?.('id') === 'os-say-input');
    input.value = 'more symmetry, please';
    fire(input, 'input');
    fire(t.find((n) => n.tagName === 'form'), 'submit', { preventDefault() {} });
    await t.until(() => t.state().council.chat.length === 1, 'the words');
    dispatch('council/convene');
    await t.until(() => t.state().council.phase === 'veto', 'the verdict');
    const oracle = t.state().council.proposals.find((p: any) => p.by === 'oracle');
    assert.match(oracle?.why ?? '', /^You asked for symmetry/, 'the oracle heard the human');
    assert.match(t.html(), /class="os-verdict"/);
    t.press('v');
    await t.until(() => t.state().council.log[0]?.status === 'vetoed' && t.state().council.log[0]?.reward !== null, 'the veto');
    assert.ok(t.calls.some(([op]) => op === 'amendment.put'));
    dispatch('council/convene');
    await t.until(() => t.state().council.phase === 'veto', 'the second verdict');
    t.press('a');
    await t.until(() => t.state().council.log[0]?.status === 'enacted', 'the approval');
    t.os.destroy();
  });

  it('drafts and forecasts in the Machine app, exports, keeps and puts back artworks', async () => {
    const t = boot();
    const { dispatch } = t.os.app;
    dispatch('machine/run', false);
    dispatch('os/app', 'machine');
    dispatch('machine/draft', viewModel(t.state()).ui.rules[0].cells[2].cycleWrite);
    await t.until(() => t.state().machine.forecast !== null, 'the forecast');
    dispatch('machine/propose');
    await t.until(() => t.state().council.queue.length === 1, 'the proposal');
    dispatch('os/app', 'exports');
    await t.until(() => t.state().exports.status === 'done', 'the CSS');
    dispatch('exports/download');
    assert.equal(t.downloads[0].name, 'radiant-theme.css');
    dispatch('os/app', 'gallery');
    await t.until(() => t.state().gallery.status === 'idle', 'the listing');
    dispatch('gallery/save');
    await t.until(() => t.state().gallery.items.length === 1, 'the artwork');
    dispatch('machine/tick', { steps: 20 });
    await t.until(() => t.state().world.tick === 20, 'the dance');
    dispatch('gallery/open', t.state().gallery.items[0].id);
    await t.until(() => t.state().world.tick === 0, 'the artwork back');
    t.os.destroy();
  });

  it('sculpts every document it runs, the oracle’s grammar among them', () => {
    const t = boot();
    t.os.app.dispatch('os/app', 'source');
    assert.ok(DOCUMENTS.some((d) => d.id === 'oracle'));
    for (const doc of DOCUMENTS) {
      t.os.app.dispatch('source/doc', doc.id);
      const ui = viewModel(t.state()).ui;
      assert.equal(ui.source?.id, doc.id);
      assert.ok(ui.sculpture.layout.nodes.length > 0, doc.id);
    }
    t.os.destroy();
  });

  it('saves the running session and restores what it can run', async () => {
    const t = boot();
    t.timers.advance(AUTOSAVE_MS);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.calls.filter(([op]) => op === 'session.put').length, 1);
    t.os.destroy();
    const fresh = initialState({ edition: 'e', title: 't' });
    const saved = sessionSlice(t.state());
    assert.equal(restoreState(fresh, saved).world.tick, saved.world.tick);
    const bad = structuredClone(saved);
    bad.program.machine.transitions[0].to = 'sleep';
    assert.equal(restoreState(fresh, bad).program, fresh.program);
    assert.equal(describeFailure({ error: { code: 'unreadable' } }), 'That artwork was kept in a form this OS cannot run, so it stays in the gallery.');
    assert.equal(describeFailure({ error: { code: 'JC2050', details: [{ path: '/by', keyword: 'const' }] } }), 'The OS refused the request: /by (const).');
    assert.equal(describeFailure(null), 'The request failed.');
  });
});
