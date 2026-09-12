/**
 * The transport policy every client in this package shares: which
 * failures are transient, how long to wait before trying again, what a
 * provider's `Retry-After` is worth, and how an abort cuts a wait
 * short. The chat wire and the embeddings wire fail alike at the
 * transport — a network error, a 408, a 429, a 5xx, a 200 whose body is
 * not what the wire promised — and differ only in what a good reply
 * must carry. So the loop lives here, once, and each client keeps its
 * own reading of a reply: one implementation of retry, two wire shapes.
 *
 * Everything here is internal to the package; the public surface is
 * the `retry` option each client documents.
 */

import { AiError } from './errors.ts';
import { backoffDelay, parseRetryAfter, sleep as defaultSleep, abortError } from '@jarenjs/core/retry';
export { abortError };

/** The `retry` option of every client. */

/** The option with its defaults filled in. */

/**
 */
export function normalizeRetry(retry: RetryOptions | undefined): RetryPolicy {
  return {
    attempts: Math.max(1, retry?.attempts ?? 3),
    baseMs: retry?.baseMs ?? 500,
    maxMs: retry?.maxMs ?? 8000,
    random: retry?.random ?? Math.random,
    sleep: retry?.sleep ?? defaultSleep,
  };
}

/** Statuses worth a retry: timeout, rate limit, server-side failure. */
function isRetryableStatus(status: any) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Whether a failure is the transient kind. A transport error with a
 * retryable status is (a network failure before any response counts
 * as status 0); so is a malformed 200 — a reply that carried none of
 * what the wire promised is a provider hiccup, common on busy cheap
 * tiers, and safe to retry precisely because nothing was delivered.
 * Anything else — a caller error, a 401, a 404 — is final on the first
 * try.
 */
export function isTransientFailure(err: unknown): boolean {
  if (!(err instanceof AiError)) return false;
  return err.code === 'AI0003'
    || (err.code === 'AI0002' && isRetryableStatus(err.status ?? -1));
}

/**
 * The wait before the next try: exponential backoff with full jitter,
 * capped at `maxMs` — unless the provider named a `Retry-After`, which
 * wins up to the same cap.
 * @param attempt - the try that just failed, counted from 1
 * @param retryAfter - the provider's ask, in ms
 * @returns milliseconds
 */
export function retryDelay(policy: RetryPolicy, attempt: number, retryAfter: number | undefined): number {
  return backoffDelay({ ...policy, policy: 'ai-compat' }, attempt, retryAfter);
}

/**
 * Run `once` until it settles. A failure `retryable` accepts backs off
 * and tries again while tries remain; anything else is thrown as it
 * came, and a coded transport failure (`AI0002`, `AI0003`) carries the
 * number of tries as `attempts`. The wait honours `signal`: an abort
 * during backoff rejects with the abort reason, exactly like an abort
 * during the request — nothing is ever retried past an abort.
 * @template T
 * @param once - one request/response cycle
 *   - `retryable` is the wire's own judgment over a coded failure (the
 *   chat client, for one, stops retrying once a streamed delta has
 *   reached the caller); it is never asked about an uncoded error
 */
export async function withRetry<T>(policy: RetryPolicy, once: () => Promise<T>, options: {
  signal?: AbortSignal;
  retryable: (failure: AiError) => boolean;
}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await once();
    }
    catch (err: any) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const failure = (err as any);
      const coded = failure instanceof AiError;
      if (!(coded && options.retryable(failure) && attempt < policy.attempts)) {
        if (coded && (failure.code === 'AI0002' || failure.code === 'AI0003'))
          failure.attempts = attempt;
        throw err;
      }
      await policy.sleep(retryDelay(policy, attempt, failure.retryAfterMs), options.signal);
    }
  }
}

/**
 * The `AI0002` for a response that is not ok: the status, a short
 * excerpt of the body, and the provider's `Retry-After` in ms.
 */
export async function httpFailure(response: any, url: string): Promise<AiError> {
  const excerpt = await readErrorExcerpt(response);
  return new AiError('AI0002',
    `HTTP ${response.status} from ${url}${excerpt === '' ? '' : `: ${excerpt}`}`,
    { status: response.status, retryAfterMs: retryAfterMs(response) });
}

/**
 * What to throw when `fetch` itself threw: an abort exactly as it came
 * (the caller's own signal, never retried, never rewrapped); anything
 * else the `AI0002` of a failure before any response, status 0.
 */
export function transportFailure(err: any, url: string): any {
  if (err?.name === 'AbortError') return err;
  return new AiError('AI0002',
    `network error calling ${url}: ${err?.message ?? err}`,
    { status: 0, cause: err });
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms.
 */
export function retryAfterMs(response: any): number | undefined {
  return parseRetryAfter(response?.headers?.get?.('retry-after'));
}

/**
 * @returns a short excerpt of the error body
 */
async function readErrorExcerpt(response: any): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  }
  catch {
    return '';
  }
}

export type RetryOptions = { /**
 * - the TOTAL number of tries (default 3;
 * 1 disables retrying)
 */
  attempts?: number; /**
 * - the first backoff (default 500); each
 * later one doubles, with full jitter
 */
  baseMs?: number; /**
 * - the ceiling on any single wait (default
 * 8 000) — a provider `Retry-After` included: a provider asking for a
 * minute gets the cap, and the value it asked for rides the final
 * error as `retryAfterMs` for the caller to honour
 */
  maxMs?: number; /**
 * - the jitter source, for
 * deterministic tests
 */
  random?: () => number; /**
 * - the wait itself, for deterministic tests; the default is a timer
 * that rejects with the abort reason the moment `signal` aborts
 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
export type RetryPolicy = { attempts: number; baseMs: number; maxMs: number; random: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void>; };
