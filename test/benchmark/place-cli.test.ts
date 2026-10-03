import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { runPlaceCli } from '../../benchmark/place.ts';
import { loadPlaceFixture } from '../../benchmark/lib/place-fixture.ts';
import type { Report } from '../../benchmark/lib/place-report.types.ts';

test('place CLI refuses unknown flags, missing values and overlapping outputs before measurement', async () => {
  for (const args of [['--unknown'], ['positional'], ['--json'], ['--json', '--check'], ['--check=yes'], ['--require=no'], ['--json', 'same', '--md', 'same']]) {
    await assert.rejects(runPlaceCli(args));
  }
});

test('the independent place CLI reproduces both files without writing and rejects source drift', async t => {
  const loaded = await loadPlaceFixture();
  if (loaded.corpus.status === 'unavailable') { t.skip(loaded.corpus.detail); return; }
  const dir = await mkdtemp(join(tmpdir(), 'place-cli-'));
  try {
    const json = join(dir, 'report.json'), md = join(dir, 'report.md');
    await writeFile(json, await readFile('benchmark/results/place.json'));
    await writeFile(md, await readFile('docs/PLACE_BENCHMARK.md'));
    const before = [(await stat(json)).mtimeMs, (await stat(md)).mtimeMs];
    await promisify(execFile)(process.execPath, ['benchmark/place.ts', '--json', json, '--md', md, '--check', '--require']);
    assert.deepEqual([(await stat(json)).mtimeMs, (await stat(md)).mtimeMs], before);
    const report = JSON.parse(await readFile(json, 'utf8')) as Report;
    report.source.files[0].sha256 = '0'.repeat(64);
    report.source.sha256 = await canonicalSha256({ head: report.source.head, files: report.source.files });
    const { sha256: _, ...body } = report; report.sha256 = await canonicalSha256(body);
    await writeFile(json, JSON.stringify(report));
    const bytes = await readFile(json, 'utf8');
    await assert.rejects(runPlaceCli(['--json', json, '--md', md, '--check']), /source drift/);
    assert.equal(await readFile(json, 'utf8'), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
