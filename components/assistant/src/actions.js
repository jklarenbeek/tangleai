//@ts-check
/** Assistant transitions received from the existing panel. */
export const ASSISTANT_ACTIONS = {
'ai/cancel': {
  patch: [
    { op: 'replace', path: '/ai/status', value: 'idle' },
    { op: 'replace', path: '/ai/pending', value: '' },
    { op: 'replace', path: '/ai/activity', value: null },
  ],
  effects: [{ run: 'ai-cancel' }],
},
'ai/toggle': {
    patch: [{ op: 'replace', path: '/ai/open', value: { $not: '$.ai.open' } }],
    // opening while unconfigured pins the settings form open (see
    // ai-ensure-settings), so it cannot vanish mid-edit as typing
    // makes the configuration valid. The ledger read is what makes a
    // reloaded page show the objective it was left with — the goal
    // lives in storage, not in this tab.
    effects: [{ run: 'ai-ensure-settings' }, { run: 'ai-ledger-read' }],
  },
'ai/settings-toggle': {
    patch: [{ op: 'replace', path: '/ai/settingsOpen', value: { $not: '$.ai.settingsOpen' } }],
  },
'ai/settings-open': {
    patch: [{ op: 'replace', path: '/ai/settingsOpen', value: '$payload' }],
  },
'ai/setting': {
    patch: [
      {
        op: 'add',
        path: { $concat: ['/ai/settings/', '$payload.key'] },
        value: '$event.value',
      },
      // an edited connection voids the last probe verdict
      { op: 'replace', path: '/ai/probe', value: { status: 'idle', detail: null, models: [] } },
    ],
  },
'ai/probe': {
    patch: [{
      op: 'replace',
      path: '/ai/probe',
      value: { status: 'busy', detail: null, models: [] },
    }],
    effects: [{ run: 'ai-probe' }],
  },
'ai/probe-result': {
    patch: [{ op: 'replace', path: '/ai/probe', value: '$payload' }],
  },
'ai/save-settings': {
    patch: [{ op: 'replace', path: '/ai/settingsOpen', value: false }],
    effects: [{ run: 'ai-save-settings' }],
  },
'ai/draft': {
    patch: [{ op: 'replace', path: '/ai/draft', value: '$event.value' }],
  },
'ai/send': { effects: [{ run: 'ai-send' }] },
'ai/user': {
    patch: [
      { op: 'add', path: '/ai/messages/-', value: { role: 'user', content: '$payload' } },
      { op: 'replace', path: '/ai/draft', value: '' },
      { op: 'replace', path: '/ai/pending', value: '' },
      { op: 'replace', path: '/ai/status', value: 'streaming' },
      { op: 'replace', path: '/ai/activity', value: null },
      { op: 'replace', path: '/ai/error', value: null },
      { op: 'replace', path: '/ai/reasoningChars', value: 0 },
    ],
    effects: [{ run: 'ai-persist' }],
  },
'ai/delta': {
    patch: [{ op: 'replace', path: '/ai/pending', value: { $concat: ['$.ai.pending', '$payload'] } }],
  },
'ai/reasoning': {
    patch: [{ op: 'replace', path: '/ai/reasoningChars', value: { $add: ['$.ai.reasoningChars', '$payload'] } }],
  },
'ai/activity': {
    patch: [{ op: 'replace', path: '/ai/activity', value: '$payload' }],
  },
'ai/reply': {
    patch: [
      { op: 'add', path: '/ai/messages/-', value: { role: 'assistant', content: '$payload' } },
      { op: 'replace', path: '/ai/pending', value: '' },
      { op: 'replace', path: '/ai/status', value: 'idle' },
      { op: 'replace', path: '/ai/activity', value: null },
    ],
    effects: [{ run: 'ai-persist' }],
  },
'ai/failed': {
    patch: [
      { op: 'replace', path: '/ai/status', value: 'error' },
      { op: 'replace', path: '/ai/error', value: '$payload' },
      { op: 'replace', path: '/ai/pending', value: '' },
      { op: 'replace', path: '/ai/activity', value: null },
    ],
  },
'ai/clear': {
    patch: [
      { op: 'replace', path: '/ai/messages', value: [] },
      { op: 'replace', path: '/ai/pending', value: '' },
      { op: 'replace', path: '/ai/status', value: 'idle' },
      { op: 'replace', path: '/ai/activity', value: null },
      { op: 'replace', path: '/ai/error', value: null },
      { op: 'replace', path: '/ai/remembered', value: null },
    ],
    // the archived rounds go with the transcript they were cut from:
    // their addresses only ever existed in its synopsis
    effects: [{ run: 'ai-clear-run' }, { run: 'ai-persist' }, { run: 'ai-clear-archive' }],
  },
'ai/ledger': {
    patch: [
      { op: 'replace', path: '/ai/goal', value: '$payload.goal' },
      { op: 'replace', path: '/ai/memories', value: '$payload.memories' },
      { op: 'replace', path: '/ai/archived', value: '$payload.archived' },
      { op: 'replace', path: '/ai/persistence', value: '$payload.persistence' },
      { op: 'replace', path: '/ai/retention', value: '$payload.retention' },
    ],
  },
'ai/goal-draft': {
    patch: [{ op: 'replace', path: '/ai/goalDraft', value: '$event.value' }],
  },
'ai/goal-set': { effects: [{ run: 'ai-goal-set' }] },
'ai/goal-committed': {
    patch: [
      { op: 'replace', path: '/ai/goal', value: '$payload.goal' },
      { op: 'replace', path: '/ai/memories', value: '$payload.memories' },
      { op: 'replace', path: '/ai/archived', value: '$payload.archived' },
      { op: 'replace', path: '/ai/persistence', value: '$payload.persistence' },
      { op: 'replace', path: '/ai/retention', value: '$payload.retention' },
      { op: 'replace', path: '/ai/goalDraft', value: '' },
    ],
  },
'ai/goal-clear': { effects: [{ run: 'ai-goal-clear' }] },
'ai/remember': {
    patch: [
      { op: 'replace', path: '/ai/remembering', value: true },
      { op: 'replace', path: '/ai/remembered', value: null },
    ],
    effects: [{ run: 'ai-remember' }],
  },
'ai/remembered': {
    patch: [
      { op: 'replace', path: '/ai/remembering', value: false },
      { op: 'replace', path: '/ai/remembered', value: '$payload.note' },
    ],
  },
};
