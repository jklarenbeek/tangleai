import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { researchContext } from '../../benchmark/lib/research.ts';
import { RESEARCH_FIXTURE_PATH } from '../../benchmark/lib/research-fixture.ts';

// Parsing an injected timestamp is deterministic. Reading or constructing the
// global clock, including through Date aliases, remains forbidden here.
const clockReference = /\bDate\b(?!\.parse\b)|performance\.now/;
it('the source guard distinguishes input timestamp parsing from global clocks', () => {
  assert.doesNotMatch('Date.parse(licence.auditedAt)', clockReference);
  for (const source of ['Date.now()', 'new Date()', 'Date()', 'const clock = Date',
    'globalThis.Date.now()', 'Date.parse(Date())', 'performance.now()']) assert.match(source, clockReference, source);
});
it('authored fixtures and generated schemas reproduce without clocks in the implementation', async () => {
  const context = await researchContext();
  for (const command of [['benchmark/scripts/research-fixtures.ts', '--check'], ['scripts/research-schema.ts', '--check']]) {
    const child = spawnSync(process.execPath, command, { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  }
  for (const path of (await readdir('benchmark/lib')).filter(path => /^research.*\.ts$/.test(path)))
    assert.doesNotMatch(await readFile(join('benchmark/lib', path), 'utf8'), clockReference);
  assert.ok(context.source.files.some(file => file.path === RESEARCH_FIXTURE_PATH + '/LICENSE.md'));
  for (const member of context.loaded.manifest.members)
    assert.ok(context.source.files.some(file => file.path === RESEARCH_FIXTURE_PATH + '/' + member.path), member.path);
});
