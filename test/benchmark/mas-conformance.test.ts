/**
 * The MAS conformance instrument's contract: the registration is
 * complete and ordered, every canonical revision recomputes from
 * committed bytes, the schema's `$query` reconciliation refuses forged
 * passes, hidden calls, wrong refusals, dangling identities and forged
 * decisions, the suite probes hit exact oracles through published
 * primitives, the committed measurement is 11/11 runtime passes and 7/7
 * exact refusals under a mechanical runtime-conformant decision, and
 * two renders over the same tree are byte-identical with no clock,
 * hostname or absolute path anywhere in a keyless identity.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJsonQuery } from '@jarenjs/json/query';

import { createReportValidator } from '../../benchmark/lib/validate.ts';
import masConformanceSchema from '../../benchmark/schemas/mas-conformance.schema.json' with { type: 'json' };
import {
  BASELINE_PATH,
  BASELINE_QUERY_PATH,
  MANIFEST_PATH,
  REPORT_PATH,
  SOURCE_MANIFEST,
  buildReport,
  loadFixtures,
  masWorkflowVersionIdOf,
  renderBaseline,
  renderDocument,
  renderReport,
  runBaselineQuery,
  runSuiteProbes,
} from '../../benchmark/lib/mas-conformance.ts';
import type { MasConformance } from '../../benchmark/lib/mas-conformance.types.ts';

const POSITIVE_ORDER = [
  'sequential', 'fanout-fanin', 'message-order', 'switch-one', 'switch-many',
  'loop-three', 'nested-state', 'interaction', 'checkpoint', 'failure-abort',
  'weekly-report-manual',
] as const;
const NEGATIVE_ORDER = [
  'plain-cycle', 'unknown-port', 'switch-no-default', 'unbounded-loop',
  'undeclared-tool', 'child-over-budget', 'incompatible-wire',
] as const;

/** A frozen source, so determinism tests never shell out to git. */
const FROZEN_SOURCE: MasConformance['source'] = {
  head: '455bc71b09b1d5a1a4b378b23e2b8bfa2b5b0000'.slice(0, 40),
  clean: false,
  files: [{ path: 'frozen', sha256: 'a'.repeat(64) }],
  sha256: 'b'.repeat(64),
};

const committedReport = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as MasConformance;
const loaded = await loadFixtures();
const reportValidator = createReportValidator(masConformanceSchema as object);

