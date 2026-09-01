/* eslint-disable no-console */
/**
 * Execute the committed flat-baseline JSON Query document — the one
 * immutable downstream handoff.
 *
 * `queries/grounding/flat-baseline.json` is loaded, compiled with the
 * suite's `compileJsonQuery` and executed VERBATIM over the validated
 * live attempt and the dated web diagnostic; no wrapper parses,
 * translates or re-groups what the document says. Inputs are validated
 * first and refused before any query runs; the handoff is validated
 * against the report schema before a byte is written; the output is
 * clock-free, so two renders are byte-identical.
 *
 *   node benchmark/grounding-query.ts               # execute + write + summary
 *   node benchmark/grounding-query.ts --out PATH    # write elsewhere
 *
 * Exit 1 with the reason when an input is missing or invalid, the
 * handoff does not validate, or the recorded decision no longer names
 * the live report it was computed from. Nothing is written in those
 * cases.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJsonQuery } from '@jarenjs/json/query';

import { parseArgs } from './lib/args.ts';
import { createGroundingValidator } from './lib/grounding.ts';
import type { GroundingHandoff, GroundingLive, GroundingWeb } from './lib/grounding.types.ts';
import { describeErrors } from './lib/validate.ts';

const args = parseArgs(process.argv.slice(2), { values: ['out', 'live', 'web'] });

export const HANDOFF_QUERY_PATH = 'queries/grounding/flat-baseline.json';

const validate = createGroundingValidator();

function mustValidate(name: string, value: unknown): void {
  const outcome = validate(value);
  if (outcome.valid) return;
  console.error(`${name} does not validate against benchmark/schemas/grounding.schema.json:`);
  for (const line of describeErrors(outcome)) console.error(`  ${line}`);
  process.exit(1);
}

const livePath = args.values.get('live') ?? 'benchmark/results/grounding-live.json';
const webPath = args.values.get('web') ?? 'benchmark/results/grounding-web-live.json';
const live = JSON.parse(await readFile(livePath, 'utf8')) as GroundingLive;
mustValidate(livePath, live);
const web = JSON.parse(await readFile(webPath, 'utf8')) as GroundingWeb;
mustValidate(webPath, web);

if (live.decision.state !== 'not-evaluated' && live.decision.liveReportId !== live.reportId) {
  console.error(`the recorded decision names report ${live.decision.liveReportId} but the live report is ${live.reportId}; a stale decision cannot enter a handoff`);
  process.exit(1);
}

const queryBytes = await readFile(HANDOFF_QUERY_PATH, 'utf8');
const { $comment: _comment, ...query } = JSON.parse(queryBytes) as Record<string, unknown>;
const run = compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
const handoff = run({ live, web }) as GroundingHandoff['handoff'];

const report: GroundingHandoff = {
  document: 'grounding-handoff',
  benchmark: 'grounding',
  instrument: { entry: 'benchmark/grounding-query.ts', query: HANDOFF_QUERY_PATH },
  querySha256: createHash('sha256').update(queryBytes).digest('hex'),
  handoff,
  reportId: '0'.repeat(64),
};
const { reportId: _placeholder, ...rest } = report;
report.reportId = await canonicalSha256(rest as unknown as Record<string, unknown>);
mustValidate('the handoff', report);

const out = args.values.get('out') ?? 'benchmark/results/grounding-handoff.json';
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);

console.log(`# Flat-grounding handoff — ${HANDOFF_QUERY_PATH} over ${livePath} + ${webPath}`);
console.log('');
console.log(`flat report ${handoff.identities.reportId.slice(0, 12)}… · registration ${handoff.identities.registrationId.slice(0, 12)}… · config identity ${handoff.identities.configIdentityId.slice(0, 12)}…`);
console.log(`decision: ${handoff.decision.state}`);
for (const comparison of handoff.pairing.comparisons) {
  console.log(`${comparison.metric}: mean ${comparison.mean.toFixed(4)}, two-sided 95% [${comparison.interval.low.toFixed(4)}, ${comparison.interval.high.toFixed(4)}]`);
}
console.log(`web diagnostic: ${handoff.diagnostics.web.notRun === null ? `report ${handoff.diagnostics.web.reportId?.slice(0, 12)}…` : `not run — ${handoff.diagnostics.web.notRun}`}`);
console.log(`handoff → ${out} (${report.reportId.slice(0, 12)}…)`);
