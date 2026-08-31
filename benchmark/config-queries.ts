/* eslint-disable no-console */
/**
 * Execute the committed config JSON Query documents — the operator's
 * local answers, straight from the artifacts.
 *
 * Three FLWOR documents under `queries/config/` are loaded, compiled
 * with the suite's `compileJsonQuery` and executed verbatim — no
 * wrapper parses, translates or re-groups what they say. Inputs are
 * validated FIRST: every artifact envelope passes the identity
 * envelope's own schema (a dangling run row refuses before any query
 * runs), and the profile-resolution input is produced by the pure
 * resolver over the registered fixture stacks, so the whole run is
 * keyless, clock-free and deterministic.
 *
 *   node benchmark/config-queries.ts               # execute + write + summary
 *   node benchmark/config-queries.ts --out PATH    # write elsewhere
 */

import { readFile, writeFile } from 'node:fs/promises';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJsonQuery } from '@jarenjs/json/query';
import { resolveProfile, validateIdentityEnvelope, type HostManifest, type IdentityEnvelope } from '@tangleai/config';

import { parseArgs } from './lib/args.ts';
import { createReportValidator, describeErrors } from './lib/validate.ts';
import { productionRegistry } from '../apps/desktop/src/ai-host.ts';
import SCHEMA from './schemas/config-queries.schema.json' with { type: 'json' };

const args = parseArgs(process.argv.slice(2), { values: ['out'] });

const QUERY_PATHS = [
  'queries/config/identity-inventory.json',
  'queries/config/profile-resolution.json',
  'queries/config/temporal-stack.json',
] as const;

const ARTIFACTS = [
  'benchmark/results/locomo-policy.json',
  'benchmark/results/locomo-qa-live.json',
  'benchmark/results/locomo-qa.json',
  'benchmark/results/locomo-recall.json',
] as const;

async function loadQuery(path: string): Promise<(input: unknown) => unknown> {
  const { $comment: _comment, ...query } = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  return compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
}

/** An artifact's envelope, refused before any query touches it. */
function validatedEnvelope(path: string, envelope: unknown): IdentityEnvelope {
  const outcome = validateIdentityEnvelope(envelope);
  if (!outcome.ok) {
    console.error(`${path} carries an envelope that does not validate; no query runs over it:`);
    for (const issue of outcome.issues.slice(0, 5)) console.error(`  ${issue.code} ${issue.path} — ${issue.detail}`);
    process.exit(1);
  }
  return outcome.value;
}

const [identityInventoryQuery, profileResolutionQuery, temporalStackQuery] = await Promise.all(QUERY_PATHS.map(loadQuery));

// --- identity inventory: every artifact's envelope, validated then joined
const artifacts: Array<{ artifact: string, envelope: IdentityEnvelope }> = [];
const documents = new Map<string, Record<string, unknown>>();
for (const path of ARTIFACTS) {
  const document = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  documents.set(path, document);
  artifacts.push({ artifact: path, envelope: validatedEnvelope(path, document.configIdentities) });
}
const identityInventory = identityInventoryQuery({ artifacts });

// --- profile resolution: the registered fixture stacks through the pure resolver
const fixture = JSON.parse(await readFile('test/fixtures/config-conformance.json', 'utf8')) as {
  base: { registry: unknown, request: unknown, host: HostManifest },
};
const hostA = structuredClone(fixture.base.host);
const hostB = structuredClone(fixture.base.host);
hostB.credentialSlots = hostB.credentialSlots.map((slot) => ({ ...slot, configured: false }));
const resolutions: Array<{ host: string, hostManifestRevision: string, request: unknown, identity: unknown }> = [];
for (const [host, manifest, request] of [
  ['fixture-host-with-slot', hostA, { kind: 'tag', tag: 'fast', overrides: null }],
  ['fixture-host-without-slot', hostB, { kind: 'tag', tag: 'fast', overrides: null }],
  ['fixture-host-with-slot', hostA, { kind: 'profile', profile: 'base', overrides: null }],
] as const) {
  const resolution = await resolveProfile({ registry: fixture.base.registry, request, host: manifest });
  if (!resolution.ok) {
    console.error(`the ${host} ${JSON.stringify(request)} stack refused; the comparison input is broken:`);
    for (const issue of resolution.issues.slice(0, 3)) console.error(`  ${issue.code} ${issue.path}`);
    process.exit(1);
  }
  resolutions.push({
    host,
    hostManifestRevision: resolution.identity.hostManifestRevision,
    request,
    identity: resolution.identity,
  });
}
const profileResolution = profileResolutionQuery({ resolutions });

// --- temporal stack: the two committed answer artifacts
const temporalStack = temporalStackQuery({
  live: documents.get('benchmark/results/locomo-qa-live.json'),
  keyless: documents.get('benchmark/results/locomo-qa.json'),
});

const report = {
  benchmark: 'config-queries' as const,
  instrument: { entry: 'benchmark/config-queries.ts' as const, queries: [...QUERY_PATHS] },
  queries: { identityInventory, profileResolution, temporalStack },
  reportId: '0'.repeat(64),
};
const { reportId: _placeholder, ...rest } = report;
report.reportId = await canonicalSha256(rest);

const outcome = createReportValidator(SCHEMA as object)(report);
if (!outcome.valid) {
  console.error('the query output does not validate against benchmark/schemas/config-queries.schema.json:');
  for (const line of describeErrors(outcome, 8)) console.error(`  ${line}`);
  process.exit(1);
}

const out = args.values.get('out') ?? 'benchmark/results/config-queries.json';
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);

const inventory = identityInventory as { byStatus: Array<{ identityStatus: string, rows: number }> };
const temporal = temporalStack as { liveStacks: Array<{ identityStatus: string, temporalF1?: number, temporalQuestions?: number }> };
console.log(`# Config queries — ${QUERY_PATHS.length} committed documents over ${ARTIFACTS.length} artifacts`);
console.log('');
console.log(`rows by status: ${inventory.byStatus.map((row) => `${row.identityStatus} ${row.rows}`).join(' · ')}`);
const legacy = temporal.liveStacks.find((row) => row.identityStatus === 'legacy-unrecorded');
if (legacy !== undefined) {
  console.log(`temporal QA: ${legacy.temporalQuestions} historic category-2 questions under one legacy-unrecorded group (no stack fact invented)`);
}
const resolution = profileResolution as { byRequest: Array<{ tag?: string, hosts: number, distinctIdentities: number }> };
for (const row of resolution.byRequest) {
  if (row.tag !== undefined) console.log(`tag '${row.tag}': ${row.hosts} hosts, ${row.distinctIdentities} distinct effective identities — never collapsed`);
}
console.log(`report → ${out} (${report.reportId.slice(0, 12)}…)`);
