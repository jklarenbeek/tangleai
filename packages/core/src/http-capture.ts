/** The shared canonical address format for exact HTTP captures. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
export type CaptureKind = 'searxng' | 'document';
export const CAPTURED_HEADERS = ['content-type', 'content-length', 'etag', 'last-modified', 'location'] as const;
/** Query parameter order is retained. This preserves historical capture keys. */
export async function captureKeyOf(kind: CaptureKind, method: string, url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.username !== '' || parsed.password !== '')
        throw new Error('a capture key may not cover a credential-bearing URL; credentials travel in no capture, manifest or report');
    return canonicalSha256({ kind, method: method.toUpperCase(), url: parsed.toString() });
}
