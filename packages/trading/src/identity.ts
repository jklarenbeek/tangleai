import { canonicalSha256, cloneJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';

/** Snapshot finite JSON before any asynchronous validation or injected seam. */
export function immutableTradingJson<T>(value: T): T { return deepFreeze(cloneJson(value)) as T; }
export function tradingRevisionOf(value: unknown): Promise<string> { return canonicalSha256(value); }
export async function tradingIdentityOf(value: { kind: string; id?: string; revision?: string }): Promise<{ id: string; revision: string }> {
  const { id: _id, revision: _revision, ...body } = immutableTradingJson(value);
  const revision = await canonicalSha256({ domain: `trading-${body.kind}/1`, body });
  return { id: `${body.kind}-${revision}`, revision };
}
