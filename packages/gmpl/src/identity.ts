import { canonicalSha256, cloneJson } from '@jarenjs/json/canonical';
import { sha256Hex } from '@jarenjs/core/string';
import { deepFreeze } from '@jarenjs/core/object';
/** Fresh, stable JSON property order; non-JSON/functions/nonfinite values refuse. */
export function immutableJson<T>(value:T):T{return deepFreeze(cloneJson(value)) as T;}
export function gmplRevisionOf(value:unknown):Promise<string>{return canonicalSha256(value);}
export function gmplVersionOf(value:{revision:string}):Promise<string>{const {revision:_,...payload}=value;return gmplRevisionOf(payload);}
/** Exact UTF-8 source receipt, including whitespace/comments/line endings. */
export async function gmplTextDigest(text:string):Promise<string>{
  return sha256Hex(text);
}
