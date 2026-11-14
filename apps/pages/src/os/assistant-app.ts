/**
 * The desktop's assistant as a window: the shared @tangleai/assistant panel,
 * filling the window instead of sliding out, with every contract the kernel
 * grants it as tools. Its connection (provider, model, key) comes from the
 * preferences, so the Settings app and the panel's own settings edit the same
 * thing.
 */
import { mountAssistant } from '@tangleai/assistant/component';
import type { Kernel } from '@tangleai/os';
import type { ShippedMount } from '@tangleai/os/shell';
import { PROVIDER_KINDS, type Preferences, type ProviderKind } from './preferences.ts';

const SYSTEM = [
  'You are the assistant of Tangle OS, a desktop in the browser where every application is a window.',
  'Your tools are the contract operations the open applications serve; a tool name is <contract>__<operation>.',
  'Use them to answer from the applications\' real data rather than guessing, and say which application an answer came from.',
  'When no tool fits, say so plainly and answer from what you know.',
].join(' ');

/**
 * The kernel's grants change as windows open and close, so the toolbox is
 * asked again at each turn instead of being fixed when the window opens.
 */
function liveToolbox(kernel: Kernel) {
  return {
    list: () => kernel.tools().list(),
    toFunctionTools: () => kernel.tools().toFunctionTools(),
    execute: (name: string, args: unknown, context?: unknown) => kernel.tools().execute(name, args, context as any),
  };
}

export function assistantMount(kernel: Kernel, prefs: Preferences, openSettings: () => void): ShippedMount {
  return (node, context) => {
    const doc = node.ownerDocument;
    const host = doc.createElement('div');
    host.className = 'tos-assistant-host';
    node.append(host);
    let handle: ReturnType<typeof mountAssistant> | null = null;
    let stopOpenWatch: (() => void) | null = null;
    let closing: Promise<unknown> = Promise.resolve();
    let live = true;

    const aiStorage = {
      read: () => prefs.ai(),
      // the panel's own settings form saves here; tag it so this window does not remount itself
      write: (value: any) => prefs.writeAi({ provider: value.provider, baseUrl: value.baseUrl, model: value.model, apiKey: value.apiKey }, 'assistant'),
    };

    function mount() {
      handle = mountAssistant(host, {
        title: 'Assistant', launchTitle: 'Open the assistant', open: true,
        intro: 'Ask about anything on this desktop. The assistant can use every application that is open and has granted it access.',
        capabilities: ['Search and read what open applications serve', 'Answer with the application it used', 'Keep the conversation in this browser'],
        settingsHint: 'Your key stays in this browser and is sent only to its own provider. Settings has every provider, the model list and your starred models.',
        aiStorage, aiChat: prefs.chat, toolbox: liveToolbox(kernel), system: SYSTEM,
        lang: context.locale, dir: context.dir,
        onError: (error) => console.error(error),
      });
      // the panel's own close button would leave only its launcher; in a
      // window the window's close button closes, so the panel stays open
      stopOpenWatch = handle.subscribe((state: any) => { if (!state.open) handle?.dispatch('ai/toggle'); });
    }

    async function remount() {
      if (!live) return;
      stopOpenWatch?.(); stopOpenWatch = null;
      const old = handle; handle = null;
      closing = Promise.resolve(old?.dispose()).catch(() => {});
      await closing;
      if (!live) return;
      host.replaceChildren();
      mount();
    }

    // the footer: switch between the person's models (across providers), and Settings
    const footer = doc.createElement('div');
    footer.className = 'tos-assistant-footer';
    const switcher = doc.createElement('select');
    switcher.className = 'tos-model-switch';
    switcher.setAttribute('aria-label', 'Model');
    switcher.addEventListener('change', () => {
      const [kind, ...rest] = switcher.value.split(':');
      prefs.use(kind as ProviderKind, rest.join(':'), 'switch');
    });
    function renderSwitcher() {
      const kind = prefs.active(), model = prefs.connection(kind).model;
      const options = prefs.favourites().map(f => ({ kind: f.kind, model: f.model }));
      if (model && !options.some(o => o.kind === kind && o.model === model)) options.unshift({ kind, model });
      switcher.replaceChildren(...options.map(o => {
        const option = doc.createElement('option');
        option.value = `${o.kind}:${o.model}`;
        option.textContent = `${o.model} · ${PROVIDER_KINDS[o.kind].label}`;
        option.selected = o.kind === kind && o.model === model;
        return option;
      }));
      switcher.hidden = options.length === 0;
    }
    const link = doc.createElement('button');
    link.type = 'button'; link.className = 'tos-link';
    link.textContent = 'Providers and models';
    link.addEventListener('click', openSettings);
    footer.append(switcher, link);
    node.append(footer);
    renderSwitcher();

    mount();
    const unsubscribe = prefs.subscribe((what, source) => {
      if (what !== 'ai') return;
      renderSwitcher();
      if (source !== 'assistant') void remount();
    });
    return () => {
      live = false; unsubscribe(); stopOpenWatch?.();
      const old = handle; handle = null;
      void Promise.resolve(old?.dispose()).catch(() => {});
      host.remove(); footer.remove();
    };
  };
}
