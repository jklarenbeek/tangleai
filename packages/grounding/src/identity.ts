/** Stable JSON identities; callers provide observations explicitly, never a clock. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
export function immutableGroundingJson<T>(value: T): T {
    return deepFreeze(JSON.parse(canonicalizeJson(value))) as T;
}
export function groundingRevisionOf(value: unknown): Promise<string> { return canonicalSha256(value); }
export function profileRevisionOf(document: { revision: string }): Promise<string> {
    const { revision: _, ...payload } = document;
    return groundingRevisionOf(payload);
}
export async function groundingIdOf(kind: string, payload: unknown): Promise<string> {
    if (!/^[a-z][a-z-]*$/.test(kind)) throw new TypeError('A grounding identity kind must be a lowercase name.');
    return `${kind}-${(await groundingRevisionOf(payload)).slice(0, 32)}`;
}
