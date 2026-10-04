import assert from 'node:assert/strict';
import { it } from 'node:test';
import { normalizeLiterature, dedupeLiterature, normalizeDoi, normalizeArxiv, discoverCrossref, createReplayTransport } from '@tangleai/research';
import { licence, query, providerHost, adapterContext, transcript } from './discovery-fixtures.ts';

it('same work under three providers collapses with three retained raw hashes', async () => {
  const metadata = { title: ' Same   title ', authors: ['A Author'], date: '2026-01-01', sourceUrl: 'https://fixture.invalid/paper', canonicalIds: { doi: 'https://doi.org/10.5555/SAME' } };
  const rows = await Promise.all((['openalex', 'crossref', 'arxiv'] as const).map((source, i) => normalizeLiterature(metadata, source, String(i).repeat(64), licence)));
  const result = await dedupeLiterature(rows);
  assert.equal(result.records.length, 1); assert.equal(result.records[0].rawHashes.length, 3); assert.equal(result.dedupe.identityMerges, 2);
  assert.equal(result.records[0].canonicalIds.doi, '10.5555/same');
  assert.deepEqual(await dedupeLiterature([...rows].reverse()), result);
});
it('distinct canonical works with identical metadata remain distinct and record the refused fallback', async () => {
  const replay = await createReplayTransport([await transcript('collisions/distinct-title')], { scope: 'collisions' });
  const found = await discoverCrossref(query('crossref', 'distinct-title'), providerHost(replay.transport), adapterContext());
  const result = await dedupeLiterature(found.records);
  assert.equal(found.outcome.state, 'complete'); assert.equal(result.records.length, 2);
  assert.equal(result.dedupe.fallbackMerges[0].status, 'refused'); assert.equal(result.dedupe.distinctPreserved, 1);
});
it('identifier canonicalization preserves arXiv versions and refuses invented identifiers', () => {
  assert.equal(normalizeDoi('doi:10.5555/ABC'), '10.5555/abc');
  assert.deepEqual(normalizeArxiv('https://arxiv.org/abs/2608.05179v3'), { arxiv: '2608.05179', arxivVersion: 3 });
  assert.throws(() => normalizeDoi('no-doi')); assert.throws(() => normalizeArxiv('not-arxiv'));
});
it('metadata fallback joins an unidentified record but preserves disjoint identified works', async () => {
  const metadata = { title: 'Protocol', authors: ['Author'], date: '2026-01-01', sourceUrl: 'https://fixture.invalid/source' };
  const identified = await normalizeLiterature({ ...metadata, canonicalIds: { doi: '10.5555/one' } }, 'crossref', '1'.repeat(64), licence);
  const unidentified = await normalizeLiterature({ ...metadata, canonicalIds: {} }, 'openalex', '2'.repeat(64), licence);
  const disjoint = await normalizeLiterature({ ...metadata, canonicalIds: { arxiv: '2608.05179' } }, 'arxiv', '3'.repeat(64), licence);
  const merged = await dedupeLiterature([identified, unidentified]);
  assert.equal(merged.records.length, 1); assert.equal(merged.dedupe.fallbackMerges[0].status, 'merged');
  const refused = await dedupeLiterature([identified, disjoint]);
  assert.equal(refused.records.length, 2); assert.equal(refused.dedupe.fallbackMerges[0].status, 'refused');
  assert.equal((await dedupeLiterature([identified, unidentified, disjoint])).records.length, 3);
});
it('cross-provider identity bridges merge compatible groups without erasing conflicts', async () => {
  const metadata = { title: 'Protocol', authors: ['Author'], date: '2026-01-01', sourceUrl: 'https://fixture.invalid/source' };
  const rows = await Promise.all([{ doi: '10.5555/one' }, { arxiv: '2608.05179' }, { doi: '10.5555/one', arxiv: '2608.05179' }]
    .map((canonicalIds, i) => normalizeLiterature({ ...metadata, canonicalIds }, 'crossref', String(i).repeat(64), licence)));
  assert.equal((await dedupeLiterature(rows)).records.length, 1);
  const conflict = await normalizeLiterature({ ...metadata, canonicalIds: { doi: '10.5555/two', arxiv: '2608.05179' } }, 'arxiv', 'f'.repeat(64), licence);
  const result = await dedupeLiterature([...rows, conflict]);
  assert.equal(result.records.length, 4, 'Contradictory identity components keep every source record separate.');
  assert.ok(result.records.some(r => r.canonicalIds.doi === '10.5555/two'));
  assert.deepEqual(await dedupeLiterature([conflict, ...rows].reverse()), result);
});
