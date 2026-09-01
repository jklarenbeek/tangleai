/* eslint-disable no-console */
/**
 * The MAS runtime conformance instrument — run it, read the baseline.
 *
 * Loads and verifies the registered fixture manifest (every canonical
 * revision recomputes from committed bytes), executes the suite
 * substrate probes against the published JarenJS primitives, measures
 * the integrated MAS baseline, validates the report against its schema
 * (including the `$query` reconciliation), projects the committed flat
 * baseline query and renders the generated benchmark document. Keyless,
 * clock-free, deterministic: a fetch during the run throws, and two
 * runs over the same tree write byte-identical JSON, Markdown and query
 * output.
 *
 *   node benchmark/mas-conformance.ts             # report + baseline + document
 *   node benchmark/mas-conformance.ts --check     # write nothing; exit 1 on drift
 *   node benchmark/mas-conformance.ts --out PATH  # write the report elsewhere
 */

import { readFile, writeFile } from 'node:fs/promises';

import { parseArgs } from './lib/args.ts';
import {
  BASELINE_PATH,
  DOCUMENT_PATH,
  REPORT_PATH,
  buildReport,
  renderBaseline,
  renderDocument,
  renderReport,
  runBaselineQuery,
} from './lib/mas-conformance.ts';

const args = parseArgs(process.argv.slice(2), {
  flags: ['check'],
  values: ['out'],
});

// A conformance run is keyless by construction; a probe that reached for
// the network would be a defect in the instrument itself, so it throws.
const guardedFetch: typeof globalThis.fetch = () => {
  throw new Error('the MAS conformance instrument made a network call — it must not');
};
globalThis.fetch = guardedFetch;

const report = await buildReport();
const baseline = await runBaselineQuery(report);

const reportText = renderReport(report);
const baselineText = renderBaseline(baseline);
const documentText = renderDocument(report);

if (args.flags.has('check')) {
  const drift: string[] = [];
  const compare = async (path: string, text: string): Promise<void> => {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== text) drift.push(path);
  };
  await compare(REPORT_PATH, reportText);
  await compare(BASELINE_PATH, baselineText);
  await compare(DOCUMENT_PATH, documentText);
  if (drift.length > 0) {
    for (const path of drift) console.error(`out of date: ${path}`);
    console.error('The committed MAS conformance artifacts do not reproduce. Run npm run benchmark:mas.');
    process.exit(1);
  }
  console.log(`mas conformance artifacts reproduce byte-identically (report ${report.reportId.slice(0, 12)}…)`);
} else {
  const out = args.values.get('out') ?? REPORT_PATH;
  await writeFile(out, reportText);
  await writeFile(BASELINE_PATH, baselineText);
  await writeFile(DOCUMENT_PATH, documentText);

  const { counts } = report;
  console.log(`# MAS conformance — ${counts.fixtures} registered fixtures, ${counts.probes.total} suite probes`);
  console.log('');
  console.log(`suite probes: ${counts.probes.passed} pass, ${counts.probes.failed} fail (substrate only — never an integrated pass)`);
  console.log(`durability: ${counts.durability.passed} pass, ${counts.durability.failed} fail (durable-scripted persistence evidence)`);
  console.log(`integrated: ${counts.integrated.runtimePass}/11 runtime oracles pass, ${counts.integrated.refusedAsRegistered}/7 registered refusals hold, `
    + `${counts.integrated.validated} validated, ${counts.integrated.notImplemented} not implemented`);
  console.log(`scripted totals: ${counts.calls} calls, ${counts.toolCalls} tool calls, ${counts.contextReads} context reads, ${counts.restores} restores`);
  console.log(`report → ${out} (${report.reportId.slice(0, 12)}…)`);
  console.log(`baseline → ${BASELINE_PATH} (query ${baseline.queryRevision.slice(0, 12)}…)`);
  console.log(`document → ${DOCUMENT_PATH}`);
}
