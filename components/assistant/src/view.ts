/**
 * The assistant panel for a host that runs the assistant elsewhere: the host
 * reports its run as state, the view renders it with the panel's own rules and
 * catalogue and hands the person's intents back — start, cancel, open, close,
 * follow a link. It keeps no clock, request or poll of its own, and reaches no
 * model, agent or context module.
 */
import { createApp, formEventFields } from '@jarenjs/app';
import { assistantRoot, createAssistantViewRules } from './views.ts';
import { assistantText, assistantTranscript } from './viewmodel.ts';
import { createAssistantMessages, type AssistantCatalogue, type AssistantMessages } from './messages.ts';
import { defaultPresentation, instanceId, keepFragments, presentation, replyMarkdown } from './mount.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type AssistantViewStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AssistantViewState = {
  status: AssistantViewStatus, runId?: string | null,
  messages: { role: 'user' | 'assistant', content: string }[], pending?: string,
  progress?: { stage?: string, step?: number } | null, links?: { id: string, label: string }[],
  notice?: string | null, error?: string | null, conversation?: Json,
};
export type AssistantViewIntent = { type: 'open' } | { type: 'close' } | { type: 'link', id: string };
export type AssistantViewTransport = {
  start(message: string, context: { conversation: Json, signal: AbortSignal }): string | Promise<string>;
  cancel(runId: string): void | Promise<void>;
};
export type AssistantViewOptions = {
  transport: AssistantViewTransport, state: AssistantViewState,
  messages?: AssistantCatalogue | AssistantMessages, onIntent?: (intent: AssistantViewIntent) => void,
  title?: string, launchLabel?: string, launchTitle?: string, intro?: string, capabilities?: string[],
  open?: boolean, renderMarkdown?: (source: string) => any,
  schedule?: (flush: () => void) => void, onError?: (error: Error) => void,
};
export type AssistantViewSnapshot = {
  state: Required<AssistantViewState>, open: boolean, draft: string,
  starting: boolean, startError: string | null, cancelling: boolean, cancelError: string | null,
};

const STATUSES = ['idle', 'running', 'succeeded', 'failed', 'cancelled'];
const MEMBERS = ['status', 'runId', 'messages', 'pending', 'progress', 'links', 'notice', 'error', 'conversation'];

