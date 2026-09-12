import { canonicalSha256,canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
/** Fresh, stable JSON property order; non-JSON/functions/nonfinite values refuse. */
export function immutableJson<T>(value:T):T{return deepFreeze(JSON.parse(canonicalizeJson(value))) as T;}
export function gmplRevisionOf(value:unknown):Promise<string>{return canonicalSha256(value);}
export function gmplVersionOf(value:{revision:string}):Promise<string>{const {revision:_,...payload}=value;return gmplRevisionOf(payload);}
/** Exact UTF-8 source receipt, including whitespace/comments/line endings. */
export async function gmplTextDigest(text:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
