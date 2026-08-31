/**
 * The conformance instrument's contract: the schemas refuse what the
 * campaign says they refuse, the construction census is re-derived from
 * the sources rather than trusted, the registered fixture is complete
 * and mirrored into the committed report, the secret sentinel escapes
 * into no serialized byte, the rendering is deterministic, and the
 * frozen desktop contract snapshot is compiler-produced at the
 * pre-change revision.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileContract } from '@jarenjs/contract';
import { publicProjection } from '@jarenjs/contract/project';
import { profileRegistrySchema, runIdentitySchema } from '@tangleai/config';

import { createReportValidator } from '../../benchmark/lib/validate.ts';
import configConformanceSchema from '../../benchmark/schemas/config-conformance.schema.json' with { type: 'json' };
import {
  CONSTRUCTION_CENSUS,
  CONTRACT_FIXTURE_PATH,
  FIXTURE_PATH,
  REPORT_PATH,
  SECRET_SENTINEL,
  SENTINEL_MARKER,
  SOURCE_MANIFEST,
  assertRedacted,
  buildReport,
  loadFixture,
  measureCases,
  renderReport,
  substituteSentinel,
} from '../../benchmark/lib/config-conformance.ts';
import type { ConfigConformance } from '../../benchmark/lib/config-conformance.types.ts';

/** The desktop contract revision measured before this campaign changed anything. */
const PRE_CONFIG_CONTRACT_REVISION = 'bf3afe35d3c9307aa5b443a769bb69a141b573f2cbf756508679a293779ae4bf';

/** A frozen source, so determinism tests never shell out to git. */
const FROZEN_SOURCE: ConfigConformance['source'] = {
  head: 'cfc52394c9ce5963f5ed77c864f5eef05377a3c3',
  clean: false,
  files: [{ path: 'frozen', sha256: 'a'.repeat(64) }],
  sha256: 'b'.repeat(64),
};

const committedReport = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as ConfigConformance;
const fixture = await loadFixture();

