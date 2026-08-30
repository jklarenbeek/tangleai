/**
 * The scripted wire every live test runs against — one of them, not one
 * per test file. It answers `/embeddings` deterministically from the
 * suite's hash reference and `/chat/completions` from a script, and it
 * counts what was asked of it, so a test can assert that a census made
 * ZERO chat calls or that a failure was a wire failure rather than a
 * wrong answer.
 *
 * It lives here rather than in a test file because a second scripted
 * wire would be a second idea of what the provider does, and the first
 * thing to disagree would be the failure path nobody exercises.
 */

import { createHashEmbedder } from '@jarenjs/ai/embed';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../../apps/desktop/src/settings.ts';
import { chatSettingsOf, embedSettingsOf, readAiEnv } from '../../benchmark/lib/ai-env.ts';
import type { ReplayCache } from '../../benchmark/lib/wire-cache.ts';

export interface ScriptOptions {
  /** What the chat wire answers, given the request body. */
  chat?: (body: any) => { content: string, usage?: unknown } | Response;
  /** Fail every chat call with this status. */
  fail?: number;
  /** Sees every chat request body as the wire would — what the thinking control looked like on the wire. */
  onRequest?: (body: any) => void;
}

/** The program the scripted author writes: chunk by line, ask every piece about THIS question (as a real author would — a prompt that named no question would make every question's sub-call over a piece the same request), collect the values, answer. */
export function scriptedProgram(question: string): { steps: Array<Record<string, unknown>> } {
  return {
    steps: [
      { op: 'chunk', from: 'corpus', as: 'pieces', strategy: 'line', size: 2000 },
      { op: 'map', from: 'pieces', as: 'found', prompt: `Quote the turn that answers "${question.slice(0, 120)}", with its [id]; null if none.` },
      { op: 'reduce', from: 'found', as: 'summary', query: { $for: { r: '$[*].value' }, $return: '$r.value' } },
      { op: 'answer', from: 'summary' },
    ],
  };
}

/** A fetch that answers `/embeddings` deterministically and `/chat/completions` from a script. */
export function scriptedFetch(options: ScriptOptions = {}): { fetch: typeof globalThis.fetch, calls: { embeddings: number, chat: number, judge: number, author: number, subcall: number } } {
  const hash = createHashEmbedder({ dims: 8 });
  const calls = { embeddings: 0, chat: 0, judge: 0, author: 0, subcall: 0 };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url.endsWith('/embeddings')) {
      calls.embeddings++;
      const texts: string[] = Array.isArray(body.input) ? body.input : [body.input];
      const vectors = await hash.embed(texts);
      return new Response(JSON.stringify({ data: vectors.map((v, index) => ({ index, embedding: Array.from(v) })), model: body.model }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/chat/completions')) {
      const name = body.response_format?.json_schema?.name;
      const system: string = body.messages?.[0]?.content ?? '';
      const isSubcall = system.startsWith('You are given ONE piece');
      if (name === 'locomo_judge') calls.judge++;
      else if (name === 'jaren_program') calls.author++;
      else if (isSubcall) calls.subcall++;
      else calls.chat++;
      options.onRequest?.(body);
      if (options.fail !== undefined) return new Response('nope', { status: options.fail });
      if (name === 'locomo_judge') {
        return completion(JSON.stringify({ correct: /not|did not|no such/i.test(body.messages.at(-1).content), reasoning: 'scripted' }));
      }
      if (name === 'jaren_program') {
        const asked = /Question: ([^\n]*)/.exec(String(body.messages.at(-1).content));
        return completion(JSON.stringify(scriptedProgram(asked?.[1] ?? 'the question')));
      }
      if (isSubcall) {
        // the first turn of the piece, quoted with its id, in the shape the program's reduce reads (`$r.value`) — a JSON value, as a sub-call must answer
        const piece: string = body.messages.at(-1).content;
        const line = /^\[(D\d+:\d+)\] \([^)]*\) (?:[^:\n]+: )?(.*)$/m.exec(piece.slice(piece.indexOf('--- piece')));
        return completion(JSON.stringify(line === null ? null : { value: `${line[2]} [${line[1]}]` }));
      }
      const scripted = options.chat?.(body);
      if (scripted instanceof Response) return scripted;
      return completion(scripted?.content ?? JSON.stringify({ answer: '', citations: [] }), scripted?.usage);
    }
    return new Response('not scripted', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export function completion(content: string, usage: unknown = { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage, model: 'stub' }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}

/** The ids and texts the prompt listed, read back out of the request. */
export function listedMemories(body: any): Array<{ id: string, text: string }> {
  const system: string = body.messages[0].content;
  return [...system.matchAll(/^\[([^\]]+)\] \([^)]*\) (?:[^:\n]+: )?(.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
}

/** The environment a scripted live run reads: a wire for both, tiny guards. */
export function scriptedEnv(overrides: Record<string, string> = {}) {
  return readAiEnv({
    OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'fast', TANGLE_AI_MODEL_STRONG: 'strong',
    TANGLE_AI_EMBEDDING_MODEL: 'stub-embed', TANGLE_AI_MAX_CALLS: '1000', TANGLE_AI_MAX_CONCURRENCY: '3',
    ...overrides,
  });
}

export function liveClients(
  env: ReturnType<typeof readAiEnv>,
  fetch: typeof globalThis.fetch,
  cache?: ReplayCache,
  reasoning?: { effort: 'none' },
) {
  return {
    chat: chatClientFor(chatSettingsOf(env), { fetch, retry: { attempts: 1 }, cache, reasoning }),
    judge: chatClientFor(chatSettingsOf(env, env.modelStrong), { fetch, retry: { attempts: 1 }, cache, reasoning }),
    embedder: embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, fetch, cache),
  };
}
