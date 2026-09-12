/** The visual assistant owns one app, its request lifecycle and its DOM listeners. */
import { createApp, formEventFields } from '@jarenjs/app';
import { createMdComponent } from '@jarenjs/md/component';
import { highlightPlugin } from '@jarenjs/md/plugins';
import { mermaidPlugin } from '@jarenjs/mermaid/plugin';
import { createLedger } from '@tangleai/context';
import { createToolbox } from '@tangleai/agents';
import { createAssistantState, createAssistantController, ASSISTANT_ACTIONS } from './index.ts';
import { createAssistantRules } from './views.ts';
import { assistantView } from './viewmodel.ts';

const DEFAULT_PRESENTATION = {
  title: 'Assistant', launchLabel: ' Assistant', launchTitle: 'Open assistant',
  intro: 'Describe what you want to get done. The assistant can use the tools this host provides.',
  capabilities: [],
  settingsHint: 'Provider requests use your settings. This host controls local persistence.',
};
let nextInstance = 0;
/** @param value */
function presentation(value: AssistantPresentation) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(DEFAULT_PRESENTATION, key)));
}
/** @param node @param [options] */
export function mountAssistant(node: HTMLElement | null, options: AssistantOptions = {}) {
  let app: any, disposed = false, closing: any;
  const id = `tangle-assistant-${++nextInstance}`;
  let settings = options.settings ?? null, transcript = options.transcript ?? null;
  const aiStorage = options.aiStorage ?? { read: () => settings, write: (value: any) => { settings = structuredClone(value); } };
  const aiChat = options.aiChat ?? { read: () => transcript, write: (value: any) => { transcript = structuredClone(value); } };
  const md = createMdComponent({ plugins: [highlightPlugin(), mermaidPlugin({ theme: 'host' })], headingIds: true, headingAnchors: true });
  const renderMarkdown = options.renderMarkdown ?? (source => md.view(source, { slugPrefix: `user-content-${id}-` }));
  const controller = createAssistantController({
    ...options, aiStorage, aiChat,
    ledger: options.ledger ?? createLedger(), toolbox: options.toolbox ?? createToolbox(), getApp: () => app
  });
  app = createApp({
    state: { ai: { ...createAssistantState(aiStorage.read(), aiChat.read()), open: options.open ?? false }, presentation: { ...DEFAULT_PRESENTATION, ...presentation(options) } },
    actions: { ...ASSISTANT_ACTIONS, 'assistant/presentation': { patch: [{ op: 'replace', path: '/presentation', value: '$payload' }] } },
    view: {
      $jslt: '0.1', modes: { assistant: { unmatched: 'error' } }, rules: [
        { match: '$', body: ['section', { class: 'tangle-assistant', 'data-assistant-instance': id }, { $apply: ['$.ui.assistant', 'assistant'] }] },
        ...createAssistantRules(`${id}-models`),
      ]
    },
  }, {
    node, document: node?.ownerDocument, schedule: options.schedule, onError: options.onError,
    eventFields: formEventFields(), effects: controller.effects,
    afterRender: () => { if (node?.querySelectorAll) md.hydrate(node); },
    viewModel: (state: any) => ({
      ui: {
        assistant: {
          ...assistantView(state.ai, renderMarkdown), ...state.presentation,
          capabilities: state.presentation.capabilities.map((text: any) => ({ text }))
        }
      }
    }),
  });
  // A Markdown fragment belongs to this component, not to its host's hash router.
  function click(event: any) {
    const anchor = event.target.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#/')) return;
    event.preventDefault();
    let fragment; try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
    for (const target of node?.querySelectorAll('[id]') ?? []) {
      if (target.id === fragment) { target.scrollIntoView?.({ block: 'nearest' }); break; }
    }
  }
  node?.addEventListener('click', click);
  if (options.open) {
    controller.effects['ai-ensure-settings']({}, app.dispatch);
    controller.effects['ai-ledger-read']({}, app.dispatch);
  }
  return {
    controller,
    read: () => structuredClone(app.getState().ai),
    dispatch(action: any, payload: any = null, event: any = null) { if (!disposed) app.dispatch(action, payload, event); },
    subscribe(listener: any) { return app.subscribe((state: any) => listener(structuredClone(state.ai))); },
    /** Presentation updates retain the transcript, request and input node. */
    update(next: AssistantPresentation) {
      if (!disposed) app.dispatch('assistant/presentation', { ...app.getState().presentation, ...presentation(next) });
    },
    dispose() {
      if (disposed) return closing;
      disposed = true; node?.removeEventListener('click', click);
      closing = controller.dispose(); app.destroy(); return closing;
    },
  };
}
/** @param [options] */
export function createAssistantWidget(options: AssistantOptions = {}) {
  return {
    mount: (host: any, props: any) => mountAssistant(host, { ...options, ...props }),
    update: (handle: any, props: any) => handle.update(props), unmount: (handle: any) => handle.dispose()
  };
}

export type AssistantPresentation = {
  title?: string, launchLabel?: string, launchTitle?: string,
  intro?: string, capabilities?: string[], settingsHint?: string
 };
export type AssistantOptions = AssistantPresentation & Partial<Omit<Parameters<typeof createAssistantController>[0], 'getApp'>> & {
  settings?: any, transcript?: any, open?: boolean,
  schedule?: (flush: () => void) => void, onError?: (error: Error) => void,
  renderMarkdown?: (source: string) => any
 };
