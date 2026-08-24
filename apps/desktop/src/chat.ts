/**
 * Chat, grounded on the curated memory.
 *
 * Every question is embedded, ranked against the live memory
 * (`rankByEmbedding` — superseded records can't surface), and the top
 * hits become both the model's context and the visible citations. The
 * model is @jarenjs/ai's `createChatClient` when the user configured
 * one; when none is configured OR the wire fails, the answer degrades
 * to grounded recall — the memories themselves, cited, with an honest
 * note. Errors are values here: a dead Ollama never breaks chat.
 */

import { createChatClient } from '@jarenjs/ai';
import { hashContent } from '@jarenjs/core/string';
import { excerpt } from '@jarenjs/core/chunk';
import { rankByEmbedding, type MemoryStore } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { TangleDb } from '@tangleai/store';

import type { Settings } from './settings.ts';
import { embedderFor } from './settings.ts';
import { asRows } from '@tangleai/store';

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  citations?: string[];
  provider?: string | null;
}

export interface ChatOutcome {
  reply: ChatMessageRecord;
  citations: MemoryUnit[];
  provider: string | null;
}

export interface ChatEngineOptions {
  db: TangleDb;
  memoryStore: MemoryStore;
  settings: () => Promise<Settings>;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  recallK?: number;
}

const SYSTEM_PROMPT = [
  'You are Tangle, an assistant whose ONLY knowledge source is the memory list below,',
  'curated from the user\'s own folder. Answer from these memories and cite the ones you',
  'used by their [id]. If the memories do not contain the answer, say so plainly —',
  'do not invent. Keep answers short and concrete.',
].join(' ');

function memoryContext(ranked: Array<{ unit: MemoryUnit, score: number }>): string {
  if (ranked.length === 0) return 'MEMORIES: (none recalled)';
  const lines = ranked.map(({ unit, score }) =>
    `[${unit.id}] (${score.toFixed(3)}) ${unit.text}\n    evidence: ${unit.evidence}`);
  return `MEMORIES:\n${lines.join('\n')}`;
}

function offlineReply(ranked: Array<{ unit: MemoryUnit, score: number }>, note: string): string {
  if (ranked.length === 0) {
    return `${note}\n\nNo memories matched this question yet — sync a folder first, or ask something the ingested documents cover.`;
  }
  const lines = ranked.map(({ unit }) => `- ${unit.text} — *${excerpt(unit.evidence, 72)}* \`[${unit.id}]\``);
  return `${note}\n\nGrounded recall:\n${lines.join('\n')}`;
}

export interface ChatEngine {
  history(limit?: number): Promise<ChatMessageRecord[]>;
  send(text: string): Promise<ChatOutcome>;
}

export function createChatEngine(options: ChatEngineOptions): ChatEngine {
  const { db, memoryStore } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const recallK = options.recallK ?? 6;
  const chats = db.collection('chats');
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
      const rows = asRows<ChatMessageRecord>(
        await chats.execute({ $for: { c: '$[*]' }, $return: '$c' }),
      );
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(-limit);
    },

    async send(text) {
      const settings = await options.settings();
      await persist({ role: 'user', text, at: now() });

      const embedder = embedderFor(settings, options.fetch);
      let ranked: Array<{ unit: MemoryUnit, score: number }> = [];
      try {
        const [vector] = await embedder.embed([text]);
        ranked = rankByEmbedding(await memoryStore.list(), vector, { k: recallK });
      } catch {
        ranked = []; // a dead embedding wire degrades recall, never chat
      }
      const citations = ranked.map((r) => r.unit);

      const chat = settings.chat;
      const configured = chat.provider !== null && chat.model !== null
        && (chat.baseUrl !== null || chat.provider === 'openrouter');

      let replyText: string;
      let provider: string | null = null;

      if (!configured) {
        replyText = offlineReply(ranked, '_No chat model is configured (Settings → Chat provider)._');
      } else {
        try {
          const client = createChatClient({
            provider: chat.provider as any,
            baseUrl: chat.baseUrl ?? undefined,
            model: chat.model ?? undefined,
            apiKey: chat.apiKey ?? undefined,
            fetch: options.fetch,
            retry: { attempts: 1 },
          });
          const history = await this.history(12);
          const outcome = await client.complete({
            messages: [
              { role: 'system', content: `${SYSTEM_PROMPT}\n\n${memoryContext(ranked)}` },
              ...history.slice(0, -1).map((m) => ({ role: m.role, content: m.text })),
              { role: 'user', content: text },
            ],
            stream: false,
          });
          replyText = String(outcome.message?.content ?? '').trim()
            || offlineReply(ranked, '_The model returned an empty reply._');
          provider = `${chat.provider}/${chat.model}`;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          replyText = offlineReply(ranked, `_The chat wire failed (${excerpt(reason, 120)}) — answering from memory alone._`);
        }
      }

      const reply = await persist({
        role: 'assistant',
        text: replyText,
        at: now(),
        citations: citations.map((u) => u.id),
        provider,
      });
      return { reply, citations, provider };
    },
  };
}
