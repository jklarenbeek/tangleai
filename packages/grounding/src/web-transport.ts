/** Exact committed responses, with no replay miss fallback or network/DNS access. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { captureKeyOf, CAPTURED_HEADERS, type CaptureKind } from '@tangleai/core/http-capture';
import { DocumentError } from '@tangleai/documents/contracts';
import type { AddressLookup } from '@tangleai/documents/url-policy';
export interface WebTransport {
    fetch: typeof globalThis.fetch;
    lookup: AddressLookup;
    searxBase: string;
    /** Host identity of the capture set or live transport configuration. */
    revision: string;
}
export interface WebReplayRecord {
    key: string; kind: CaptureKind; method: 'GET'; url: string; status: number;
    headers: readonly (readonly [string, string])[]; bytes: Uint8Array; sha256: string;
}
export async function webBytesSha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function createReplayWebTransport(records: readonly WebReplayRecord[], options: { searxBase: string }) {
    const base = new URL(options.searxBase), searchPath = base.pathname.replace(/\/+$/, '') + '/search';
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
        throw new TypeError('Replay search base must be a credential-free HTTP origin/path.');
    const rows = new Map<string, WebReplayRecord>();
    for (const record of records) {
        if (record.method !== 'GET' || record.key !== await captureKeyOf(record.kind, record.method, record.url)
            || record.sha256 !== await webBytesSha256(record.bytes) || rows.has(record.key)
            || !Number.isSafeInteger(record.status) || record.status < 200 || record.status > 599
            || record.headers.some(([name]) => !CAPTURED_HEADERS.includes(name.toLowerCase() as typeof CAPTURED_HEADERS[number])))
            throw new TypeError('Replay record key, bytes, status or headers differ from the capture format.');
        rows.set(record.key, { ...record, headers: record.headers.map(pair => [...pair] as [string, string]), bytes: new Uint8Array(record.bytes) });
    }
    const revision = await canonicalSha256({ searxBase: base.toString(), records: [...rows.values()].map(({ bytes: _, ...row }) => row).sort((a, b) => a.key.localeCompare(b.key)) });
    const census = { requests: 0, hits: 0, failed: 0, servedBytes: 0, networkRequests: 0 as const };
    const transport: WebTransport = { searxBase: base.toString().replace(/\/$/, ''), revision,
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: async (input, init) => {
            census.requests++;
            try {
                const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
                if (method !== 'GET') throw new DocumentError('replay-missing', 'Replay permits only registered GET requests.');
                const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
                if (signal?.aborted) throw new DocumentError('fetch-aborted', 'Replay request was aborted.');
                const url = new URL(input instanceof Request ? input.url : String(input));
                const kind = url.origin === base.origin && url.pathname === searchPath ? 'searxng' : 'document';
                const key = await captureKeyOf(kind, method, url.toString()), record = rows.get(key);
                if (!record) throw new DocumentError('replay-missing', 'No exact response was registered for this request.', { kind, method, url: url.toString(), key });
                const body = record.bytes.length ? new Uint8Array(record.bytes) : null;
                const response = new Response(body, { status: record.status, headers: record.headers.map(pair => [...pair] as [string, string]) });
                census.hits++; census.servedBytes += record.bytes.length; return response;
            } catch (cause) { census.failed++; throw cause; }
        },
    };
    return Object.freeze({ ...transport, stats: () => ({ ...census }) });
}
