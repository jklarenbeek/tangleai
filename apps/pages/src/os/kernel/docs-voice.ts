/**
 * The docs' voice, Tangle edition: a question answered by a language
 * model from the library's passages, and from nothing else.
 *
 * The library's own search finds the passages; the model is handed them
 * numbered and asked to answer only from them, citing each one it uses
 * as [n]. An answer is kept only when it cites at least one passage it
 * was given — evidence is mandatory — and its citations are exactly those
 * passages; anything else (no model, a failed call, an answer that cites
 * nothing or cites what it was not given) falls back to the offline
 * answer, the passages themselves with where they came from.
 */

import { createChatClient } from '@tangleai/models';
import { answerFromDocs, placeOf } from './library.ts';
import type { Hit } from './library.ts';
import { isLive } from './oracle.ts';
import type { ModelSettings } from './oracle.ts';

export type Answer = ReturnType<typeof answerFromDocs>;

export type DocsVoice = {
  readonly live: boolean,
  configure: (settings: ModelSettings | null | undefined) => void,
  ask: (question: string, hits: readonly Hit[]) => Promise<Answer>,
};

/** The passages the model may answer from, at most this many. */
export const PASSAGES = 4;

/** The question and its passages, as the model reads them. */
export function docsPrompt(question: string, hits: readonly Hit[]): Array<{ role: string, content: string }> {
  return [
    {
      role: 'system',
      content: 'You answer questions about Radiant OS and the Tangle AI packages from the numbered passages of their documentation, and from nothing else. '
        + 'Cite every passage you use as [n]. Keep it to a few sentences. If the passages do not answer the question, say so in one sentence.',
    },
    {
      role: 'user',
      content: `${hits.map((h, i) => `[${i + 1}] ${placeOf(h)}: ${h.excerpt}`).join('\n')}\n\nQuestion: ${question.trim()}`,
    },
  ];
}

/** The passages an answer cites, in the order it first cites them; out-of-range numbers are not citations. */
export function citedIn(text: string, hits: readonly Hit[]): Hit[] {
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= hits.length) seen.add(n - 1);
  }
  return [...seen].map((i) => hits[i]);
}

/**
 * The docs' voice: a live model when the assistant's settings name one,
 * the offline answer otherwise.
 */
export function createDocsVoice(options: { settings?: ModelSettings | null, fetch?: typeof fetch, onError?: (error: unknown) => void } = {}): DocsVoice {
  let chat: ReturnType<typeof createChatClient> | null = null;
  const configure = (next: ModelSettings | null | undefined) => {
    chat = !isLive(next) ? null : createChatClient({
      provider: next.provider, baseUrl: next.baseUrl || undefined, apiKey: next.apiKey || undefined,
      model: next.model, fetch: options.fetch, maxTokens: 500,
    });
  };
  configure(options.settings);
  return {
    get live() { return chat !== null; },
    configure,
    async ask(question, hits) {
      const offline = answerFromDocs(question, hits);
      const passages = hits.filter((h) => h.excerpt.length > 0).slice(0, PASSAGES);
      if (chat === null || passages.length === 0) return offline;
      try {
        const reply = await chat.complete({ messages: docsPrompt(question, passages) });
        const text = typeof reply?.message?.content === 'string' ? reply.message.content.trim() : '';
        const cited = citedIn(text, passages);
        if (text === '' || cited.length === 0) return offline;
        return { text, citations: cited.map((h) => ({ doc: h.doc, section: h.section, label: placeOf(h) })) };
      }
      catch (error) {
        options.onError?.(error);
        return offline;
      }
    },
  };
}
