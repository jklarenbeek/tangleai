/* global Worker */
/**
 * The site's work surfaces as desktop applications: Studio, Playground, Flow,
 * Data and the adventure, plus moving browser data. One shared composition
 * owns their state and persistence, as it always has; each window attaches a
 * surface and detaching keeps its work. Their assistant tools join the
 * desktop assistant, and a tool that used to change page opens a window.
 */
import { createTransport } from '@jarenjs/studio/data';
import { resolveBootBudgets } from '@jarenjs/studio/data/host';
import type { ShippedMount } from '@tangleai/os/shell';
import { mountPageHost } from '../demos/host.ts';
import { mountTransferControls } from '../demos/transfer-controls.ts';
import { SYSTEM_PROMPT } from '../demos/playground/toolbox.ts';

/** Which application a former page link opens. */
export const SURFACE_OF: Record<string, string> = { project: 'studio', studio: 'studio', play: 'playground', flow: 'flow', data: 'data', game: 'adventure' };
const KEY_OF: Record<string, string> = { studio: 'project', playground: 'play', flow: 'flow', data: 'data', adventure: 'game' };

export function createSurfaces(win: any, options: { settings: () => any, open: (module: string) => void, onError?: (error: unknown) => void }) {
  const doc = win.document;
  const jsonSlot = (key: string) => ({
    key, reliable: true,
    read: () => { try { return JSON.parse(win.localStorage.getItem(key) ?? 'null'); } catch { return null; } },
    write: (value: unknown) => win.localStorage.setItem(key, JSON.stringify(value)),
  });
  const slots = { settings: jsonSlot('tangle-ai'), transcript: jsonSlot('tangle-ai-chat'), ledger: jsonSlot('tangle-ai-ledger'), projects: jsonSlot('tangle-projects'), play: jsonSlot('tangle-play') };
  const gameSave = { read: () => win.localStorage.getItem('tangle-game'), write: (value: string) => win.localStorage.setItem('tangle-game', value) };
  const download = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob), link = doc.createElement('a');
    link.href = url; link.download = filename; doc.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0); return true;
  };
  const openFile = () => new Promise(resolve => {
    const input = doc.createElement('input'); input.type = 'file'; input.accept = '.json,.jsonx';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) resolve(null);
      else void file.text().then((text: string) => resolve({ name: file.name, text }), () => resolve(null));
    }, { once: true });
    input.click();
  });
  let budgetOverrides: unknown = null;
  try { budgetOverrides = JSON.parse(win.sessionStorage.getItem('tangle-data-boot-budgets') ?? 'null'); } catch { /* the qualified production budgets apply */ }

  // the surfaces live here while no window shows them
  const parking = doc.createElement('div');
  parking.hidden = true; parking.className = 'tos-parking';
  doc.body.append(parking);
  const onError = options.onError ?? ((error: unknown) => win.console.error('[tangle-os]', error));

  const host = mountPageHost({
    root: parking, windowed: true, settings: options.settings,
    slots, gameSave, locks: win.navigator.locks, singleWriter: true, realm: win, lifecycleTarget: win,
    hash: '#/', navigate: (hash: string) => { const page = new URL(hash.replace(/^#/, ''), 'https://tangle.invalid').pathname.slice(1); const module = SURFACE_OF[page]; if (module) options.open(module); },
    share: async (hash: string) => { const url = new URL(win.location.href); url.hash = hash; await win.navigator.clipboard.writeText(url.href); return url.href; },
    download, openFile, aiFetch: win.fetch.bind(win), onError,
    projectWorker: () => new Worker(new URL('./project-worker.js', doc.baseURI), { type: 'module' }),
    transport: () => createTransport({
      spawnWorker: () => new Worker(new URL('./data-worker.js', doc.baseURI), { type: 'module' }),
      openChannel: () => new win.BroadcastChannel('tangle-data-studio'), budgets: resolveBootBudgets(budgetOverrides as any),
    }),
  });

  const surface = (module: string): ShippedMount => (node) => {
    node.classList.add('tos-surface', `tos-surface-${module}`);
    host.attach(KEY_OF[module], node);
    return () => host.detach(KEY_OF[module]);
  };
  const transfer: ShippedMount = (node) => {
    node.classList.add('tos-surface', 'tos-transfer');
    const lead = doc.createElement('p');
    lead.className = 'tos-transfer-lead';
    lead.textContent = 'Export your projects, sessions, conversation and game to a file, or import such a file into empty places. Settings and keys never leave this browser. Close other Tangle tabs first.';
    const controls = doc.createElement('div');
    controls.id = 'data-transfer-controls';
    node.append(lead, controls);
    const remove = mountTransferControls(controls, {
      slots: { ...slots, game: gameSave }, secrets: () => [options.settings()?.apiKey ?? slots.settings.read()?.apiKey ?? ''],
      close: () => host.dispose(), download, locks: win.navigator.locks, reload: () => win.location.reload(),
    });
    return () => { remove(); lead.remove(); controls.remove(); };
  };

  return {
    host,
    mounts: { studio: surface('studio'), playground: surface('playground'), flow: surface('flow'), data: surface('data'), adventure: surface('adventure'), transfer } as Record<string, ShippedMount>,
    /** The authoring tools for Studio, Playground, Flow and Data, for the desktop assistant. */
    toolbox: host.toolbox,
    system: SYSTEM_PROMPT,
    /** A former page link (`#/project?s=…`, `#/play?…`): open its application and apply it. */
    follow(hash: string) {
      const page = new URL(hash.replace(/^#/, ''), 'https://tangle.invalid').pathname.slice(1);
      const module = SURFACE_OF[page]; if (!module) return false;
      options.open(module); host.setRoute(hash); return true;
    },
  };
}
