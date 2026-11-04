import { AiError } from './errors.ts';

/**
 * Optional host routing for model-only calls. No tools execute inside this boundary.
 * These are the purposes Tangle's own callers route by; a host may name its own.
 */
export const MODEL_PURPOSES = Object.freeze(['author', 'subcall', 'embedding', 'stylesheet']);

/** A selector returns a route or ordered fallback routes: `{client, identity}`.
 * A route identity is host data; it never controls provider policy. Embedding callers
 * use their embedding API directly: this chat wrapper refuses that purpose so a
 * fallback cannot silently change an index's embedding identity.
 *
 * Every failure of its own is coded, with a machine-readable `outcome`: a
 * deadline is `AI0004` (`timeout`, `deadlineMs`), a reply over its token
 * ceiling `AI0005` (`token-limit`, `usage`, `limit`), an account stop
 * `AI0006` (`budget`). A timed-out or over-ceiling route falls through to
 * the next one; the last failure is the one thrown. A caller's own abort
 * rejects with the caller's reason, as it came, and is never retried.
 *
 * `limits` bound each route: `deadlineMs` its wall time, `outputTokens` the
 * reply's completion tokens (sent as the request's `maxTokens` too) and
 * `reasoningTokens` its reasoning. A deadline bounds one `complete`, not a
 * whole structured generation — `createStructuredOutput({ deadlineMs })`
 * bounds that. `onRoute` receives one `ModelRouteEvent` per route tried;
 * `account` is the host's shared budget (`ModelAccount`), asked before every
 * route and charged after it. The purpose is any non-empty name but
 * `embedding`; `MODEL_PURPOSES` are Tangle's own.
 * @param context */