describe('the registration is complete, ordered and recomputable', () => {
  it('registers exactly the eleven positive and seven negative fixtures in order', () => {
    assert.deepEqual(loaded.manifest.positive.map((entry) => entry.id), [...POSITIVE_ORDER]);
    assert.deepEqual(loaded.manifest.negative.map((entry) => entry.id), [...NEGATIVE_ORDER]);
    assert.deepEqual(
      loaded.fixtures.map((fixture) => fixture.document.id),
      [...POSITIVE_ORDER, ...NEGATIVE_ORDER],
    );
  });

  it('recomputes every fixture, registry, catalog and workflow identity from committed bytes', async () => {
    // loadFixtures already threw if any revision or versionId drifted; pin the anchors.
    assert.equal(loaded.registryRevision, loaded.manifest.registry.revision);
    assert.equal(loaded.configCatalogRevision, loaded.manifest.configCatalog.revision);
    for (const fixture of loaded.fixtures) {
      const workflow = fixture.document.workflow as Record<string, unknown>;
      assert.equal(await masWorkflowVersionIdOf(workflow), workflow.versionId, `${fixture.document.id} versionId recomputes`);
    }
  });

  it('pins the registered refusal codes and pointers for every negative fixture', () => {
    const byId = new Map(loaded.fixtures.map((fixture) => [fixture.document.id, fixture.document.expect]));
    const expected: Array<[string, string, string]> = [
      ['plain-cycle', 'TMAS1005', '/messages/2'],
      ['unknown-port', 'TMAS1004', '/messages/1/to/port'],
      ['switch-no-default', 'TMAS1006', '/nodes/0/default'],
      ['unbounded-loop', 'TMAS1007', '/nodes/0/maxIterations'],
      ['undeclared-tool', 'TMAS1009', '/nodes/0/tools/0'],
      ['child-over-budget', 'TMAS1008', '/nodes/0/limits/calls'],
      ['incompatible-wire', 'TMAS1004', '/messages/0/to'],
    ];
    for (const [id, code, path] of expected) {
      const expect = byId.get(id);
      assert.ok(expect !== undefined && expect.kind === 'refusal', `${id} is registered as a refusal`);
      assert.equal(expect.code, code, `${id} code`);
      assert.equal(expect.path, path, `${id} pointer`);
    }
  });

  it('mirrors every registration into the committed report unchanged', () => {
    assert.deepEqual(
      committedReport.registration.fixtures.map((fixture) => fixture.id),
      loaded.fixtures.map((fixture) => fixture.document.id),
    );
    for (const [index, fixture] of committedReport.registration.fixtures.entries()) {
      assert.deepEqual(fixture.expect, loaded.fixtures[index].document.expect, `${fixture.id} keeps its registered oracle`);
      assert.equal(fixture.revision, loaded.fixtures[index].revision, `${fixture.id} keeps its registered revision`);
    }
  });

  it('refuses a fixture whose committed bytes moved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mas-conformance-'));
    await cp('benchmark/fixtures/mas', join(root, 'benchmark/fixtures/mas'), { recursive: true });
    const path = join(root, 'benchmark/fixtures/mas/positive/sequential.json');
    const document = JSON.parse(await readFile(path, 'utf8')) as { script: { input: { text: string } } };
    document.script.input.text = 'tampered';
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
    await assert.rejects(loadFixtures(root), /does not recompute to its registered revision/);
  });
});

describe('the report schema refuses what the campaign says it refuses', () => {
  it('accepts the committed report and recomputes its identity (decision excluded)', async () => {
    assert.equal(reportValidator(committedReport).valid, true);
    const { reportId, decision: _decision, ...rest } = committedReport;
    assert.equal(await canonicalSha256(rest), reportId);
  });

  it('refuses a missing and a duplicated integrated row', () => {
    const missing = structuredClone(committedReport);
    missing.integrated.pop();
    assert.equal(reportValidator(missing).valid, false, 'a missing row must refuse');
    const duplicated = structuredClone(committedReport);
    duplicated.integrated[1] = structuredClone(duplicated.integrated[0]);
    assert.equal(reportValidator(duplicated).valid, false, 'a duplicated row must refuse');
  });

  it('refuses a forged runtime pass', () => {
    // A validated row already carries its identities, so the forgery clause
    // must bite on the runtime evidence: at least one attempt and a measured
    // concurrency inside the registered bounds.
    const forged = structuredClone(committedReport);
    forged.integrated[0].state = 'runtime-pass';
    forged.counts.integrated.validated -= 1;
    forged.counts.integrated.runtimePass += 1;
    assert.equal(reportValidator(forged).valid, false, 'a pass with zero attempts must refuse');
    const withAttempts = structuredClone(forged);
    withAttempts.integrated[0].attempts = 1;
    assert.equal(reportValidator(withAttempts).valid, false, 'a pass without measured concurrency must refuse');
    const withConcurrency = structuredClone(withAttempts);
    withConcurrency.integrated[0].maxObservedConcurrency = 5;
    assert.equal(reportValidator(withConcurrency).valid, false, 'a concurrency outside the registered bounds must refuse');
  });

  it('refuses a call hidden under a non-executing state', () => {
    const hidden = structuredClone(committedReport);
    hidden.integrated[0].calls = 3;
    hidden.counts.calls += 3;
    assert.equal(reportValidator(hidden).valid, false, 'a validated row cannot hide a call');
    const identityless = structuredClone(committedReport);
    identityless.integrated[0].executableRevision = null;
    assert.equal(reportValidator(identityless).valid, false, 'a validated row without an executable revision must refuse');
  });

  it('refuses a denominator or sum that does not reconcile', () => {
    const skewed = structuredClone(committedReport);
    skewed.counts.integrated.validated -= 1;
    skewed.counts.integrated.notImplemented += 1;
    assert.equal(reportValidator(skewed).valid, false, 'a state partition that does not reconcile must refuse');
    const sums = structuredClone(committedReport);
    sums.counts.calls += 1;
    assert.equal(reportValidator(sums).valid, false, 'a call sum that does not reconcile must refuse');
  });

  it('refuses a refusal row whose code or pointer disagrees with the registration', () => {
    const index = committedReport.integrated.findIndex((row) => row.id === 'plain-cycle');
    assert.equal(committedReport.integrated[index].state, 'refused-as-registered');
    const wrong = structuredClone(committedReport);
    wrong.integrated[index].refusal = { code: 'TMAS1004', path: '/messages/2' };
    assert.equal(reportValidator(wrong).valid, false, 'a wrong code must refuse');
    const wrongPath = structuredClone(committedReport);
    wrongPath.integrated[index].refusal = { code: 'TMAS1005', path: '/messages/0' };
    assert.equal(reportValidator(wrongPath).valid, false, 'a wrong pointer must refuse');
    const missing = structuredClone(committedReport);
    missing.integrated[index].refusal = null;
    assert.equal(reportValidator(missing).valid, false, 'a refused row without its refusal must refuse');
  });

  it('refuses a dangling workflow identity and a live call', () => {
    const dangling = structuredClone(committedReport);
    dangling.integrated[0].workflowVersionId = 'c'.repeat(64);
    assert.equal(reportValidator(dangling).valid, false, 'an identity absent from the registration must refuse');
    const live = structuredClone(committedReport) as unknown as { gate: { transportCalls: number } };
    live.gate.transportCalls = 1;
    assert.equal(reportValidator(live).valid, false, 'a report of a run that made a transport call must refuse');
  });
});

