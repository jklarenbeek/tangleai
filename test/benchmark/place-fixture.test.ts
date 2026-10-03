import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { geoDistance, geohashNeighbours, geohashEncode, isValidGeoJson } from '@jarenjs/core/geo';
import { loadPlaceFixture, placeHash, type PlaceTurn } from '../../benchmark/lib/place-fixture.ts';
import { placeOracle } from '../../benchmark/lib/place-oracle.ts';

test('place fixture preserves sourced coordinates and the complete audited denominator', async () => {
  const loaded = await loadPlaceFixture();
  assert.equal(loaded.fixtureHash, '57c8e16c67be98679480bbaa80dec3c8d069b290dba7a712b5972eab21279f36');
  assert.equal(loaded.fixture.manifest.census.entries, 71);
  assert.deepEqual(loaded.fixture.manifest.coverage, { mentionSites: 197, grounded: 174, ungrounded: 13, ambiguous: 10, personas: 16, positions: 57 });
  assert.equal(loaded.fixture.manifest.floor.passed, true);
  for (const entry of loaded.fixture.entries) {
    assert.equal(isValidGeoJson(entry.geometry), true);
    assert.deepEqual(entry.geometry.coordinates, [entry.sourceLatLon.lon, entry.sourceLatLon.lat]);
    assert.equal(entry.geometry.coordinates.length, 2);
    assert.equal('crs' in entry.geometry, false);
    assert.ok(entry.source.id && entry.source.url && entry.source.retrieved);
    assert.equal(entry.source.kind, 'wikidata');
    assert.equal(geohashNeighbours(geohashEncode(entry.geometry.coordinates[0], entry.geometry.coordinates[1], 6)).length, 9);
  }
});

test('place spans are exact UTF-16 source slices and fixture strings redistribute no turn prose', async t => {
  const loaded = await loadPlaceFixture();
  if (loaded.corpus.status === 'unavailable') { t.skip(loaded.corpus.detail); return; }
  assert.equal(loaded.corpus.unresolvedMentions, 0);
  for (const mention of loaded.fixture.mentions) {
    const source: PlaceTurn = loaded.corpus.turns.get(`${mention.sampleId}/${mention.diaId}`)!;
    assert.equal(await canonicalSha256(source.text.slice(mention.start, mention.end)), mention.quoteSha256);
  }
  const aliases = new Set(loaded.fixture.entries.flatMap(e => e.names).concat(loaded.fixture.manifest.knownUngrounded));
  const longestAlias = Math.max(...[...aliases].map(a => a.length));
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  for (const file of [...loaded.fixture.manifest.files, { path: 'manifest.json' }]) {
    const data = JSON.parse(await readFile(`benchmark/fixtures/place/${file.path}`, 'utf8')) as unknown;
    for (const value of strings(data)) if (value.length > longestAlias && !aliases.has(value)) {
      assert.equal([...loaded.corpus.turns.values()].some(turn => turn.text.includes(value)), false, `Redistributed prose: ${file.path}`);
    }
  }
});

test('place fixture refuses drift, foreign members, rehashed geometry swaps and unresolved spans', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'place-fixture-drift-'));
  try {
    const path = join(dir, 'benchmark/fixtures/place'); await mkdir(path, { recursive: true });
    await cp('benchmark/fixtures/place', path, { recursive: true });
    const manifestPath = join(path, 'manifest.json'), originalManifest = await readFile(manifestPath, 'utf8');
    const loaded = await loadPlaceFixture(), manifest = structuredClone(loaded.fixture.manifest);
    const change = async (name: string, data: unknown) => {
      const bytes = JSON.stringify(data, null, 2) + '\n'; await writeFile(join(path, name), bytes);
      manifest.files.find(f => f.path === name)!.sha256 = placeHash(bytes); await writeFile(manifestPath, JSON.stringify(manifest));
    };
    const gazetteerPath = join(path, 'gazetteer.json'), originalGazetteer = await readFile(gazetteerPath, 'utf8');
    await writeFile(gazetteerPath, originalGazetteer + ' ');
    await assert.rejects(loadPlaceFixture({ root: dir, corpusRoot: process.cwd() }), /hash drift/);
    const gazetteer = JSON.parse(originalGazetteer) as { entries: typeof loaded.fixture.entries };
    gazetteer.entries[0].geometry.coordinates.reverse(); await change('gazetteer.json', gazetteer);
    await assert.rejects(loadPlaceFixture({ root: dir, corpusRoot: process.cwd() }), /coordinate differs|place contract/);
    await writeFile(gazetteerPath, originalGazetteer); await writeFile(manifestPath, originalManifest);
    const badMembers = JSON.parse(originalManifest) as typeof manifest; badMembers.files[0].path = '../gazetteer.json';
    await writeFile(manifestPath, JSON.stringify(badMembers));
    await assert.rejects(loadPlaceFixture({ root: dir, corpusRoot: process.cwd() }), /member inventory/);
    await t.test('a rehashed changed span remains unresolved', { skip: loaded.corpus.status === 'unavailable' ? loaded.corpus.detail : false }, async () => {
      Object.assign(manifest, JSON.parse(originalManifest));
      const mentions = { document: 'place-mentions', rows: structuredClone(loaded.fixture.mentions) }; mentions.rows[0].start++;
      await change('mentions.json', mentions);
      await assert.rejects(loadPlaceFixture({ root: dir, corpusRoot: process.cwd() }), /unresolved-mention: 1/);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('independent place oracle derives every answer from annotations and native kernels', async t => {
  const loaded = await loadPlaceFixture();
  if (loaded.corpus.status === 'unavailable') { t.skip(loaded.corpus.detail); return; }
  for (const question of loaded.fixture.questions) {
    const { expected, ...input } = question;
    assert.deepEqual(await placeOracle(loaded, input), expected, question.id);
    if (question.kind === 'movement-distance' && 'metres' in expected) {
      const from = loaded.fixture.entries.find(e => e.id === expected.fromEntryId)!;
      const to = loaded.fixture.entries.find(e => e.id === expected.toEntryId)!;
      assert.equal(expected.metres, Math.round(geoDistance(from.geometry, to.geometry)!));
    }
  }
});
