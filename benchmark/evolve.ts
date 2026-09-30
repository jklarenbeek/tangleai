/* eslint-disable no-console */
/**
 * The repository-experiment instrument — run it, read the registration.
 *
 * Loads and verifies the fixture registration (every committed digest and
 * every proposal revision recomputes, or the load refuses), executes the
 * fixture experiments through durable workflows, and compares their measured
 * decisions with the registration. The ablation uses a separate artifact pair.
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
import {
  SELECTION_DOCUMENT_PATH, SELECTION_REPORT_PATH, buildSelectionReport,
  renderSelectionDocument, renderSelectionReport,
} from './lib/evolve-selection.ts';

const argv = process.argv.slice(2);
if (argv.some((arg) => arg.startsWith('--check='))) throw new Error('--check takes no value');
const args = parseArgs(argv, { flags: ['check', 'ablation', 'live', 'authorize'], values: ['out', 'model', 'tokens'] });
if (args.rest.length > 0) throw new Error('the experiment instrument takes no positional arguments');
if (args.flags.has('live')) {
  const tokens = Number(args.values.get('tokens') ?? 0);
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('--tokens must be a nonnegative integer');
  const plan = Object.freeze({ arm: 'live-model', rounds: 3, attempts: 6,
    model: args.values.get('model') ?? 'unconfigured', tokenCeiling: tokens });
  console.log(JSON.stringify(plan, null, 2));
  if (!args.flags.has('authorize')) throw new Error('TEVO1010: live proposals require --authorize; no client was called.');
  throw new Error('This instrument has no live client. Inject an explicitly authorized client into createModelProposer in your host.');
}
if (args.flags.has('authorize') || args.values.has('model') || args.values.has('tokens')) {
  throw new Error('Live configuration requires --live.');
}

// An experiment registration is keyless by construction; a run that reached
// the network would be a defect in the instrument itself, so it throws.
globalThis.fetch = (() => {
  throw new Error('the experiment instrument made a network call — it must not');
}) as typeof fetch;

const ablation = args.flags.has('ablation');
const selection = ablation ? await buildSelectionReport() : null;
const report = ablation ? null : await buildReport();
const reportText = selection === null ? renderReport(report!) : renderSelectionReport(selection);
const documentText = selection === null ? renderDocument(report!) : renderSelectionDocument(selection);
const reportPath = ablation ? SELECTION_REPORT_PATH : REPORT_PATH;
const documentPath = ablation ? SELECTION_DOCUMENT_PATH : DOCUMENT_PATH;
const reportId = (selection ?? report)!.reportId;

if (args.flags.has('check')) {
  const drift: string[] = [];
  const compare = async (path: string, text: string): Promise<void> => {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== text) drift.push(path);
  };
  await compare(reportPath, reportText);
  await compare(documentPath, documentText);
  if (drift.length > 0) {
    for (const path of drift) console.error(`out of date: ${path}`);
    console.error('The committed experiment artifacts do not reproduce. Run npm run benchmark:evolve' + (ablation ? ' -- --ablation.' : '.'));
    process.exit(1);
  }
  console.log(`experiment artifacts reproduce byte-identically (report ${reportId.slice(0, 12)}…)`);
} else {
  const out = args.values.get('out') ?? reportPath;
  await writeFile(out, reportText);
  await writeFile(documentPath, documentText);

  if (selection !== null) {
    console.log(`selection: ${selection.experiments} experiments; ${selection.verdict}; ${selection.modelDecision}; default ${selection.default}`);
    console.log(`report → ${out}; document → ${documentPath}`);
    process.exit(0);
  }
  if (report === null) throw new Error('Missing experiment report.');

  const { counts, controls, registration } = report;
  const probesRun = report.hostProbes.filter((probe) => probe.state !== 'implementation-missing').length;
  console.log(`# Repository experiments — ${registration.experiments} registered proposals, ${registration.hostProbes.length} host probes`);
  console.log('');
  console.log(`registration: ${registration.strategies.length} strategies, fixture ${report.fixture.id} at base ${report.fixture.baseRevision.slice(0, 12)}… (${report.fixture.files} files)`);
  const exact = report.rows.filter((row) => row.matches === true).length;
  console.log(`rows run: ${counts.attempted}/${registration.experiments}; host probes run: ${probesRun}/${registration.hostProbes.length}; as registered: ${exact}/${registration.experiments}; hit rate: ${counts.kept}/${counts.attempted}`);
  console.log(`oracle control: ${controls.oracle.kept}/${controls.oracle.attempted} kept; seeded control: ${controls.random.kept}/${controls.random.attempted} kept (seed ${controls.random.seed})`);
  console.log(`census: ${counts.kept} kept, ${counts.abandoned.total} abandoned, ${counts.refused.total} refused, ${counts.uncertain} uncertain, `
    + `${counts.processRuns} process runs, ${counts.protectedRefWrites} protected-ref writes, ${counts.liveModelCalls} live model calls`);
  console.log(`decision: ${report.decision}`);
  console.log(`report → ${out} (${report.reportId.slice(0, 12)}…)`);
  console.log(`document → ${DOCUMENT_PATH}`);
}
