export const DEFAULT_AI_SETTINGS = {
  provider: 'openrouter',  // 'openrouter' | 'ollama' | 'lmstudio' | 'custom'
  baseUrl: '',             // required for 'custom'; overrides the preset otherwise
  model: '',               // e.g. 'qwen/qwen3-4b' or a local model name
  apiKey: '',              // bring your own; local runtimes need none
};
/** @param [aiSettings] @param [aiChat] */
export function createAssistantState(aiSettings: any = null, aiChat: any = null) {
  return {
    open: false,
    settingsOpen: false,
    // the settings "Test connection" probe: idle | busy | ok | fail,
    // a human detail line, and the model ids a successful probe found
    probe: { status: 'idle', detail: null, models: [] },
    // reasoning characters streamed this turn (thinking models emit
    // reasoning before - or instead of - visible content)
    reasoningChars: 0,
    settings: { ...DEFAULT_AI_SETTINGS, ...(aiSettings ?? {}) },
    // visible transcript: { role, content }; restored from local
    // storage so a page reload keeps the conversation
    messages: Array.isArray(aiChat?.messages) ? structuredClone(aiChat.messages) : [],
    draft: '',             // composer text
    pending: '',           // the assistant reply currently streaming
    status: 'idle',        // 'idle' | 'streaming' | 'error'
    activity: null,        // the tool the model is currently calling
    error: null,
    // the @tangleai/context ledger, as the panel shows it. Read from the
    // ledger (not mirrored into it): the objective is durable state and
    // this slice is a view of it, so a reload shows what storage holds
    // rather than what this tab last typed.
    goal: null,            // { objective, progress: [ { at, note, evidence } ] }
    goalDraft: '',         // the objective composer
    memories: 0,           // evidenced facts carried into every turn
    persistence: null, retention: null,
    archived: 0,           // dropped rounds sitting in slots, recallable
    remembering: false,    // a refinement is in flight
    remembered: null,      // what the last refinement did, in one line
  };
}
