/**
 * The app document's state and actions — pure JSON, no host code.
 *
 * Actions stay simple on purpose: every transition is an unconditional
 * patch; branching on server outcomes happens in the effects (host JS),
 * which dispatch a different action for ok and for error. The document
 * never needs to express a conditional it cannot see.
 */

export const INITIAL_STATE = {
  page: 'chat',
  status: null as any,
  chat: {
    input: '',
    busy: false,
    error: null as string | null,
    messages: [] as any[],
    citations: [] as any[],
    documentCitations: [] as any[],
  },
  loom: {
    mermaid: '',
    nodes: [] as string[],
    live: { run: null as any, nodes: {} as Record<string, any>, seq: 0 },
    runs: [] as any[],
    detail: null as any,
    syncing: false,
    syncError: null as string | null,
  },
  memory: {
    q: '',
    superseded: false,
    items: [] as any[],
    detail: null as any,
  },
  documents: {
    url: '',
    q: '',
    busy: false,
    error: null as string | null,
    items: [] as any[],
    results: [] as any[],
    skipped: 0,
    browser: null as any,
    webQ: '',
    webBusy: false,
    webError: null as string | null,
    webResults: [] as any[],
    webSelected: [] as string[],
    webIngestResults: [] as any[],
  },
  settings: {
    draft: null as any,
    saved: false,
    probe: null as any,
    embedProbe: null as any,
  },
};

/** One effect entry: { run: <registered effect>, with: <query> }. */
const invoke = (op: string, input: any, done: string, fail: string): any =>
  ({ run: 'invoke', with: { op, input, done, fail } });

