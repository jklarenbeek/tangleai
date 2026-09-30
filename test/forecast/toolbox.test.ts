import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentError } from '@tangleai/documents/contracts';
import { runtimeFixture } from './runtime-fixture.ts';
import { createForecastToolbox, forecastMust, forecastPut, sealForecastRecord, sha256Bytes } from '@tangleai/forecast';

describe('forecast read-only toolbox', () => {
  it('the executor toolbox is exactly web_search, web_read, harness_read, evidence_read', async () => {
    const { toolbox, harness } = await runtimeFixture();
    assert.deepEqual(toolbox.names, ['web_search', 'web_read', 'harness_read', 'evidence_read']);
    assert.equal('add' in toolbox, false);
    assert.throws(() => (toolbox as any).add({ name: 'web_search' }));
    assert.deepEqual(await toolbox.execute('harness_read', {}), harness!.document);
    assert.equal((await toolbox.execute('write', {})).code, 'TFCT1003');
    assert.equal((await toolbox.execute('web_search', { query: 'test', scope: 'foreign' })).code, 'TFCT1001');
  });
  it('the no-harness toolbox omits harness_read', async () => {
    const { toolbox } = await runtimeFixture('no-harness');
    assert.deepEqual(toolbox.names, ['web_search', 'web_read', 'evidence_read']);
    assert.equal((await toolbox.execute('harness_read', {})).code, 'TFCT1003');
  });
  it('post-cutoff and undated snapshots are refused and counted', async () => {
    const f = await runtimeFixture();
    await f.toolbox.execute('web_search', { query: 'Tidewater' });
    const future = f.snapshots.find(s => s.availableAt! > f.checkpoint.cutoffAt)!;
    assert.equal((await f.toolbox.execute('web_read', { url: future.url })).code, 'TFCT1006');
    assert.equal(f.toolbox.audit().postCutoff, 1);
    assert.equal(f.toolbox.evidence().filter(e => !e.admitted).length, 1);
    const admitted = f.snapshots.find(s => s.availableAt! <= f.checkpoint.cutoffAt)!;
    const evidence = await f.toolbox.execute('web_read', { url: admitted.url });
    assert.deepEqual(await f.toolbox.execute('evidence_read', { citationId: evidence.citationId }), evidence);
    assert.equal((await f.toolbox.execute('evidence_read', { citationId: 'missing' })).code, 'TFCT1002');
    f.toolbox.close();
    assert.equal((await f.toolbox.execute('web_read', { url: admitted.url })).code, 'TFCT1006');
  });
  it('live document refusals preserve their codes without transport', async () => {
    for (const code of ['robots-denied', 'terms-denied', 'response-too-large', 'fetch-timeout', 'fetch-failed', 'too-many-redirects', 'unsupported-mime'] as const) {
      const f = await runtimeFixture('no-harness', { cutoffPolicy: { kind: 'live' }, fetcher: { fetch: async () => { throw new DocumentError(code, 'scripted refusal'); } }, extract: async () => { throw Error('Unreachable'); } });
      assert.equal((await f.toolbox.execute('web_read', { url: 'https://fixture.invalid' })).code, code);
      assert.equal(f.toolbox.audit().refusals.length, 1);
    }
  });
  it('refuses undated evidence, freezes host inputs and checks captured hashes', async () => {
    const f = await runtimeFixture(), snapshots = structuredClone(f.snapshots);
    snapshots[0].availableAt = null;
    const options = { ...f,cutoffPolicy: { kind: 'replay' as const,corpus: 'tidewater',snapshots },now: () => f.checkpoint.scheduledAt };
    const toolbox = await createForecastToolbox(options);
    snapshots[0].availableAt = f.checkpoint.scheduledAt; snapshots[1].excerpt = 'mutated after construction';
    await toolbox.execute('web_search',{ query: 'Tidewater' });
    assert.equal(toolbox.audit().undated,1); assert.equal(toolbox.audit().postCutoff,1);
    const record = await toolbox.execute('web_read',{ url: snapshots[1].url });
    assert.notEqual(record.excerpt,'mutated after construction');
    await assert.rejects(createForecastToolbox(options),/captured bytes/);
    const future = f.snapshots.find(s => s.availableAt! > f.checkpoint.cutoffAt)!;
    const forged = await sealForecastRecord('evidence',{ checkpointId: f.checkpoint.id,kind: 'snapshot',address: { corpus: 'tidewater',snapshotId: future.id },availableAt: future.availableAt,fetchedAt: null,claimedPublishedAt: null,sha256: future.sha256,bytes: future.excerpt.length,excerpt: future.excerpt,citationId: future.id,admitted: true,refusal: null });
    const refused = await forecastPut(f.store,'evidence',forged); assert.equal(refused.ok,false); if (!refused.ok) assert.equal(refused.issues[0].code,'TFCT1006');
  });
  it('live capture hashes raw bytes separately from bounded excerpts and distinct source addresses', async () => {
    const bytes = new TextEncoder().encode('<html>Raw captured evidence.</html>'); let reads = 0;
    const f = await runtimeFixture('no-harness',{ cutoffPolicy: { kind: 'live' },limits: { excerptChars: 12 },fetcher: { fetch: async (url: string) => { reads++; return { status: 'ok',finalUrl: url,mimeType: 'text/html',bytes,fetchedAt: '2025-01-10T00:00:00.000Z' }; } },extract: async () => ({ elements: [{ text: 'The extracted text is longer than the excerpt.' }] }) });
    const a = await f.toolbox.execute('web_read',{ url: 'https://fixture.invalid/a' }), b = await f.toolbox.execute('web_read',{ url: 'https://fixture.invalid/b' });
    assert.equal(reads,2); assert.equal(a.bytes,bytes.length); assert.equal(a.sha256,await sha256Bytes(bytes)); assert.notEqual(a.bytes,new TextEncoder().encode(a.excerpt).length); assert.notEqual(a.citationId,b.citationId);
    assert.equal(a.availableAt,null); assert.equal(a.claimedPublishedAt,null); assert.ok(a.fetchedAt); assert.ok(a.excerpt.length<=12);
    forecastMust(await forecastPut(f.store,'evidence',a));
  });
});
