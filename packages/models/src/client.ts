/**
 * The chat client: one `complete()` call against any OpenAI-compatible
 * `/chat/completions` endpoint, streaming by default. The host injects
 * `fetch` exactly like every other jarenjs boundary injects its
 * environment, so the client runs identically in the browser, in Node
 * and in tests against a scripted stub.
 *
 * The reply is normalized to `{ message: { role, content, toolCalls },
 * finishReason, usage, model }` whether the server streamed deltas or
 * answered in one JSON document.
 */

import { AiError } from './errors.ts';
import { PROVIDERS, resolveEndpoint } from './providers.ts';
import { normalizeRetry, withRetry, isTransientFailure, httpFailure, transportFailure } from './retry.ts';
import { createSseDecoder } from './sse.ts';
import { normalizeCache, replayKey, verifyChatEntry, cloneJson, now } from './replay.ts';

/**
 * The reasoning text one streamed chunk carries: the OpenRouter/`o`-
 * family `delta.reasoning` string, or the `reasoning_details` text
 * entries some providers emit instead.
 */
export function reasoningOf(delta: any): string {
  if (typeof delta?.reasoning === 'string') return delta.reasoning;
  if (Array.isArray(delta?.reasoning_details)) {
    let text = '';
    for (const detail of delta.reasoning_details) {
      if (typeof detail?.text === 'string') text += detail.text;
    }
    return text;
  }
  return '';
}

/**
 * Accumulates OpenAI streaming chunks (`choices[0].delta`) into one
 * normalized assistant message. Tool-call fragments merge by `index`;
 * argument strings concatenate across chunks; reasoning deltas
 * accumulate into `message.reasoning` (absent when the model emitted
 * none) so a reasoning-only turn is distinguishable from an empty one.
 * @returns
 *   `push` returns the text delta this chunk contributed (may be '').
 */
export function createStreamAccumulator(): {
  push: (chunk: any) => string;
  result: () => any;
} {
  let role = 'assistant';
  let content = '';
  let reasoning = '';

  const toolCalls: any[] = [];
  let finishReason: any = null;
  let usage: any = null;
  let model: any = null;

  return {
    push(chunk: any) {
      if (chunk === null || typeof chunk !== 'object') return '';
      if (typeof chunk.model === 'string') model = chunk.model;
      if (chunk.usage != null) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (choice == null) return '';
      if (choice.finish_reason != null) finishReason = choice.finish_reason;
      const delta = choice.delta ?? choice.message ?? {};
      if (typeof delta.role === 'string') role = delta.role;
      reasoning += reasoningOf(delta);
      let text = '';
      if (typeof delta.content === 'string') {
        content += delta.content;
        text = delta.content;
      }
      for (const fragment of delta.tool_calls ?? []) {
        const at = fragment.index ?? toolCalls.length;
        const slot = toolCalls[at] ?? (toolCalls[at] = { id: '', name: '', arguments: '' });
        if (typeof fragment.id === 'string' && fragment.id !== '') slot.id = fragment.id;
        if (typeof fragment.function?.name === 'string' && slot.name === '')
          slot.name = fragment.function.name;
        if (typeof fragment.function?.arguments === 'string')
          slot.arguments += fragment.function.arguments;
      }
      return text;
    },
    result() {
      const calls = toolCalls
        .filter((call: any) => call != null)
        .map((call: any, i) => ({ ...call, id: call.id === '' ? `call_${i}` : call.id }));
      return {
        message: {
          role,
          content,
          toolCalls: calls.length > 0 ? calls : null,
          ...(reasoning === '' ? {} : { reasoning }),
        },
        finishReason,
        usage,
        model,
      };
    },
  };
}

/**
 * @param payload - a complete (non-streamed) chat completion
 * @returns the normalized result
 */
