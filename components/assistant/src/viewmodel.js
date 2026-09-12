//@ts-check
import { PROVIDER_OPTIONS, isConfigured } from './settings.js';
/** @param {any} ai @param {(source: string) => any} renderMarkdown */
export function assistantView(ai, renderMarkdown) {
  const s = ai.settings;
  const configured = isConfigured(s);
  return {
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
        models: ai.probe.models.map((id) => ({ id })),
      },
    },
    providers: PROVIDER_OPTIONS.map((p) => ({ ...p, selected: p.value === s.provider })),
    empty: ai.messages.length === 0,
    messages: ai.messages.map((m) => (m.role === 'user'
      ? { role: 'user', text: m.content }
      : { role: 'assistant', article: renderMarkdown(m.content) })),
    // the reply currently streaming in (plain text: it changes per token)
    streaming: ai.status === 'streaming',
    pending: ai.pending,
    // the quiet-phase label: reasoning models think before they speak,
    // and watching the thinking grow beats a blind spinner
    thinkingLabel: ai.reasoningChars > 0
      ? `Thinking… (${ai.reasoningChars} characters of reasoning)`
      : 'Thinking…',
    // the ledger: a persistent objective, what has been recorded against
    // it, and what a compacted session can still reach. Every number here
    // is derived from the ledger read, so the panel cannot claim a
    // memory the store does not hold.
    goal: ai.goal === null ? null : {
      objective: ai.goal.objective,
      entries: ai.goal.progress.length + (ai.goal.checkpoint?.sources.length ?? 0),
      checkpointLabel: ai.goal.checkpoint ? `${ai.goal.checkpoint.sources.length} earlier progress entries retained with their evidence.` : '',
      // newest first: the last thing that happened is the thing a reader
      // wants, and the whole log would push the conversation off screen
      progress: [...ai.goal.progress].reverse().slice(0, PROGRESS_SHOWN)
        .map((entry) => ({ note: entry.note, evidence: entry.evidence })),
      more: Math.max(0, ai.goal.progress.length - PROGRESS_SHOWN),
    },
    goalDraft: ai.goalDraft,
    memories: ai.memories,
    memoryLabel: `${ai.memories} remembered fact${ai.memories === 1 ? '' : 's'}`,
    persistenceLabel: ai.persistence?.error ? `Storage failed: ${ai.persistence.error}`
      : ai.persistence?.concurrency === 'single-writer' ? 'Use one tab at a time to update remembered state.' : '',
    retentionLabel: ai.retention?.evicted?.length
      ? `${ai.retention.evicted.length} earlier archive address(es) evicted under the storage budget.` : '',
    archived: ai.archived,
    // said in full sentences, because "12" beside a chat is not
    // information: a compacted session has to LOOK recoverable
    archivedLabel: `${ai.archived} earlier round${ai.archived === 1 ? '' : 's'} archived —`
      + ' the assistant can fetch any of them back with recall.',
    remembering: ai.remembering,
    remembered: ai.remembered,
  };
}

/** Progress entries the panel shows before it says "and N more". */
const PROGRESS_SHOWN = 3;
