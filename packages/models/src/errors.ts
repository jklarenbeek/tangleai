/**
 * The model transport error type. Every failure the package itself raises
 * carries a stable code, like the rest of the suite:
 *
 *   AI0001 — invalid configuration or request (caller error)
 *   AI0002 — the provider answered with an HTTP error status, or no
 *            response arrived at all (`status` 0)
 *   AI0003 — the provider answered with a malformed payload
 *   AI0004 — a routed call ran past its deadline (`outcome: 'timeout'`,
 *            `deadlineMs`)
 *   AI0005 — a routed reply spent more tokens than its ceiling allows
 *            (`outcome: 'token-limit'`, `usage`, `limit`); the reply was
 *            bought, and `usage` says what it cost
 *   AI0006 — the host's account stopped a routed call before it was sent
 *            (`outcome: 'budget'`)
 *
 * A caller's own abort is never one of these: it rejects with the
 * caller's abort reason, exactly as it came.
 *
 * Tool execution and the agent loop never throw for content-level
 * problems (an unknown tool, invalid tool input, a tool that throws) —
 * those come back as `{ error }` results the model can read and
 * recover from. AiError is reserved for the transport and for misuse.
 *
 * Refinement in `@tangleai/agents` rejects with its own `AI01xx` codes,
 * enumerated there, and a grammar author's compile gate records `AI0200`
 * for a compile failure that names no code of its own. They are the same
 * idea one step further out: never thrown, they travel as records with a
 * pointer, because their reader is a model repairing its own proposal.
 */

import { CodedError } from '@jarenjs/core/errors';

export class AiError extends CodedError {
  declare status?: number;
  declare attempts?: number;
  declare retryAfterMs?: number;
  declare outcome?: 'timeout' | 'token-limit' | 'budget';
  declare deadlineMs?: number;
  declare limit?: number;
  declare usage?: any;

  /**
   * @param code - stable error code (`AI0001` … `AI0006`)
   * @param reason - The bare reason; `message` is composed as
   *   `${code}: ${reason}` per the coded contract (transport errors
   *   have no document, so there is never a location).
   * @param [meta] - transport metadata: the HTTP status
   *   (`0` for a network failure before any response), how many tries
   *   the client made, and the provider's `Retry-After` in ms; for a
   *   routed failure, its machine-readable `outcome` and what it was
   *   measured against (`deadlineMs`; `usage` and `limit`)
   */
  constructor(code: string, reason: string, meta?: {
    status?: number;
    attempts?: number;
    retryAfterMs?: number;
    outcome?: 'timeout' | 'token-limit' | 'budget';
    deadlineMs?: number;
    limit?: number;
    usage?: any;
    cause?: unknown;
  }) {
    super('AiError', code, reason, undefined,
      meta !== undefined && meta.cause !== undefined
        ? { cause: meta.cause }
        : undefined);
    if (meta !== undefined) {
      if (meta.status !== undefined) this.status = meta.status;
      if (meta.attempts !== undefined) this.attempts = meta.attempts;
      if (meta.retryAfterMs !== undefined) this.retryAfterMs = meta.retryAfterMs;
      if (meta.outcome !== undefined) this.outcome = meta.outcome;
      if (meta.deadlineMs !== undefined) this.deadlineMs = meta.deadlineMs;
      if (meta.limit !== undefined) this.limit = meta.limit;
      if (meta.usage !== undefined) this.usage = meta.usage;
    }
  }
}