const registryValidator = createReportValidator(profileRegistrySchema as object);
const identityValidator = createReportValidator(runIdentitySchema as object);
const envelopeValidator = createReportValidator(
  { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/identityEnvelope' },
  [runIdentitySchema as object],
);
const reportValidator = createReportValidator(configConformanceSchema as object);

const baseIdentity = {
  identityId: 'a'.repeat(64),
  registryRevision: null,
  hostManifestRevision: 'b'.repeat(64),
  requested: { kind: 'legacy', chat: { state: 'unconfigured' }, embed: { state: 'unconfigured' }, components: { policy: null, ranker: null }, chatPrompt: null },
  roles: {},
  embedding: { provider: 'builtin', base: null, model: 'hash-trigram-64', dims: 64, credentialSlot: null },
  components: { policy: null, ranker: null },
  budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
};

describe('the registry schema is the refusal boundary', () => {
  it('accepts the fixture base registry', () => {
    assert.equal(registryValidator(fixture.base.registry).valid, true);
  });

  it('refuses duplicates, ghosts, kind mismatches, secrets and credential URLs', () => {
    const mutations: Array<[string, (d: any) => void]> = [
      ['duplicate id', (d) => d.candidates.push({ ...d.candidates[0] })],
      ['unknown parent', (d) => { d.profiles[1].extends = 'ghost'; }],
      ['embedding referencing a chat candidate', (d) => { d.profiles[0].embedding = 'chat-alpha'; }],
      ['secret-shaped member', (d) => { d.candidates[0].apiKey = 'sk-x'; }],
      ['userinfo base URL', (d) => { d.candidates[1].baseUrl = 'https://user:pw@example.com/v1'; }],
      ['query-string base URL', (d) => { d.candidates[1].baseUrl = 'https://example.com/v1?key=abc'; }],
      ['role with neither capability nor candidate', (d) => { d.profiles[0].roles.answer.capability = null; }],
      ['role with both capability and candidate', (d) => { d.profiles[0].roles.answer.candidate = 'chat-beta'; }],
      ['ghost prompt reference', (d) => { d.profiles[0].roles.answer.prompt = 'ghost'; }],
      ['chat candidate carrying dims', (d) => { d.candidates[0].dims = 64; }],
      ['embedding candidate without dims', (d) => { delete d.candidates[2].dims; }],
      ['custom provider without a base', (d) => { d.candidates[1].provider = 'custom'; }],
      ['ghost credential slot', (d) => { d.candidates[0].credentialSlot = 'ghost-slot'; }],
      ['ranker referenced as policy component', (d) => { d.profiles[0].policyComponent = 'ranker-cosine'; }],
      ['upper-case capability tag', (d) => { d.capabilities[0].tag = 'Fast'; }],
    ];
    for (const [name, mutate] of mutations) {
      const copy = structuredClone(fixture.base.registry) as any;
      mutate(copy);
      assert.equal(registryValidator(copy).valid, false, `${name} must refuse`);
    }
  });
});

describe('the run-identity schema and its envelope', () => {
  it('accepts an honest identity and refuses a secret-shaped member', () => {
    assert.equal(identityValidator(baseIdentity).valid, true);
    assert.equal(identityValidator({ ...baseIdentity, apiKey: 'sk-x' }).valid, false);
  });

  it('requires every run row to resolve to exactly one identity', () => {
    const good = {
      identities: [baseIdentity],
      rows: [
        { rowId: 'r1', identityStatus: 'run', identityId: baseIdentity.identityId },
        { rowId: 'r2', identityStatus: 'not-run' },
        { rowId: 'r3', identityStatus: 'legacy-unrecorded' },
      ],
    };
    assert.equal(envelopeValidator(good).valid, true);
    const dangling = structuredClone(good);
    dangling.rows[0] = { rowId: 'r1', identityStatus: 'run', identityId: 'c'.repeat(64) };
    assert.equal(envelopeValidator(dangling).valid, false, 'a dangling reference must refuse');
    const duplicated = structuredClone(good);
    duplicated.identities.push(structuredClone(baseIdentity));
    assert.equal(envelopeValidator(duplicated).valid, false, 'a duplicated identity id must refuse');
    const bare = structuredClone(good);
    (bare.rows[1] as { identityStatus: string }).identityStatus = 'run';
    assert.equal(envelopeValidator(bare).valid, false, 'a run row without an identity reference must refuse');
  });

  it('refuses a not-run row that pretends to a provider through closure', () => {
    const pretending = {
      identities: [],
      rows: [{ rowId: 'r1', identityStatus: 'not-run', provider: 'openrouter' }],
    };
    assert.equal(envelopeValidator(pretending).valid, false);
  });
});

describe('the report schema refuses arithmetic that does not reconcile', () => {
  it('accepts the committed report and refuses a broken count', () => {
    assert.equal(reportValidator(committedReport).valid, true);
    const broken = structuredClone(committedReport);
    broken.counts.cases += 1;
    assert.equal(reportValidator(broken).valid, false, 'a case count that does not reconcile must refuse');
    const skewed = structuredClone(committedReport);
    skewed.counts.byStatus.gap -= 1;
    skewed.counts.byStatus.holds += 1;
    assert.equal(reportValidator(skewed).valid, false, 'a status partition that does not reconcile must refuse');
    const family = structuredClone(committedReport);
    family.counts.byFamily.legacy -= 1;
    family.counts.byFamily.refusal += 1;
    assert.equal(reportValidator(family).valid, false, 'a family partition that does not reconcile must refuse');
    const calls = structuredClone(committedReport) as any;
    calls.gate.transportCalls = 1;
    assert.equal(reportValidator(calls).valid, false, 'a report of a run that made a call must refuse');
    const sites = structuredClone(committedReport);
    sites.census.factories.chatConsumerCalls += 1;
    assert.equal(reportValidator(sites).valid, false, 'a consumer-call sum that does not reconcile must refuse');
    const summary = structuredClone(committedReport);
    summary.census.summary.reportArtifactsWithIdentities = 2;
    assert.equal(reportValidator(summary).valid, false, 'an artifact-identity summary that does not reconcile must refuse');
  });

  it('recomputes the committed reportId from the committed bytes', async () => {
    const { reportId, ...rest } = committedReport;
    assert.equal(await canonicalSha256(rest), reportId);
  });
});

describe('the construction census is re-derived, not trusted', () => {
  const callsites = (source: string, name: string): number =>
    source.split(`${name}(`).length - 1 - (source.includes(`function ${name}(`) ? 1 : 0);

  it('reconciles every registered consumer count with the sources', async () => {
    for (const kind of ['chatConsumers', 'embedConsumers'] as const) {
      const factory = kind === 'chatConsumers' ? CONSTRUCTION_CENSUS.factories.chatFactory : CONSTRUCTION_CENSUS.factories.embedFactory;
      for (const site of CONSTRUCTION_CENSUS.factories[kind]) {
        const source = await readFile(site.file, 'utf8');
        assert.equal(callsites(source, factory), site.count, `${site.file} must hold ${site.count} ${factory} calls`);
      }
    }
    const registered = CONSTRUCTION_CENSUS.factories.chatConsumers.reduce((sum, site) => sum + site.count, 0);
    assert.equal(registered, CONSTRUCTION_CENSUS.factories.chatConsumerCalls);
    const registeredEmbed = CONSTRUCTION_CENSUS.factories.embedConsumers.reduce((sum, site) => sum + site.count, 0);
    assert.equal(registeredEmbed, CONSTRUCTION_CENSUS.factories.embedConsumerCalls);
  });

  it('finds no unregistered product or instrument consumer', async () => {
    const { readdir } = await import('node:fs/promises');
    const roots = ['apps/desktop/src', 'apps/pages', 'apps/scraper/src', 'examples', 'scripts'];
    const files: string[] = ['benchmark/locomo-census.ts', 'benchmark/locomo-recall.ts', 'benchmark/locomo-qa.ts', 'benchmark/locomo-policy.ts', 'benchmark/config-conformance.ts'];
    for (const root of roots) {
      for (const name of await readdir(root, { recursive: true })) {
        if (String(name).endsWith('.ts')) files.push(`${root}/${name}`);
      }
    }
    const registered = new Map<string, number>();
    for (const site of CONSTRUCTION_CENSUS.factories.chatConsumers) registered.set(`chat:${site.file}`, site.count);
    for (const site of CONSTRUCTION_CENSUS.factories.embedConsumers) registered.set(`embed:${site.file}`, site.count);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const chat = callsites(source, 'chatClientFor');
      const embed = file === CONSTRUCTION_CENSUS.factories.file ? 0 : callsites(source, 'embedderFor');
      assert.equal(chat, registered.get(`chat:${file}`) ?? 0, `${file} holds an unregistered chatClientFor call`);
      assert.equal(embed, registered.get(`embed:${file}`) ?? 0, `${file} holds an unregistered embedderFor call`);
    }
  });

  it('states the stored-run and artifact discipline honestly', () => {
    assert.equal(committedReport.census.summary.runProducers, 3);
    assert.equal(committedReport.census.summary.runProducersRecordingIdentity, 3);
    assert.equal(committedReport.census.summary.reportArtifacts, 4);
    assert.equal(committedReport.census.summary.reportArtifactsWithIdentities, 4);
    assert.equal(committedReport.census.hostInputs.length, 2);
  });
});

