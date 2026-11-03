import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mountAssistantView, createAssistantViewWidget, type AssistantViewState } from '@tangleai/assistant/view';
import { nl } from '@tangleai/assistant/messages/nl';
import { ar } from '@tangleai/assistant/messages/ar';
import { createStubHost, fire, serialize } from './dom.stub.ts';

const IDLE: AssistantViewState = { status: 'idle', messages: [] };
const RUNNING: AssistantViewState = { status: 'running', runId: 'run-1', messages: [{ role: 'user', content: 'Plan the week' }] };
const TRANSPORT = { start: () => 'run', cancel: () => {} };
const find = (node: any, predicate: any): any => predicate(node) ? node : (node.childNodes ?? []).map((child: any) => find(child, predicate)).find(Boolean);
const button = (container: any, text: string) => find(container, (n: any) => n.tagName === 'button' && serialize(n).includes(text));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function type(container: any, text: string) {
  const area = find(container, (n: any) => n.tagName === 'textarea');
  area.value = text; fire(area, 'input');
}
const submit = (container: any) => fire(find(container, (n: any) => n.tagName === 'form'), 'submit');
/** A JSON document of `depth` nested objects. @param depth */
function deep(depth: number) { let value: any = null; for (let i = 0; i < depth; i++) value = { inner: value }; return value; }
function mounted(t: any, options: Record<string, any> = {}) {
  const { container } = createStubHost();
  const started: any[] = [], cancelled: string[] = [], intents: any[] = [];
  const handle = mountAssistantView(container as any, {
    state: IDLE, open: true, schedule: fn => fn(), onError: error => { throw error; }, onIntent: intent => { intents.push(intent); }, ...options,
    transport: {
      start: (message, context) => { started.push({ message, context }); return options.start ? options.start(message, context) : 'run-1'; },
      cancel: runId => { cancelled.push(runId); return options.cancel?.(runId); },
    },
  });
  t.after(() => handle.dispose());
  return { container, handle, started, cancelled, intents };
}

it('a submit starts one run with the draft, the conversation and a signal', async t => {
  let resolve!: (id: string) => void;
  const view = mounted(t, { state: { ...IDLE, conversation: { id: 'c-1' } }, start: () => new Promise<string>(done => { resolve = done; }) });
  assert.match(serialize(view.container), /role="status">Ready for a new run\.<\/p>/, 'every status has a line');
  type(view.container, '   '); submit(view.container);
  assert.equal(view.started.length, 0, 'an empty draft starts nothing');
  type(view.container, '  Plan the week  '); submit(view.container);
  assert.equal(view.started.length, 1);
  assert.equal(view.started[0].message, 'Plan the week');
  assert.deepEqual(view.started[0].context.conversation, { id: 'c-1' });
  assert.equal(view.started[0].context.signal.aborted, false);
  assert.equal(view.handle.read().starting, true);
  assert.match(serialize(view.container), /disabled="disabled">…<\/button>/);
  assert.match(serialize(view.container), /<p class="ai-status" role="status">Starting the run…<\/p>/);
  submit(view.container);
  assert.equal(view.started.length, 1, 'a second submit while starting does nothing');
  resolve('run-1'); await settle();
  assert.deepEqual([view.handle.read().starting, view.handle.read().draft], [false, '']);
  view.handle.update(RUNNING); type(view.container, 'Again'); submit(view.container);
  assert.equal(view.started.length, 1, 'a submit while the host reports a run does nothing');
  view.handle.update({ ...RUNNING, status: 'succeeded' }); submit(view.container);
  assert.equal(view.started.length, 2);
});

it('a refused start shows the framed reason and keeps the draft', async t => {
  const view = mounted(t, { start: () => Promise.reject(new Error('quota reached')) });
  type(view.container, 'Plan the week'); submit(view.container); await settle();
  const { starting, draft, startError } = view.handle.read();
  assert.deepEqual({ starting, draft, startError }, { starting: false, draft: 'Plan the week', startError: 'quota reached' });
  assert.match(serialize(view.container), /<p class="ai-error">The run could not be started: quota reached<\/p>/);
  let attempts = 0;
  const thrown = mounted(t, { start: () => { if (attempts++ === 0) throw new Error('offline'); return 'run-2'; } });
  type(thrown.container, 'Plan the week'); submit(thrown.container);
  assert.equal(thrown.handle.read().startError, 'offline', 'a start that throws is refused the same way');
  submit(thrown.container); await settle();
  assert.equal(thrown.handle.read().startError, null, 'the next start clears the reason');
});

