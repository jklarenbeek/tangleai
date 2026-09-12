/* global Worker */
/** Browser-owned endpoints, storage identities and file pickers for Tangle Pages. */
import { createTransport } from '@jarenjs/studio/data';
import { resolveBootBudgets } from '@jarenjs/studio/data/host';
import { mountPageHost } from './host.ts';
import { mountTransferControls } from './transfer-controls.ts';
export function bootDemos(window: any) {
  const document = window.document;
  const jsonSlot = (key: any) => ({
    key, reliable: true,
    read: () => JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    write: (value: any) => window.localStorage.setItem(key, JSON.stringify(value)),
  });
  const slots = {
    settings: jsonSlot('tangle-ai'), transcript: jsonSlot('tangle-ai-chat'), ledger: jsonSlot('tangle-ai-ledger'),
    projects: jsonSlot('tangle-projects'), play: jsonSlot('tangle-play')
  };
  const gameSave = { read: () => window.localStorage.getItem('tangle-game'), write: (value: any) => window.localStorage.setItem('tangle-game', value) };
  const download = (filename: any, text: any) => {
    const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0); return true;
  };
  const pickers = new Set<() => void>();
  const openFile = () => new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.jsonx';
    let complete = false;
    const cancel = () => finish(null);
    const finish = (value: any) => { if (complete) return; complete = true; pickers.delete(cancel); input.remove(); resolve(value); };
    pickers.add(cancel);
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) finish(null);
      else void file.text().then((text: any) => finish({ name: file.name, text }), () => finish(null));
    }, { once: true });
    document.body.appendChild(input); input.click();
  });
  let budgetOverrides: any = null;
  try { budgetOverrides = JSON.parse(window.sessionStorage.getItem('tangle-data-boot-budgets') ?? 'null'); } catch { /* Invalid overrides use the qualified production budgets. */ }
  const host = mountPageHost({
    root: document.getElementById('demos'), assistantNode: document.getElementById('assistant'), landingNode: document.getElementById('app'),
    slots, gameSave, locks: window.navigator.locks, singleWriter: true, realm: window, lifecycleTarget: window,
    hash: window.location.hash || '#/', navigate: (hash: any) => { if (window.location.hash !== hash) window.location.hash = hash; },
    share: async (hash: any) => { const url = new URL(window.location.href); url.hash = hash; await window.navigator.clipboard.writeText(url.href); return url.href; },
    download, openFile, aiFetch: window.fetch.bind(window), onError: (error: any) => window.console.error('[tangle-demos]', error),
    projectWorker: () => new Worker(new URL('./project-worker.js', import.meta.url), { type: 'module' }),
    transport: () => createTransport({
      spawnWorker: () => new Worker(new URL('./data-worker.js', import.meta.url), { type: 'module' }),
      openChannel: () => new window.BroadcastChannel('tangle-data-studio'), budgets: resolveBootBudgets(budgetOverrides),
    }),
  });
  const hashChange = () => host.setRoute(window.location.hash || '#/');
  const focus = () => { if (host.webmcp.status === 'unavailable') void host.refreshWebMcp(); };
  window.addEventListener('hashchange', hashChange); window.addEventListener('focus', focus);
  let disposed = false;
  function stopHost() {
    if (disposed) return; disposed = true;
    window.removeEventListener('hashchange', hashChange); window.removeEventListener('focus', focus);
    for (const cancel of pickers) cancel();
    return host.dispose();
  }
  const removeTransfer = mountTransferControls(document.getElementById('data-transfer-controls'), {
    slots: { ...slots, game: gameSave }, secrets: () => [slots.settings.read()?.apiKey ?? ''],
    close: stopHost, download, locks: window.navigator.locks, reload: () => window.location.reload(),
  });
  const dispose = () => { window.removeEventListener('pagehide', dispose); removeTransfer(); return stopHost(); };
  window.addEventListener('pagehide', dispose, { once: true });
  // Local observability is also the integration surface for scripted browser proofs.
  window.tanglePages = host;
  return { dispose };
}
