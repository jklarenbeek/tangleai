/* global Worker */
/**
 * Radiant OS, Tangle edition — the browser bootstrap. Everything that
 * needs a real browser lives here and nowhere else: the database worker,
 * the service worker, the stylesheet the JTLT theme renders into, file
 * downloads, saved preferences, WebMCP, and the oracle's model settings,
 * read from the Tangle assistant's own storage slot. The OS itself
 * (`createOs`) runs the same with or without any of them.
 */

import { compileContract } from '@jarenjs/contract';
import { openPortClient } from '@jarenjs/contract/port';
import { openLocalClient } from '@jarenjs/contract/local';
import { registerWebMcp } from '@jarenjs/contract/webmcp';
import storeDoc from './documents/store.contract.json' with { type: 'json' };
import { createMemoryStore } from './kernel/store.ts';
import { createOracleSeat } from './kernel/oracle.ts';
import type { ModelSettings } from './kernel/oracle.ts';
import type { StorePort } from './kernel/system.ts';
import { createOs } from './app/createOs.ts';
import { sessionSlice } from './app/state.ts';

/** The preferences both editions share on this origin. */
const PREFS_KEY = 'radiant-os-prefs';
/** Where the Tangle assistant keeps its model settings. */
const SETTINGS_KEY = 'tangle-ai';
const READY_MS = 10000;

/** What the About app says in this edition. */
const ABOUT = {
  lead: 'A browser OS that is a Turing machine, governed by a council of its own parts — one of them a language model — and by you.',
  sections: [
    { title: 'The machine', text: 'The floor is the tape of a two-dimensional Turing machine. Four heads — the Painter, the Dancer, the Critic and the Architect — read the cell under them, paint, turn and step, all by one program: a jaren-fsm document compiled by @jarenjs/flow. Every block on the floor is a symbol the machine wrote.' },
    { title: 'The council', text: 'Every few hundred steps the council meets. Each member proposes one amendment to the program and judges every proposal by simulating it ahead; votes are weighted by merit. A session is a jaren-workflow document: a DAG gathers and tallies, then a wait state holds the winner for your verdict.' },
    { title: 'The oracle', text: 'The television on the plinth is the oracle’s seat, and in this edition a language model can sit in it through @tangleai/models. Configure a model in the Tangle assistant on the main pages and the OS reads the same settings. The model is asked only when you have spoken to the council since it last answered — your words are what it brings — and its answer is constrained by the contract’s own Change grammar, validated locally, and judged by simulation like every other proposal. Without a model, a scripted oracle answers offline through the same client.' },
    { title: 'Merit', text: 'Merit is earned by measured results, in a jaren-dag of query documents: an enacted amendment is judged against the future it replaced, and gains most when it lifts every member’s taste together. A veto costs its proposer and backers a little — the council learns what you will not have.' },
    { title: 'The veto', text: 'It is always yours. The veto, the early approval and the repeal of an enacted amendment are operations of the OS contract that no tool projection carries: neither the oracle nor an agent connected over WebMCP is ever offered them.' },
    { title: 'Code as art', text: 'Everything the OS runs is a JSON document — the program, the council, merit, the oracle’s grammar, the view you are reading, the system calls. The Source app sculpts any of them into dancing figures with one JSLT stylesheet and lights up what is executing; Exports renders the artwork as CSS, HTML and JavaScript through JTLT templates.' },
    { title: 'The drawing', text: 'The figures are drawn in homage to the bold outlined line of 1980s subway and street art — Keith Haring’s above all — and reimagined rather than reproduced: cut-out dancers that are the heads of a Turing machine, on a floor their own program paints. Dark mode is the subway: chalk on black.' },
  ],
  links: [
    { label: 'Tangle AI pages and the assistant', href: '../' },
    { label: 'Radiant OS, Jaren edition', href: 'https://jklarenbeek.github.io/jarenjs/os/' },
    { label: 'Source on GitHub', href: 'https://github.com/jklarenbeek/tangleai' },
  ],
};

