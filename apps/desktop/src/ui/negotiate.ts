/**
 * Version negotiation, before the app mounts.
 *
 * The browser bundle carries its own compiled copy of the contract, so
 * the one mismatch shipping both halves together cannot rule out is a
 * CACHED bundle older than the server serving it. Without this, that
 * shows up as operations failing one at a time for reasons none of them
 * can explain.
 *
 * `negotiate()` asks the server's well-known document and answers a
 * value — never throws, and `compatible` is the suite's declared rule
 * (same version, or either end's `compat` names the other's). This turns
 * that value into a mount decision plus a sentence an operator can act
 * on.
 *
 * The policy, and why each half of it: a version the two ends do not
 * declare compatible is a real refusal and blocks the mount, because
 * every operation after it would be guesswork. A server that cannot be
 * reached, or answers something that is not this contract, does NOT
 * block: the first is transient and the app reports its own transport
 * failures, and the second can only mean the port belongs to something
 * else, which the operator sees the moment anything is attempted.
 */

/** What `negotiate()` answers; structural, so any client shape fits. */
export interface NegotiationResult {
  compatible: boolean;
  reason: 'same-version' | 'server-accepts' | 'client-accepts' | 'version-mismatch' | 'unreachable' | 'not-a-contract';
  server: { id: string | null, version: string | null, compat: string[], revision: string | null } | null;
  error: { code: string, message: string } | null;
}

export interface NegotiatingClient {
  negotiate: (options?: { signal?: AbortSignal }) => Promise<NegotiationResult>;
}

export interface BootVerdict {
  /** Whether the app may mount against this server. */
  mount: boolean;
  reason: NegotiationResult['reason'];
  /** The server's declared identity, or null when it did not answer. */
  server: NegotiationResult['server'];
  /** Operator-facing sentence; null exactly when the mount proceeds unremarkably. */
  message: string | null;
  /** The coded refusal, carried so a caller can log it without re-deriving. */
  code: string | null;
}

/** Reasons that stop the mount. Everything else proceeds. */
const REFUSING = new Set(['version-mismatch']);

/**
 * Negotiate, and answer whether to mount. `clientVersion` is the version
 * the bundle was built against — the one number an operator needs to see
 * beside the server's to understand a refusal.
 */
export async function negotiateBoot(
  client: NegotiatingClient,
  clientVersion: string,
  options: { signal?: AbortSignal } = {},
): Promise<BootVerdict> {
  const result = await client.negotiate(options.signal ? { signal: options.signal } : {});
  const server = result.server ?? null;
  if (result.compatible) return { mount: true, reason: result.reason, server, message: null, code: null };
  const code = result.error?.code ?? null;
  if (REFUSING.has(result.reason)) {
    return { mount: false, reason: result.reason, server, code,
      message: `This page was built for desktop ${clientVersion} and the server speaks `
        + `${server?.version ?? 'an undeclared version'}`
        + `${server && server.compat.length ? ` (accepting ${server.compat.join(', ')})` : ''}. `
        + 'Reload to pick up the build this server ships.' };
  }
  return { mount: true, reason: result.reason, server, code,
    message: result.reason === 'unreachable'
      ? 'The desktop server did not answer the version check; continuing, and operations will report their own failures.'
      : 'The address answered something that is not this desktop contract; continuing, but nothing here will work against it.' };
}
