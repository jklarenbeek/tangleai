import { createChatClient, probeProvider } from '@tangleai/models';
import { createAgent, createRefiner } from '@tangleai/agents';
import { createEnvironment } from '@tangleai/context';
import { applyJSONPatch, compileJsonQuery } from '@jarenjs/json';
import { isConfigured } from './settings.ts';
/** Chat turns sent back to the model per request (persisted transcripts can be long). */
const HISTORY_WINDOW = 20;

/** Chat turns kept in the persisted transcript (a localStorage slot, not an archive). */
const SAVED_WINDOW = 100;

/**
 * How many memories the agent carries into a turn. Small on purpose:
 * they are paid for out of the same history budget the conversation is,
 * and a retrieval that crowded out the conversation would be a worse
 * assistant with a better memory.
 */
const MEMORY_WINDOW = 5;

/**
 * The ledger as the panel shows it: the active objective (a superseded
 * or abandoned one is not "what we are doing" and is not shown), what
 * has been recorded against it, and how many dropped rounds are sitting
 * in slots waiting for a `recall`. One read, so the panel can never
 * disagree with itself about which turn it is describing.
 */
async function readLedger(ledger: any) {
  const goal = await ledger.getGoal();
  const slots = await ledger.listSlots();
  return {
    goal: goal !== null && goal.status === 'active'
      ? { objective: goal.objective, progress: goal.progress, checkpoint: goal.checkpoint }
      : null,
    memories: (await ledger.listMemories()).length,
    archived: slots.filter((slot: any) => slot.kind === 'agent-round').length,
    persistence: ledger.storageStatus?.() ?? null,
    retention: await ledger.retentionReport?.() ?? null,
  };
}

/**
 * The assistant's impure effects: the streaming agent turn, the
 * settings persistence, the transcript persistence and the ledger. The
 * injected `aiFetch` keeps the whole thing testable against a scripted
 * transport, and the injected `ledger` keeps it testable without a
 * store.
 */
