/** Original committed HTTP bytes behind the existing canonical capture key. */
import { createHash } from 'node:crypto';
import { captureKeyOf, type CaptureKind } from './http-capture.ts';
import type { PrihaWebRecord } from './priha.types.ts';
export function createPrihaReplay(records: readonly PrihaWebRecord[], bodies: ReadonlyMap<string, Uint8Array>) {
    const byKey = new Map(records.map(row => [row.key, row])), stats = { requests: 0, hits: 0, failed: 0, bytes: 0, networkRequests: 0 };
    return {
        stats: () => ({ ...stats }),
        fetchFor(kind: CaptureKind): typeof globalThis.fetch {
            return async (input, init) => {
                stats.requests++;
                try {
                    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
                    if (method !== 'GET')
                        throw Error('PriHA replay permits only registered GET requests.');
                    const url = input instanceof Request ? input.url : String(input), key = await captureKeyOf(kind, method, url), row = byKey.get(key);
                    if (!row)
                        throw Error('PriHA replay has no registered ' + kind + ' record for this URL.');
                    const bytes = bodies.get(row.file);
                    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
                        throw Error('PriHA replay bytes do not match their registered digest.');
                    const response = new Response(bytes.length ? new Uint8Array(bytes) : null, { status: row.status, headers: row.headers as [
                            string,
                            string
                        ][] });
                    stats.hits++;
                    stats.bytes += bytes.length;
                    return response;
                }
                catch (error) {
                    stats.failed++;
                    throw error;
                }
            };
        },
    };
}