describe('the registered fixture is complete and mirrored', () => {
  it('covers every family and every router quirk', () => {
    const families = new Set(fixture.cases.map((item) => item.family));
    assert.deepEqual([...families].sort(), ['equivalence', 'legacy', 'refusal', 'sensitivity']);
    const ids = new Set(fixture.cases.map((item) => item.id));
    assert.equal(ids.size, fixture.cases.length, 'case ids are unique');
    for (const quirk of [
      'l-settings-secret-reflection',
      'l-endpoint-guard-disagreement',
      'l-corrupt-settings',
      'l-half-configured-embed',
      'l-loose-env-integers',
      'l-endpoint-userinfo-passthrough',
    ]) {
      assert.equal(ids.has(quirk), true, `quirk case ${quirk} is registered`);
    }
    for (const named of [
      'e-endpoint-default-base', 'e-endpoint-trailing-slash', 'e-endpoint-chat-path', 'e-reorder-members',
      's-model', 's-endpoint-base', 's-temperature', 's-reasoning', 's-response-schema', 's-prompt-revision',
      's-tool-manifest', 's-embedding-model', 's-embedding-dims', 's-component-revision', 's-budget-ceiling', 's-rate-card',
      'r-inheritance-cycle', 'r-request-unknown-tag', 'r-unavailable-slot', 'r-registry-secret-url',
      'r-feature-mismatch', 'r-registry-secret-member', 'r-dims-disagreement', 'r-dangling-identity-row',
      'l-unconfigured-offline', 'l-run-identity-absence',
    ]) {
      assert.equal(ids.has(named), true, `design-named case ${named} is registered`);
    }
  });

  it('mirrors every fixture case into the committed report in order', () => {
    assert.deepEqual(
      committedReport.cases.map((item) => item.id),
      fixture.cases.map((item) => item.id),
    );
    for (const [index, item] of committedReport.cases.entries()) {
      assert.deepEqual(item.expect, fixture.cases[index].expect, `${item.id} keeps its registered expectation`);
    }
  });

  it('publishes the campaign end state: every registered case holds and nothing is pending', () => {
    for (const item of committedReport.cases) {
      assert.equal(item.status, 'holds', `${item.id}: ${item.observed}`);
    }
    assert.equal(committedReport.counts.byStatus.gap, 0);
    assert.equal(committedReport.counts.byStatus.pending, 0);
    assert.equal(committedReport.counts.byStatus.holds, committedReport.counts.cases);
  });

  it('carries no resolver implementation detail and no secret value', async () => {
    const text = await readFile(FIXTURE_PATH, 'utf8');
    assert.equal(text.includes(SECRET_SENTINEL), false, 'the fixture holds only the redaction marker');
    assert.equal(text.includes('resolveProfile'), false);
    assert.equal(substituteSentinel(`x ${SENTINEL_MARKER} y`), `x ${SECRET_SENTINEL} y`);
    assert.throws(() => assertRedacted(`oops ${SECRET_SENTINEL}`, 'test'), /leaked/);
  });
});