it('cancel asks the host once per report, only while it reports a run with an id', async t => {
  const view = mounted(t, { state: { ...RUNNING, runId: null } });
  assert.equal(button(view.container, 'Cancel'), undefined, 'no run id, no cancel control');
  view.handle.update(RUNNING);
  fire(button(view.container, 'Cancel'), 'click'); fire(button(view.container, 'Cancel'), 'click');
  assert.deepEqual(view.cancelled, ['run-1']);
  assert.equal(button(view.container, 'Cancel').attributes.get('disabled'), 'disabled');
  assert.match(serialize(view.container), /role="status">Cancelling the run…<\/p>/, 'cancelling outranks the reported run');
  assert.equal(view.handle.read().state.status, 'running', 'the view never sets the status');
  view.handle.update({ ...RUNNING, progress: { step: 2 } });
  assert.equal(button(view.container, 'Cancel').attributes.get('disabled'), undefined, 'the next report enables it again');
  fire(button(view.container, 'Cancel'), 'click');
  assert.deepEqual(view.cancelled, ['run-1', 'run-1']);
  const refused = mounted(t, { state: RUNNING, cancel: () => Promise.reject(new Error('already finished')) });
  fire(button(refused.container, 'Cancel'), 'click'); await settle();
  assert.equal(refused.handle.read().cancelling, false);
  assert.match(serialize(refused.container), /<p class="ai-error">The run could not be cancelled: already finished<\/p>/);
});

it('links and the launcher report intents and navigate nowhere', t => {
  const view = mounted(t, { open: false, state: { ...RUNNING, status: 'succeeded', links: [{ id: 'proposal-7', label: 'Review the proposal' }] } });
  fire(find(view.container, (n: any) => n.attributes?.get('class') === 'ai-launch'), 'click');
  fire(button(view.container, 'Review the proposal'), 'click');
  fire(find(view.container, (n: any) => n.attributes?.get('aria-label') === 'Close assistant'), 'click');
  assert.deepEqual(view.intents, [{ type: 'open' }, { type: 'link', id: 'proposal-7' }, { type: 'close' }]);
  assert.equal(view.handle.read().open, false);
  fire(find(view.container, (n: any) => n.attributes?.get('class') === 'ai-launch'), 'click');
  assert.match(serialize(view.container), /role="status">The assistant finished this run\.<\/p>/);
});

it('update replaces the host report and renders it as data', async t => {
  const report = {
    status: 'running', runId: 'run-1', messages: [{ role: 'user', content: 'Plan the week' }], pending: '**partial**',
    progress: { step: 2, stage: 'Reading orders' }, links: [{ id: 'orders', label: 'Open orders' }], notice: 'Using last week',
  } satisfies AssistantViewState;
  const view = mounted(t, { state: report });
  let html = serialize(view.container);
  assert.match(html, /<p>\*\*partial\*\*<\/p>/, 'the pending reply is plain text');
  for (const shown of ['Working…', 'Step 2 — Reading orders', 'Open orders', 'Using last week']) assert.ok(html.includes(shown), shown);
  report.notice = 'changed after the report';
  assert.doesNotMatch(serialize(view.container), /changed after/, 'the view keeps a copy');
  view.handle.update({ status: 'failed', messages: [...report.messages, { role: 'assistant', content: '## Plan\n\n**Half** done' }], error: 'Upstream timeout' });
  await settle(); html = serialize(view.container);
  assert.match(html, /<strong>Half<\/strong>/, 'assistant turns render as Markdown');
  assert.match(html, /id="user-content-tangle-assistant-\d+-plan"/, 'reply headings carry the instance prefix');
  assert.doesNotMatch(html, /partial|Reading orders|Open orders|Using last week/, 'nothing merges from the earlier report');
  assert.match(html, /The assistant could not finish this run\./);
  assert.match(html, /<p class="ai-error">Upstream timeout<\/p>/);
  assert.deepEqual(view.handle.read().state, {
    status: 'failed', runId: null, messages: [...report.messages, { role: 'assistant', content: '## Plan\n\n**Half** done' }],
    pending: '', progress: null, links: [], notice: null, error: 'Upstream timeout', conversation: null,
  });
});

