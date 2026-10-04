import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readAtomEntries } from '@tangleai/research';
import { transcript } from './discovery-fixtures.ts';

it('Atom namespaces, arXiv versions, entities and CDATA preserve scholarly text', async () => {
  const fixture = (await transcript('kmeans-seeding/arxiv-0')).response.body;
  const parsed = readAtomEntries(fixture.replace('Synthetic kmeans-seeding protocol note 1', 'A &amp; B <![CDATA[<fixture>]]>'));
  assert.equal(parsed.errors.length, 0); assert.equal(parsed.entries.length, 5);
  assert.equal(parsed.entries[0].title, 'A & B <fixture>'); assert.equal(parsed.entries[0].canonicalIds.arxivVersion, 2);
  assert.equal(parsed.entries[0].updatedAt, '2026-01-02T00:00:00Z'); assert.deepEqual(parsed.entries[0].categories, ['cs.AI']);
  assert.equal(parsed.total, 8); assert.equal(parsed.start, 0);
});
it('malformed entries are counted without hiding valid neighbors', async () => {
  const fixture = (await transcript('kmeans-seeding/arxiv-0')).response.body;
  const parsed = readAtomEntries(fixture.replace(/<author>.*?<\/author>/, ''));
  assert.equal(parsed.malformed, 1); assert.equal(parsed.entries.length, 4); assert.equal(parsed.errors.length, 1);
});
it('Atom refuses DTDs, unknown entities, namespace spoofing and unbalanced XML', () => {
  for (const text of ['<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed/>',
    '<feed xmlns="http://www.w3.org/2005/Atom">&unknown;</feed>', '<feed xmlns="wrong"/>',
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry></feed>']) assert.ok(readAtomEntries(text).errors.length);
});
