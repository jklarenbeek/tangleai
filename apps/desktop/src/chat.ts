/**
 * Chat, grounded on the curated memory and the document corpus.
 *
 * Every question is a RUN: `start` admits it through the chat
 * scheduler, opens a run, and answers `{ runId, messageId }` while the
 * work continues in the background, appending what it does as frames —
 * the identity it resolved, what it retrieved, provisional deltas while
 * the model generates, the provider's usage block, every degradation by
 * name, and the answer's address. A watcher subscribes to that run;
 * `send` is the same run awaited to its end, so the request/response
 * surface is unchanged. Cancelling aborts the run's own controller and
 * ends it as `cancelled` — a state the transcript shows rather than an
 * answer that never arrives.
 *
 * Every question is embedded and ranked against both lanes
 * (`recallByEmbedding` — superseded records can't surface, and only
 * records embedded by the SAME identity as the question are ranked; a
 * folder synced under another embedder is skipped, never scored;
 * `collectDocumentEvidence` — the one serializer the benchmark
 * measures). The top hits are the model's CANDIDATES, not its
 * citations: a configured model answers through the suite's structured
 * output under the measured claims-with-citations contract, a
 * supplied-reference gate repairs a fabricated id, and only the ids the
 * answer actually named surface as citations — retrieved unused
 * candidates stay inside the local trace. When no model is configured,
 * the wire fails, or the reply stays invalid after repair, the answer
 * degrades to grounded recall — the sources themselves, visibly quoted
 * and therefore cited, with an honest note. Errors are values here: a
 * dead Ollama never breaks chat.
 */

import { hashContent } from '@jarenjs/core/string';
import { excerpt } from '@jarenjs/core/chunk';
import { DEFAULT_MEMORY_POLICY, recallByEmbedding, type MemoryStore } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { IdentityRepository, RunLog, TangleDb } from '@tangleai/store';
import type { DocumentCorpusStore, RankedDocumentChunk } from '@tangleai/documents';

import {
  collectDocumentEvidence,
  GROUNDING_DEFAULTS,
  generateGroundedAnswer,
  renderGroundedAnswer,
  serializeDocumentEvidence,
  type DocumentEvidence,
} from './grounding.ts';

import type { Settings } from './settings.ts';
import { asRows } from '@tangleai/store';
import { createFrameSink, type FrameSink } from './frames.ts';
import type { HostStack, StackOptions } from './ai-host.ts';

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  citations?: string[];
  /** Display metadata only — the identity reference is the identity. */
  provider?: string | null;
  /** The content-addressed config identity that produced this answer; null when no stack ran or none could finalize. */
  identityId?: string | null;
  /** Provider-reported usage, kept verbatim as observation. */
  usage?: unknown;
  /** The decision this reply IS, once one was recorded; null when none could be. */
  decisionId?: string | null;
  /** The verdict an operator recorded against this reply, once one was accepted. */
  feedback?: { at: string, verdict: string, resolutionId: string } | null;
}

export interface ChatOutcome {
  reply: ChatMessageRecord;
  citations: MemoryUnit[];
  documentCitations: RankedDocumentChunk[];
  provider: string | null;
}

export interface ChatEngineOptions {
  db: TangleDb;
  memoryStore: MemoryStore;
  documentStore: DocumentCorpusStore;
  settings: () => Promise<Settings>;
  /** Resolves settings into the identity-bearing stack; injected so tests script it. */
  stackFor: (settings: Settings, options: StackOptions) => Promise<HostStack>;
  identities: IdentityRepository;
  runLog: RunLog;
  /** The controller of every chat run this process is executing, keyed by run id. */
  inflight: Map<string, AbortController>;
  /** Bounded admission; a refusal is the scheduler's own `queue-full`/`closed` error. */
  scheduler: { run<T>(worker: () => T | Promise<T>, context?: { scope?: string, signal?: AbortSignal }): Promise<T> };
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  /** Monotonic milliseconds, for coalescing only — never for a stored timestamp. */
  ticks?: () => number;
  recallK?: number;
  /**
   * Record what this reply decided, so a verdict on it has something to
   * resolve. Injected: the chat engine states the facts of its own
   * answer and knows nothing about how they are kept. A refusal is a
   * value — the reply still answers, with no decision to its name.
   */
  recordDecision?: (
    reply: ChatMessageRecord,
    facts: { question: string, disposition: 'answer' | 'refusal' },
  ) => Promise<{ ok: true, decisionId: string } | { ok: false, issues: Array<{ code: string, path: string, detail: string }> }>;
}