it('a malformed report is refused with the member it breaks, at mount and at update', t => {
  const cases: [unknown, RegExp][] = [
    [null, /state must be a plain object/],
    [Object.assign(Object.create({ status: 'idle' }), { messages: [] }), /state must be a plain object/],
    [{ status: 'done', messages: [] }, /status must be 'idle' \| 'running'/],
    [{ status: 'idle' }, /messages must be an array/],
    [{ status: 'idle', messages: [{ role: 'system', content: 'x' }] }, /messages\[0\]\.role must be/],
    [{ status: 'idle', messages: [{ role: 'user', content: 7 }] }, /messages\[0\]\.content must be a string/],
    [{ status: 'idle', messages: [], usage: {} }, /unknown member usage/],
    [{ status: 'idle', messages: [], links: [{ id: 'a', label: 'A', href: '/a' }] }, /unknown member links\[0\]\.href/],
    [{ status: 'idle', messages: [], progress: { step: 1.5 } }, /progress\.step must be a whole number/],
    [{ status: 'idle', messages: [], progress: { step: -1 } }, /progress\.step must be a whole number/],
    [{ status: 'idle', messages: [], runId: '' }, /runId must be a non-empty string/],
    [{ status: 'idle', messages: [], conversation: deep(65) }, /conversation must be JSON at most 64 levels deep/],
    [{ status: 'idle', messages: [], conversation: deep(20000) }, /conversation must be JSON at most 64 levels deep/],
    [{ status: 'idle', messages: [], runId: 7 }, /runId must be a non-empty string/],
    [{ status: 'idle', messages: [], conversation: { seen: new Map() } }, /conversation must be JSON/],
  ];
  const refused = (pattern: RegExp) => (error: any) => error instanceof TypeError && pattern.test(error.message);
  const { container } = createStubHost();
  for (const [state, pattern] of cases) assert.throws(() => mountAssistantView(container as any, { transport: TRANSPORT, state: state as any }), refused(pattern));
  assert.throws(() => mountAssistantView(container as any, { transport: {} as any, state: IDLE }), refused(/transport must have start and cancel/));
  assert.equal(container.childNodes.length, 0, 'a refused mount renders nothing');
  const view = mounted(t);
  for (const [state, pattern] of cases) assert.throws(() => view.handle.update(state as any), refused(pattern));
  assert.equal(view.handle.read().state.status, 'idle');
  view.handle.update({ status: 'idle', messages: [], conversation: deep(64) });
  assert.deepEqual(view.handle.read().state.conversation, deep(64), 'the bound is exact on every engine');
});

it('disposal aborts a start in flight, removes DOM and listeners once, and never cancels the run', async t => {
  let signal: AbortSignal | undefined;
  const view = mounted(t, { start: (_message: string, context: any) => { signal = context.signal; return new Promise(() => {}); } });
  type(view.container, 'Plan the week'); submit(view.container);
  view.handle.update(RUNNING);
  assert.equal(view.container.listeners.get('click')!.size, 1);
  const first = view.handle.dispose();
  assert.equal(view.handle.dispose(), first); await first;
  assert.equal(signal!.aborted, true);
  assert.deepEqual(view.cancelled, []);
  assert.equal(view.container.childNodes.length, 0); assert.equal(view.container.listeners.get('click')!.size, 0);
  const before = view.handle.read();
  view.handle.update({ ...RUNNING, status: 'succeeded' }); view.handle.update(null as any);
  assert.deepEqual(view.handle.read(), before);
});

it('supports the app widget mount/update/unmount contract', async () => {
  const { container } = createStubHost();
  const widget = createAssistantViewWidget({ transport: TRANSPORT, schedule: fn => fn() });
  const handle = widget.mount(container, { state: IDLE, open: true, title: 'Orders desk' });
  assert.match(serialize(container), /Orders desk/);
  widget.update(handle, { state: { ...IDLE, notice: 'Synced' } }); assert.match(serialize(container), /Synced/);
  await widget.unmount(handle); assert.equal(container.childNodes.length, 0);
});

it('renders every sentence from the catalogue it is given, behind explicit presentation', t => {
  const view = mounted(t, { messages: nl, title: 'Bestellingen', state: { ...RUNNING, progress: { step: 1234, stage: 'Orders lezen' } } });
  const html = serialize(view.container);
  for (const shown of ['Bestellingen', 'Bezig…', 'Stap 1.234 — Orders lezen', 'Annuleren', 'Vraag het de assistent…']) assert.ok(html.includes(shown), shown);
  assert.throws(() => mountAssistantView(null, { transport: TRANSPORT, state: IDLE, messages: { 'view/unknown': 'x' } as any }), /unknown assistant message key: view\/unknown/);
});

it('an Arabic view lays out right to left from its own root', t => {
  const view = mounted(t, { messages: ar, lang: 'ar', dir: 'rtl', state: { ...RUNNING, progress: { step: 1234, stage: 'قراءة الطلبات' } } });
  const root = find(view.container, (n: any) => n.tagName === 'section').attributes;
  assert.deepEqual([root.get('lang'), root.get('dir')], ['ar', 'rtl']);
  const html = serialize(view.container);
  for (const shown of ['جارٍ العمل…', 'الخطوة 1,234 — قراءة الطلبات', 'إلغاء']) assert.ok(html.includes(shown), shown);
  assert.throws(() => mountAssistantView(null, { transport: TRANSPORT, state: IDLE, dir: 'rtl ' as any }), /dir must be 'ltr', 'rtl' or 'auto'/);
});