describe('the suite probes prove the substrate with exact oracles', () => {
  it('measures every registered primitive and never claims integration', () => {
    assert.deepEqual(
      committedReport.suiteProbes.map((probe) => probe.id),
      [
        'dag-fanout-concurrency', 'dag-fanin-edge-order', 'dag-abort-siblings',
        'dag-checkpoint-restore', 'fsm-document-order-resume',
        'db-job-reclaim-checkpoints', 'budget-concurrent-reserve',
      ],
    );
    for (const probe of committedReport.suiteProbes) {
      assert.equal(probe.state, 'substrate', `${probe.id} is a substrate probe`);
      assert.equal(probe.outcome, 'pass', `${probe.id}: ${probe.observed}`);
    }
  });

  it('measures fan-out concurrency by controlled overlap, at least 3', async () => {
    const probes = await runSuiteProbes();
    const fanout = probes.find((probe) => probe.id === 'dag-fanout-concurrency');
    assert.ok(fanout !== undefined);
    const measured = fanout.measured as { maxConcurrency: number, portOrder: string[] };
    assert.ok(measured.maxConcurrency >= 3, 'the entry/exit counter reached at least 3');
    assert.deepEqual(measured.portOrder, ['a', 'b', 'c']);
    const reclaim = probes.find((probe) => probe.id === 'db-job-reclaim-checkpoints');
    assert.deepEqual((reclaim?.measured as { reusedValues: string[] }).reusedValues, ['n1']);
    const budget = probes.find((probe) => probe.id === 'budget-concurrent-reserve');
    assert.deepEqual(budget?.measured, { reserved: 3, stopped: 1, spentTurns: 3 });
  });
});

