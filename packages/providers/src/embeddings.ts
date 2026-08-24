/**
 * Embedding client — the one provider capability @jarenjs/ai deliberately
 * does not ship (its ledger recalls by tag and recency and refuses to
 * rank without an instrument; Tangle is the host that brings the
 * instrument). Chat completions stay on @jarenjs/ai `createChatClient`;
 * this module covers only `embed`.
 *
 * Two wires, one contract:
 *   'ollama'  — POST {baseUrl}/api/embed        { model, input }   → { embeddings }
 *   'openai'  — POST {baseUrl}/v1/embeddings    { model, input }   → { data: [{ embedding, index }] }
 *               (OpenRouter, LM Studio, vLLM, OpenAI proper)
 *
 * House rules carried over from @jarenjs/ai's client: `fetch` is
 * injected (testable without network, browser-loadable), errors are
 * coded (`TA0001` misuse, `TA0002` HTTP, `TA0003` malformed payload),
 * and the reply is verified to be one vector per input IN INPUT ORDER —
 * the OpenAI wire's `index` field exists because providers may answer
 * out of order, and an embedding attached to the wrong text is worse
 * than an error.
 */

import { callerError, transportError, payloadError } from '@tangleai/core/errors';

export type EmbeddingProvider = 'ollama' | 'openai';

export interface EmbeddingClient {
  embed(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
  readonly model: string;
  readonly provider: EmbeddingProvider;
}

export interface EmbeddingClientOptions {
  provider: EmbeddingProvider;
  /** e.g. `http://localhost:11434` or `https://openrouter.ai/api` */
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export function createEmbeddingClient(options: EmbeddingClientOptions): EmbeddingClient {
  const { provider, model } = options;
  if (provider !== 'ollama' && provider !== 'openai') {
    throw callerError(`unknown embedding provider '${String(provider)}' — expected 'ollama' or 'openai'`);
  }
  if (!options.baseUrl) throw callerError('baseUrl is required');
  if (!model) throw callerError('model is required');

  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const url = provider === 'ollama'
    ? `${baseUrl}/api/embed`
    : `${baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`}/embeddings`;

  const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  return {
    provider,
    model,
    async embed(texts, { signal }: { signal?: AbortSignal } = {}) {
      if (!Array.isArray(texts) || texts.length === 0) {
        throw callerError('embed expects a non-empty array of strings');
      }

      const response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: texts }),
        signal,
      });
      if (!response.ok) {
        throw transportError(`embedding request failed with HTTP ${response.status}`, { status: response.status });
      }

      const payload: any = await response.json();
      const vectors = provider === 'ollama'
        ? payload?.embeddings
        : orderedOpenAiEmbeddings(payload);

      if (!Array.isArray(vectors) || vectors.length !== texts.length
        || vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
        throw payloadError(`embedding reply did not carry ${texts.length} non-empty vectors`);
      }
      return vectors as number[][];
    },
  };
}

/** Reassemble an OpenAI-wire reply in input order via each item's `index`. */
function orderedOpenAiEmbeddings(payload: any): number[][] | null {
  const data = payload?.data;
  if (!Array.isArray(data)) return null;
  const out: number[][] = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const index = typeof item?.index === 'number' ? item.index : i;
    if (index < 0 || index >= data.length || out[index] !== undefined) return null;
    out[index] = item?.embedding;
  }
  return out;
}