export function createAssistantController(deps: {
  toolbox: any;
  getApp: () => any;
  aiFetch?: typeof fetch;
  aiStorage: {
    read: () => any;
    write: (data: any) => any;
  };
  aiChat: {
    read: () => any;
    write: (data: any) => any;
  };
  ledger: any;
  system?: string;
  headers?: Record<string, string>;
  onDispose?: () => any;
}) {
  let disposed = false, epoch = 0, closing: any;

  let turnAbort: AbortController | null = null;
  const lifetime = new AbortController();
  const fetchImpl = deps.aiFetch ?? globalThis.fetch;
  deps = {
    ...deps, aiFetch: (url: any, init = {}) => fetchImpl(url, {
      ...init,
      signal: AbortSignal.any([lifetime.signal, ...(init.signal ? [init.signal] : [])])
    })
  };
  function cancel() { epoch++; turnAbort?.abort(); turnAbort = null; }
  function dispose() {
    if (disposed) return closing;
    disposed = true; cancel(); lifetime.abort();
    closing = Promise.resolve().then(() => deps.onDispose?.());
    return closing;
  }
  /**
   * The last completed turn, kept here rather than in the state: it is
   * the trajectory a refinement reads, it is large, and nothing renders
   * it. State holds what the panel draws; this holds what the next
   * action needs.
   * @type
   */
  let lastRun: {
    messages: any[];
    steps: any[];
  } | null = null;

  /** The client the current settings describe, or a dispatched failure. */
  const clientFor = (state: any, dispatch: any) => {
    const s = state.ai.settings;
    try {
      return createChatClient({
        provider: s.provider,
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model,
        fetch: deps.aiFetch,
        headers: deps.headers,
      });
    }
    catch (err: any) {
      dispatch('ai/failed', (err as Error).message);
      return null;
    }
  };

  const rawEffects = {
    'ai-send': (props: any, dispatch: any) => {
      const app = deps.getApp();
      const state = app.getState();
      const draft = state.ai.draft.trim();
      if (draft === '' || state.ai.status === 'streaming') return;
      if (!isConfigured(state.ai.settings)) {
        dispatch('ai/failed', 'Add a provider, model and (for OpenRouter) an API key in settings first.');
        return;
      }
      const runEpoch = epoch;
      dispatch('ai/user', draft);

      const client = clientFor(state, dispatch);
      if (client === null) return;

      // weak local models are first-class: enough rounds to read an
      // engine's { error } result, fetch an example and try again —
      // and a studio flow (template → write → patch → repair → save)
      // legitimately runs past a dozen rounds on a small model. The
      // history budget keeps those long sessions inside a small local
      // context window (~6k tokens), which is what makes the higher
      // cap affordable.
      //
      // With the ledger under it, that budget stops destroying: every
      // round it drops is archived to a slot first and the model can
      // `recall` it back. The same ledger puts the objective and what
      // has been learned into the prompt of every turn.
      // and with an ENVIRONMENT over that same ledger, the archive stops
      // being a list of addresses to fetch one at a time: `env_grep`
      // scans every archived round for a pattern and answers with which
      // slot matched and one line of context, so "what did we try
      // earlier?" costs one call instead of one call per round. The
      // corpus and the archive share a store on purpose — the same
      // operations reach both.
      const environment = createEnvironment({
        ledger: deps.ledger,
        compileQuery: compileJsonQuery,
      });
      const agent = createAgent({
        client, toolbox: {
          toFunctionTools: () => deps.toolbox.toFunctionTools(),
          execute: (name, args: any) => disposed || epoch !== runEpoch
            ? { error: 'The assistant turn was cancelled.' } : deps.toolbox.execute(name, args)
        }, system: deps.system ?? 'Help the user complete their task using the available tools.', maxToolRounds: 16,
        historyBudget: 24_000,
        ledger: deps.ledger,
        environment,
        retrieval: { memories: { limit: MEMORY_WINDOW } },
      });
      // build the turn from this effect's own snapshot: the ai/user
      // dispatch above is queued FIFO behind the running transaction,
      // so a getState() here would still miss the draft
      const history = [...state.ai.messages, { role: 'user', content: draft }]
        .slice(-HISTORY_WINDOW)
        .map((m: any) => ({ role: m.role, content: m.content }));
      turnAbort?.abort(); turnAbort = new AbortController();
      return agent.send(history, {
        signal: turnAbort.signal,
        onDelta: (text) => dispatch('ai/delta', text),
        onReasoning: (text) => dispatch('ai/reasoning', text.length),
        onToolCall: (call) => dispatch('ai/activity', call.name),
        // back to 'Thinking…' between a tool's result and the next token
        onToolResult: () => dispatch('ai/activity', null),
      }).then(
        // an empty final message is a model quirk worth an honest line —
        // and a reasoning-only turn deserves to say what happened
        (result) => {
          if (disposed || epoch !== runEpoch) return;
          lastRun = { messages: result.messages, steps: result.steps };
          dispatch('ai/reply', result.message.content !== ''
            ? result.message.content
            : result.message.reasoning !== undefined
              ? '*The model spent the whole turn reasoning without a final reply — send another message to continue.*'
              : '*The model ended its turn without a reply — whatever it loaded is on screen; send another message to continue.*');
          // the archive grows during a turn, so the panel's count is read
          // after it: what the model can still reach is a fact about the
          // finished turn, not the one that started it
          readLedger(deps.ledger).then((view) => dispatch('ai/ledger', view), () => { });
        },
        (err: any) => dispatch('ai/failed', err?.message ?? String(err)),
      );
    },

    // the ledger panel: one read, dispatched as one value. Run on open
    // (so a reloaded page shows the objective it was left with) and
    // after anything that writes.
    'ai-ledger-read': (props: any, dispatch: any) => {
      readLedger(deps.ledger).then((view) => dispatch('ai/ledger', view),
        (err: any) => dispatch('ai/failed', err?.message ?? String(err)));
    },

    // clearing the conversation clears what compaction archived FROM it:
    // an archived round is a piece of a transcript, and its address only
    // ever appeared in that transcript's synopsis. Keeping the rounds
    // would leave the panel counting recoverable context for a
    // conversation that no longer exists — and leave bytes in the store
    // that nothing can ever name again. Memories and the goal survive:
    // they are what was LEARNED, not what was said.
    'ai-clear-archive': (props: any, dispatch: any) => {
      (typeof deps.ledger.clearArchives === 'function' ? deps.ledger.clearArchives()
        : deps.ledger.listSlots().then((slots: any) => Promise.all(slots
          .filter((slot: any) => slot.kind === 'agent-round' || slot.kind === 'agent-round-index')
          .map((slot: any) => deps.ledger.deleteSlot(slot.name)))))
        .then(() => readLedger(deps.ledger))
        .then((view: any) => dispatch('ai/ledger', view),
          (err: any) => dispatch('ai/failed', err?.message ?? String(err)));
    },

    'ai-goal-set': (props: any, dispatch: any) => {
      const objective = deps.getApp().getState().ai.goalDraft.trim();
      if (objective === '') return;
      deps.ledger.setGoal({ objective }).then((goal: any) => {
        if (goal?.error !== undefined) {
          dispatch('ai/failed', goal.error);
          return;
        }
        // the draft is cleared by what comes back from the ledger, not by
        // the action: the objective on screen is the stored one
        return readLedger(deps.ledger).then((view) => dispatch('ai/goal-committed', view));
      }, (err: any) => dispatch('ai/failed', err?.message ?? String(err)));
    },

    // "clear" abandons the objective rather than deleting it: the ledger
    // keeps what this agent was asked to do, and the panel stops showing
    // an objective nobody is working on
    'ai-goal-clear': (props: any, dispatch: any) => {
      deps.ledger.setGoalStatus('abandoned')
        .then(() => readLedger(deps.ledger))
        .then((view: any) => dispatch('ai/ledger', view),
          (err: any) => dispatch('ai/failed', err?.message ?? String(err)));
    },

    // the refinement button: the model proposes an RFC 6902 patch over
    // its own supplemental state, every stage of the gate runs, and what
    // survives is committed. The patch engine is INJECTED here, exactly
    // as @tangleai/agents requires — the package never imports @jarenjs/json.
    'ai-remember': (props: any, dispatch: any) => {
      const state = deps.getApp().getState();
      if (lastRun === null) {
        dispatch('ai/remembered', { note: 'Nothing to remember yet — send a message first.' });
        return;
      }
      if (!isConfigured(state.ai.settings)) {
        dispatch('ai/remembered', { note: 'Add a provider, model and key in settings first.' });
        return;
      }
      const client = clientFor(state, dispatch);
      if (client === null) return;
      return createRefiner({
        client,
        ledger: deps.ledger,
        applyPatch: (document: any, patch) => applyJSONPatch(document, patch),
      }).refine(lastRun, { signal: lifetime.signal }).then((outcome: any) => {
        const written = outcome.ok === true
          ? outcome.memories.length + outcome.skills.length + outcome.progress.length
          : 0;
        dispatch('ai/remembered', {
          note: outcome.ok !== true
            ? `Nothing was stored — ${outcome.error}`
            : written === 0
              ? 'The assistant found nothing worth remembering from this session.'
              : `Remembered ${written} evidenced item${written === 1 ? '' : 's'}.`,
        });
        return readLedger(deps.ledger).then((view) => dispatch('ai/ledger', view));
      }, (err: any) => dispatch('ai/remembered', { note: err?.message ?? String(err) }));
    },

    'ai-save-settings': async (_props: any, dispatch: any) => {
      try {
        if (await deps.aiStorage.write(deps.getApp().getState().ai.settings) === false)
          throw new Error('Assistant settings could not be saved.');
      }
      catch (error: any) { dispatch('ai/settings-open', true); dispatch('ai/failed', error.message); }
    },

    // the settings "Test connection" button: one /models probe with the
    // exact auth a chat turn would use; the result object drives the
    // status line and the model-name datalist
    'ai-probe': (props: any, dispatch: any) => {
      const s = deps.getApp().getState().ai.settings;
      return probeProvider({
        provider: s.provider,
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        fetch: deps.aiFetch,
      }).then((result) => dispatch('ai/probe-result', result.ok
        ? {
          status: 'ok',
          detail: `Connected — ${result.models.length} model${result.models.length === 1 ? '' : 's'} available.`,
          models: result.models.slice(0, 100),
        }
        : { status: 'fail', detail: result.error, models: [] }));
    },

    // opening the panel unconfigured lands you in settings — pinned
    // open, so the form does not hide the moment typing a model name
    // makes the configuration valid (only Save closes and persists it)
    'ai-ensure-settings': (props: any, dispatch: any) => {
      const state = deps.getApp().getState();
      if (state.ai.open && !isConfigured(state.ai.settings)) {
        dispatch('ai/settings-open', true);
      }
    },

    // the transcript mirror: every appended turn (and a clear) writes
    // the visible messages through the injected store, so a reload
    // resumes the conversation
    'ai-persist': async (_props: any, dispatch: any) => {
      const messages = deps.getApp().getState().ai.messages;
      try {
        if (await deps.aiChat.write({ messages: messages.slice(-SAVED_WINDOW) }) === false)
          throw new Error('The assistant transcript could not be saved.');
      }
      catch (error: any) { dispatch('ai/failed', error.message); }
    },
  };
  const effects = Object.fromEntries(Object.entries(rawEffects).map(([name, effect]) => [name, (props: any, dispatch: any) => {
    if (disposed) return;
    const version = epoch;
    const publish = (action: any, payload: any) => { if (!disposed && version === epoch) dispatch(action, payload); };
    return effect(props, publish);
  }]));
  effects['ai-cancel'] = () => { if (!disposed) cancel(); };
  effects['ai-clear-run'] = () => { if (!disposed) { cancel(); lastRun = null; } };
  return { effects, cancel, dispose, get signal() { return turnAbort?.signal ?? lifetime.signal; } };
}