/**
 * Provisional model text, batched. A delta frame is an observation that
 * generation is moving, so it is capped in both directions: no more
 * than one frame per `maxMs`, and no frame longer than `maxChars`.
 */
export function createDeltaCoalescer(options: {
  maxMs: number, maxChars: number, ticks: () => number,
  emit: (text: string, chars: number) => void,
}): { push(text: string): void, flush(): void } {
  let held = '';
  let opened = options.ticks();
  const release = (): void => {
    if (held === '') return;
    options.emit(held, held.length);
    held = '';
    opened = options.ticks();
  };
  return {
    push(text) {
      if (text === '') return;
      if (held === '') opened = options.ticks();
      held += text;
      while (held.length >= options.maxChars) {
        const slice = held.slice(0, options.maxChars);
        held = held.slice(options.maxChars);
        options.emit(slice, slice.length);
        opened = options.ticks();
      }
      if (held !== '' && options.ticks() - opened >= options.maxMs) release();
    },
    flush: release,
  };
}

/** The text a cancelled run leaves in the transcript, so the conversation says what happened. */
export const CANCELLED_REPLY = '_The run was cancelled before it answered._';

/** How long, and how much, provisional model text is held before it becomes one frame. */
export const DELTA_COALESCE_MS = 64;
export const DELTA_COALESCE_CHARS = 512;

export const SYSTEM_PROMPT = [
  'You are Tangle, an assistant whose ONLY knowledge sources are the two explicit lanes below:',
  'curated memories and verbatim document chunks. Answer from these sources and cite the ones you',
  'used by their [id]. If neither lane contains the answer, say so plainly —',
  'do not invent. Keep answers short and concrete.',
].join(' ');

function memoryContext(ranked: Array<{ unit: MemoryUnit, score: number }>): string {
  if (ranked.length === 0) return 'MEMORIES: (none recalled)';
  const lines = ranked.map(({ unit, score }) =>
    `[${unit.id}] (${score.toFixed(3)}) ${unit.text}\n    evidence: ${unit.evidence}`);
  return `MEMORIES:\n${lines.join('\n')}`;
}

/** The document evidence section — the ONE serializer in `grounding.ts`, so the benchmark measures the product's exact bytes. */
function documentContext(ranked: RankedDocumentChunk[]): string {
  return serializeDocumentEvidence(ranked).context;
}

function offlineReply(ranked: Array<{ unit: MemoryUnit, score: number }>, note: string): string {
  if (ranked.length === 0) {
    return `${note}\n\nNo memories matched this question yet — sync a folder first, or ask something the ingested documents cover.`;
  }
  const lines = ranked.map(({ unit }) => `- ${unit.text} — *${excerpt(unit.evidence, 72)}* \`[${unit.id}]\``);
  return `${note}\n\nGrounded recall:\n${lines.join('\n')}`;
}

function groundedOfflineReply(
  memories: Array<{ unit: MemoryUnit, score: number }>,
  documents: RankedDocumentChunk[],
  note: string,
): string {
  if (memories.length === 0 && documents.length === 0) return offlineReply(memories, note);
  const memoryLines = memories.map(({ unit }) => `- ${unit.text} — *${excerpt(unit.evidence, 72)}* \`[${unit.id}]\``);
  const documentLines = documents.map(({ chunk, source }) =>
    `- ${chunk.text} — *${source.title ?? source.canonicalUrl}* \`[${chunk.id}]\``);
  return `${note}\n\nGrounded recall:\n${[...memoryLines, ...documentLines].join('\n')}`;
}