describe('the measured baseline is deterministic, keyless and redacted', () => {
  it('renders byte-identical reports and makes no network call', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      calls += 1;
      throw new Error('the conformance instrument must not fetch');
    }) as typeof fetch;
    try {
      const first = renderReport(await buildReport({ source: FROZEN_SOURCE }));
      const second = renderReport(await buildReport({ source: FROZEN_SOURCE }));
      assert.equal(first, second);
      assert.equal(calls, 0);
      assert.equal(first.includes(SECRET_SENTINEL), false);
      assert.equal(/"at":\s*"20/.test(first.replaceAll('"startedAt"', '"x"')), false, 'no clock reading enters the document');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('measures every resolver-scope case through the resolver', async () => {
    const measured = await measureCases(fixture);
    const byId = new Map(measured.map((item) => [item.id, item]));
    for (const item of measured.filter((entry) => entry.scope === 'resolver')) {
      assert.equal(item.status, 'holds', `${item.id}: ${item.observed}`);
    }
    assert.equal(byId.get('e-reorder-members')?.status, 'holds');
    assert.equal([...byId.values()].filter((item) => item.status === 'pending').length, 0, 'nothing is unmeasurable any more');
  });
});

describe('the frozen desktop contract snapshot', () => {
  it('is the compiler-produced public projection at the pre-change revision', async () => {
    const snapshot = JSON.parse(await readFile(CONTRACT_FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    const compiled = compileContract(snapshot);
    assert.equal(await compiled.revision(), PRE_CONFIG_CONTRACT_REVISION, 'the frozen snapshot never moves during the campaign');
    assert.deepEqual(publicProjection(compiled), snapshot, 'the projection of the projection is the projection');
    assert.match(committedReport.census.desktopContract.revision, /^[0-9a-f]{64}$/);
    assert.equal(committedReport.census.desktopContract.operations, 21, 'the twenty pre-campaign operations plus the read-only config inspection');
  });
});

describe('the generated bundles are generator-owned', () => {
  it('carry the generated header and the load-bearing declarations', async () => {
    const contracts = await readFile('packages/config/src/contracts.gen.ts', 'utf8');
    assert.match(contracts, /^\/\/ Generated by @jarenjs\/emit from packages\/config\/schemas\./);
    for (const name of ['ProfileRegistry', 'RunIdentity', 'IdentityEnvelope', 'HostManifest', 'Resolution']) {
      assert.match(contracts, new RegExp(`^export (interface|type) ${name}[ =]`, 'm'), `${name} is missing from the generated contract`);
    }
    const conformance = await readFile('benchmark/lib/config-conformance.types.ts', 'utf8');
    assert.match(conformance, /^\/\/ Generated by @jarenjs\/emit from benchmark\/schemas\/config-conformance\.schema\.json\./);
    for (const name of ['ConfigConformance', 'MeasuredCase', 'RegisteredCase', 'Fixture']) {
      assert.match(conformance, new RegExp(`^export (interface|type) ${name}[ =]`, 'm'), `${name} is missing from the generated contract`);
    }
  });

  it('keeps the source manifest free of the report itself', () => {
    assert.equal(SOURCE_MANIFEST.includes(REPORT_PATH), false, 'a report inside its own digest could never reproduce');
    assert.deepEqual([...SOURCE_MANIFEST].sort(), [...SOURCE_MANIFEST], 'the manifest is sorted');
  });
});