const refuse = (member: string, expected: string): never => { throw new TypeError(`assistant view state: ${member} must be ${expected}`); };
function closed(value: unknown, member: string, members: string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse(member, 'an object');
  for (const key of Object.keys(value as object))
    if (!members.includes(key)) throw new TypeError(`assistant view state: unknown member ${member === 'state' ? key : `${member}.${key}`}`);
  return value as Record<string, unknown>;
}
const string = (value: unknown, member: string) => typeof value === 'string' ? value : refuse(member, 'a string');
const nullable = (value: unknown, member: string) => value === undefined || value === null ? null : string(value, member);
function isJson(value: unknown, ancestors: unknown[] = []): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.includes(value)) return false;
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.values(value).every(item => isJson(item, [...ancestors, value]));
}
/** The host's report, checked member by member and copied; a malformed one is a caller bug. @param value */
function checkState(value: unknown): Required<AssistantViewState> {
  const state = closed(value, 'state', MEMBERS);
  if (!STATUSES.includes(state.status as string)) refuse('status', STATUSES.map(name => `'${name}'`).join(' | '));
  if (!Array.isArray(state.messages)) refuse('messages', 'an array');
  const messages = (state.messages as unknown[]).map((turn, i) => {
    const { role, content } = closed(turn, `messages[${i}]`, ['role', 'content']);
    if (role !== 'user' && role !== 'assistant') refuse(`messages[${i}].role`, "'user' | 'assistant'");
    return { role: role as 'user' | 'assistant', content: string(content, `messages[${i}].content`) };
  });
  if (state.links !== undefined && !Array.isArray(state.links)) refuse('links', 'an array');
  const links = ((state.links ?? []) as unknown[]).map((link, i) => {
    const { id, label } = closed(link, `links[${i}]`, ['id', 'label']);
    return { id: string(id, `links[${i}].id`), label: string(label, `links[${i}].label`) };
  });
  let progress: { stage?: string, step?: number } | null = null;
  if (state.progress !== undefined && state.progress !== null) {
    const { stage, step } = closed(state.progress, 'progress', ['stage', 'step']);
    progress = {};
    if (stage !== undefined) progress.stage = string(stage, 'progress.stage');
    if (step !== undefined) progress.step = Number.isSafeInteger(step) && (step as number) >= 0 ? step as number : refuse('progress.step', 'a whole number of at least 0');
  }
  if (state.conversation !== undefined && !isJson(state.conversation)) refuse('conversation', 'JSON');
  return {
    status: state.status as AssistantViewStatus, runId: nullable(state.runId, 'runId'), messages,
    pending: state.pending === undefined ? '' : string(state.pending, 'pending'), progress, links,
    notice: nullable(state.notice, 'notice'), error: nullable(state.error, 'error'),
    conversation: state.conversation === undefined ? null : structuredClone(state.conversation as Json),
  };
}

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const ACTIONS = {
  'ai/toggle': { patch: [{ op: 'replace', path: '/local/open', value: { $not: '$.local.open' } }], effects: [{ run: 'view-toggled' }] },
  'ai/draft': { patch: [{ op: 'replace', path: '/local/draft', value: '$event.value' }] },
  'ai/send': { effects: [{ run: 'view-start' }] },
  'ai/cancel': { effects: [{ run: 'view-cancel' }] },
  'view/link': { effects: [{ run: 'view-intent', with: { type: 'link', id: '$payload.id' } }] },
  'view/starting': { patch: [{ op: 'replace', path: '/local/starting', value: true }, { op: 'replace', path: '/local/startError', value: null }] },
  'view/started': { patch: [{ op: 'replace', path: '/local/starting', value: false }, { op: 'replace', path: '/local/draft', value: '' }] },
  'view/start-failed': { patch: [{ op: 'replace', path: '/local/starting', value: false }, { op: 'replace', path: '/local/startError', value: '$payload' }] },
  'view/cancelling': { patch: [{ op: 'replace', path: '/local/cancelling', value: true }, { op: 'replace', path: '/local/cancelError', value: null }] },
  'view/cancel-failed': { patch: [{ op: 'replace', path: '/local/cancelling', value: false }, { op: 'replace', path: '/local/cancelError', value: '$payload' }] },
  'view/host': { patch: [{ op: 'replace', path: '/host', value: '$payload' }, { op: 'replace', path: '/local/cancelling', value: false }] },
};

/** The projection: the shared parts from the panel's projection, the run as the host reported it. */
function project({ host, local, presentation: shown }: any, messages: AssistantMessages, renderMarkdown: (source: string) => any) {
  const running = host.status === 'running';
  // what the view is doing outranks what the host last reported
  const status = local.cancelling ? 'cancelling' : local.starting ? 'starting' : host.status;
  return {
    text: assistantText(messages), ...shown, capabilities: shown.capabilities.map((text: string) => ({ text })),
    open: local.open, draft: local.draft,
    empty: host.messages.length === 0 && host.pending === '',
    messages: assistantTranscript(host.messages, renderMarkdown), pending: host.pending,
    busy: local.starting || running, cancellable: running && host.runId !== null, cancelling: local.cancelling,
    statusLabel: messages[`view/status/${status}` as 'view/status/running'](),
    progressLabel: host.progress === null ? '' : messages['view/progress'](host.progress),
    hasLinks: host.links.length > 0, links: host.links, notice: host.notice ?? '',
    error: host.error ? messages['error/detail']({ detail: host.error }) : '',
    startError: local.startError === null ? '' : messages['view/start-failed']({ detail: local.startError }),
    cancelError: local.cancelError === null ? '' : messages['view/cancel-failed']({ detail: local.cancelError }),
  };
}

