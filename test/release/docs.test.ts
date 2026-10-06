import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderDocument, REPORT_PATH, DOCUMENT_PATH } from '../../benchmark/lib/research.ts';
import { RESEARCH_ERRORS } from '@tangleai/research';
import type { ResearchReport } from '../../benchmark/lib/research.types.ts';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { ROOT, config, npm, readJson } from '../../scripts/release/common.ts';
import { assertPackagedGuides } from '../../scripts/release/build.ts';

for (const path of config().packages) {
  const source = resolve(ROOT, path);
  if (!existsSync(resolve(source, 'docs'))) continue;
  it(`${basename(source)} ships all package guides through its real npm files allowlist`, () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tangle-guide-pack-'));
    try {
      const manifest = readJson(resolve(source, 'package.json'));
      writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'tangle-guide-probe', version: '0.0.0', private: true, files: manifest.files }));
      cpSync(resolve(source, 'README.md'), resolve(directory, 'README.md'));
      cpSync(resolve(source, 'docs'), resolve(directory, 'docs'), { recursive: true });
      const [pack] = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: directory, capture: true }));
      assertPackagedGuides(source, new Set(pack.files.map((file: { path: string }) => file.path)));
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
  });
}

it('research documentation is rendered from the report and linked by its public entry points', async () => {
  const report: ResearchReport = JSON.parse(await readFile(resolve(ROOT, REPORT_PATH), 'utf8'));
  assert.equal(await readFile(resolve(ROOT, DOCUMENT_PATH), 'utf8'), renderDocument(report));
  const root = await readFile(resolve(ROOT, 'README.md'), 'utf8');
  const research = await readFile(resolve(ROOT, 'packages/research/README.md'), 'utf8');
  assert.ok(root.includes('(docs/RESEARCH_BENCHMARK.md)'));
  assert.ok(research.includes('(../../docs/RESEARCH_BENCHMARK.md)'));
  assert.ok(research.includes(report.lessons.defaultWriteback));
  assert.ok(research.includes('`' + report.lessons.defaultDecay + '`'));
  for (const [code, meaning] of Object.entries(RESEARCH_ERRORS).filter(([code]) => code.startsWith('TRSH2')))
    assert.ok(research.includes('| `' + code + '` | ' + meaning + ' |'), code);
  assert.match(research, /ARC-Bench is not adopted/);
});
