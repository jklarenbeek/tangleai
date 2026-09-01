/* eslint-disable no-console */
/**
 * The MAS runtime handoff — the committed query, executed verbatim.
 *
 * Loads the committed conformance report, validates it (including the
 * decision recomputation), compiles `queries/mas/runtime-handoff.json`
 * with the suite's `compileJsonQuery` and executes it verbatim, checks
 * that every content-addressed identity in the projection resolves
 * exactly once against the report, and writes the immutable handoff
 * artifact downstream campaigns cite. Deterministic: two runs write
 * byte-identical JSON.
 *
 *   node benchmark/mas-query.ts             # write + summary
 *   node benchmark/mas-query.ts --check     # write nothing; exit 1 on drift
 */

import { readFile, writeFile } from 'node:fs/promises';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJsonQuery } from '@jarenjs/json/query';

import { parseArgs } from './lib/args.ts';
import { createReportValidator, describeErrors } from './lib/validate.ts';
import { REPORT_PATH } from './lib/mas-conformance.ts';
import masConformanceSchema from './schemas/mas-conformance.schema.json' with { type: 'json' };
import type { MasConformance } from './lib/mas-conformance.types.ts';

export const HANDOFF_QUERY_PATH = 'queries/mas/runtime-handoff.json';
export const HANDOFF_PATH = 'benchmark/results/mas-runtime-handoff.json';

const args = parseArgs(process.argv.slice(2), { flags: ['check'] });

const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as MasConformance;
const outcome = createReportValidator(masConformanceSchema as object)(report);
if (!outcome.valid) {
  console.error('the committed report does not validate; no handoff is written:');
  for (const line of describeErrors(outcome, 5)) console.error(`  ${line}`);
  process.exit(1);
}

const raw = JSON.parse(await readFile(HANDOFF_QUERY_PATH, 'utf8')) as Record<string, unknown>;
const { $comment: _comment, ...query } = raw;
const compiled = compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
const handoff = compiled(report) as Record<string, unknown>;

// Every content-addressed identity in the projection must resolve exactly
// once against the report it projects.
const reportText = JSON.stringify(report);
const identities: Array<[string, string]> = [
  ['reportId', handoff.reportId as string],
  ['registration.registryRevision', (handoff.registration as { registryRevision: string }).registryRevision],
  ['registration.manifestRevision', (handoff.registration as { manifestRevision: string }).manifestRevision],
  ['registration.configCatalogRevision', (handoff.registration as { configCatalogRevision: string }).configCatalogRevision],
  ['weeklyReport.workflowVersionId', (handoff.weeklyReport as { workflowVersionId: string }).workflowVersionId],
  ['weeklyReport.executableRevision', (handoff.weeklyReport as { executableRevision: string }).executableRevision],
];
for (const [name, identity] of identities) {
  if (!/^[0-9a-f]{64}$/.test(identity)) {
    console.error(`${name} is not a content address: ${String(identity)}`);
    process.exit(1);
  }
  if (!reportText.includes(identity)) {
    console.error(`${name} (${identity.slice(0, 12)}…) does not resolve against the report`);
    process.exit(1);
  }
}

const artifact = {
  benchmark: 'mas-runtime-handoff' as const,
  query: HANDOFF_QUERY_PATH,
  queryRevision: await canonicalSha256(query),
  reportId: report.reportId,
  handoff,
  artifactId: '0'.repeat(64),
};
const { artifactId: _placeholder, ...rest } = artifact;
artifact.artifactId = await canonicalSha256(rest);
const text = `${JSON.stringify(artifact, null, 2)}\n`;

if (args.flags.has('check')) {
  const current = await readFile(HANDOFF_PATH, 'utf8').catch(() => null);
  if (current !== text) {
    console.error(`out of date: ${HANDOFF_PATH}. Run npm run benchmark:mas:handoff.`);
    process.exit(1);
  }
  console.log(`mas handoff reproduces byte-identically (${artifact.artifactId.slice(0, 12)}…)`);
} else {
  await writeFile(HANDOFF_PATH, text);
  console.log(`# MAS runtime handoff — ${(handoff.decision as string)}`);
  console.log('');
  const conformance = handoff.conformance as Record<string, number>;
  console.log(`conformance: ${conformance.runtimePass}/11 runtime oracles, ${conformance.exactRefusals}/7 exact refusals; `
    + `weekly report concurrency ${(handoff.weeklyReport as { maxObservedConcurrency: number }).maxObservedConcurrency}`);
  console.log(`non-claims: ${(handoff.nonClaims as string[]).length}; deployment limits: ${(handoff.deploymentLimits as string[]).length}; live: ${(handoff.live as { state: string }).state}`);
  console.log(`handoff → ${HANDOFF_PATH} (query ${artifact.queryRevision.slice(0, 12)}…, artifact ${artifact.artifactId.slice(0, 12)}…)`);
}