export const ACTIONS: Record<string, any> = {
  boot: {
    effects: [
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('dag.get', {}, 'dag/done', 'noop'),
      invoke('chat.history', {}, 'chat/history', 'noop'),
      invoke('runs.list', {}, 'runs/done', 'noop'),
      invoke('memories.list', { limit: 200 }, 'memory/done', 'noop'),
      invoke('documents.list', {}, 'documents/done', 'noop'),
      invoke('browser.status', {}, 'browser/done', 'noop'),
      invoke('settings.get', {}, 'settings/done', 'noop'),
    ],
  },
  noop: {},

  nav: {
    patch: [{ op: 'replace', path: '/page', value: '$payload' }],
  },

  'status/done': { patch: [{ op: 'replace', path: '/status', value: '$payload' }] },
  'dag/done': {
    patch: [
      { op: 'replace', path: '/loom/mermaid', value: '$payload.mermaid' },
      { op: 'replace', path: '/loom/nodes', value: '$payload.nodes' },
    ],
  },

  // -- chat -----------------------------------------------------------------
  'chat/input': { patch: [{ op: 'replace', path: '/chat/input', value: '$event.value' }] },
  'chat/history': { patch: [{ op: 'replace', path: '/chat/messages', value: '$payload' }] },
  'chat/send': {
    patch: [
      { op: 'add', path: '/chat/messages/-', value: { role: 'user', text: '$.chat.input', local: true } },
      { op: 'replace', path: '/chat/busy', value: true },
      { op: 'replace', path: '/chat/error', value: null },
      { op: 'replace', path: '/chat/input', value: '' },
    ],
    effects: [{ run: 'chatSend', with: { text: '$.chat.input' } }],
  },
  'chat/done': {
    patch: [
      { op: 'add', path: '/chat/messages/-', value: '$payload.reply' },
      { op: 'replace', path: '/chat/citations', value: '$payload.citations' },
      { op: 'replace', path: '/chat/documentCitations', value: '$payload.documentCitations' },
      { op: 'replace', path: '/chat/busy', value: false },
    ],
  },
  'chat/fail': {
    patch: [
      { op: 'replace', path: '/chat/busy', value: false },
      { op: 'replace', path: '/chat/error', value: '$payload' },
    ],
  },

  // -- loom (DAG, runs, sync) ----------------------------------------------
  'loom/live': { patch: [{ op: 'replace', path: '/loom/live', value: '$payload' }] },
  'runs/refresh': {
    effects: [
      invoke('runs.list', {}, 'runs/done', 'noop'),
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('memories.list', { limit: 200 }, 'memory/done', 'noop'),
    ],
  },
  'runs/done': { patch: [{ op: 'replace', path: '/loom/runs', value: '$payload' }] },
  'run/select': {
    effects: [{ run: 'invoke', with: { op: 'runs.get', input: { id: '$payload' }, done: 'run/detail', fail: 'noop' } }],
  },
  'run/detail': { patch: [{ op: 'replace', path: '/loom/detail', value: '$payload' }] },
  'run/close': { patch: [{ op: 'replace', path: '/loom/detail', value: null }] },

  sync: {
    patch: [
      { op: 'replace', path: '/loom/syncing', value: true },
      { op: 'replace', path: '/loom/syncError', value: null },
    ],
    effects: [invoke('folder.sync', {}, 'sync/done', 'sync/fail')],
  },
  'sync/done': {
    patch: [{ op: 'replace', path: '/loom/syncing', value: false }],
    effects: [
      invoke('runs.list', {}, 'runs/done', 'noop'),
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('memories.list', { limit: 200 }, 'memory/done', 'noop'),
    ],
  },
  'sync/fail': {
    patch: [
      { op: 'replace', path: '/loom/syncing', value: false },
      { op: 'replace', path: '/loom/syncError', value: '$payload' },
    ],
  },

  // -- memory ---------------------------------------------------------------
  'memory/q': {
    patch: [{ op: 'replace', path: '/memory/q', value: '$event.value' }],
    effects: [{ run: 'search', with: { q: '$event.value', superseded: '$.memory.superseded' } }],
  },
  'memory/superseded': {
    patch: [{ op: 'replace', path: '/memory/superseded', value: '$event.checked' }],
    effects: [{ run: 'search', with: { q: '$.memory.q', superseded: '$event.checked' } }],
  },
  'memory/done': { patch: [{ op: 'replace', path: '/memory/items', value: '$payload' }] },
  'memory/select': { patch: [{ op: 'replace', path: '/memory/detail', value: '$payload' }] },
  'memory/close': { patch: [{ op: 'replace', path: '/memory/detail', value: null }] },

  // -- documents ------------------------------------------------------------
  'documents/url': { patch: [{ op: 'replace', path: '/documents/url', value: '$event.value' }] },
  'documents/q': {
    patch: [{ op: 'replace', path: '/documents/q', value: '$event.value' }],
    effects: [{ run: 'documentSearch', with: { q: '$event.value' } }],
  },
  'documents/ingest': {
    patch: [
      { op: 'replace', path: '/documents/busy', value: true },
      { op: 'replace', path: '/documents/error', value: null },
    ],
    effects: [{ run: 'documentIngest', with: { url: '$.documents.url' } }],
  },
  'documents/ingestUrl': {
    patch: [
      { op: 'replace', path: '/documents/busy', value: true },
      { op: 'replace', path: '/documents/error', value: null },
    ],
    effects: [{ run: 'documentIngest', with: { url: '$payload' } }],
  },
  'documents/ingested': {
    patch: [
      { op: 'replace', path: '/documents/busy', value: false },
      { op: 'replace', path: '/documents/url', value: '' },
    ],
    effects: [
      invoke('documents.list', {}, 'documents/done', 'noop'),
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('runs.list', {}, 'runs/done', 'noop'),
    ],
  },
  'documents/fail': {
    patch: [
      { op: 'replace', path: '/documents/busy', value: false },
      { op: 'replace', path: '/documents/error', value: '$payload' },
    ],
  },
  'documents/done': { patch: [{ op: 'replace', path: '/documents/items', value: '$payload' }] },
  'documents/searchDone': {
    patch: [
      { op: 'replace', path: '/documents/results', value: '$payload.ranked' },
      { op: 'replace', path: '/documents/skipped', value: '$payload.skipped' },
    ],
  },
  'browser/done': { patch: [{ op: 'replace', path: '/documents/browser', value: '$payload' }] },
  'documents/webQ': { patch: [{ op: 'replace', path: '/documents/webQ', value: '$event.value' }] },
  'documents/webSearch': {
    patch: [
      { op: 'replace', path: '/documents/webBusy', value: true },
      { op: 'replace', path: '/documents/webError', value: null },
    ],
    effects: [{ run: 'webDiscover', with: { q: '$.documents.webQ' } }],
  },
  'documents/webDone': {
    patch: [
      { op: 'replace', path: '/documents/webBusy', value: false },
      { op: 'replace', path: '/documents/webResults', value: '$payload.results' },
      { op: 'replace', path: '/documents/webSelected', value: [] },
      { op: 'replace', path: '/documents/webIngestResults', value: [] },
    ],
  },
  'documents/webSelected': { patch: [{ op: 'replace', path: '/documents/webSelected', value: '$payload' }] },
  'documents/webIngest': {
    patch: [
      { op: 'replace', path: '/documents/busy', value: true },
      { op: 'replace', path: '/documents/error', value: null },
    ],
    effects: [{ run: 'documentBatchIngest', with: { urls: '$.documents.webSelected' } }],
  },
  'documents/webIngested': {
    patch: [
      { op: 'replace', path: '/documents/busy', value: false },
      { op: 'replace', path: '/documents/webSelected', value: [] },
      { op: 'replace', path: '/documents/webIngestResults', value: '$payload' },
    ],
    effects: [
      invoke('documents.list', {}, 'documents/done', 'noop'),
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('runs.list', {}, 'runs/done', 'noop'),
    ],
  },
  'documents/webFail': {
    patch: [
      { op: 'replace', path: '/documents/webBusy', value: false },
      { op: 'replace', path: '/documents/webError', value: '$payload' },
    ],
  },

  // -- settings -------------------------------------------------------------
  'settings/done': {
    patch: [
      { op: 'replace', path: '/settings/draft', value: '$payload' },
      { op: 'replace', path: '/settings/saved', value: false },
    ],
  },
  'settings/folder': { patch: [{ op: 'replace', path: '/settings/draft/folder', value: '$event.value' }] },
  'settings/chat-provider': { patch: [{ op: 'replace', path: '/settings/draft/chat/provider', value: '$event.value' }] },
  'settings/chat-baseurl': { patch: [{ op: 'replace', path: '/settings/draft/chat/baseUrl', value: '$event.value' }] },
  'settings/chat-model': { patch: [{ op: 'replace', path: '/settings/draft/chat/model', value: '$event.value' }] },
  'settings/chat-apikey': { patch: [{ op: 'replace', path: '/settings/draft/chat/apiKey', value: '$event.value' }] },
  'settings/embed-provider': { patch: [{ op: 'replace', path: '/settings/draft/embed/provider', value: '$event.value' }] },
  'settings/embed-baseurl': { patch: [{ op: 'replace', path: '/settings/draft/embed/baseUrl', value: '$event.value' }] },
  'settings/embed-model': { patch: [{ op: 'replace', path: '/settings/draft/embed/model', value: '$event.value' }] },
  'settings/embed-apikey': { patch: [{ op: 'replace', path: '/settings/draft/embed/apiKey', value: '$event.value' }] },
  'settings/document-chunker': { patch: [{ op: 'replace', path: '/settings/draft/documents/chunker', value: '$event.value' }] },
  'settings/document-max': { patch: [{ op: 'replace', path: '/settings/draft/documents/maxTokens', value: '$event.value' }] },
  'settings/document-overlap': { patch: [{ op: 'replace', path: '/settings/draft/documents/overlapTokens', value: '$event.value' }] },
  'settings/browser-mode': { patch: [{ op: 'replace', path: '/settings/draft/browser/mode', value: '$event.value' }] },
  'settings/browser-endpoint': { patch: [{ op: 'replace', path: '/settings/draft/browser/endpoint', value: '$event.value' }] },
  'settings/browser-token': { patch: [{ op: 'replace', path: '/settings/draft/browser/token', value: '$event.value' }] },
  'settings/browser-unsafe': { patch: [{ op: 'replace', path: '/settings/draft/browser/allowUnsafeLocal', value: '$event.checked' }] },
  'settings/search-url': { patch: [{ op: 'replace', path: '/settings/draft/search/searxngUrl', value: '$event.value' }] },
  'settings/save': {
    effects: [{ run: 'saveSettings', with: { settings: '$.settings.draft' } }],
  },
  'settings/saved': {
    patch: [
      { op: 'replace', path: '/settings/draft', value: '$payload' },
      { op: 'replace', path: '/settings/saved', value: true },
      { op: 'replace', path: '/settings/probe', value: null },
      { op: 'replace', path: '/settings/embedProbe', value: null },
    ],
    effects: [
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('browser.status', {}, 'browser/done', 'noop'),
    ],
  },
  probe: {
    patch: [{ op: 'replace', path: '/settings/probe', value: { pending: true } }],
    effects: [invoke('provider.probe', {}, 'probe/done', 'noop')],
  },
  'probe/done': { patch: [{ op: 'replace', path: '/settings/probe', value: '$payload' }] },
  embedProbe: {
    patch: [{ op: 'replace', path: '/settings/embedProbe', value: { pending: true } }],
    effects: [invoke('embed.probe', {}, 'embedProbe/done', 'noop')],
  },
  'embedProbe/done': { patch: [{ op: 'replace', path: '/settings/embedProbe', value: '$payload' }] },
};
