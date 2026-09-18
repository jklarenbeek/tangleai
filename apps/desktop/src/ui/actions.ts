/**
 * The app document's state and actions — pure JSON, no host code.
 *
 * Transitions use the suite query language and JSON patches; branching on server outcomes happens in the effects (host JS),
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
    /** The run answering the pending question: its addresses and what it has said so far. */
    run: null as { runId: string, messageId: string, chars: number, degraded: any[], status: string } | null,
    /**
     * The verdict form, open on at most one reply. A thumb opens it; only
     * an explicit submission with a reason and named evidence records
     * anything, and what comes back is what the server stored.
     */
    feedback: {
      messageId: null as string | null,
      form: null as any,
      verdict: 'success',
      reason: '',
      note: '',
      refs: [] as string[],
      error: null as string | null,
      receipt: null as any,
    },
  },
  loom: {
    mermaid: '',
    nodes: [] as string[],
    /** The live run window, in the shape its subscription's snapshot carries. */
    runs: { rows: [] as any[] },
    /** The run the Loom is watching; a subscriber names its run. */
    watch: null as string | null,
    /** A fresh attempt number restarts the frame subscription at the seq the rows reached. */
    frameAttempt: 0,
    frames: { runId: null as string | null, rows: [] as any[] },
    detail: null as any,
    syncing: false,
    syncError: null as string | null,
    /** A refused slot is fixable by waiting, so it is a note and not a failure. */
    syncNote: null as string | null,
    /** What the host's watcher has observed, as `folder.watch.get` reports it. */
    watcher: null as any,
  },
  /**
   * What this host can measure, and what it kept. A build that
   * registered nothing says so — that is the state of the build, not an
   * error of the page.
   */
  reports: {
    instruments: [] as any[],
    issues: [] as any[],
    rows: [] as any[],
    detail: null as any,
    /** The report run this page is watching, followed through the run window. */
    runId: null as string | null,
    busy: false,
    error: null as string | null,
    receipt: null as any,
  },
  memory: {
    q: '',
    superseded: false,
    items: [] as any[],
    detail: null as any,
  },
  skills: {
    runs: [] as any[],
    detail: null as any,
    merges: null as any,
    candidate: null as any,
    evaluation: null as any,
    head: null as any,
    error: null as string | null,
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
    /** Pending explicit secret clears — the only way a stored credential is removed. */
    clear: { chatKey: false, embedKey: false, browserToken: false },
    /** Bumped on every save so the write-only secret inputs re-mount blank. */
    saveCount: 0,
    /** The read-only config inspection: registry, request, resolution state, identity. */
    inspect: null as any,
    /** What the selected-but-unsaved profile resolves to, or null when none is selected. */
    preview: null as any,
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
      invoke('skills.runs.list', {}, 'skills/runs', 'noop'),
      invoke('settings.get', {}, 'settings/done', 'noop'),
      invoke('config.inspect', {}, 'config/done', 'noop'),
      invoke('folder.watch.get', {}, 'watch/done', 'noop'),
      invoke('reports.instruments', {}, 'reports/instruments', 'noop'),
      invoke('reports.list', {}, 'reports/rows', 'noop'),
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
  'chat/started': {
    patch: [
      { op: 'replace', path: '/chat/run', value: { runId: '$payload.runId', messageId: '$payload.messageId', chars: 0, degraded: [], status: 'running' } },
      { op: 'replace', path: '/chat/citations', value: [] },
      { op: 'replace', path: '/chat/documentCitations', value: [] },
    ],
  },
  'chat/streamed': {
    patch: [{ op: 'replace', path: '/chat/run', value: '$payload' }],
  },
  'chat/answered': {
    effects: [invoke('chat.history', { limit: 200 }, 'chat/replied', 'chat/fail')],
  },
  'chat/replied': {
    patch: [
      { op: 'replace', path: '/chat/messages', value: '$payload' },
      { op: 'replace', path: '/chat/busy', value: false },
    ],
    effects: [invoke('runs.list', {}, 'runs/done', 'noop')],
  },
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
  /** End the run answering the pending question; its terminal frame says cancelled. */
  'chat/stop': {
    effects: [{ run: 'invoke', with: { op: 'runs.cancel', input: { runId: '$payload' }, done: 'noop', fail: 'noop' } }],
  },
  'chat/fail': {
    patch: [
      { op: 'replace', path: '/chat/busy', value: false },
      { op: 'replace', path: '/chat/error', value: '$payload' },
    ],
  },

  // -- feedback (an evidenced verdict, never a bare click) -------------------
  /** A thumb OPENS the form, pre-selecting what it meant; it submits nothing. */
  'feedback/open': {
    patch: [{
      op: 'replace',
      path: '/chat/feedback',
      value: {
        messageId: '$payload.messageId', form: null, verdict: '$payload.verdict',
        reason: '', note: '', refs: [], error: null, receipt: null,
      },
    }],
    effects: [{ run: 'feedbackOpen', with: { messageId: '$payload.messageId' } }],
  },
  'feedback/form': { patch: [{ op: 'replace', path: '/chat/feedback/form', value: '$payload' }] },
  'feedback/close': { patch: [{ op: 'replace', path: '/chat/feedback/messageId', value: null }] },
  'feedback/verdict': { patch: [{ op: 'replace', path: '/chat/feedback/verdict', value: '$payload' }] },
  'feedback/reason': { patch: [{ op: 'replace', path: '/chat/feedback/reason', value: '$event.value' }] },
  'feedback/note': { patch: [{ op: 'replace', path: '/chat/feedback/note', value: '$event.value' }] },
  /** Ticking is a set operation; the host effect computes it and hands back the whole set. */
  'feedback/toggle': {
    effects: [{ run: 'feedbackToggle', with: { refs: '$.chat.feedback.refs', ref: '$payload' } }],
  },
  'feedback/refs': { patch: [{ op: 'replace', path: '/chat/feedback/refs', value: '$payload' }] },
  'feedback/submit': {
    patch: [{ op: 'replace', path: '/chat/feedback/error', value: null }],
    effects: [{
      run: 'feedbackSubmit',
      with: {
        messageId: '$.chat.feedback.messageId',
        verdict: '$.chat.feedback.verdict',
        reason: '$.chat.feedback.reason',
        note: '$.chat.feedback.note',
        refs: '$.chat.feedback.refs',
        options: '$.chat.feedback.form.evidence',
      },
    }],
  },
  /** What the server recorded, shown as the numbers it answered. */
  'feedback/recorded': {
    patch: [
      { op: 'replace', path: '/chat/feedback/receipt', value: '$payload' },
      { op: 'replace', path: '/chat/feedback/error', value: null },
    ],
    effects: [invoke('memories.list', { limit: 200 }, 'memory/done', 'noop')],
  },
  'feedback/fail': { patch: [{ op: 'replace', path: '/chat/feedback/error', value: '$payload' }] },

  // -- loom (DAG, runs, sync) ----------------------------------------------
  // The run window arrives as its subscription's own document; the
  // patches are applied under this slot by the handler that receives
  // them, so what the surface holds is what the server maintains.
  'loom/runs': { patch: [{ op: 'replace', path: '/loom/runs', value: '$payload' }] },
  /** Watch a named run — the only way frames are ever requested. The
   * subscription that starts for it seeds the slot with its own id. */
  'loom/follow': { patch: [{ op: 'replace', path: '/loom/watch', value: '$payload' }] },
  'loom/frames': { patch: [{ op: 'replace', path: '/loom/frames', value: '$payload' }] },
  /** A lost stream: a new attempt restarts the subscription from a fresh snapshot of the run. */
  'loom/frameLost': { patch: [{ op: 'replace', path: '/loom/frameAttempt', value: '$payload' }] },
  'runs/refresh': {
    effects: [
      invoke('runs.list', {}, 'runs/done', 'noop'),
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('memories.list', { limit: 200 }, 'memory/done', 'noop'),
    ],
  },
  'runs/done': { patch: [{ op: 'replace', path: '/loom/runs/rows', value: '$payload' }] },
  'run/select': {
    patch: [{ op: 'replace', path: '/loom/watch', value: '$payload' }],
    effects: [
      { run: 'invoke', with: { op: 'runs.get', input: { id: '$payload' }, done: 'run/detail', fail: 'noop' } },
      { run: 'runFrames', with: { runId: '$payload' } },
    ],
  },
  'run/detail': { patch: [{ op: 'replace', path: '/loom/detail', value: '$payload' }] },
  'run/close': { patch: [{ op: 'replace', path: '/loom/detail', value: null }] },

  // -- skills (read only: this surface shows what a run did) ------------------
  'skills/refresh': { effects: [invoke('skills.runs.list', {}, 'skills/runs', 'skills/fail')] },
  'skills/runs': { patch: [{ op: 'replace', path: '/skills/runs', value: '$payload' }] },
  'skills/select': {
    patch: [
      { op: 'replace', path: '/skills/error', value: null },
      { op: 'replace', path: '/skills/candidate', value: null },
      { op: 'replace', path: '/skills/evaluation', value: null },
    ],
    effects: [
      { run: 'invoke', with: { op: 'skills.runs.get', input: { id: '$payload' }, done: 'skills/detail', fail: 'skills/fail' } },
      { run: 'invoke', with: { op: 'skills.merges.get', input: { runId: '$payload' }, done: 'skills/merges', fail: 'noop' } },
    ],
  },
  'skills/detail': {
    patch: [{ op: 'replace', path: '/skills/detail', value: '$payload' }],
    effects: [{ run: 'skillDetail', with: { detail: '$payload' } }],
  },
  'skills/merges': { patch: [{ op: 'replace', path: '/skills/merges', value: '$payload' }] },
  'skills/candidate': { patch: [{ op: 'replace', path: '/skills/candidate', value: '$payload' }] },
  'skills/evaluation': { patch: [{ op: 'replace', path: '/skills/evaluation', value: '$payload' }] },
  'skills/head': { patch: [{ op: 'replace', path: '/skills/head', value: '$payload' }] },
  'skills/fail': { patch: [{ op: 'replace', path: '/skills/error', value: '$payload' }] },
  'skills/close': {
    patch: [
      { op: 'replace', path: '/skills/detail', value: null },
      { op: 'replace', path: '/skills/merges', value: null },
      { op: 'replace', path: '/skills/candidate', value: null },
      { op: 'replace', path: '/skills/evaluation', value: null },
    ],
  },

  sync: {
    patch: [
      { op: 'replace', path: '/loom/syncing', value: true },
      { op: 'replace', path: '/loom/syncError', value: null },
      { op: 'replace', path: '/loom/syncNote', value: null },
    ],
    effects: [{ run: 'syncFolder' }],
  },
  'sync/done': {
    patch: [
      { op: 'replace', path: '/loom/syncing', value: false },
      { op: 'replace', path: '/loom/watch', value: '$payload.runId' },
    ],
    effects: [
      { run: 'runFrames', with: { runId: '$payload.runId' } },
      invoke('runs.list', {}, 'runs/done', 'noop'),
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('memories.list', { limit: 200 }, 'memory/done', 'noop'),
      invoke('folder.watch.get', {}, 'watch/done', 'noop'),
    ],
  },
  /** The click found a pass already running: the work it asked for is being done. */
  'sync/busy': {
    patch: [
      { op: 'replace', path: '/loom/syncing', value: false },
      { op: 'replace', path: '/loom/syncNote', value: '$payload' },
    ],
    effects: [invoke('folder.watch.get', {}, 'watch/done', 'noop')],
  },
  'sync/fail': {
    patch: [
      { op: 'replace', path: '/loom/syncing', value: false },
      { op: 'replace', path: '/loom/syncError', value: '$payload' },
    ],
  },
  'watch/done': { patch: [{ op: 'replace', path: '/loom/watcher', value: '$payload' }] },
  'watch/refresh': { effects: [invoke('folder.watch.get', {}, 'watch/done', 'noop')] },

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
  'reports/instruments': {
    patch: [
      { op: 'replace', path: '/reports/instruments', value: '$payload.instruments' },
      { op: 'replace', path: '/reports/issues', value: '$payload.issues' },
    ],
  },
  'reports/rows': { patch: [{ op: 'replace', path: '/reports/rows', value: '$payload.rows' }] },
  'reports/run': {
    patch: [
      { op: 'replace', path: '/reports/busy', value: true },
      { op: 'replace', path: '/reports/error', value: null },
      { op: 'replace', path: '/reports/receipt', value: null },
    ],
    effects: [{ run: 'runReport', with: { id: '$payload' } }],
  },
  'reports/done': {
    patch: [
      { op: 'replace', path: '/reports/busy', value: false },
      { op: 'replace', path: '/reports/receipt', value: '$payload' },
      { op: 'replace', path: '/reports/runId', value: '$payload.runId' },
    ],
    effects: [
      invoke('reports.list', {}, 'reports/rows', 'noop'),
      invoke('runs.list', {}, 'runs/done', 'noop'),
    ],
  },
  'reports/fail': {
    patch: [
      { op: 'replace', path: '/reports/busy', value: false },
      { op: 'replace', path: '/reports/error', value: '$payload' },
    ],
  },
  'reports/open': { effects: [{ run: 'invoke', with: { op: 'reports.get', input: { reportId: '$payload' }, done: 'reports/detail', fail: 'reports/fail' } }] },
  'reports/detail': { patch: [{ op: 'replace', path: '/reports/detail', value: '$payload' }] },
  'reports/close': { patch: [{ op: 'replace', path: '/reports/detail', value: null }] },

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
  'settings/chat-max-tokens': { patch: [{ op: 'add', path: '/settings/draft/chat/maxTokens', value: '$event.value' }] },
  'settings/chat-max-field': { patch: [{ op: 'add', path: '/settings/draft/chat/maxTokensField', value: '$event.value' }] },
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
  // selecting a profile previews it at once: the operator sees the
  // refusal a save would produce before saving it
  'settings/profile': {
    patch: [{ op: 'replace', path: '/settings/draft/profile', value: '$event.value' }],
    effects: [{ run: 'previewProfile', with: { profile: '$event.value' } }],
  },
  'config/preview': { patch: [{ op: 'replace', path: '/settings/preview', value: '$payload' }] },
  'settings/save': {
    effects: [{ run: 'saveSettings', with: { settings: '$.settings.draft', clear: '$.settings.clear' } }],
  },
  'settings/clear-chat-key': { patch: [{ op: 'replace', path: '/settings/clear/chatKey', value: '$payload' }] },
  'settings/clear-embed-key': { patch: [{ op: 'replace', path: '/settings/clear/embedKey', value: '$payload' }] },
  'settings/clear-browser-token': { patch: [{ op: 'replace', path: '/settings/clear/browserToken', value: '$payload' }] },
  'config/done': { patch: [{ op: 'replace', path: '/settings/inspect', value: '$payload' }] },
  'settings/saved': {
    patch: [
      { op: 'replace', path: '/settings/draft', value: '$payload' },
      { op: 'replace', path: '/settings/saved', value: true },
      { op: 'replace', path: '/settings/probe', value: null },
      { op: 'replace', path: '/settings/embedProbe', value: null },
      { op: 'replace', path: '/settings/clear', value: { chatKey: false, embedKey: false, browserToken: false } },
      { op: 'replace', path: '/settings/saveCount', value: { '$add': ['$.settings.saveCount', 1] } },
      // the saved selection is now the effective one; the inspection below
      // states it, so a stale preview beside it would say it twice
      { op: 'replace', path: '/settings/preview', value: null },
    ],
    effects: [
      invoke('status.get', {}, 'status/done', 'noop'),
      invoke('browser.status', {}, 'browser/done', 'noop'),
      invoke('config.inspect', {}, 'config/done', 'noop'),
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
