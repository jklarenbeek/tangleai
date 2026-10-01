import { it } from 'node:test';
import assert from 'node:assert/strict';
import { captureKeyOf } from '@tangleai/core/http-capture';
import { DocumentError } from '@tangleai/documents';
import { createReplayWebTransport, webBytesSha256, type WebReplayRecord } from '@tangleai/grounding';
import { captureKeyOf as historicalKey } from '../../benchmark/lib/http-capture.ts';
async function record(url = 'https://official.example/page', text = 'Exact page bytes.'): Promise<WebReplayRecord> {
    const bytes = new TextEncoder().encode(text), kind = url.includes('/search?') ? 'searxng' as const : 'document' as const;
    return { key: await captureKeyOf(kind, 'GET', url), kind, method: 'GET', url, status: 200,
        headers: [['content-type', kind === 'document' ? 'text/plain' : 'application/json']], bytes, sha256: await webBytesSha256(bytes) };
}
it('replay serves exact copied bytes repeatedly with no network or DNS fallback', async () => {
    const original = globalThis.fetch; let network = 0;
    globalThis.fetch = async () => { network++; throw Error('Unexpected network fallback.'); };
    try {
        const row = await record(), transport = await createReplayWebTransport([row], { searxBase: 'https://search.example' });
        row.bytes.fill(0);
        for (let i = 0; i < 2; i++) assert.equal(await (await transport.fetch(row.url)).text(), 'Exact page bytes.');
        assert.equal(network, 0); assert.equal(transport.stats().networkRequests, 0); assert.equal(transport.stats().hits, 2);
        assert.deepEqual(await transport.lookup('does-not-exist.example'), [{ address: '93.184.216.34', family: 4 }]);
        await assert.rejects(transport.fetch('https://official.example/missing'), (error: unknown) => error instanceof DocumentError && error.code === 'replay-missing');
        assert.equal(transport.stats().failed, 1); assert.equal(network, 0);
    } finally { globalThis.fetch = original; }
});
it('capture identity matches its historical owner exactly and retains query ordering', async () => {
    const a = 'https://search.example/search?q=Harbour+booking&format=json', b = 'https://search.example/search?format=json&q=Harbour+booking';
    assert.equal(await captureKeyOf('searxng', 'get', a), await historicalKey('searxng', 'GET', a));
    assert.notEqual(await captureKeyOf('searxng', 'GET', a), await captureKeyOf('searxng', 'GET', b));
    const transport = await createReplayWebTransport([await record(a, '{"results":[]}')], { searxBase: 'https://search.example' });
    await assert.rejects(transport.fetch(b), (error: unknown) => error instanceof DocumentError && error.code === 'replay-missing');
});
it('replay refuses changed bytes, repeated keys and credential-bearing capture addresses', async () => {
    const row = await record();
    await assert.rejects(createReplayWebTransport([{ ...row, sha256: '0'.repeat(64) }], { searxBase: 'https://search.example' }), /capture format/);
    await assert.rejects(createReplayWebTransport([row, row], { searxBase: 'https://search.example' }), /capture format/);
    await assert.rejects(captureKeyOf('document', 'GET', 'https://user:password@official.example/page'), /credential-bearing/);
});
it('redirect, empty and failed response status remain exact replay data', async () => {
    const redirect = { ...await record('https://official.example/start', ''), status: 302, headers: [['location', 'https://outside.example/page']] as [string, string][] };
    const missing = { ...await record('https://official.example/not-found', ''), status: 404 };
    const transport = await createReplayWebTransport([redirect, missing], { searxBase: 'https://search.example' });
    const r = await transport.fetch(redirect.url); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://outside.example/page'); assert.equal(await r.text(), '');
    assert.equal((await transport.fetch(missing.url)).status, 404); assert.equal(transport.stats().servedBytes, 0);
});
