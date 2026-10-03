/** Keyless sourced-place measurement; malformed or stale inputs are refused before writing. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { parseArgs } from './lib/args.ts';
import { placeContext, runPlaceConformance, renderPlaceReport, validatePlaceReport } from './lib/place-conformance.ts';
import type { Report } from './lib/place-report.types.ts';
import { preparePlaceBaselines } from './lib/place-baselines.ts';
import { placeRuntimeAdapters } from './lib/place-runtime.ts';

export async function runPlaceCli(argv: string[]): Promise<Report> {
  for (const arg of argv) if (/^--(?:check|require)=/.test(arg)) throw new Error(`${arg.split('=')[0]} takes no value`);
  const args = parseArgs(argv, { flags: ['check', 'require'], values: ['json', 'md'] });
  if (args.rest.length || [...args.values.values()].some(v => v.startsWith('--'))) throw new Error('unexpected place argument or missing output path');
  const json = args.values.get('json') ?? 'benchmark/results/place.json', md = args.values.get('md') ?? 'docs/PLACE_BENCHMARK.md';
  if (resolve(json) === resolve(md)) throw new Error('place JSON and Markdown paths must differ');
  let context = await placeContext();
  if (args.flags.has('require') && context.loaded.corpus.status !== 'available') throw new Error(`required place corpus unavailable: ${context.loaded.corpus.detail}`);
  if (args.flags.has('check')) {
    const previous = JSON.parse(await readFile(json, 'utf8')) as Report;
    if (!await validatePlaceReport(previous, context.loaded)) throw new Error('existing place report does not validate');
    if (canonicalizeJson(previous.source.files) !== canonicalizeJson(context.source.files)) throw new Error('place report source drift');
    context = { ...context, source: previous.source };
  }
  const prepared = await preparePlaceBaselines(context.loaded);
  const report = await runPlaceConformance(context, await placeRuntimeAdapters(context.loaded, prepared), prepared);
  if (args.flags.has('require') && report.counts.failed) throw new Error('required place measurement contains failed executions');
  const outputs = [[json, JSON.stringify(report, null, 2) + '\n'], [md, renderPlaceReport(report)]];
  if (args.flags.has('check')) {
    for (const [path, bytes] of outputs) if (await readFile(path, 'utf8') !== bytes) throw new Error(`place output drift: ${path}`);
  } else for (const [path, bytes] of outputs) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runPlaceCli(process.argv.slice(2));
  console.log(JSON.stringify({ fixtureHash: report.fixtureHash, sha256: report.sha256, coverage: report.coverage, counts: report.counts }));
}
