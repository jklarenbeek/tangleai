/** Regenerate authored inputs; the research fixture owner records the enclosing census. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tabularStatisticsFixtureFiles } from '../lib/research-tabular-fixture.ts';
import { RESEARCH_FIXTURE_PATH } from '../lib/research-fixture.ts';
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('Usage: tabular-statistics-fixture.ts [--check]');
for (const [path, bytes] of await tabularStatisticsFixtureFiles()) {
  const destination = join(RESEARCH_FIXTURE_PATH, path);
  if (args.includes('--check')) { if (!Buffer.from(await readFile(destination)).equals(bytes)) throw Error('Tabular fixture drift: ' + path); }
  else { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); }
}