it('a cancel refusal counts only for the report it was asked under, and only for its own run', async t => {
  const refusals: ((error: Error) => void)[] = [];
  const view = mounted(t, { state: RUNNING, cancel: () => new Promise<void>((_done, reject) => { refusals.push(reject); }) });
  const cancel = () => fire(button(view.container, 'Cancel'), 'click');
  cancel(); view.handle.update(RUNNING); cancel();
  refusals[0]!(new Error('request timed out')); await settle();
  assert.equal(view.handle.read().cancelling, true, 'the second cancel is still in flight');
  assert.doesNotMatch(serialize(view.container), /could not be cancelled/);
  cancel();
  assert.deepEqual(view.cancelled, ['run-1', 'run-1'], 'no third cancel while the second is in flight');
  view.handle.update({ ...RUNNING, status: 'cancelled' }); refusals[1]!(new Error('too late')); await settle();
  assert.doesNotMatch(serialize(view.container), /could not be cancelled/);
  const other = mounted(t, { state: RUNNING, cancel: () => Promise.reject(new Error('already finished')) });
  fire(button(other.container, 'Cancel'), 'click'); await settle();
  other.handle.update(RUNNING);
  assert.match(serialize(other.container), /could not be cancelled: already finished/, 'the same run still running keeps the reason');
  other.handle.update({ ...RUNNING, runId: 'run-2' });
  assert.doesNotMatch(serialize(other.container), /could not be cancelled/, 'another run does not inherit it');
});

it('a report of the running run settles a start in flight, and text typed meanwhile stays', async t => {
  let resolve!: (id: string) => void;
  const view = mounted(t, { start: () => new Promise<string>(done => { resolve = done; }) });
  type(view.container, 'Plan the week'); submit(view.container);
  view.handle.update(RUNNING);
  assert.deepEqual([view.handle.read().starting, view.handle.read().draft], [false, '']);
  assert.match(serialize(view.container), /role="status">Working…<\/p>/);
  resolve('run-1'); await settle();
  assert.deepEqual([view.handle.read().starting, view.handle.read().draft], [false, '']);
  let finish!: (id: string) => void;
  const second = mounted(t, { start: () => new Promise<string>(done => { finish = done; }) });
  type(second.container, 'First'); submit(second.container);
  type(second.container, 'Second thought');
  finish('run-9'); await settle();
  assert.deepEqual([second.handle.read().starting, second.handle.read().draft], [false, 'Second thought']);
});

it('a refusal without a reason reads as a whole sentence', async t => {
  const cases: [unknown, string][] = [[{}, 'The run could not be started.'], [undefined, 'The run could not be started.'],
    [new Error(''), 'The run could not be started.'], ['offline', 'The run could not be started: offline']];
  for (const [refusal, shown] of cases) {
    const view = mounted(t, { start: () => Promise.reject(refusal) });
    type(view.container, 'Plan'); submit(view.container); await settle();
    assert.ok(serialize(view.container).includes(`<p class="ai-error">${shown}</p>`), shown);
  }
});

it('a report is read once and kept apart from the host and the transport', t => {
  let reads = 0;
  const report = { messages: [], get status() { reads++; return reads === 1 ? 'running' : 'bogus'; }, runId: 'run-1', conversation: { id: 'c-1' } };
  const caps = ['Plan orders'];
  const view = mounted(t, { state: report, capabilities: caps, title: undefined, start: (_message: string, context: any) => { context.conversation.id = 'changed'; return 'run-2'; } });
  assert.deepEqual([view.handle.read().state.status, reads], ['running', 1]);
  caps.push('Injected');
  view.handle.update({ status: 'idle', messages: [], conversation: { id: 'c-1' } });
  type(view.container, 'Plan'); submit(view.container);
  assert.equal(view.handle.read().state.conversation && (view.handle.read().state.conversation as any).id, 'c-1', 'the transport gets a copy');
  const html = serialize(view.container);
  assert.doesNotMatch(html, /Injected/, 'presentation is copied at mount');
  assert.match(html, /<span class="ai-title">Assistant<\/span>|>Assistant</, 'a title passed as undefined keeps its default');
  const zero = mounted(t, { state: { ...RUNNING, progress: { step: -0 } } });
  assert.ok(Object.is(zero.handle.read().state.progress!.step, 0));
  assert.match(serialize(zero.container), /Step 0</);
  const unknown = mounted(t, { lang: '' });
  assert.equal(find(unknown.container, (n: any) => n.tagName === 'section').attributes.get('lang'), '', 'an empty lang is HTML\'s unknown language');
});