function fromCompletion(payload: any): any {
  const choice = payload?.choices?.[0];
  if (choice == null || typeof choice !== 'object')
    throw new AiError('AI0003', 'malformed completion: no choices in the response');
  const message = choice.message ?? {};
  const calls = (message.tool_calls ?? []).map((call: any, i: any) => ({
    id: typeof call.id === 'string' && call.id !== '' ? call.id : `call_${i}`,
    name: call.function?.name ?? '',
    arguments: call.function?.arguments ?? '',
  }));
  const reasoning = reasoningOf(message);
  return {
    message: {
      role: message.role ?? 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls: calls.length > 0 ? calls : null,
      ...(reasoning === '' ? {} : { reasoning }),
    },
    finishReason: choice.finish_reason ?? null,
    usage: payload.usage ?? null,
    model: payload.model ?? null,
  };
}

/**
 * A reply that arrived as text rather than as a stream of events: one
 * JSON completion document — a provider or proxy that ignores `stream`
 * — or nothing this client can read. One implementation for every place
 * that can happen (a nonstreaming request, a fetch without a readable
 * body, and a stream that closed without a single event), so all answer
 * the same way: the message, or `AI0003`. Never a silent empty message.
 * @returns the normalized result
 */
function completionFromText(text: string): any {
  if (!/^\s*\{/.test(text))
    throw new AiError('AI0003', `expected an SSE stream or a JSON completion, got: ${text.slice(0, 120)}`);

  let payload: any;
  try {
    payload = JSON.parse(text);
  }
  catch {
    throw new AiError('AI0003', `malformed completion: ${text.slice(0, 120)}`);
  }
  return fromCompletion(payload);
}

/**
 * @param [options]
 *   - `maxTokensField` selects the wire field for client and request
 *     `maxTokens` budgets (default `'max_tokens'`). Select
 *     `'max_completion_tokens'` for OpenAI Chat Completions, including
 *     reasoning models. The selection is explicit, not inferred from
 *     the URL or model; exactly one field is sent when a budget is set.
 *   - `reasoning` is the default thinking control for every request (see
 *     `ChatRequest.reasoning`); a per-request value overrides it.
 *   - `structured` is the structured-output tier the model speaks —
 *     `'json_schema'`, `'json'` or `null` — when it is not the preset's:
 *     the tier belongs to the model, and one aggregator serves models of
 *     every kind. `createStructuredOutput` reads it from `endpoint.structured`.
 *   - `timeoutMs` bounds each attempt, the streamed body included; a
 *     timed-out attempt is `AI0002` with `status` 0 and retries like a
 *     network failure (unless output already reached the caller). There is
 *     no default: a long answer on a local runtime legitimately takes time.
 *   - `requestUsage` asks a streamed reply for its usage
 *     (`stream_options: { include_usage: true }`), per client or per
 *     request; off by default, because a server that does not know the
 *     member may refuse it. It never enters the replay key.
 *   - `cache` is the replay seam: `{ get(key), set(key, value) }`, each
 *     sync or async. The client keys every request by its effective
 *     credential-free wire body after endpoint resolution and default
 *     application (`stream`, the signal and the callbacks never enter
 *     the key), answers a remembered reply with ZERO transport calls,
 *     marked `replayed: { ms }` — the wall time of the purchase — with
 *     `onDelta`/`onReasoning` fired once each with the whole text, and
 *     remembers a bought reply as `{ value, ms }`. The seam fails closed:
 *     an adapter that throws fails the call; a stored entry that does not
 *     verify is `AI0003`; a request that cannot be keyed (a function
 *     inside `tools`) is `AI0001` before any wire call. The key is the
 *     complete canonical request — an adapter wanting a fixed-width id
 *     hashes it cryptographically, never with a 32-bit hash.
 *   - `retry.attempts` is the TOTAL number of tries (default 3; 1
 *     disables retrying); backoff is exponential with full jitter,
 *     capped at `maxMs`. A provider `Retry-After` (seconds or HTTP-date)
 *     wins over the computed delay, capped at `maxMs` too: a provider
 *     asking for a minute gets the cap (8 000 ms by default), and the
 *     value it asked for rides the final error as `retryAfterMs` for
 *     the caller to honour. `random` and `sleep` exist for deterministic
 *     tests.
 */
export function createChatClient(options: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  maxTokens?: number;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  reasoning?: {
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
    enabled?: boolean;
    exclude?: boolean;
    max_tokens?: number;
  };
  retry?: import('./retry.ts').RetryOptions;
  cache?: import('./replay.ts').ReplayCache;
  structured?: 'json_schema' | 'json' | null;
  timeoutMs?: number;
  requestUsage?: boolean;
} = {}): {
  /** The credential-free identity: safe to log, to serialize and to copy. */
  endpoint: ChatEndpoint;
  /** Resolves a `ChatResult`; typed loosely so a host's own result types keep composing. */
  complete: (request: ChatRequest) => Promise<any>;
  /** Credential-free replay identity after applying the client's wire defaults; no I/O. */
  requestKey: (request: ChatRequest) => string;
} {
  // the headers carry the key, so they stay in this closure: nothing
  // reachable from the returned object holds a credential
  const { headers, ...resolved } = resolveEndpoint(options);
  const secret = (options.apiKey ?? '').trim();
  if (options.structured !== undefined && !['json_schema', 'json', null].includes(options.structured))
    throw new AiError('AI0001', "structured must be 'json_schema', 'json' or null");
  const structured = options.structured !== undefined ? options.structured : PROVIDERS[resolved.provider].structured;
  const endpoint: ChatEndpoint = { ...resolved, hasKey: secret !== '', structured };
  const maxTokensField = options.maxTokensField ?? 'max_tokens';
  if (maxTokensField !== 'max_tokens' && maxTokensField !== 'max_completion_tokens')
    throw new AiError('AI0001', "maxTokensField must be 'max_tokens' or 'max_completion_tokens'");
  const fetchFn = options.fetch ?? ((url: any, init: any) => globalThis.fetch(url, init));
  const retry = normalizeRetry(options.retry);
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0))
    throw new AiError('AI0001', `timeoutMs must be a positive number, got ${String(timeoutMs)}`);
  const cache = normalizeCache(options.cache);

  /**
   * The body one request POSTs, defaults applied. One construction for
   * the wire and for the replay key, so the two cannot drift: what is
   * keyed is exactly what would be sent.
   */
  function requestBody(request: ChatRequest): any {
    const { messages, tools, toolChoice } = request;
    const model = request.model ?? endpoint.model;
    const stream = request.stream ?? true;

    const body: any = { model, messages, stream };
    // an OpenAI-compatible stream carries usage only when asked for it;
    // opt-in, because a server that does not know the member may refuse it
    if (stream === true && (request.requestUsage ?? options.requestUsage) === true)
      body.stream_options = { include_usage: true };
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
    if (toolChoice !== undefined) body.tool_choice = toolChoice;
    if (typeof request.temperature === 'number') body.temperature = request.temperature;
    // an unset ceiling is not "no ceiling": a provider substitutes the
    // model's whole context window, and an aggregator that bills against
    // a balance REFUSES the request when it cannot afford that worst case
    // (OpenRouter answers 402 naming the number it wanted). A caller that
    // knows its answer is a few thousand tokens should be able to say so.
    const maxTokens = request.maxTokens ?? options.maxTokens;
    if (typeof maxTokens === 'number') body[maxTokensField] = maxTokens;
    // the thinking control rides through untouched — a hybrid model needs
    // it to answer WITHOUT reasoning first, and a body that silently drops
    // it is indistinguishable from a provider that ignores it
    const reasoning = request.reasoning ?? options.reasoning;
    if (reasoning !== undefined) body.reasoning = reasoning;
    const format = request.responseFormat;
    if (format !== undefined) {
      body.response_format = format.type === 'json'
        ? { type: 'json_object' }
        : {
          type: 'json_schema',
          json_schema: {
            name: format.name ?? 'result',
            schema: format.schema,
            strict: format.strict ?? true,
          },
        };
    }
    return body;
  }

  function requestKey(request: ChatRequest): string {
    // a reply streamed or answered whole, with or without its usage
    // chunk, is the same reply: neither member enters the key
    const { stream: _stream, stream_options: _usage, ...keyed } = requestBody(request);
    return replayKey('chat', endpoint, keyed);
  }

  /**
   * One request/response cycle. `state.delivered` flips as soon as a
   * streamed delta reaches `onDelta` or `onReasoning` — the point of no
   * return for the retry loop (the caller has observed output).
   */
  async function attemptOnce(request: ChatRequest, state: {
    delivered: boolean;
  }) {
    // the attempt's own deadline rides beside the caller's signal; which
    // of the two fired decides whether the failure is a retryable
    // timeout or the caller's abort
    if (timeoutMs === undefined) return exchange(request, state, request.signal);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const signal = request.signal === undefined ? deadline.signal : AbortSignal.any([request.signal, deadline.signal]);
    try {
      return await exchange(request, state, signal);
    }
    catch (err: any) {
      if (deadline.signal.aborted && request.signal?.aborted !== true && !(err instanceof AiError))
        throw new AiError('AI0002', `no answer from ${endpoint.url} within ${timeoutMs} ms`, { status: 0, cause: err });
      throw err;
    }
    finally {
      clearTimeout(timer);
    }
  }

  /** The request and the whole reply, the stream read to its end, under `signal`. */
  async function exchange(request: ChatRequest, state: {
    delivered: boolean;
  }, signal: AbortSignal | undefined) {
    const { onDelta, onReasoning } = request;
    const body = requestBody(request);
    const stream = body.stream;

    let response: any;
    try {
      response = await fetchFn(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    }
    catch (err: any) {
      throw transportFailure(err, endpoint.url);
    }
    if (response.ok !== true) throw await httpFailure(response, endpoint.url, secret);
    if (!stream) return completionFromText(await response.text());

    const decoder = createSseDecoder();
    const accumulator = createStreamAccumulator();
    /** @param payload */
    const handle = (payload: string) => {
      if (payload === '[DONE]') return;

      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      }
      catch {
        throw new AiError('AI0003', `malformed stream chunk: ${payload.slice(0, 120)}`);
      }
      if (onReasoning !== undefined) {
        const thinking = reasoningOf(chunk?.choices?.[0]?.delta ?? {});
        if (thinking !== '') {
          state.delivered = true;
          onReasoning(thinking);
        }
      }
      const text = accumulator.push(chunk);
      if (text !== '' && onDelta !== undefined) {
        state.delivered = true;
        onDelta(text);
      }
    };

    // the body's text is kept only until the first event arrives: a
    // reply that closes without one was never a stream (see below), and
    // must then be read whole as a document
    let events = 0;
    let raw = '';
    /** @param text */
    const feed = (text: string) => {
      if (events === 0) raw += text;
      for (const payload of decoder.feed(text)) {
        events += 1;
        handle(payload);
      }
      if (events > 0) raw = '';
    };
    if (typeof response.body?.getReader === 'function') {
      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let finished = false;
      try {
        for (; ;) {
          const { done, value } = await reader.read();
          if (done) { finished = true; break; }
          feed(textDecoder.decode(value, { stream: true }));
        }
      }
      finally {
        if (!finished) {
          try { await reader.cancel(); }
          catch { /* Preserve the read, decoding or callback failure. */ }
        }
        reader.releaseLock();
      }
    }
    else {
      // a host without a readable body (test stubs, exotic fetch shims)
      // hands over the whole text at once
      feed(await response.text());
    }
    for (const payload of decoder.end()) {
      events += 1;
      handle(payload);
    }
    // zero events means the reply was never a stream: a provider or proxy
    // that ignores `stream` answers one JSON document, and anything else
    // is malformed — either way a coded answer, never an empty message
    if (events === 0) return completionFromText(raw);
    return accumulator.result();
  }

  /** @param request */
  async function complete(request: ChatRequest) {
    const { messages, signal } = request ?? {};
    if (!Array.isArray(messages) || messages.length === 0)
      throw new AiError('AI0001', 'complete() needs a non-empty messages array');
    const model = request.model ?? endpoint.model;
    if (model === '' || model == null)
      throw new AiError('AI0001', 'no model configured — set one in the client options or the request');

    // transient transport failures (network, 408, 429, 5xx) and a
    // malformed 200 — no choices, a bad chunk — back off and try again
    // through the shared policy; the one judgment that is this wire's
    // own is the `!state.delivered` guard, which keeps a retry from ever
    // re-sending after the caller has observed streamed output
    const state = { delivered: false };
    const buy = () => withRetry(retry, () => attemptOnce(request, state), {
      signal,
      retryable: (failure) => isTransientFailure(failure) && !state.delivered,
    });
    if (cache === null) return buy();

    // the key is the body the wire would see, minus `stream`: a reply
    // streamed or answered whole is the same reply, and the callbacks
    // are fired on a replay so a streaming caller sees one path
    const key = requestKey(request);
    const hit = await cache.get(key);
    if (hit !== undefined) {
      const { value, ms } = verifyChatEntry(hit);
      const result = cloneJson(value);
      const reasoning = result.message.reasoning;
      if (typeof reasoning === 'string' && reasoning !== '' && request.onReasoning !== undefined)
        request.onReasoning(reasoning);
      const content = result.message.content;
      if (typeof content === 'string' && content !== '' && request.onDelta !== undefined)
        request.onDelta(content);
      return { ...result, replayed: { ms } };
    }
    const started = now();
    const result = await buy();
    // a `set` that throws fails the call AFTER the purchase — the reply
    // was bought and is lost, which is the loud failure a broken cache
    // deserves (fail closed; an adapter that wants otherwise catches)
    await cache.set(key, { value: cloneJson(result), ms: now() - started });
    return result;
  }

  return { endpoint, complete, requestKey };
}

