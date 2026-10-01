import { it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentError, SafeStaticFetcher, assertPublicUrl, isReservedAddress } from '@tangleai/documents';
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
it('admission runs before any initial request and on every redirect target', async () => {
    const requested: string[] = [], admitted: Array<[string, number]> = [];
    const fetcher = new SafeStaticFetcher({ lookup, limits: { respectRobots: false, perHostDelayMs: 0 },
        admission: (url, hop) => { admitted.push([url, hop]); return new URL(url).host === 'official.example' ? { admitted: true, tier: 'official', ruleId: 'official' } : { admitted: false, reason: 'unknown-host' }; },
        fetch: async input => { const url = String(input); requested.push(url); return new Response(null, { status: 302, headers: { location: 'https://outside.example/secret' } }); } });
    try {
        await assert.rejects(fetcher.fetch('https://outside.example/initial'), (error: unknown) => error instanceof DocumentError && error.code === 'policy-denied' && error.details?.hop === 0);
        assert.deepEqual(requested, []);
        await assert.rejects(fetcher.fetch('https://official.example/start'), (error: unknown) => error instanceof DocumentError && error.code === 'policy-denied'
            && error.details?.hop === 1 && error.details?.url === 'https://outside.example/secret');
        assert.deepEqual(requested, ['https://official.example/start']);
        assert.deepEqual(admitted, [['https://outside.example/initial', 0], ['https://official.example/start', 0], ['https://outside.example/secret', 1]]);
    } finally { await fetcher.close(); }
});
it('auxiliary robots reads cannot escape a path-scoped admission policy', async () => {
    let requests = 0;
    const fetcher = new SafeStaticFetcher({ lookup, limits: { respectRobots: true, perHostDelayMs: 0 },
        admission: url => new URL(url).pathname.startsWith('/allowed/') ? { admitted: true } : { admitted: false, reason: 'outside-path' },
        fetch: async () => { requests++; return new Response(''); } });
    try {
        await assert.rejects(fetcher.fetch('https://official.example/allowed/page'), (error: unknown) => error instanceof DocumentError && error.code === 'policy-denied' && error.details?.url === 'https://official.example/robots.txt');
        assert.equal(requests, 0);
        const api = await fetcher.fetch('https://official.example/allowed/search', {}, undefined, { respectRobots: false });
        assert.equal(api.status, 'ok'); assert.equal(requests, 1);
    } finally { await fetcher.close(); }
});
it('admission does not bypass terms and successful redirects retain their chain', async () => {
    let requests = 0, allowTerms = false;
    const fetcher = new SafeStaticFetcher({ lookup, admission: () => ({ admitted: true }), termsPolicy: () => allowTerms,
        limits: { respectRobots: false, perHostDelayMs: 0 }, fetch: async input => { requests++; return String(input).endsWith('/start')
            ? new Response(null, { status: 302, headers: { location: '/end' } }) : new Response('Document text', { headers: { 'content-type': 'text/plain' } }); } });
    try {
        await assert.rejects(fetcher.fetch('https://official.example/start'), (error: unknown) => error instanceof DocumentError && error.code === 'terms-denied');
        assert.equal(requests, 0); allowTerms = true;
        const result = await fetcher.fetch('https://official.example/start'); assert.deepEqual(result.redirects, ['https://official.example/end']);
        assert.equal(result.finalUrl, 'https://official.example/end'); assert.equal(requests, 2);
    } finally { await fetcher.close(); }
});
it('a request can narrow its byte allowance but cannot widen the host limit', async () => {
    let requests = 0;
    const fetcher = new SafeStaticFetcher({ lookup, limits: { respectRobots: false, perHostDelayMs: 0, maxBytes: 20 },
        fetch: async () => { requests++; return new Response('0123456789'); } });
    try {
        await assert.rejects(fetcher.fetch('https://official.example/page', {}, undefined, { maxBytes: 21 }), (error: unknown) => error instanceof DocumentError && error.code === 'invalid-fetch-budget');
        assert.equal(requests, 0);
        await assert.rejects(fetcher.fetch('https://official.example/page', {}, undefined, { maxBytes: 5 }), (error: unknown) => error instanceof DocumentError && error.code === 'response-too-large');
        assert.equal(requests, 1);
    } finally { await fetcher.close(); }
});

it('protected IPv4 mapped through normalized or expanded IPv6 is refused before transport', async () => {
    for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:c0a8:101', '0:0:0:0:0:0:0:1', '2001:0db8:0:0:0:0:0:1']) {
        assert.equal(isReservedAddress(address), true, address);
        await assert.rejects(assertPublicUrl('http://[' + address + ']/'), (error: unknown) => error instanceof DocumentError && error.code === 'blocked-address');
    }
    assert.equal(isReservedAddress('::ffff:1.1.1.1'), false);
    assert.equal(isReservedAddress('2606:4700:4700::1111'), false);
});
