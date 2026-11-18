/**
 * A source receipt identifies what a generator reads, not the release it
 * ships in: a version-only bump of every Tangle package moves no package
 * manifest's or lockfile's identity, and a dependency move still does.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { identityBytes } from '../../benchmark/lib/source-manifest.ts';

const digest = (path: string, text: string) => createHash('sha256').update(identityBytes(path, Buffer.from(text))).digest('hex');
const bump = (text: string, from: string, to: string) => text.split(`"${from}"`).join(`"${to}"`);

describe('source identity across a release', () => {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;
  const next = version.replace(/\d+$/, n => String(Number(n) + 1));

  for (const path of ['package.json', 'package-lock.json', 'packages/core/package.json']) {
    it(`${path}: a version-only bump keeps its identity, a Jaren move does not`, () => {
      const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
      assert.ok(text.includes(`"${version}"`), 'the file carries the release version');
      assert.equal(digest(path, bump(text, version, next)), digest(path, text));
      const jaren = text.match(/"@jarenjs\/core": "([^"]+)"/)?.[1];
      if (jaren) assert.notEqual(digest(path, bump(text, jaren, `${jaren}-next`)), digest(path, text));
    });
  }

  it('hashes every other file as its bytes', () => {
    const bytes = Buffer.from('{"version":"1.0.0"}');
    assert.equal(identityBytes('benchmark/fixtures/x.json', bytes), bytes);
  });
});
