/**
 * Assemble a running Radiant OS: the app document (state, the view
 * stylesheet, the action documents, the subscriptions), the boundaries
 * it names, the council driver, and the system call table that binds
 * them — and nothing that needs a browser. The bootstrap (`main.ts`)
 * hands in what only a browser has (a node to render into, a database
 * worker's port, a way to apply a stylesheet or save a file, the oracle's
 * model); a test hands in nothing, and gets the same OS, headless.
 */

import { createApp } from '@jarenjs/app';
import { compileMachine, stepWorld } from '../kernel/machine.ts';
import { measure, roundMeasure } from '../kernel/metrics.ts';
import { LOOKAHEAD } from '../kernel/council.ts';
import { createCouncilDriver } from '../kernel/session.ts';
import type { Oracle } from '../kernel/session.ts';
import { createSystem, isProposal } from '../kernel/system.ts';
import type { StorePort } from '../kernel/system.ts';
import { renderArt } from '../kernel/exports.ts';
import { stageWidget } from '../stage/widget.ts';
import { sculptureWidget } from '../stage/sculpture.ts';
import { initialState, restoreState, sessionSlice } from './state.ts';
import { ACTIONS } from './actions.ts';
import { VIEW } from './view.ts';
import { viewModel } from './viewmodel.ts';

/** How often the running session is saved, ms. */
export const AUTOSAVE_MS = 20000;
/** How many harmony samples the sparkline keeps, one per this many ticks. */
const TRAIL = { keep: 48, every: 12 };

/** What a refused contract call means, in words a person can act on. */
const FAILURE_TEXT: Record<string, string> = {
  'not-awaiting': 'Nothing is awaiting your verdict any more.',
  'in-session': 'The council is already in session.',
  'queue-full': 'The council’s table is full; wait for the next session.',
  'unknown-state': 'That rule names a state the program does not have.',
  'not-found': 'There is nothing by that name.',
  unreadable: 'That artwork was kept in a form this OS cannot run, so it stays in the gallery.',
  'not-repealable': 'That amendment cannot be undone: only enacted rule and tempo changes can.',
  storage: 'The OS database is not available right now.',
};

export function describeFailure(outcome: any): string {
  const code = outcome?.error?.code;
  if (code && FAILURE_TEXT[code]) return FAILURE_TEXT[code];
  if (code === 'JC2050') return `The OS refused the request: ${(outcome.error.details ?? []).map((d: any) => `${d.path || '/'} (${d.keyword})`).join(', ') || 'invalid input'}.`;
  return outcome?.error?.message ?? 'The request failed.';
}

export type Timers = {
  setInterval: (fn: () => void, ms: number) => any, clearInterval: (id: any) => void,
  setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (id: any) => void,
};
export type OsOptions = {
  node?: any, document?: any,
  edition: string, title: string, about?: any,
  theme?: 'light' | 'dark', reduce?: boolean, app?: string,
  store?: StorePort | null,
  saved?: any,
  oracle?: Oracle,
  applyTheme?: (css: string) => void,
  download?: (file: { name: string, mime: string, text: string }) => void,
  savePrefs?: (prefs: { theme: string, reduce: boolean }) => void,
  keys?: { addEventListener: (type: string, fn: any) => void, removeEventListener: (type: string, fn: any) => void } | null,
  timers?: Timers, now?: () => number,
  schedule?: (flush: () => void) => void,
  onError?: (error: any) => void,
};
type Send = (action: string, payload?: any) => void;