export interface ChatEngine {
  history(limit?: number): Promise<ChatMessageRecord[]>;
  /** Open a run for this question; the work continues after the handshake. */
  start(text: string): Promise<{ runId: string, messageId: string, done: Promise<ChatOutcome> }>;
  /** The same run, awaited to its outcome. */
  send(text: string): Promise<ChatOutcome>;
}

export function createChatEngine(options: ChatEngineOptions): ChatEngine {
  const { db, memoryStore, documentStore, runLog, inflight, scheduler } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const ticks = options.ticks ?? ((): number => Date.now());
  const recallK = options.recallK ?? DEFAULT_MEMORY_POLICY.retrieval.k;
  const documentRecallK = options.recallK ?? GROUNDING_DEFAULTS.k;
  const chats = db.collection<ChatMessageRecord>('chats');
  let sequence = 0;

  async function persist(message: Omit<ChatMessageRecord, 'id'>): Promise<ChatMessageRecord> {
    sequence += 1;
    const id = `c-${message.at}-${String(sequence).padStart(4, '0')}-${hashContent(message.text)}`;
    const record: ChatMessageRecord = { id, ...message };
    await chats.put(record);
    return record;
  }

  async function history(limit = 200): Promise<ChatMessageRecord[]> {
    const rows = asRows(
      await chats.execute<ChatMessageRecord>({ $for: { c: '$[*]' }, $return: '$c' }),
    );
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return rows.slice(-limit);
  }

  /** The reply a cancelled run leaves behind, and the run's terminal state. */
  async function cancelled(runId: string, frames: FrameSink, at: string): Promise<ChatOutcome> {
    const reply = await persist({
      role: 'assistant', text: CANCELLED_REPLY, at: now(),
      citations: [], provider: null, identityId: null, usage: null,
    });
    const drained = await frames.drain();
    await runLog.finishRun(runId, 'cancelled', { at, messageId: reply.id, frameRefusals: drained.refused });
    return { reply, citations: [], documentCitations: [], provider: null };
  }

  /**
   * One question, from the resolved stack to the persisted reply, with
   * every step appended to the run as it happens. The signal is the
   * run's own — never the request's, which ends at the handshake.
   */
  async function answer(runId: string, text: string, signal: AbortSignal): Promise<ChatOutcome> {
    const frames = createFrameSink(runLog, runId);
    const settings = await options.settings();

    const stack = await options.stackFor(settings, {
      fetch: options.fetch,
      retry: { attempts: 1 },
      onFinal: async (identity) => {
        await options.identities.put(identity);
        await runLog.attachIdentity(runId, identity.identityId);
        await frames.append('identity', { identityId: identity.identityId });
      },
    });
    if (stack.state === 'refused') {
      // an incomplete or invalid configuration is a value the user can
      // fix — never an answer that pretends another stack was asked
      const detail = stack.issues.map((issue) => `${issue.code} ${issue.path}`).join('; ');
      await frames.append('degraded', { reason: 'refused', detail: excerpt(detail, 240) });
      const reply = await persist({
        role: 'assistant',
        text: `_The AI configuration was refused (${detail}) — fix Settings; no source was consulted._`,
        at: now(),
        citations: [],
        provider: null,
        identityId: null,
        usage: null,
      });
      await frames.append('answer', { messageId: reply.id, citations: [], provider: null });
      const drained = await frames.drain();
      await runLog.finishRun(runId, 'error', { refused: detail, messageId: reply.id, frameRefusals: drained.refused });
      return { reply, citations: [], documentCitations: [], provider: null };
    }
    if (stack.state === 'ready') {
      await runLog.attachIdentity(runId, stack.identity.identityId);
      await frames.append('identity', { identityId: stack.identity.identityId });
    }
    if (signal.aborted) return cancelled(runId, frames, 'configuration');

    const embedder = stack.embedder;
    let ranked: Array<{ unit: MemoryUnit, score: number }> = [];
    let documentRanked: RankedDocumentChunk[] = [];
    let evidence: DocumentEvidence | null = null;
    let skippedDocuments = 0;
    try {
      const [vector] = await embedder.embed([text]);
      const identity = { model: embedder.model, dims: embedder.dims ?? vector.length };
      ranked = recallByEmbedding(await memoryStore.list(), vector, { k: recallK, identity }).ranked;
      const collected = await collectDocumentEvidence(documentStore, vector, identity, { k: documentRecallK, maxPerSource: 2 });
      // the helper reports a failure as a value; the chat surface keeps
      // its measured degradation and projects it to empty evidence
      if (!collected.ok) throw new Error(collected.error.message);
      evidence = collected.evidence;
      documentRanked = evidence.ranked;
      skippedDocuments = collected.skipped;
    } catch (error) {
      // a dead embedding wire degrades recall, never chat — and the run
      // says so rather than showing an empty retrieval nobody explains
      ranked = [];
      documentRanked = [];
      evidence = null;
      await frames.append('degraded', {
        reason: 'embedding',
        detail: excerpt(error instanceof Error ? error.message : String(error), 120),
      });
    }
    const recalled = ranked.map((r) => r.unit);
    await frames.append('retrieval', {
      memories: recalled.length,
      documentChunks: documentRanked.length,
      skippedDocuments,
      candidates: [...recalled.map((u) => u.id), ...documentRanked.map((item) => item.chunk.id)],
    });
    if (signal.aborted) return cancelled(runId, frames, 'retrieval');

    const runIdentity = stack.state === 'ready' ? stack.identity : stack.embedder.finalIdentity();
    if (runIdentity !== null) await options.identities.put(runIdentity);

    let replyText: string;
    let provider: string | null = null;
    let usage: unknown = null;
    // the degraded paths visibly QUOTE every retrieved source, so their
    // citations are used by construction; the structured path below
    // narrows these to the ids the answer actually named
    let citedMemories: MemoryUnit[] = recalled;
    let citedDocuments: RankedDocumentChunk[] = documentRanked;
    let visibleCitations: string[] = [...recalled.map((u) => u.id), ...documentRanked.map((item) => item.chunk.id)];
    // what the reply DID, as the decision records it: a degraded answer
    // still answers from its sources; only an explicit abstention declines
    let disposition: 'answer' | 'refusal' = 'answer';

    if (stack.chat === null) {
      await frames.append('degraded', { reason: 'no-model', detail: 'no chat provider is configured' });
      replyText = groundedOfflineReply(ranked, documentRanked, '_No chat model is configured (Settings → Chat provider)._');
    } else {
      const past = await history(12);
      // the ids this request actually serialized — the semantic gate's
      // whole vocabulary. Expanded neighbour chunks are supplied too.
      const listed = new Set<string>([
        ...recalled.map((u) => u.id),
        ...(evidence?.suppliedChunkIds ?? documentRanked.map((item) => item.chunk.id)),
      ]);
      const deltas = createDeltaCoalescer({
        maxMs: DELTA_COALESCE_MS,
        maxChars: DELTA_COALESCE_CHARS,
        ticks,
        emit: (chunk, chars) => frames.push('delta', { text: chunk, chars }),
      });
      const outcome = await generateGroundedAnswer(stack.chat, [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${memoryContext(ranked)}\n\n${documentContext(documentRanked)}` },
        ...past.slice(0, -1).map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: text },
      ], listed, { signal, onDelta: (chunk: string) => deltas.push(chunk) });
      deltas.flush();
      usage = outcome.usage;
      await frames.append('usage', { usage: usage ?? null });
      if (signal.aborted) return cancelled(runId, frames, 'generation');
      if (outcome.answer !== null) {
        // what ANSWERED, named by the stack that built the wire — under a
        // named selection the settings say nothing about the chosen model
        provider = stack.display;
        replyText = renderGroundedAnswer(outcome.answer);
        // only ids the answer named become citations, in first-visible
        // order; retrieved unused candidates stay inside the local trace
        const named: string[] = [];
        const seen = new Set<string>();
        if (outcome.answer.disposition !== 'answer') disposition = 'refusal';
        if (outcome.answer.disposition === 'answer') {
          for (const claim of outcome.answer.claims) {
            for (const id of claim.citations) {
              if (seen.has(id)) continue;
              seen.add(id);
              named.push(id);
            }
          }
        }
        const memoryOf = new Map(recalled.map((unit) => [unit.id, unit]));
        citedMemories = [];
        citedDocuments = [];
        visibleCitations = [];
        const citedDocumentIds = new Set<string>();
        for (const id of named) {
          const unit = memoryOf.get(id);
          if (unit !== undefined) {
            citedMemories.push(unit);
            visibleCitations.push(id);
            continue;
          }
          // a cited neighbour chunk resolves through the ranked candidate
          // whose expanded context carried it into the prompt
          const item = documentRanked.find((entry) => entry.chunk.id === id || entry.context.some((chunk) => chunk.id === id));
          if (item !== undefined && !citedDocumentIds.has(item.chunk.id)) {
            citedDocumentIds.add(item.chunk.id);
            citedDocuments.push(item);
            visibleCitations.push(item.chunk.id);
          }
        }
      } else {
        const failure = outcome.failure!;
        await frames.append('degraded', { reason: failure.kind, detail: excerpt(failure.detail, 240) });
        const note = failure.kind === 'wire'
          ? `_The chat wire failed (${excerpt(failure.detail, 120)}) — answering from retrieved sources._`
          : '_The model\'s reply failed the grounded answer contract after repair — answering from retrieved sources._';
        replyText = groundedOfflineReply(ranked, documentRanked, note);
      }
    }

    const reply = await persist({
      role: 'assistant',
      text: replyText,
      at: now(),
      citations: visibleCitations,
      provider,
      identityId: runIdentity?.identityId ?? null,
      usage,
      decisionId: null,
    });
    // the decision is recorded between the row and the answer frame, so a
    // subscriber that sees the answer can open the form on it at once; a
    // refused decision is a value the form reports, never a failed answer
    if (options.recordDecision !== undefined && reply.identityId != null) {
      const decided = await options.recordDecision(reply, { question: text, disposition });
      if (decided.ok) {
        reply.decisionId = decided.decisionId;
        await chats.put(reply);
      }
    }
    await frames.append('answer', { messageId: reply.id, citations: visibleCitations, provider });
    const drained = await frames.drain();
    // a refused finish has already closed the run as an error inside its
    // own transaction, terminal frame included
    await runLog.finishRun(runId, 'ok', { messageId: reply.id, frameRefusals: drained.refused });
    return { reply, citations: citedMemories, documentCitations: citedDocuments, provider };
  }

  return {
    history,

    async start(text) {
      let admit: (handshake: { runId: string, messageId: string }) => void = () => {};
      let refuse: (reason: unknown) => void = () => {};
      const opened = new Promise<{ runId: string, messageId: string }>((resolve, reject) => {
        admit = resolve;
        refuse = reject;
      });
      // admission first: a refused request must leave no run row and no
      // half of a conversation behind
      const done = scheduler.run(async () => {
        const user = await persist({ role: 'user', text, at: now() });
        const run = await runLog.startRun('chat');
        const controller = new AbortController();
        inflight.set(run.id, controller);
        admit({ runId: run.id, messageId: user.id });
        try {
          return await answer(run.id, text, controller.signal);
        } catch (error) {
          // a run whose worker died still has to end: a row left running
          // is a run nobody can watch, resume or cancel
          await runLog.finishRun(run.id, 'error', { error: error instanceof Error ? error.message : String(error) });
          throw error;
        } finally {
          inflight.delete(run.id);
        }
      }, { scope: 'chat' });
      done.catch((error: unknown) => refuse(error));
      const handshake = await opened;
      return { ...handshake, done };
    },

    async send(text) {
      const started = await this.start(text);
      return started.done;
    },
  };
}
