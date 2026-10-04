import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJSONPointer, JSONPOINTER_NOTHING } from '@jarenjs/json/pointer';
import { researchContext, buildReport, renderReport, renderDocument, validateResearchReport, REPORT_PATH, DOCUMENT_PATH } from '../../benchmark/lib/research.ts';
import { validateResearchReportShape } from '../../benchmark/lib/research-validation.ts';
import { RESEARCH_DIMENSIONS, RESEARCH_ROW_IDS, RESEARCH_DISCLOSURES } from '../../benchmark/lib/research-schema.ts';
import { runResearchCli, requireResearchGate } from '../../benchmark/research.ts';
import { RESEARCH_FIXTURE_PATH } from '../../benchmark/lib/research-fixture.ts';
import { runResearchFixture } from '../../benchmark/lib/research-runner.ts';
import type { ResearchReport, ResearchMeasuredRow } from '../../benchmark/lib/research.types.ts';

const context = await researchContext();
const report = await buildReport({ context });
function measured(value: ResearchReport, index: number): ResearchMeasuredRow {
  const row = value.rows[index]; assert.equal(row.state, 'measured');
  if (row.state !== 'measured') throw new Error('expected measured row'); return row;
}
async function rehash(value: ResearchReport): Promise<void> {
  const { reportId: _id, ...body } = value; value.reportId = await canonicalSha256(body);
}
async function temporary(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-research-report-'));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('research instrument', () => {
  it('two runs are byte-identical with zero network requests', async () => {
    const before = globalThis.fetch; let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Forbidden research network call.'); };
    try {
      const first = await buildReport({ context }), second = await buildReport({ context });
      assert.equal(renderReport(first), renderReport(second)); assert.equal(renderDocument(first), renderDocument(second));
      assert.equal(requests, 0); assert.equal(first.gate.networkCalls, 0);
    } finally { globalThis.fetch = before; }
  });
  it('the committed report and document reproduce with their original source identity', async () => {
    const prior: ResearchReport = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
    assert.equal(await validateResearchReport(prior, context), true);
    const rebuilt = await buildReport({ context: { ...context, source: prior.source } });
    assert.equal(renderReport(rebuilt), await readFile(REPORT_PATH, 'utf8'));
    assert.equal(renderDocument(rebuilt), await readFile(DOCUMENT_PATH, 'utf8'));
  });
  it('the oracle reaches every dimension ceiling while the no-model floor omits half the claims', () => {
    assert.equal(report.decision, 'conformant'); assert.deepEqual(report.gate, { registration: true, oracle: true, bundles: true, networkCalls: 0 });
    const oracle = measured(report, 0), floor = measured(report, 1);
    for (const topic of oracle.topics) for (const dimension of RESEARCH_DIMENSIONS)
      assert.equal(topic[dimension].value, dimension === 'literatureRecall' ? 0.75 : 1, topic.topicId + '/' + dimension);
    assert.equal(floor.claimSupport.value, 0.5); assert.equal(floor.claimSupport.total, 12);
    assert.equal(floor.failures.unsupported, 6); assert.equal(floor.literaturePrecision.value, 0.75);
    assert.equal(floor.citationIdentity.value, 0); assert.deepEqual(floor.gateBehaviour, { passed: 7, total: 9, value: 7 / 9 });
    assert.equal(floor.interventions.approvals, 7);
    assert.deepEqual(floor.topics.map(t => t.workflow?.state.status), ['STOPPED', 'COMPLETE', 'STOPPED']);
    for (const topic of floor.topics) {
      assert.equal(topic.completePathControl?.state.status, 'COMPLETE');
      assert.deepEqual(topic.completePathControl?.gateBehaviour, { passed: 3, total: 3, value: 1 });
      assert.equal(topic.bundle.interventions.length, 0, 'Legacy pure-program evidence does not relabel early native approvals');
      assert.equal(topic.workflow?.providerCalls, 0);
      assert.equal(topic.workflow?.attempts.every(a => a.runIdentityId === report.identity.identities[0].identityId), true);
    }
    assert.equal(floor.completion.value, 1); assert.equal(floor.topics[2].result, 'SATURATED');
    assert.deepEqual(floor.cost, { calls: 0, tokens: 0, ms: 0, physical: 0 });
  });
  it('discovery measures metadata screening separately from oracle support and retains all raw provenance', () => {
    assert.equal(report.discovery.length, 3);
    for (const row of report.discovery) {
      assert.deepEqual(row.literatureRecall, { passed: 6, total: 8, value: 0.75 });
      assert.deepEqual(row.literaturePrecision, { passed: 6, total: 8, value: 0.75 });
      assert.equal(row.absentRelevant, 2); assert.equal(row.receipt.dedupe.identityMerges, 24);
      assert.deepEqual(row.cards, { total: 16, resolvable: 16, unresolvable: 0 });
      assert.deepEqual(row.replay, { requests: 20, misses: 0, networkCalls: 0 });
      assert.deepEqual(row.providerOutcomes.counts, { ok: 11, failed: 0, refused: 0, unresolved: 0, cancelled: 0, rateLimited: 0 });
      assert.ok(row.literature.every(record => record.rawHashes.length === 4));
      assert.ok(row.acquisitions.every(a => a.status === 'resolved' && a.issues.length === 0));
    }
  });
  it('every registered mechanism and its absent provider identity remain explicit', () => {
    assert.deepEqual(report.rows.map(row => row.id), RESEARCH_ROW_IDS);
    for (const row of report.rows.slice(2)) {
      assert.equal(row.state, 'implementation-missing'); assert.equal(Object.hasOwn(row, 'claimSupport'), false);
      assert.ok('reason' in row && row.reason.length > 0);
    }
    assert.equal(report.identity.identities.length, 1);
    assert.equal(report.identity.rows.find(row => row.rowId === 'no-model-runner')?.identityStatus, 'run');
    assert.ok(report.identity.rows.filter(row => row.rowId !== 'no-model-runner').every(row => row.identityStatus === 'not-run'));
  });
  it('native stage execution preserves the exact scientific bundle and truthful early-gate artifact sets', async () => {
    for (const [index, topic] of context.loaded.topics.entries()) {
      const actual = measured(report, 1).topics[index], workflow = actual.workflow!;
      assert.deepEqual(actual.bundle, await runResearchFixture(context.loaded, topic, 'no-model-runner'));
      assert.deepEqual(workflow.taskExecutions, ['create', 'discovery', 'synthesis', 'hypothesis', 'design', 'execute', 'analyze', 'decide',
        ...(actual.bundle.decision.kind === 'Proceed' ? ['write', 'verify'] : [])]);
      const raw = new Set(actual.bundle.runs.map(run => 'art-' + run.rawArtifactHash));
      for (const interaction of workflow.interactions) {
        const prompt = interaction.prompt as { gate: { kind: string; artifacts: Array<{ artifactId: string }> } };
        assert.equal(prompt.gate.artifacts.some(a => raw.has(a.artifactId)), prompt.gate.kind === 'quality');
      }
      assert.equal(new Set(workflow.interactions.map(i => (i.prompt as { gate: { manifestHash: string } }).gate.manifestHash)).size, workflow.interactions.length);
    }
  });
  it('selection retains not-run rows and cannot silently enable an unknown or duplicate id', async () => {
    const selected = await buildReport({ context, rows: ['artifact-oracle'] });
    assert.equal(selected.rows.length, 8); assert.equal(selected.rows[0].state, 'measured');
    assert.ok(selected.rows.slice(1).every(row => row.state === 'not-run'));
    assert.equal(selected.gate.oracle, true);
    await assert.rejects(buildReport({ context, rows: ['invented'] }), /subset/);
    await assert.rejects(buildReport({ context, rows: ['artifact-oracle', 'artifact-oracle'] }), /subset/);
  });
  it('dropping a required supported proposition lowers the oracle and refuses the required gate', async () => {
    const oracles = new Map(context.loaded.oracles), bundle = structuredClone(oracles.get('kmeans-seeding')!);
    bundle.claims.shift(); bundle.claimLedger.claims.shift(); oracles.set(bundle.topicId, bundle);
    const degraded = await buildReport({ context: { ...context, loaded: { ...context.loaded, oracles } } });
    assert.equal(measured(degraded, 0).topics[0].claimSupport.total, 4);
    assert.equal(measured(degraded, 0).topics[0].claimSupport.passed, 3);
    assert.equal(degraded.gate.oracle, false); assert.equal(degraded.decision, 'drift');
    assert.throws(() => requireResearchGate(degraded, 'oracle'), /gate failed/);
  });
  it('an incorrectly accepted adversarial bundle records no invented refusal code', async () => {
    const invalid = [...context.loaded.invalid];
    invalid[0] = { ...invalid[0], bundle: context.loaded.oracles.get('kmeans-seeding')! };
    const broken = await buildReport({ context: { ...context, loaded: { ...context.loaded, invalid } } });
    assert.equal(broken.decision, 'drift'); assert.equal(broken.gate.bundles, false);
    assert.equal(broken.bundles[0].refusedAsRegistered, false); assert.equal(broken.bundles[0].observed, null);
    assert.throws(() => requireResearchGate(broken, 'bundles'), /gate failed/);
  });
  it('schema queries reject count, ordered inventory, denominator and gate forgeries', () => {
    const mutations: Array<(value: ResearchReport) => void> = [
      value => { [value.rows[1], value.rows[2]] = [value.rows[2], value.rows[1]]; },
      value => { measured(value, 0).topics[1].topicId = measured(value, 0).topics[0].topicId; },
      value => { value.bundles[1].id = value.bundles[0].id; },
      value => { value.bundles[0].expected.path = '/invented'; value.bundles[0].observed!.path = '/invented'; },
      value => { value.disclosure[0].items[1].item = value.disclosure[0].items[0].item; },
      value => { measured(value, 0).cost.calls++; },
      value => { measured(value, 1).failures.unsupported--; },
      value => { measured(value, 0).claimSupport.total++; },
      value => { value.gate.bundles = false; },
      value => { value.decision = 'drift'; },
    ];
    assert.equal(validateResearchReportShape(report).valid, true);
    for (const [index, mutate] of mutations.entries()) {
      const forged = structuredClone(report); mutate(forged);
      assert.equal(validateResearchReportShape(forged).valid, false, 'mutation ' + index);
    }
  });
  it('a fully rehashed and internally reconciled forged quality score fails re-execution', async () => {
    const forged = structuredClone(report), row = measured(forged, 1), topic = row.topics[0];
    topic.claimSupport.passed++; topic.claimSupport.value = topic.claimSupport.passed / topic.claimSupport.total;
    row.claimSupport.passed++; row.claimSupport.value = row.claimSupport.passed / row.claimSupport.total;
    await rehash(forged); assert.equal(validateResearchReportShape(forged).valid, true);
    assert.equal(await validateResearchReport(forged, context), false);
    const registration = structuredClone(report); registration.registration.revision = '0'.repeat(64); await rehash(registration);
    assert.equal(await validateResearchReport(registration, context), false);
  });
  it('satisfied disclosure pointers resolve to retained artifacts, including every topic', () => {
    for (const row of report.disclosure) {
      assert.deepEqual(row.items.map(item => item.item), RESEARCH_DISCLOSURES);
      for (const item of row.items) if (item.satisfied) {
        assert.ok(item.evidence.length >= 3);
        for (const pointer of item.evidence) assert.notEqual(compileJSONPointer(pointer)(report), JSONPOINTER_NOTHING, pointer);
      } else assert.deepEqual(item.evidence, []);
    }
  });
  it('CLI checks write nothing, reproduce both files, reject drift and restore fetch', async () => {
    await temporary(async directory => {
      const out = join(directory, 'report.json'), before = globalThis.fetch;
      await runResearchCli(['--out', out, '--require', 'oracle']); assert.equal(globalThis.fetch, before);
      const original = await readFile(out, 'utf8'), markdown = await readFile(out + '.md', 'utf8');
      await runResearchCli(['--out', out, '--check', '--require', 'bundles']);
      assert.equal(await readFile(out, 'utf8'), original); assert.equal(await readFile(out + '.md', 'utf8'), markdown);
      await writeFile(out + '.md', 'drift');
      await assert.rejects(runResearchCli(['--out', out, '--check']), /output drift/);
      assert.equal(globalThis.fetch, before); assert.equal(await readFile(out, 'utf8'), original);
      assert.equal(await readFile(out + '.md', 'utf8'), 'drift');
    });
  });
  it('malformed CLI requests and unmet gates exit nonzero before any output is written', async () => {
    await temporary(async directory => {
      const out = join(directory, 'absent.json');
      for (const args of [['--rows', 'unknown'], ['--rows', 'artifact-oracle,artifact-oracle'], ['--require', 'unknown'],
        ['--check=true'], ['positional'], ['--rows', '--check'], ['--rows', 'no-model-runner', '--require', 'oracle']]) {
        const child = spawnSync(process.execPath, ['benchmark/research.ts', '--out', out, ...args], { encoding: 'utf8' });
        assert.equal(child.status, 1, JSON.stringify(args) + child.stdout + child.stderr);
      }
      assert.deepEqual(await readdir(directory), []);
    });
  });
  it('authored fixtures and generated schemas reproduce without clocks in the implementation', async () => {
    for (const command of [['benchmark/scripts/research-fixtures.ts', '--check'], ['scripts/research-schema.ts', '--check']]) {
      const child = spawnSync(process.execPath, command, { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stdout + child.stderr);
    }
    for (const path of (await readdir('benchmark/lib')).filter(path => /^research.*\.ts$/.test(path)))
      assert.doesNotMatch(await readFile(join('benchmark/lib', path), 'utf8'), /\bDate\b|performance\.now/);
    assert.ok(context.source.files.some(file => file.path === RESEARCH_FIXTURE_PATH + '/LICENSE.md'));
    for (const member of context.loaded.manifest.members)
      assert.ok(context.source.files.some(file => file.path === RESEARCH_FIXTURE_PATH + '/' + member.path), member.path);
  });
});
