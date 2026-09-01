/**
 * Chat, grounded on the curated memory and the document corpus.
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
import { recallByEmbedding, type MemoryStore } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { IdentityRepository, TangleDb } from '@tangleai/store';
import type { DocumentCorpusStore, RankedDocumentChunk } from '@tangleai/documents';

import {
  collectDocumentEvidence,
  generateGroundedAnswer,
  renderGroundedAnswer,
  serializeDocumentEvidence,
  type DocumentEvidence,
} from './grounding.ts';

import type { Settings } from './settings.ts';
import { asRows } from '@tangleai/store';
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
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  recallK?: number;
}

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
  send(text: string): Promise<ChatOutcome>;
}

export function createChatEngine(options: ChatEngineOptions): ChatEngine {
  const { db, memoryStore, documentStore } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const recallK = options.recallK ?? 6;
  const chats = db.collection<ChatMessageRecord>('chats');
  let sequence = 0;

  async function persist(message: Omit<ChatMessageRecord, 'id'>): Promise<ChatMessageRecord> {
    sequence += 1;
    const id = `c-${message.at}-${String(sequence).padStart(4, '0')}-${hashContent(message.text)}`;
    const record: ChatMessageRecord = { id, ...message };
    await chats.put(record);
    return record;
  }

  return {
    async history(limit = 200) {
      const rows = asRows(
        await chats.execute<ChatMessageRecord>({ $for: { c: '$[*]' }, $return: '$c' }),
      );
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(-limit);
    },

    async send(text) {
      const settings = await options.settings();
      await persist({ role: 'user', text, at: now() });

      const stack = await options.stackFor(settings, { fetch: options.fetch, retry: { attempts: 1 } });
      if (stack.state === 'refused') {
        // an incomplete or invalid configuration is a value the user can
        // fix — never an answer that pretends another stack was asked
        const detail = stack.issues.map((issue) => `${issue.code} ${issue.path}`).join('; ');
        const reply = await persist({
          role: 'assistant',
          text: `_The AI configuration was refused (${detail}) — fix Settings; no source was consulted._`,
          at: now(),
          citations: [],
          provider: null,
          identityId: null,
          usage: null,
        });
        return { reply, citations: [], documentCitations: [], provider: null };
      }

      const embedder = stack.embedder;
      let ranked: Array<{ unit: MemoryUnit, score: number }> = [];
      let documentRanked: RankedDocumentChunk[] = [];
      let evidence: DocumentEvidence | null = null;
      try {
        const [vector] = await embedder.embed([text]);
        const identity = { model: embedder.model, dims: embedder.dims ?? vector.length };
        ranked = recallByEmbedding(await memoryStore.list(), vector, { k: recallK, identity }).ranked;
        const collected = await collectDocumentEvidence(documentStore, vector, identity, { k: recallK, maxPerSource: 2 });
        // the helper reports a failure as a value; the chat surface keeps
        // its measured degradation and projects it to empty evidence
        if (!collected.ok) throw new Error(collected.error.message);
        evidence = collected.evidence;
        documentRanked = evidence.ranked;
      } catch {
        ranked = []; // a dead embedding wire degrades recall, never chat
        documentRanked = [];
        evidence = null;
      }
      const recalled = ranked.map((r) => r.unit);

      const runIdentity = stack.state === 'ready' ? stack.identity : stack.embedder.finalIdentity();
      if (runIdentity !== null) await options.identities.put(runIdentity);

      const chat = settings.chat;
      let replyText: string;
      let provider: string | null = null;
      let usage: unknown = null;
      // the degraded paths visibly QUOTE every retrieved source, so their
      // citations are used by construction; the structured path below
      // narrows these to the ids the answer actually named
      let citedMemories: MemoryUnit[] = recalled;
      let citedDocuments: RankedDocumentChunk[] = documentRanked;
      let visibleCitations: string[] = [...recalled.map((u) => u.id), ...documentRanked.map((item) => item.chunk.id)];

      if (stack.chat === null) {
        replyText = groundedOfflineReply(ranked, documentRanked, '_No chat model is configured (Settings → Chat provider)._');
      } else {
        const history = await this.history(12);
        // the ids this request actually serialized — the semantic gate's
        // whole vocabulary. Expanded neighbour chunks are supplied too.
        const listed = new Set<string>([
          ...recalled.map((u) => u.id),
          ...(evidence?.suppliedChunkIds ?? documentRanked.map((item) => item.chunk.id)),
        ]);
        const outcome = await generateGroundedAnswer(stack.chat, [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n${memoryContext(ranked)}\n\n${documentContext(documentRanked)}` },
          ...history.slice(0, -1).map((m) => ({ role: m.role, content: m.text })),
          { role: 'user', content: text },
        ], listed);
        usage = outcome.usage;
        if (outcome.answer !== null) {
          provider = `${chat.provider}/${chat.model}`;
          replyText = renderGroundedAnswer(outcome.answer);
          // only ids the answer named become citations, in first-visible
          // order; retrieved unused candidates stay inside the local trace
          const named: string[] = [];
          const seen = new Set<string>();
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
          const note = outcome.failure!.kind === 'wire'
            ? `_The chat wire failed (${excerpt(outcome.failure!.detail, 120)}) — answering from retrieved sources._`
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
      });
      return { reply, citations: citedMemories, documentCitations: citedDocuments, provider };
    },
  };
}
