import { isConfigured } from './state.ts';
import type { AssistantMessages, AssistantMessageKey } from './messages.ts';

/** Sentences without parameters, rendered once per projection under `text`. */
const TEXT = {
  settingsTitle: 'panel/settings-title', settingsLabel: 'panel/settings-label', clearTitle: 'panel/clear-title',
  clearLabel: 'panel/clear-label', closeTitle: 'panel/close-title', closeLabel: 'panel/close-label',
  provider: 'settings/provider', apiKey: 'settings/api-key', apiKeyExample: 'settings/api-key-example',
  baseUrl: 'settings/base-url', baseUrlExample: 'settings/base-url-example', model: 'settings/model',
  modelExample: 'settings/model-example', save: 'settings/save', test: 'settings/test', testing: 'settings/testing',
  setup: 'intro/setup', composer: 'composer/placeholder', send: 'composer/send', cancel: 'composer/cancel',
  goalPlaceholder: 'goal/placeholder', goalSet: 'goal/set', objective: 'goal/objective',
  goalClearTitle: 'goal/clear-title', goalClearLabel: 'goal/clear-label', remember: 'goal/remember', remembering: 'goal/remembering',
} as const satisfies Record<string, AssistantMessageKey>;
/** Stands in for a value the view wraps in its own element, so one sentence keeps its word order. */
const VALUE = '\uE000';

/** @param ai @param renderMarkdown @param messages @param providers */
export function assistantView(ai: any, renderMarkdown: (source: string) => any, messages: AssistantMessages,
  providers: readonly { value: string, label: string, local: boolean }[]) {
  const s = ai.settings;
  const configured = isConfigured(s);
  const [before = '', after = ''] = messages['activity/running']({ tool: VALUE }).split(VALUE);
  return {
    text: Object.fromEntries(Object.entries(TEXT).map(([name, key]) => [name, messages[key]()])),
    open: ai.open,
    status: ai.status,
    activity: ai.activity,
    error: ai.error,
    draft: ai.draft,
    configured,
    // the settings form shows until the assistant can actually run, or
    // whenever the user opens it explicitly
    showSettings: ai.settingsOpen || !configured,
    settings: {
      provider: s.provider,
      baseUrl: s.baseUrl,
      model: s.model,
      apiKey: s.apiKey,
      needsKey: s.provider === 'openrouter' || s.provider === 'custom',
      probe: {
        status: ai.probe.status,
        detail: ai.probe.detail,
        busy: ai.probe.status === 'busy',
        ok: ai.probe.status === 'ok',
        fail: ai.probe.status === 'fail',
        models: ai.probe.models.map((id: any) => ({ id })),
      },
    },
    providers: providers.map((p) => ({
      ...p, label: Object.hasOwn(messages, `provider/${p.value}`) ? messages[`provider/${p.value}` as AssistantMessageKey]() : p.label,
      selected: p.value === s.provider,
    })),
    empty: ai.messages.length === 0,
    messages: ai.messages.map((m: any) => (m.role === 'user'
      ? { role: 'user', text: m.content }
      : { role: 'assistant', article: renderMarkdown(m.content) })),
    // the reply currently streaming in (plain text: it changes per token)
    streaming: ai.status === 'streaming',
    pending: ai.pending,
    activityLabel: { before, after },
    // the quiet-phase label: reasoning models think before they speak,
    // and watching the thinking grow beats a blind spinner
    thinkingLabel: ai.reasoningChars > 0
      ? messages['activity/thinking-count']({ count: ai.reasoningChars })
      : messages['activity/thinking'](),
    // the ledger: a persistent objective, what has been recorded against
    // it, and what a compacted session can still reach. Every number here
    // is derived from the ledger read, so the panel cannot claim a
    // memory the store does not hold.
    goal: ai.goal === null ? null : {
      objective: ai.goal.objective,
      entries: ai.goal.progress.length + (ai.goal.checkpoint?.sources.length ?? 0),
      checkpointLabel: ai.goal.checkpoint ? messages['goal/checkpoint']({ count: ai.goal.checkpoint.sources.length }) : '',
      // newest first: the last thing that happened is the thing a reader
      // wants, and the whole log would push the conversation off screen
      progress: [...ai.goal.progress].reverse().slice(0, PROGRESS_SHOWN)
        .map((entry: any) => ({ note: entry.note, evidence: entry.evidence })),
      more: Math.max(0, ai.goal.progress.length - PROGRESS_SHOWN),
      moreLabel: messages['goal/more']({ count: Math.max(0, ai.goal.progress.length - PROGRESS_SHOWN) }),
    },
    goalDraft: ai.goalDraft,
    memories: ai.memories,
    memoryLabel: messages['ledger/memories']({ count: ai.memories }),
    persistenceLabel: ai.persistence?.error ? messages['ledger/storage-failed']({ detail: ai.persistence.error })
      : ai.persistence?.concurrency === 'single-writer' ? messages['ledger/single-writer']() : '',
    retentionLabel: ai.retention?.evicted?.length
      ? messages['ledger/evicted']({ count: ai.retention.evicted.length }) : '',
    archived: ai.archived,
    // said in full sentences, because "12" beside a chat is not
    // information: a compacted session has to LOOK recoverable
    archivedLabel: messages['ledger/archived']({ count: ai.archived }),
    remembering: ai.remembering,
    remembered: ai.remembered,
  };
}

/** Progress entries the panel shows before it says "and N more". */
const PROGRESS_SHOWN = 3;
