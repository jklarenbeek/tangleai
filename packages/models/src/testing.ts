/**
 * A scripted `fetch` for keyless tests of anything built on these
 * clients: each request takes the next step of a script, so a test states
 * the replies, failures and hangs it needs and makes no network call.
 *
 * A step is a reply's text; a reply object (`content`, `finishReason`,
 * `usage`, `toolCalls`, `reasoning`, `model`); an HTTP failure
 * (`{ status, body?, headers? }`, any status that is not 2xx, or a 2xx
 * with a raw body to script a malformed payload); an `Error`, with which
 * `fetch` rejects as a network failure does; or `'hang'`, which never
 * answers and rejects with the signal's reason when the request is
 * aborted — the way `fetch` itself does. A reply is answered as the
 * request asked: an SSE stream when it streams, one JSON completion when
 * not (`mode` forces either). Every request is kept in `calls` with its
 * parsed body; a request past the end of the script rejects, naming it.
 */

/** A reply the script answers. `finishReason` defaults to `stop`, or `tool_calls` with tool calls. */
export type ScriptedReply = {
  content?: string;
  finishReason?: string | null;
  usage?: Record<string, unknown> | null;
  toolCalls?: Array<{ id?: string; name: string; arguments: string }>;
  reasoning?: string;
  model?: string;
};

/** An HTTP answer with this status and body, verbatim. */
export type ScriptedHttp = { status: number; body?: string; headers?: Record<string, string> };

export type ScriptedStep = string | ScriptedReply | ScriptedHttp | Error | 'hang';

export type ScriptedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
};

const isHttp = (step: object): step is ScriptedHttp => typeof (step as ScriptedHttp).status === 'number';

function choiceOf(reply: ScriptedReply, streamed: boolean) {
  const toolCalls = reply.toolCalls?.map((call, index) => ({
    index, id: call.id ?? `call_${index}`, type: 'function', function: { name: call.name, arguments: call.arguments },
  }));
  const message: Record<string, unknown> = { role: 'assistant', content: reply.content ?? '' };
  if (reply.reasoning !== undefined) message.reasoning = reply.reasoning;
  if (toolCalls !== undefined && toolCalls.length > 0) message.tool_calls = toolCalls;
  const finish = reply.finishReason !== undefined ? reply.finishReason
    : toolCalls !== undefined && toolCalls.length > 0 ? 'tool_calls' : 'stop';
  return { index: 0, [streamed ? 'delta' : 'message']: message, finish_reason: finish };
}

/**
 * @param script - the steps, one per request, in order
 * @param [options] - `mode`: `'auto'` (default) answers as the request
 *   asked; `'json'` or `'sse'` forces one shape
 */
export function createScriptedFetch(script: readonly ScriptedStep[], options: { mode?: 'auto' | 'json' | 'sse' } = {}): {
  fetch: typeof globalThis.fetch;
  calls: ScriptedCall[];
  /** Steps not yet answered. */
  remaining: () => number;
} {
  const mode = options.mode ?? 'auto';
  if (mode !== 'auto' && mode !== 'json' && mode !== 'sse') throw new TypeError("mode must be 'auto', 'json' or 'sse'");
  const calls: ScriptedCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const text = typeof init.body === 'string' ? init.body : undefined;
    let body: unknown = text;
    try { if (text !== undefined) body = JSON.parse(text); } catch { /* a non-JSON body is kept as text */ }
    const signal = init.signal ?? undefined;
    calls.push({
      url: String(input), method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()), body, signal,
    });
    const index = calls.length - 1;
    if (index >= script.length)
      throw new Error(`createScriptedFetch: no step for request ${index + 1}; the script has ${script.length}`);
    signal?.throwIfAborted();
    const step = script[index];
    if (step === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (step instanceof Error) throw step;
    if (typeof step === 'object' && isHttp(step))
      return new Response(step.body ?? '', { status: step.status, headers: step.headers });
    const reply: ScriptedReply = typeof step === 'string' ? { content: step } : step;
    const streamed = mode === 'sse' || (mode === 'auto' && (body as { stream?: unknown } | undefined)?.stream === true);
    if (!streamed) {
      return Response.json({ model: reply.model, choices: [choiceOf(reply, false)], usage: reply.usage ?? undefined });
    }
    const chunks = [{ model: reply.model, choices: [choiceOf(reply, true)] }];
    if (reply.usage != null) chunks.push({ model: reply.model, choices: [], usage: reply.usage } as any);
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, remaining: () => Math.max(0, script.length - calls.length) };
}