export function createRoutedClient(options: {
  client: any;
  selectModel?: (context: ModelContext) => any;
  limits?: ModelLimits;
  onRoute?: (event: ModelRouteEvent) => void;
  account?: ModelAccount | null;
}, context: ModelContext) {
  if (typeof context?.purpose !== 'string' || context.purpose === '' || context.purpose === 'embedding')
    throw new TypeError('chat routing needs a purpose, and never the embedding purpose');
  const limits = { ...options.limits, ...context.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  }
  return {
    endpoint: options.client.endpoint,
    async complete(request: any) {
      if (request.tools?.length || request.toolChoice !== undefined)
        throw new TypeError('model routing does not retry tool-bearing requests');
      const choice = options.selectModel ? await options.selectModel({ ...context, limits }) : null;
      const routes = choice === null ? [{ client: options.client, identity: 'default' }]
        : Array.isArray(choice) ? choice : [choice];
      if (routes.length === 0) throw new TypeError('selectModel returned no routes');
      let last;
      for (const [index, route] of routes.entries()) {
        if (!route?.client?.complete || typeof route.identity !== 'string' || !route.identity)
          throw new TypeError('a model route needs client and identity');
        request.signal?.throwIfAborted();
        const stopped = options.account?.stop();
        if (stopped) throw new AiError('AI0006', String(stopped), { outcome: 'budget' });
        const controller = new AbortController();
        const remaining = options.account?.remaining?.().ms;
        const deadline = Math.min(limits.deadlineMs ?? Infinity, remaining ?? Infinity);
        const signal = request.signal
          ? Number.isFinite(deadline) ? AbortSignal.any([request.signal, controller.signal]) : request.signal
          : controller.signal;
        let timer;
        const started = performance.now();
        const event: ModelRouteEvent = {
          ...context, identity: route.identity, fallback: index, limits, outcome: 'provider', ms: 0, usage: null,
          schemaBytes: request.responseFormat?.schema ? new TextEncoder().encode(JSON.stringify(request.responseFormat.schema)).length : 0,
          finishReason: null, errorCode: null
        };
        try {
          options.account?.reserve();
          const bounded = {
            ...request, signal,
            ...(limits.outputTokens ? { maxTokens: Math.min(request.maxTokens ?? Infinity, limits.outputTokens) } : {}),
            ...(limits.reasoningTokens ? {
              reasoning: {
                ...request.reasoning,
                max_tokens: Math.min(request.reasoning?.max_tokens ?? Infinity, limits.reasoningTokens)
              }
            } : {}),
          };
          const pending = Promise.resolve().then(() => route.client.complete(bounded));
          const reply = await Promise.race([pending, new Promise((_, reject) => {
            const abort = () => reject(signal.reason ?? new Error('aborted'));
            signal.addEventListener('abort', abort, { once: true });
            // Remove the listener when even an abort-ignoring client eventually settles.
            pending.then(() => signal.removeEventListener('abort', abort), () => signal.removeEventListener('abort', abort));
            if (Number.isFinite(deadline)) timer = setTimeout(() => controller.abort(new AiError('AI0004',
              `the model deadline of ${deadline} ms passed`, { outcome: 'timeout', deadlineMs: deadline })), deadline);
          })]);
          event.usage = reply.usage ?? null;
          event.finishReason = reply.finishReason ?? null;
          options.account?.settle(reply.usage, JSON.stringify(request.messages) + String(reply.message?.content ?? ''));
          const usage = reply.usage;
          const over = limits.outputTokens && usage?.completion_tokens > limits.outputTokens
            ? { spent: usage.completion_tokens, limit: limits.outputTokens, kind: 'completion' }
            : limits.reasoningTokens && usage?.completion_tokens_details?.reasoning_tokens > limits.reasoningTokens
              ? { spent: usage.completion_tokens_details.reasoning_tokens, limit: limits.reasoningTokens, kind: 'reasoning' }
              : null;
          if (over !== null) {
            event.outcome = 'token-limit';
            throw new AiError('AI0005',
              `the provider exceeded the model token ceiling: ${over.spent} ${over.kind} tokens against ${over.limit}`,
              { outcome: 'token-limit', usage, limit: over.limit });
          }
          event.outcome = 'complete';
          return reply;
        }
        catch (error: any) {
          last = error;
          event.errorCode = error?.code ?? error?.name ?? 'Error';
          if (controller.signal.aborted) event.outcome = 'timeout';
          if (request.signal?.aborted) { event.outcome = 'aborted'; throw error; }
        }
        finally { clearTimeout(timer); event.ms = performance.now() - started; options.onRoute?.(event); }
      }
      throw last;
    },
  };
}

export type ModelLimits = { deadlineMs?: number, outputTokens?: number, reasoningTokens?: number; };
export type ModelPurpose = 'author' | 'subcall' | 'embedding' | 'stylesheet';
export type ModelContext = { purpose: ModelPurpose | (string & {}), grammar?: string, depth?: number, limits?: ModelLimits; };

/** What `onRoute` receives for each route tried, after it settles. */
export type ModelRouteEvent = ModelContext & {
  /** The route's host identity; `default` without a selector. */
  identity: string;
  /** 0 for the first route, then each fallback in order. */
  fallback: number;
  limits: ModelLimits;
  /** `provider` while running; then how the route ended. */
  outcome: 'provider' | 'complete' | 'timeout' | 'aborted' | 'token-limit';
  ms: number;
  /** The provider's usage, when it reported one. */
  usage: any;
  /** UTF-8 bytes of the response-format schema, 0 without one. */
  schemaBytes: number;
  finishReason: string | null;
  /** The failure's code (or name), `null` on success. */
  errorCode: string | null;
};

/**
 * The host's budget for routed calls. `stop()` answers a reason to stop
 * (any truthy text) or nothing; `remaining()` may cap a route's deadline
 * by `ms`; `reserve()` runs before a route is sent and `settle(usage, text)`
 * after its reply, with the provider's usage and the request and reply text
 * for an estimate when usage is missing.
 */
export type ModelAccount = {
  stop(): unknown;
  remaining?(): { ms?: number };
  reserve(): void;
  settle(usage: any, text: string): void;
};