/** @param node @param options */
export function mountAssistantView(node: HTMLElement | null, options: AssistantViewOptions) {
  const messages = createAssistantMessages(options.messages);
  const transport = options.transport;
  if (typeof transport?.start !== 'function' || typeof transport.cancel !== 'function')
    throw new TypeError('assistant view: transport must have start and cancel functions');
  const host = checkState(options.state);
  const id = instanceId(), md = replyMarkdown(id, messages), renderMarkdown = options.renderMarkdown ?? md.render;
  // the person leaving is not a cancellation: disposal aborts a start in
  // flight and never cancels the host's run
  const lifetime = new AbortController();
  let app: any, disposed = false, closing: Promise<void> | undefined, starting = false, cancelling = false;
  const effects = {
    'view-start': (_props: unknown, dispatch: any) => {
      const state = app.getState(), message = state.local.draft.trim();
      if (starting || message === '' || state.host.status === 'running') return;
      starting = true; dispatch('view/starting');
      const settle = (action: string, payload: unknown = null) => { starting = false; if (!disposed) dispatch(action, payload); };
      let run;
      try { run = transport.start(message, { conversation: state.host.conversation, signal: lifetime.signal }); }
      catch (error) { settle('view/start-failed', reason(error)); return; }
      Promise.resolve(run).then(() => settle('view/started'), error => settle('view/start-failed', reason(error)));
    },
    'view-cancel': (_props: unknown, dispatch: any) => {
      const { status, runId } = app.getState().host;
      if (cancelling || status !== 'running' || runId === null) return;
      cancelling = true; dispatch('view/cancelling');
      const failed = (error: unknown) => { cancelling = false; if (!disposed) dispatch('view/cancel-failed', reason(error)); };
      try { Promise.resolve(transport.cancel(runId)).catch(failed); } catch (error) { failed(error); }
    },
    'view-toggled': () => options.onIntent?.({ type: app.getState().local.open ? 'open' : 'close' }),
    'view-intent': (intent: AssistantViewIntent) => options.onIntent?.(intent),
  };
  app = createApp({
    state: {
      host, local: { open: options.open ?? false, draft: '', starting: false, startError: null, cancelling: false, cancelError: null },
      presentation: { ...defaultPresentation(messages), ...presentation(options) },
    },
    actions: ACTIONS,
    view: { $jslt: '0.1', modes: { assistant: { unmatched: 'error' } }, rules: [assistantRoot(id), ...createAssistantViewRules()] },
  }, {
    node, document: node?.ownerDocument, schedule: options.schedule, onError: options.onError,
    eventFields: formEventFields(), effects,
    afterRender: () => md.hydrate(node),
    viewModel: (state: any) => ({ ui: { assistant: project(state, messages, renderMarkdown) } }),
  });
  const detach = keepFragments(node);
  return {
    /** Replace the host's report; a cancel in flight is answered by it. */
    update(state: AssistantViewState) {
      if (disposed) return;
      const next = checkState(state);
      cancelling = false; app.dispatch('view/host', next);
    },
    read: (): AssistantViewSnapshot => {
      const { host, local } = app.getState();
      return structuredClone({ state: host, ...local });
    },
    dispose(): Promise<void> {
      if (disposed) return closing!;
      disposed = true; lifetime.abort(); detach(); app.destroy();
      return closing = Promise.resolve();
    },
  };
}
/** The app widget contract: mount with options and props, `update` with `{ state }`. @param [options] */
export function createAssistantViewWidget(options: Partial<AssistantViewOptions> = {}) {
  return {
    mount: (host: any, props: any) => mountAssistantView(host, { ...options, ...props }),
    update: (handle: any, props: any) => handle.update(props.state), unmount: (handle: any) => handle.dispose(),
  };
}
