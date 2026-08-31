/* eslint-disable no-console */
/**
 * The config conformance instrument — run it, read the gaps.
 *
 * Measures every registered identity/refusal/legacy case in
 * `test/fixtures/config-conformance.json` against current behavior,
 * freezes the construction-path census, validates the report against
 * its schema (including the `$query` count reconciliation) and writes
 * it. Keyless, clock-free, deterministic: a fetch during the run throws,
 * two runs over the same tree write byte-identical JSON, and the gate's
 * transport/probe/model counters are literal zeros in the schema.
 *
 *   node benchmark/config-conformance.ts                     # report + summary
 *   node benchmark/config-conformance.ts --out <path>        # write elsewhere
 *   node benchmark/config-conformance.ts --contract-fixture  # also refresh the
 *       suite public projection snapshot of the desktop contract
 */

import { writeFile } from 'node:fs/promises';

import { parseArgs } from './lib/args.ts';
import {
  CONTRACT_FIXTURE_PATH,
  REPORT_PATH,
  buildReport,
  contractProjection,
  renderReport,
} from './lib/config-conformance.ts';

const args = parseArgs(process.argv.slice(2), {
  flags: ['contract-fixture'],
  values: ['out'],
});

// A conformance run is keyless by construction; a probe that reached for
// the network would be a defect in the instrument itself, so it throws.
const guardedFetch: typeof globalThis.fetch = () => {
  throw new Error('the conformance instrument made a network call — it must not');
};
globalThis.fetch = guardedFetch;

const report = await buildReport();
const out = args.values.get('out') ?? REPORT_PATH;
await writeFile(out, renderReport(report));

if (args.flags.has('contract-fixture')) {
  const { projection, revision } = await contractProjection();
  await writeFile(CONTRACT_FIXTURE_PATH, `${JSON.stringify(projection, null, 2)}\n`);
  console.log(`contract projection → ${CONTRACT_FIXTURE_PATH} (revision ${revision.slice(0, 12)}…)`);
}

const { counts, census } = report;
console.log(`# Config conformance — ${counts.cases} registered cases`);
console.log('');
console.log('| family | cases | | status | cases |');
console.log('|---|---:|---|---|---:|');
console.log(`| equivalence | ${counts.byFamily.equivalence} | | holds | ${counts.byStatus.holds} |`);
console.log(`| sensitivity | ${counts.byFamily.sensitivity} | | gap | ${counts.byStatus.gap} |`);
console.log(`| refusal | ${counts.byFamily.refusal} | | pending | ${counts.byStatus.pending} |`);
console.log(`| legacy | ${counts.byFamily.legacy} | | | |`);
console.log('');
console.log(`factory pair: ${census.factories.chatFactory}/${census.factories.embedFactory} in ${census.factories.file}; `
  + `${census.factories.chatConsumerCalls} chat and ${census.factories.embedConsumerCalls} embed consumer calls`);
console.log(`run producers recording an identity: ${census.summary.runProducersRecordingIdentity} of ${census.summary.runProducers}; `
  + `artifacts with identities: ${census.summary.reportArtifactsWithIdentities} of ${census.summary.reportArtifacts}`);
console.log(`desktop contract: ${census.desktopContract.operations} operations at revision ${census.desktopContract.revision.slice(0, 12)}…`);
console.log(`report → ${out} (${report.reportId.slice(0, 12)}…)`);