describe('the durability measurements are durable-scripted evidence', () => {
  it('publishes six passing probes over the real adapter and queue', () => {
    assert.deepEqual(
      committedReport.durability.map((probe) => probe.id),
      ['atomic-node-completion', 'activation-cas', 'semantic-idempotency', 'segment-checkpoint-namespace', 'crash-reclaim-closes', 'uncertain-guard'],
    );
    for (const probe of committedReport.durability) {
      assert.equal(probe.state, 'durable-scripted', `${probe.id} is persistence evidence, never a runtime fixture pass`);
      assert.equal(probe.outcome, 'pass', `${probe.id}: ${probe.observed}`);
    }
    assert.deepEqual(committedReport.counts.durability, { total: 6, passed: 6, failed: 0 });
    const skewed = structuredClone(committedReport);
    skewed.counts.durability.passed -= 1;
    assert.equal(reportValidator(skewed).valid, false, 'a durability count that does not reconcile must refuse');
  });
});

describe('the integrated measurement states exactly how far the runtime has come', () => {
  it('publishes 11/11 runtime-pass oracles and 7/7 exact refusals', () => {
    assert.equal(committedReport.counts.integrated.runtimePass, 11, 'every registered positive oracle executes and passes');
    assert.equal(committedReport.counts.integrated.refusedAsRegistered, 7);
    assert.equal(committedReport.counts.integrated.validated, 0);
    assert.equal(committedReport.counts.integrated.notImplemented, 0);
    const byId = new Map(committedReport.registration.fixtures.map((fixture) => [fixture.id, fixture]));
    for (const row of committedReport.integrated) {
      if (row.family === 'positive') {
        assert.equal(row.workflowVersionId, byId.get(row.id)?.workflowVersionId, `${row.id} carries its registered workflow version`);
        assert.equal(row.registryRevision, committedReport.registration.registryRevision);
        assert.match(row.executableRevision ?? '', /^[0-9a-f]{64}$/, `${row.id} carries a lowered executable revision`);
        const registered = byId.get(row.id)?.expect;
        assert.ok(registered !== undefined && registered.kind === 'pass');
        assert.equal(row.state, 'runtime-pass', `${row.id} executed its full oracle`);
        assert.equal(row.calls, registered.calls, `${row.id} scripted calls match the registration`);
        assert.equal(row.toolCalls, registered.toolCalls);
        assert.equal(row.contextReads, registered.contextReads);
        assert.equal(row.restores, registered.restores);
        assert.ok(row.attempts >= 1);
        assert.ok(row.maxObservedConcurrency !== null
          && row.maxObservedConcurrency >= registered.concurrency.min
          && row.maxObservedConcurrency <= registered.concurrency.max, `${row.id} concurrency within registered bounds`);
      } else {
        assert.equal(row.state, 'refused-as-registered', `${row.id} refuses as registered`);
        const registered = byId.get(row.id)?.expect;
        assert.ok(registered !== undefined && registered.kind === 'refusal');
        assert.deepEqual(row.refusal, { code: registered.code, path: registered.path }, `${row.id} refusal matches its registration`);
      }
    }
    assert.equal(
      committedReport.integrated.find((row) => row.id === 'weekly-report-manual')?.maxObservedConcurrency, 3,
      'the drafters overlap at measured concurrency exactly 3',
    );
  });
});

