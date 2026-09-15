/* eslint-disable no-console */
/**
 * The repository-experiment instrument — run it, read the registration.
 *
 * Loads and verifies the fixture registration (every committed digest and
 * every proposal revision recomputes, or the load refuses), builds the
 * fixture repository in a temporary directory and confirms its registered
 * base revision, computes the oracle and seeded controls, states every
 * mechanism row as `implementation-missing` because no executor exists,
 * validates the report against its schema including the `$query`
 * reconciliation, and renders the generated benchmark document.
 *
 * Keyless and clock-free: no provider, no credential, no `--live`, a fetch
 * during the run throws, and two runs over the same tree write
 * byte-identical JSON and Markdown.
 *
 *   node benchmark/evolve.ts             # report + document
 *   node benchmark/evolve.ts --check     # write nothing; exit 1 on drift
 *   node benchmark/evolve.ts --out PATH  # write the report elsewhere
 */

import { readFile, writeFile } from 'node:fs/promises';

import { parseArgs } from './lib/args.ts';
import {
  DOCUMENT_PATH,
  REPORT_PATH,
  buildReport,
  renderDocument,
  renderReport,
} from './lib/evolve.ts';

const argv = process.argv.slice(2);
if (argv.some((arg) => arg.startsWith('--check='))) throw new Error('--check takes no value');
const args = parseArgs(argv, { flags: ['check'], values: ['out'] });
if (args.rest.length > 0) throw new Error('the experiment instrument takes no positional arguments');

// An experiment registration is keyless by construction; a run that reached
// the network would be a defect in the instrument itself, so it throws.
globalThis.fetch = (() => {
  throw new Error('the experiment instrument made a network call — it must not');
}) as typeof fetch;

const report = await buildReport();
const reportText = renderReport(report);
const documentText = renderDocument(report);

if (args.flags.has('check')) {
  const drift: string[] = [];
  const compare = async (path: string, text: string): Promise<void> => {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== text) drift.push(path);
  };
  await compare(REPORT_PATH, reportText);
  await compare(DOCUMENT_PATH, documentText);
  if (drift.length > 0) {
    for (const path of drift) console.error(`out of date: ${path}`);
    console.error('The committed experiment artifacts do not reproduce. Run npm run benchmark:evolve.');
    process.exit(1);
  }
  console.log(`experiment artifacts reproduce byte-identically (report ${report.reportId.slice(0, 12)}…)`);
} else {
  const out = args.values.get('out') ?? REPORT_PATH;
  await writeFile(out, reportText);
  await writeFile(DOCUMENT_PATH, documentText);

  const { counts, controls, registration } = report;
  const probesRun = report.hostProbes.filter((probe) => probe.state !== 'implementation-missing').length;
  console.log(`# Repository experiments — ${registration.experiments} registered proposals, ${registration.hostProbes.length} host probes`);
  console.log('');
  console.log(`registration: ${registration.strategies.length} strategies, fixture ${report.fixture.id} at base ${report.fixture.baseRevision.slice(0, 12)}… (${report.fixture.files} files)`);
  console.log(`rows run: ${counts.attempted}/${registration.experiments}; host probes run: ${probesRun}/${registration.hostProbes.length}; hit rate: not measured — no executor`);
  console.log(`oracle control: ${controls.oracle.kept}/${controls.oracle.attempted} kept; seeded control: ${controls.random.kept}/${controls.random.attempted} kept (seed ${controls.random.seed})`);
  console.log(`census: ${counts.kept} kept, ${counts.abandoned.total} abandoned, ${counts.refused.total} refused, ${counts.uncertain} uncertain, `
    + `${counts.processRuns} process runs, ${counts.protectedRefWrites} protected-ref writes, ${counts.liveModelCalls} live model calls`);
  console.log(`decision: ${report.decision}`);
  console.log(`report → ${out} (${report.reportId.slice(0, 12)}…)`);
  console.log(`document → ${DOCUMENT_PATH}`);
}