/** Create the OS. */
export function createOs(options: OsOptions) {
  const timers: Timers = options.timers ?? (globalThis as unknown as Timers);
  const now = options.now ?? (() => Date.now());
  const report = options.onError ?? ((error: any) => { throw error; });

  let app: any = null;
  const getState = () => app.getState();
  const dispatch = (action: string, payload: any = null) => app.dispatch(action, payload);

  const council = createCouncilDriver({
    getState,
    dispatch,
    oracle: options.oracle,
    validateProposal: isProposal,
    setTimer: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimer: (id) => timers.clearTimeout(id),
    now,
  });
  const system = createSystem({
    edition: options.edition,
    title: options.title,
    getState,
    dispatch,
    council,
    store: options.store ?? null,
  });

  // what the tape unit remembers between ticks: the tapes the dancer's
  // liveliness is judged against, and the harmony sparkline
  let history: Array<{ tick: number, tape: number[] }> = [];
  let trail: number[] = [];
  let sampled = -Infinity;

  const effects = {
    /** Step the world the action handed over and send the new one back. */
    cpu(props: { machine: any, world: any, steps: number }, send: Send) {
      let result;
      try {
        result = stepWorld(compileMachine(props.machine), props.world, Math.max(1, Math.min(64, Math.floor(Number(props.steps) || 1))));
      }
      catch (error: any) {
        send('machine/stopped', String(error?.message ?? error));
        return;
      }
      const world = result.world;
      if (history.length > 0 && history[history.length - 1].tick > world.tick) { history = []; trail = []; sampled = -Infinity; }
      if (history.length === 0 || world.tick - history[history.length - 1].tick >= TRAIL.every) history.push({ tick: world.tick, tape: world.tape });
      while (history.length > 1 && history[1].tick <= world.tick - LOOKAHEAD) history.shift();
      const past = history[0].tick < world.tick ? history[0].tape : undefined;
      const measured = roundMeasure(measure(world, past));
      if (world.tick - sampled >= TRAIL.every) {
        trail = [...trail.slice(-(TRAIL.keep - 1)), measured.harmony];
        sampled = world.tick;
      }
      send('machine/advanced', { world, measure: measured, trail, fired: result.fired });
      council.onTick(world, past).catch(report);
    },
    invoke(props: { op: string, input: any }, send: Send) {
      return system.client.invoke(props.op, props.input).then((outcome) => {
        if (!outcome.ok) send('os/notice', { tone: 'warn', text: describeFailure(outcome) });
        return outcome;
      });
    },
    /** Call the contract; send the value (with the input it answers) to
     * `then`, the refusal in words to `catch`. */
    async call(props: { op: string, input?: any, then: string, catch: string }, send: Send) {
      const outcome = await system.client.invoke(props.op, props.input);
      if (outcome.ok) send(props.then, { value: outcome.value, input: props.input ?? null });
      else send(props.catch, { message: describeFailure(outcome) });
    },
    forecast(change: any, send: Send) {
      send('machine/forecasted', council.forecast(change));
    },
    record(amendment: any) {
      options.store?.invoke('amendment.put', { amendment }).catch(() => {});
    },
    prefs(prefs: { theme: string, reduce: boolean }) {
      options.savePrefs?.(prefs);
    },
    download(file: { name: string, mime: string, text: string }) {
      options.download?.(file);
    },
    redispatch(props: { action: string, payload?: any }, send: Send) {
      send(props.action, props.payload ?? null);
    },
  };

  const subs = {
    ticker(props: { tempo: number }, send: Send) {
      const id = timers.setInterval(() => send('machine/tick'), Math.max(30, Math.round(1000 / Math.max(1, props.tempo))));
      return () => timers.clearInterval(id);
    },
    clock(_props: unknown, send: Send) {
      send('os/clock', now());
      const id = timers.setInterval(() => send('os/clock', now()), 500);
      return () => timers.clearInterval(id);
    },
    /** The human's keys: V vetoes, A lets it pass, Space runs or pauses. */
    keys(_props: unknown, send: Send) {
      const target = options.keys;
      if (!target) return undefined;
      const onKey = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const element = e.target as any;
        const tag = element?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable) return;
        const key = e.key.toLowerCase();
        if (key === 'v') send('council/veto');
        else if (key === 'a') send('council/approve');
        else if (key === ' ' && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); send('machine/toggle'); }
      };
      target.addEventListener('keydown', onKey);
      return () => target.removeEventListener('keydown', onKey);
    },
    /** Save the running session every so often. */
    autosave() {
      if (!options.store) return undefined;
      const save = () => { options.store?.invoke('session.put', { state: sessionSlice(getState()) }).catch(() => {}); };
      const id = timers.setInterval(save, AUTOSAVE_MS);
      return () => { timers.clearInterval(id); save(); };
    },
    /** Re-render the theme the chrome wears when the leader or the light
     * changes. Deferred a turn: the first start happens while the app is
     * still booting, before its state can be read. */
    theme() {
      if (!options.applyTheme) return undefined;
      const id = timers.setTimeout(() => {
        renderArt(getState()).then((art) => options.applyTheme?.(art.css), report);
      }, 0);
      return () => timers.clearTimeout(id);
    },
  };

  const fresh = initialState({ edition: options.edition, title: options.title, theme: options.theme, reduce: options.reduce, app: options.app });
  const state = restoreState(fresh, options.saved);
  state.os.about = options.about ?? { lead: '', sections: [], links: [] };
  state.os.now = null;

  const doc = {
    $app: '0.1',
    state,
    view: VIEW,
    actions: {
      ...ACTIONS,
      'os/clock': { patch: [{ op: 'replace', path: '/os/now', value: '$payload' }] },
    },
    subs: [
      { run: 'ticker', when: '$.machine.running', withQuery: { tempo: '$.program.tempo' } },
      { run: 'clock', when: { $eq: ['$.council.phase', 'veto'] } },
      { run: 'keys' },
      { run: 'autosave' },
      { run: 'theme', withQuery: { leader: '$.council.leader', theme: '$.os.theme' } },
    ],
  };

  app = createApp(doc as any, {
    ...(options.node ? { node: options.node } : {}),
    ...(options.document ? { document: options.document } : {}),
    effects,
    subs,
    widgets: { stage: stageWidget, sculpture: sculptureWidget },
    viewModel,
    onError: report,
    ...(options.schedule ? { schedule: options.schedule } : {}),
  } as any);

  return {
    app,
    system,
    council,
    /** Stop the OS: timers, the council, the app. */
    destroy() {
      council.dispose();
      app.destroy();
    },
  };
}