describe('the instrument is deterministic, keyless and self-consistent', () => {
  it('renders byte-identical report, document and query output without a network call', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      calls += 1;
      throw new Error('the MAS conformance instrument must not fetch');
    }) as typeof fetch;
    try {
      const first = await buildReport({ source: FROZEN_SOURCE });
      const second = await buildReport({ source: FROZEN_SOURCE });
      assert.equal(renderReport(first), renderReport(second));
      assert.equal(renderDocument(first), renderDocument(second));
      assert.equal(renderBaseline(await runBaselineQuery(first)), renderBaseline(await runBaselineQuery(second)));
      assert.equal(calls, 0);
      const text = renderReport(first);
      assert.equal(/"at":\s*"20/.test(text), false, 'no clock reading enters the document');
      assert.equal(text.includes(process.cwd()), false, 'no absolute path enters the document');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('executes the committed baseline query verbatim and reproduces its output', async () => {
    const raw = JSON.parse(await readFile(BASELINE_QUERY_PATH, 'utf8')) as Record<string, unknown>;
    const { $comment: _comment, ...query } = raw;
    const compiled = compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
    const rows = compiled(committedReport) as { rows: Array<{ fixture: string }>, byState: unknown };
    const committedBaseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as {
      queryRevision: string, reportId: string, rows: unknown, artifactId: string,
    };
    assert.deepEqual(committedBaseline.rows, rows, 'the committed projection reproduces');
    assert.equal(committedBaseline.reportId, committedReport.reportId);
    assert.equal(committedBaseline.queryRevision, await canonicalSha256(query), 'the query revision recomputes');
    const moved = await canonicalSha256({ ...query, $return: { changed: true } });
    assert.notEqual(moved, committedBaseline.queryRevision, 'the revision moves when the query bytes move');
    const { artifactId, ...rest } = committedBaseline;
    assert.equal(await canonicalSha256(rest), artifactId);
  });

  it('keeps the source manifest sorted and free of the report itself', () => {
    assert.equal(SOURCE_MANIFEST.includes(REPORT_PATH), false, 'a report inside its own digest could never reproduce');
    assert.equal(SOURCE_MANIFEST.includes(MANIFEST_PATH), true);
    assert.deepEqual([...SOURCE_MANIFEST].sort(), [...SOURCE_MANIFEST], 'the manifest is sorted');
  });
});

describe('the mechanical decision', () => {
  it('is runtime-conformant on the committed report, with the identity computed before the decision', async () => {
    assert.equal(committedReport.decision.outcome, 'runtime-conformant');
    assert.deepEqual(committedReport.decision.failedClauses, []);
    const { reportId, decision: _decision, ...rest } = committedReport;
    assert.equal(await canonicalSha256(rest), reportId, 'stating the decision cannot move its evidence address');
  });

  it('returns a named non-conformant decision when any one clause is flipped', async () => {
    const { decideMasRuntime } = await import('../../benchmark/lib/mas-conformance.ts');
    const flips: Array<[string, (report: MasConformance) => void]> = [
      ['conformance', (report) => { report.counts.integrated.runtimePass = 10; }],
      ['concurrencyOrder', (report) => {
        const weekly = report.integrated.find((row) => row.id === 'weekly-report-manual');
        if (weekly !== undefined) weekly.maxObservedConcurrency = 2;
      }],
      ['durability', (report) => { report.counts.durability.passed = 5; }],
      ['controlSafety', (report) => {
        const loop = report.integrated.find((row) => row.id === 'loop-three');
        if (loop !== undefined) loop.state = 'validated';
      }],
      ['persistenceIdentity', (report) => { report.durability[0].outcome = 'fail'; }],
      ['hygiene', (report) => { report.counts.durability.failed = 1; }],
      ['registration', (report) => {
        const row = report.integrated.find((entry) => entry.family === 'positive');
        if (row !== undefined) row.executableRevision = null;
      }],
    ];
    for (const [clause, flip] of flips) {
      const tampered = structuredClone(committedReport);
      flip(tampered);
      const decision = decideMasRuntime(tampered);
      assert.equal(decision.outcome, 'not-conformant', `${clause}: a flipped clause cannot stay conformant`);
      assert.ok(decision.failedClauses.includes(clause), `${clause} is named (got ${decision.failedClauses.join(', ')})`);
    }
  });

  it('a forged conformant decision over a failed clause is schema-invalid', () => {
    const forged = structuredClone(committedReport);
    forged.decision.clauses.conformance = false;
    assert.equal(reportValidator(forged).valid, false, 'the outcome-iff-all-clauses recomputation refuses');
    const hidden = structuredClone(committedReport);
    hidden.counts.integrated.runtimePass = 10;
    hidden.counts.integrated.validated = 1;
    assert.equal(reportValidator(hidden).valid, false, 'a hidden failure under a conformant decision refuses');
    const liveless = structuredClone(committedReport) as unknown as { live: unknown };
    liveless.live = { state: 'not-run', reason: '' };
    assert.equal(reportValidator(liveless as unknown as MasConformance).valid, false, 'a not-run row must state its reason');
  });
});

describe('the immutable handoff', () => {
  it('reproduces from the committed query bytes with every identity resolving', async () => {
    const raw = JSON.parse(await readFile('queries/mas/runtime-handoff.json', 'utf8')) as Record<string, unknown>;
    const { $comment: _comment, ...query } = raw;
    const compiled = compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
    const handoff = compiled(committedReport) as Record<string, unknown>;
    const committedHandoff = JSON.parse(await readFile('benchmark/results/mas-runtime-handoff.json', 'utf8')) as {
      queryRevision: string, reportId: string, handoff: unknown, artifactId: string,
    };
    assert.deepEqual(committedHandoff.handoff, handoff, 'the committed projection reproduces');
    assert.equal(committedHandoff.reportId, committedReport.reportId);
    assert.equal(committedHandoff.queryRevision, await canonicalSha256(query), 'the query bytes are pinned');
    const { artifactId, ...rest } = committedHandoff;
    assert.equal(await canonicalSha256(rest), artifactId);
    const projected = handoff as { decision: string, nonClaims: string[], deploymentLimits: string[], capabilities: { nodeKinds: string[] } };
    assert.equal(projected.decision, 'runtime-conformant');
    assert.equal(projected.nonClaims.length, 4, 'the non-claims travel with the handoff');
    assert.equal(projected.deploymentLimits.length, 4);
    assert.deepEqual(projected.capabilities.nodeKinds, ['agent', 'task', 'graph', 'loop', 'switch', 'interaction']);
  });
});

describe('the generated bundle and the import census', () => {
  it('carries the generated header and the load-bearing declarations', async () => {
    const types = await readFile('benchmark/lib/mas-conformance.types.ts', 'utf8');
    assert.match(types, /^\/\/ Generated by @jarenjs\/emit from benchmark\/schemas\/mas-conformance\.schema\.json\./);
    for (const name of ['MasConformance', 'RegisteredFixture', 'SuiteProbe', 'IntegratedRow', 'FixtureDocument', 'Manifest', 'FixtureScript']) {
      assert.match(types, new RegExp(`^export (interface|type) ${name}[ =]`, 'm'), `${name} is missing from the generated contract`);
    }
  });

  it('consumes the published primitives and contains no local scheduler, FSM, queue, retry or budget', async () => {
    const instrument = await readFile('benchmark/lib/mas-conformance.ts', 'utf8');
    for (const imported of [
      "from '@jarenjs/flow'", "from '@jarenjs/linq/flow'", "from '@jarenjs/db'",
      "from '@jarenjs/ai'", "from '@jarenjs/json/canonical'", "from '@jarenjs/json/query'",
    ]) {
      assert.ok(instrument.includes(imported), `the instrument imports ${imported}`);
    }
    const authoring = await readFile('benchmark/scripts/mas-fixtures.ts', 'utf8');
    for (const [name, forbidden] of [
      ['a wall-clock sleep', /\bsetTimeout\s*\(/],
      ['a polling interval', /\bsetInterval\s*\(/],
      ['runtime randomness', /\bMath\.random\b/],
      ['a clock reading', /\bDate\.now\b|\bnew Date\b/],
      ['a local topological sort', /kahn|toposort|topologicalSort/i],
      ['a local worker pool or lease', /leaseOwner\s*=|acquireLease|workerPool/i,],
      ['a local retry/backoff loop', /backoff\s*\(|retryWithBackoff/i],
    ] as Array<[string, RegExp]>) {
      assert.equal(forbidden.test(instrument), false, `the instrument contains ${name}`);
      assert.equal(forbidden.test(authoring), false, `the fixture author contains ${name}`);
    }
  });
});