/** One tool call of a reply, its arguments as the model wrote them. */
export type ChatToolCall = { id: string; name: string; arguments: string };

/**
 * A normalized reply, streamed or whole: the message (`reasoning` only when
 * the model emitted some), why it stopped, the provider's usage when it
 * reported one, and `replayed` when the cache answered it.
 */
export type ChatResult = {
  message: { role: string; content: string; toolCalls: ChatToolCall[] | null; reasoning?: string };
  finishReason: string | null;
  usage: any;
  model: string | null;
  replayed?: { ms: number };
};

/** What `createChatClient` returns. */
export type ChatClient = ReturnType<typeof createChatClient>;

/**
 * What a chat client says about where it sends: the resolved provider,
 * base and chat URL, the configured model, and whether a key is
 * configured — never the key or the headers that carry it.
 */
export type ChatEndpoint = {
  provider: string;
  base: string;
  url: string;
  model: string;
  hasKey: boolean;
  /** The structured-output tier this client's model speaks: the client's `structured` option, else the preset's. */
  structured: 'json_schema' | 'json' | null;
};

export type ChatRequest = { /**
 * - OpenAI wire-shape messages
 */
  messages: any[]; /**
 * - OpenAI function-tool definitions
 */
  tools?: any[]; /**
 * - `tool_choice` passthrough
 */
  toolChoice?: any; /**
 * - overrides the client's configured model
 */
  model?: string; temperature?: number; /**
 * - token ceiling for this reply, sent under
 * the client's `maxTokensField`. Overrides the client default; when
 * both are unset, the provider chooses the limit. With
 * `max_completion_tokens`, reasoning tokens share this budget with
 * visible output tokens.
 */
  maxTokens?: number; /**
 * - default true
 */
  stream?: boolean; /**
 * - structured output: `{ name, schema, strict? }` emits the OpenAI
 * `response_format: { type: "json_schema", … }` wire shape (strict
 * defaults to true); `{ type: 'json' }` emits `json_object` mode
 */
  responseFormat?: { name?: string; schema?: any; strict?: boolean; type?: "json"; }; /**
 * - the provider-normalized thinking control, forwarded verbatim.
 * `{ effort: 'none' }` (or `{ enabled: false }`) turns a hybrid
 * thinking model OFF: it answers directly, which on a short task is
 * dramatically cheaper and faster. `{ exclude: true }` only HIDES the
 * thinking — the model still thinks and you still pay for it.
 * Overrides the client-level default.
 */
  reasoning?: { effort?: "none" | "minimal" | "low" | "medium" | "high"; enabled?: boolean; exclude?: boolean; max_tokens?: number; }; signal?: AbortSignal; /**
 * - streamed text callback
 */
  onDelta?: (text: string) => void; /**
 * - streamed reasoning
 * callback (reasoning models emit thinking before/instead of content)
 */
  onReasoning?: (text: string) => void; /**
 * - ask a streamed reply for its usage; overrides the client's `requestUsage`
 */
  requestUsage?: boolean;
};