/** Saved preferences, or the system's. */
function readPrefs(window: any): { theme: 'light' | 'dark', reduce: boolean } {
  let saved: { theme?: string, reduce?: boolean } = {};
  try { saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}; }
  catch { saved = {}; }
  return {
    theme: saved.theme === 'dark' || saved.theme === 'light'
      ? saved.theme
      : (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'),
    reduce: typeof saved.reduce === 'boolean' ? saved.reduce : !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  };
}

/** The Tangle assistant's model settings, if any. */
function readSettings(window: any): ModelSettings | null {
  try { return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null'); }
  catch { return null; }
}

/** Start the database worker and wait for it; fall back to memory. */
async function openStore(): Promise<StorePort> {
  const contract = compileContract(storeDoc as any);
  try {
    const worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), READY_MS);
      worker.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.radiant === 'ready') { clearTimeout(timer); resolve(true); }
        else if (event.data?.radiant === 'failed') { clearTimeout(timer); resolve(false); }
      });
      worker.addEventListener('error', () => { clearTimeout(timer); resolve(false); });
    });
    if (ready) return openPortClient(contract, { channel: worker, timeoutMs: 15000 } as any) as unknown as StorePort;
    worker.terminate();
  }
  catch {
    // no module workers here: keep going in memory
  }
  return openLocalClient(contract, createMemoryStore() as any) as unknown as StorePort;
}

function downloader(document: any) {
  return (file: { name: string, mime: string, text: string }) => {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

function themeApplier(document: any) {
  return (css: string) => {
    let style = document.getElementById('radiant-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'radiant-theme';
      document.head.appendChild(style);
    }
    style.textContent = css;
  };
}

/** The platform's error reporter, where there is one. */
function report(error: unknown) {
  if (typeof reportError === 'function') reportError(error);
}

async function boot(window: any) {
  const document = window.document;
  const node = document.getElementById('os');
  const prefs = readPrefs(window);
  const store = await openStore();
  const saved = await store.invoke('session.get').then((o) => (o.ok ? o.value?.state ?? null : null));
  let notify = (_text: string) => {};
  const seat = createOracleSeat({
    settings: readSettings(window),
    fetch: window.fetch.bind(window),
    onError: (error: any) => notify(`The oracle could not answer: ${error?.message ?? error}`),
  });
  node.textContent = '';
  const os = createOs({
    node,
    document,
    edition: 'tangle edition',
    title: 'Radiant OS',
    about: ABOUT,
    theme: prefs.theme,
    reduce: prefs.reduce,
    app: window.matchMedia?.('(max-width: 760px)')?.matches ? 'none' : 'council',
    store,
    saved,
    oracle: seat.oracle,
    applyTheme: themeApplier(document),
    download: downloader(document),
    savePrefs: (p) => { try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: the toggle still works for this visit */ } },
    keys: window,
    // a boundary failure is reported, never thrown into the frame loop
    onError: (error) => { report(error); },
  });
  notify = (text) => os.app.dispatch('os/notice', { tone: 'warn', text });
  os.app.dispatch('os/oracle', { label: seat.label });
  // the assistant's settings changed in another tab: seat the new model
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== SETTINGS_KEY) return;
    seat.configure(readSettings(window));
    os.app.dispatch('os/oracle', { label: seat.label });
  });
  const info = await store.invoke('store.info');
  if (info.ok) os.app.dispatch('os/storage', info.value);
  os.app.dispatch('os/online', window.navigator.onLine !== false);
  window.addEventListener('online', () => os.app.dispatch('os/online', true));
  window.addEventListener('offline', () => os.app.dispatch('os/online', false));
  window.addEventListener('pagehide', () => {
    store.invoke('session.put', { state: sessionSlice(os.app.getState()) }).catch(() => {});
  });
  // language models reach the OS as the Oracle, through the public contract
  registerWebMcp(os.system.tools({ seat: 'oracle' }) as any, { realm: window, onError: () => {} } as any);
  if ('serviceWorker' in window.navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch(() => {});
  }
}

boot(globalThis).catch((error) => {
  report(error);
  const node = (globalThis as any).document?.getElementById('os');
  if (node) node.textContent = `Radiant OS could not start: ${error?.message ?? error}`;
});
