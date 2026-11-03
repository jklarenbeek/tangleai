/** The visual assistant owns one app, its request lifecycle and its DOM listeners. */
import { createApp, formEventFields } from '@jarenjs/app';
import { createLedger } from '@tangleai/context';
import { createToolbox } from '@tangleai/agents';
import { createAssistantState, createAssistantController, ASSISTANT_ACTIONS } from './index.ts';
import { assistantRoot, createAssistantRules } from './views.ts';
import { assistantView } from './viewmodel.ts';
import { PROVIDER_OPTIONS } from './settings.ts';
import { createAssistantMessages } from './messages.ts';
import { defaultPresentation, instanceId, keepFragments, presentation, replyMarkdown } from './mount.ts';

/** @param node @param [options] */
export function mountAssistant(node: HTMLElement | null, options: AssistantOptions = {}) {
  const messages = createAssistantMessages(options.messages);
  let app: any, disposed = false, closing: any;
  const id = instanceId();
  let settings = options.settings ?? null, transcript = options.transcript ?? null;
  const aiStorage = options.aiStorage ?? { read: () => settings, write: (value: any) => { settings = structuredClone(value); } };
  const aiChat = options.aiChat ?? { read: () => transcript, write: (value: any) => { transcript = structuredClone(value); } };
  const md = replyMarkdown(id, messages), renderMarkdown = options.renderMarkdown ?? md.render;
  const controller = createAssistantController({
    ...options, messages, aiStorage, aiChat,
    ledger: options.ledger ?? createLedger(), toolbox: options.toolbox ?? createToolbox(), getApp: () => app
  });
  app = createApp({
    state: { ai: { ...createAssistantState(aiStorage.read(), aiChat.read()), open: options.open ?? false }, presentation: { ...defaultPresentation(messages), ...presentation(options) } },
    actions: { ...ASSISTANT_ACTIONS, 'assistant/presentation': { patch: [{ op: 'replace', path: '/presentation', value: '$payload' }] } },
    view: {
      $jslt: '0.1', modes: { assistant: { unmatched: 'error' } }, rules: [
        assistantRoot(id),
        ...createAssistantRules(`${id}-models`),
      ]
    },
  }, {
    node, document: node?.ownerDocument, schedule: options.schedule, onError: options.onError,
    eventFields: formEventFields(), effects: controller.effects,
    afterRender: () => md.hydrate(node),
    viewModel: (state: any) => ({
      ui: {
        assistant: {
          ...assistantView(state.ai, renderMarkdown, messages, PROVIDER_OPTIONS), ...state.presentation,
          capabilities: state.presentation.capabilities.map((text: any) => ({ text }))
        }
      }
    }),
  });
  const detach = keepFragments(node);
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
      disposed = true; detach();
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
