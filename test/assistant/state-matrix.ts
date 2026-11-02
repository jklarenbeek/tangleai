/**
 * Every assistant panel state that renders text, reached through the mounted
 * component with injected settings, transcript, ledger and transport. Text a
 * host, a model or a store supplies is a sentinel `‹h:name›` (`‹h:error-…›` for
 * failures the assistant did not write), so the census can tell it apart.
 */
import { createLedger } from '@tangleai/context';
import { mountAssistant } from '@tangleai/assistant/component';
import { createStubHost } from './dom.stub.ts';

export const CONFIGURED = { provider: 'ollama', baseUrl: '', model: 'fixture', apiKey: '' };
const UNCONFIGURED = { provider: 'openrouter', baseUrl: '', model: '', apiKey: '' };
const PROBING = { provider: 'openrouter', baseUrl: '', model: '', apiKey: 'sk-fixture' };
const HOST_PRESENTATION = {
  title: '‹h:title›', launchLabel: '‹h:launch-label›', launchTitle: '‹h:launch-title›',
  intro: '‹h:intro›', capabilities: ['‹h:capability-1›', '‹h:capability-2›'], settingsHint: '‹h:settings-hint›',
};

const sse = (chunks: unknown[]) => chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
const turn = (delta: Record<string, string>) => sse([{ choices: [{ delta: { role: 'assistant', ...delta } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const refinement = (patch: unknown[]) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(patch) } }] });
const reply = (body: string) => Promise.resolve(new Response(body, { status: 200 }));
/** A request that only ends when the panel is disposed. */
const hanging = (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init.signal?.addEventListener('abort', () => reject(new Error('disposed')), { once: true });
});
/** A provider refusal the transport does not retry, so no backoff clock runs. */
const refused = (body: string) => () => Promise.resolve(new Response(body, { status: 400 }));
/** Answers each request with the next scripted reply; the last one answers every later request. */
function script(...replies: ((url: unknown, init: RequestInit) => Promise<Response>)[]) {
  return (url: unknown, init: RequestInit) => (replies.length > 1 ? replies.shift()! : replies[0]!)(url, init);
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

/** A ledger reduced to the reads the panel makes. */
function ledgerView(view: { goal?: any, memories?: number, archived?: number, persistence?: any, retention?: any, setGoal?: () => Promise<any> } = {}) {
  return {
    getGoal: async () => view.goal ? { status: 'active', progress: [], ...view.goal } : null,
    listSlots: async () => Array.from({ length: view.archived ?? 0 }, (_, i) => ({ name: `round-${i}`, kind: 'agent-round' })),
    listMemories: async () => Array.from({ length: view.memories ?? 0 }, (_, i) => ({ text: `‹h:memory-${i + 1}›` })),
    storageStatus: () => view.persistence ?? null,
    retentionReport: async () => view.retention ?? null,
    setGoal: view.setGoal ?? (async () => ({ error: 'unscripted goal' })),
  };
}
const progress = (count: number) => Array.from({ length: count }, (_, i) => ({ at: '2026-01-01T00:00:00.000Z', note: `‹h:note-${i + 1}›`, evidence: `‹h:evidence-${i + 1}›` }));
const tokens = (name: string, count: number) => Array.from({ length: count }, (_, i) => `‹h:${name}-${i + 1}›`);

async function mount(options: Record<string, any> = {}) {
  const { container } = createStubHost();
  const handle = mountAssistant(container as any, { schedule: fn => fn(), onError: error => { throw error; }, ...options });
  await settle();
  return { container, handle };
}
type Mounted = Awaited<ReturnType<typeof mount>>;
async function type(mounted: Mounted, action: string, value: string, payload: unknown = null) {
  mounted.handle.dispatch(action, payload, { target: { value } }); await settle();
}
async function send(mounted: Mounted, question = '‹h:question›') {
  await type(mounted, 'ai/draft', question);
  mounted.handle.dispatch('ai/send');
  for (let i = 0; i < 50 && mounted.handle.read().status === 'streaming'; i++) await settle();
}
async function step(mounted: Mounted, action: string, payload: unknown = null) { mounted.handle.dispatch(action, payload); await settle(); return mounted; }
async function withGoal() {
  const ledger = createLedger();
  await ledger.setGoal({ objective: '‹h:objective›' });
  return ledger;
}
/** A configured panel with a goal and one finished turn, so a refinement has a run to read. */
async function afterTurn(...refinements: ((url: unknown, init: RequestInit) => Promise<Response>)[]) {
  const mounted = await mount({ settings: CONFIGURED, open: true, ledger: await withGoal(), aiFetch: script(() => reply(turn({ content: '‹h:answer›' })), ...refinements) });
  await send(mounted);
  return mounted;
}
async function remember(mounted: Mounted) {
  mounted.handle.dispatch('ai/remember');
  for (let i = 0; i < 50 && mounted.handle.read().remembering; i++) await settle();
  return mounted;
}
const streaming = async () => step(await mount({ settings: CONFIGURED, open: true, ledger: ledgerView() }), 'ai/user', '‹h:question›');

export const ASSISTANT_STATES: { name: string, render: () => Promise<Mounted> }[] = [
  { name: 'launcher closed', render: () => mount() },
  { name: 'launcher open, unconfigured', render: () => mount({ open: true, ledger: ledgerView() }) },
  { name: 'unconfigured local provider', render: () => mount({ open: true, settings: { ...CONFIGURED, model: '' }, ledger: ledgerView() }) },
  { name: 'host presentation', render: async () => step(await mount({ ...HOST_PRESENTATION, settings: CONFIGURED, open: true, ledger: ledgerView() }), 'ai/settings-toggle') },
  { name: 'probe busy', render: async () => step(await mount({ settings: PROBING, open: true, ledger: ledgerView(), aiFetch: hanging }), 'ai/probe') },
  ...[1, 3].map(count => ({ name: `probe ok, ${count} model${count === 1 ? '' : 's'}`, render: async () => step(await mount({
    settings: PROBING, open: true, ledger: ledgerView(),
    aiFetch: () => reply(JSON.stringify({ data: tokens('model', count).map(id => ({ id })) })),
  }), 'ai/probe') })),
  { name: 'probe failed', render: async () => step(await mount({ settings: PROBING, open: true, ledger: ledgerView(), aiFetch: () => Promise.reject(new Error('‹h:error-probe›')) }), 'ai/probe') },
  { name: 'configured, empty', render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView(), capabilities: tokens('capability', 2) }) },
  { name: 'goal form with a draft', render: async () => { const mounted = await mount({ settings: CONFIGURED, open: true, ledger: ledgerView() }); await type(mounted, 'ai/goal-draft', '‹h:objective›'); return mounted; } },
  ...[1, 4, 5].map(count => ({ name: `goal, ${count} progress entr${count === 1 ? 'y' : 'ies'}`, render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ goal: { objective: '‹h:objective›', progress: progress(count) } }) }) })),
  ...[1, 3].map(count => ({ name: `goal, checkpoint of ${count} source${count === 1 ? '' : 's'}`, render: () => mount({
    settings: CONFIGURED, open: true, ledger: ledgerView({ goal: { objective: '‹h:objective›', progress: progress(1), checkpoint: { sources: tokens('source', count) } } }),
  }) })),
  ...[1, 2].map(count => ({ name: `goal, ${count} memor${count === 1 ? 'y' : 'ies'}`, render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ goal: { objective: '‹h:objective›' }, memories: count }) }) })),
  { name: 'remembering', render: async () => { const mounted = await afterTurn(hanging); mounted.handle.dispatch('ai/remember'); await settle(); return mounted; } },
  { name: 'remembered, no run', render: async () => remember(await mount({ settings: CONFIGURED, open: true, ledger: await withGoal() })) },
  { name: 'remembered, unconfigured', render: async () => {
    const mounted = await afterTurn();
    await type(mounted, 'ai/setting', '', { key: 'model' }); await remember(mounted);
    await type(mounted, 'ai/setting', CONFIGURED.model, { key: 'model' }); return mounted;
  } },
  { name: 'remembered, refused', render: async () => remember(await afterTurn(() => reply(JSON.stringify({ choices: [{ message: { content: '‹h:not-a-patch›' } }] })))) },
  { name: 'remembered, request refused', render: async () => remember(await afterTurn(refused('‹h:error-refinement›'))) },
  { name: 'remembered, nothing found', render: async () => remember(await afterTurn(() => reply(refinement([])))) },
  { name: 'remembered, 1 item', render: async () => remember(await afterTurn(() => reply(refinement([
    { op: 'add', path: '/memories/-', value: { text: '‹h:memory›', evidence: '‹h:evidence›' } },
  ])))) },
  { name: 'remembered, 2 items', render: async () => remember(await afterTurn(() => reply(refinement([
    { op: 'add', path: '/memories/-', value: { text: '‹h:memory›', evidence: '‹h:evidence›' } },
    { op: 'add', path: '/goal/progress/-', value: { note: '‹h:note›', evidence: '‹h:evidence›' } },
  ])))) },
  { name: 'streaming, thinking', render: streaming },
  ...[1, 120].map(count => ({ name: `streaming, ${count} reasoning character${count === 1 ? '' : 's'}`, render: async () => step(await streaming(), 'ai/reasoning', count) })),
  { name: 'streaming, pending reply', render: async () => step(await streaming(), 'ai/delta', '‹h:partial›') },
  { name: 'streaming, tool activity', render: async () => step(await streaming(), 'ai/activity', '‹h:tool›') },
  { name: 'send, unconfigured', render: async () => { const mounted = await mount({ open: true, ledger: ledgerView() }); await send(mounted); return mounted; } },
  { name: 'settings save refused', render: async () => step(await mount({ settings: CONFIGURED, open: true, ledger: ledgerView(), aiStorage: { read: () => CONFIGURED, write: () => false } }), 'ai/save-settings') },
  { name: 'settings save threw', render: async () => step(await mount({ settings: CONFIGURED, open: true, ledger: ledgerView(), aiStorage: { read: () => CONFIGURED, write: () => { throw new Error('‹h:error-settings›'); } } }), 'ai/save-settings') },
  { name: 'transcript write refused', render: async () => step(await mount({ settings: CONFIGURED, open: true, ledger: ledgerView(), aiChat: { read: () => null, write: () => false } }), 'ai/user', '‹h:question›') },
  { name: 'transcript write threw', render: async () => step(await mount({ settings: CONFIGURED, open: true, ledger: ledgerView(), aiChat: { read: () => null, write: () => { throw new Error('‹h:error-transcript›'); } } }), 'ai/user', '‹h:question›') },
  { name: 'provider request refused', render: async () => { const mounted = await mount({ settings: CONFIGURED, open: true, ledger: createLedger(), aiFetch: refused('‹h:error-provider›') }); await send(mounted); return mounted; } },
  { name: 'goal refused by the ledger', render: async () => {
    const mounted = await mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ setGoal: async () => ({ error: '‹h:error-goal›' }) }) });
    await type(mounted, 'ai/goal-draft', '‹h:objective›'); return step(mounted, 'ai/goal-set');
  } },
  { name: 'goal set failed', render: async () => {
    const mounted = await mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ setGoal: async () => { throw new Error('‹h:error-goal-set›'); } }) });
    await type(mounted, 'ai/goal-draft', '‹h:objective›'); return step(mounted, 'ai/goal-set');
  } },
  { name: 'goal clear failed', render: async () => step(await mount({
    settings: CONFIGURED, open: true, ledger: { ...ledgerView({ goal: { objective: '‹h:objective›' } }), setGoalStatus: async () => { throw new Error('‹h:error-goal-clear›'); } },
  }), 'ai/goal-clear') },
  { name: 'archive clear failed', render: async () => step(await mount({
    settings: CONFIGURED, open: true, ledger: { ...ledgerView(), clearArchives: async () => { throw new Error('‹h:error-archive›'); } },
  }), 'ai/clear') },
  { name: 'ledger read failed', render: () => mount({ settings: CONFIGURED, open: true, ledger: { ...ledgerView(), getGoal: async () => { throw new Error('‹h:error-ledger›'); } } }) },
  { name: 'stored provider unknown', render: async () => { const mounted = await mount({ settings: { ...CONFIGURED, provider: 'unknown' }, open: true, ledger: ledgerView() }); await send(mounted); return mounted; } },
  { name: 'reasoning-only reply', render: async () => { const mounted = await mount({ settings: CONFIGURED, open: true, ledger: createLedger(), aiFetch: () => reply(turn({ reasoning: '‹h:reasoning›' })) }); await send(mounted); return mounted; } },
  { name: 'empty reply', render: async () => { const mounted = await mount({ settings: CONFIGURED, open: true, ledger: createLedger(), aiFetch: () => reply(turn({ content: '' })) }); await send(mounted); return mounted; } },
  { name: 'storage failed', render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ persistence: { error: '‹h:error-storage›' } }) }) },
  { name: 'single writer', render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ persistence: { concurrency: 'single-writer' } }) }) },
  ...[1, 2].map(count => ({ name: `retention, ${count} evicted`, render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ retention: { evicted: tokens('address', count) } }) }) })),
  ...[1, 2].map(count => ({ name: `archived, ${count} round${count === 1 ? '' : 's'}`, render: () => mount({ settings: CONFIGURED, open: true, ledger: ledgerView({ archived: count }) }) })),
  { name: 'reply with heading, page break and footnote', render: () => mount({
    settings: CONFIGURED, open: true, ledger: ledgerView(), transcript: { messages: [
      { role: 'user', content: '‹h:question›' },
      { role: 'assistant', content: '## ‹h:heading›\n\n‹h:paragraph›[^1]\n\n<!-- pagebreak -->\n\n‹h:after›\n\n[^1]: ‹h:footnote›\n' },
    ] },
  }) },
];
