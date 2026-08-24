/**
 * Tangle's error type. One class, coded, mirroring the jarenjs
 * `CodedError` convention without importing it — @tangleai/core stays
 * dependency-free so the vector math and schemas can be lifted anywhere.
 *
 * Codes:
 *   TA0001 — caller/config error (bad argument, missing seam)
 *   TA0002 — transport error (HTTP status from a provider)
 *   TA0003 — malformed payload (a provider answered, but not with what
 *             the contract promises)
 *
 * The split matters the same way it does in @jarenjs/ai: TA0001 is a bug
 * in the host, TA0002 is the network's fault, TA0003 is the provider's.
 * A retry policy may retry the second, must not retry the first, and
 * should log the third.
 */

export type TangleErrorCode = 'TA0001' | 'TA0002' | 'TA0003';

export interface TangleErrorOptions {
  status?: number;
  cause?: unknown;
}

export class TangleError extends Error {
  readonly code: TangleErrorCode;
  readonly status?: number;

  constructor(code: TangleErrorCode, message: string, options: TangleErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TangleError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
  }
}

export function callerError(message: string, options?: TangleErrorOptions): TangleError {
  return new TangleError('TA0001', message, options);
}

export function transportError(message: string, options?: TangleErrorOptions): TangleError {
  return new TangleError('TA0002', message, options);
}

export function payloadError(message: string, options?: TangleErrorOptions): TangleError {
  return new TangleError('TA0003', message, options);
}
