import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { researchArtifactIdOf } from '@tangleai/research';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJSONPointer, JSONPOINTER_NOTHING } from '@jarenjs/json/pointer';
import { researchContext, buildReport, renderReport, renderDocument, validateResearchReport } from '../../benchmark/lib/research.ts';
import { validateResearchReportShape } from '../../benchmark/lib/research-validation.ts';
import { RESEARCH_DIMENSIONS, RESEARCH_ROW_IDS, RESEARCH_DISCLOSURES } from '../../benchmark/lib/research-schema.ts';
import { runResearchCli, requireResearchGate } from '../../benchmark/research.ts';
import { runResearchFixture } from '../../benchmark/lib/research-runner.ts';
import type { ResearchReport, ResearchMeasuredRow } from '../../benchmark/lib/research.types.ts';

const context = await researchContext();
const report = await buildReport({ context });
function measured(value: ResearchReport, index: number): ResearchMeasuredRow {
  const row = value.rows[index]; assert.equal(row.state, 'measured');
  if (row.state !== 'measured' || row.scope !== 'full-lifecycle') throw new Error('expected a measured full-lifecycle row'); return row;
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
  it('the oracle reaches every dimension ceiling while the no-model floor omits half the claims', () => {
    assert.equal(report.decision, 'conformant'); assert.deepEqual(report.gate, { registration: true, oracle: true, bundles: true, analysis: true, writing: true, networkCalls: 0 });
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
  it('every registered mechanism has an explicit measurement scope and provider identity state', () => {
    assert.deepEqual(report.rows.map(row => row.id), RESEARCH_ROW_IDS);
    for (const row of report.rows.filter(row => row.id === 'full-auto-full')) {
      assert.equal(row.state, 'measured'); assert.ok('experimental' in row && row.experimental);
    }
    assert.equal(report.identity.identities.length, 3);
    assert.equal(report.identity.rows.find(row => row.rowId === 'no-model-runner')?.identityStatus, 'run');
    assert.ok(report.identity.rows.filter(row => row.rowId !== 'artifact-oracle').every(row => row.identityStatus === 'run'));
    assert.equal(report.identity.rows.find(row => row.rowId === 'artifact-oracle')?.identityStatus, 'not-run');
  });
  it('writing retains missing result claims, the stopped scientific outcomes and a separately registered complete native control', () => {
    const rows = report.rows.filter(row => row.state === 'measured' && row.scope === 'writing');
    assert.equal(rows.length, 3);
    const [retrieval, full, automatic] = rows;
    assert.deepEqual(retrieval.claimSupport, { passed: 6, total: 12, value: 0.5 });
    assert.deepEqual(retrieval.numericMapping, { passed: 0, total: 6, value: 0 });
    assert.deepEqual(full.claimSupport, { passed: 12, total: 12, value: 1 });
    assert.deepEqual(full.numericMapping, { passed: 6, total: 6, value: 1 });
    assert.equal(retrieval.cost.calls, 0); assert.equal(retrieval.interventions.total, 0);
    assert.deepEqual(full.cost, report.analysis.rows[0].cost);
    assert.deepEqual(automatic.cost, full.cost); assert.equal(automatic.experimental, true);
    assert.deepEqual(automatic.claimSupport, full.claimSupport); assert.deepEqual(automatic.numericMapping, full.numericMapping);
    assert.equal(automatic.interventionReport.automatic, full.interventionReport.scripted);
    assert.equal(automatic.interventionReport.human, 0); assert.equal(full.interventionReport.human, 0);
    for (const row of rows) for (const topic of row.topics) {
      assert.equal(topic.citationIdentity.value, 1); assert.equal(topic.claimValidity.value, 1); assert.equal(topic.bundleRerun.value, 1);
      assert.equal(topic.refusalConformance.value, 1); assert.equal(topic.receipt.files.length, 7);
      assert.equal(topic.receipt.latex.state, 'skipped'); assert.ok(topic.receipt.latex.reason);
      assert.equal(topic.bundle.source.disclosure.length, 8);
      assert.equal(topic.bundle.source.disclosure.find(item => item.item === 'human-review')!.satisfied, false);
      if (row.id === 'single-pass-retrieve-draft') {
        assert.equal(topic.terminal, 'LITERATURE_GATE'); assert.equal(topic.scope, 'retrieval-control'); assert.equal(topic.resultClaims, 0);
        assert.equal(topic.probes.length, 3); assert.equal(topic.required.filter(claim => claim.actualState === 'missing').length, 2);
      } else {
        assert.equal(topic.terminal, 'STOPPED'); assert.equal(topic.scope, 'stopped-run-audit'); assert.equal(topic.resultClaims, 2);
        assert.equal(topic.probes.length, 4); assert.equal(topic.bundle.source.inputs.decision?.kind, 'Stop');
      }
    }
    const control = report.writing.control!;
    assert.equal(control.state.status, 'COMPLETE'); assert.equal(control.writerCalls, 2); assert.equal(control.reviewCalls, 14);
    assert.equal(control.bundle.source.inputs.analysis?.support, 'supported'); assert.equal(control.bundle.source.inputs.decision?.kind, 'Proceed');
    assert.equal(control.bundle.source.reviews.length, 2); assert.equal(control.cost.calls, control.requests.length);
    assert.equal(control.requests.every(row => row.hiddenPaths === 0), true);
    assert.equal(control.bundle.source.reviews.every(row => row.independence?.roleId !== control.bundle.source.draft.writer.roleId), true);
    assert.equal(report.identity.identities.some(row => row.identityId === control.runIdentityId), true);
    const autoControl = report.writing.autoControl!;
    assert.equal(autoControl.state.status, 'COMPLETE'); assert.deepEqual(autoControl.cost, control.cost);
    assert.equal(autoControl.interactions.length, 0); assert.equal(autoControl.bundle.experimental, true);
    assert.equal(autoControl.bundle.interventionReport!.automatic, 3); assert.equal(autoControl.bundle.source.provenance.interventions.length, 3);
    assert.doesNotThrow(() => requireResearchGate(report, 'writing'));
  });
  it('paired reasoning rows publish their equal conformance and unequal native cost without claiming experiment completion', () => {
    const rows = report.rows.filter(row => row.state === 'measured' && row.scope === 'pre-execution');
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(Object.hasOwn(row, 'completion'), false); assert.equal(Object.hasOwn(row, 'claimSupport'), false);
      assert.equal(row.hypothesisValidity.value, 1); assert.equal(row.evidenceLinkage.value, 1); assert.equal(row.refusalConformance.value, 1);
      for (const topic of row.topics) {
        assert.equal(topic.nativeStatus, 'waiting_for_input'); assert.equal(topic.state.status, 'DESIGN_GATE');
        assert.equal(topic.cost.calls, topic.usage.completion + topic.usage.normalization + topic.usage.repair);
        assert.equal(topic.cost.tokens, topic.usage.promptTokens + topic.usage.completionTokens);
        assert.equal(topic.visibleCardIds.length, 8); assert.equal(topic.availableCards, 16);
        assert.equal(topic.requests.every(request => request.hiddenPaths === 0), true); assert.ok(topic.usage.traceBytes < report.registration.caps.traceBytes);
        assert.ok(topic.probes.every(probe => probe.kind === 'independent-verifier' && probe.calls === 0 && probe.matched));
        assert.deepEqual(topic.novelty.coverage, { attempted: 2, complete: 2, total: 2 }); assert.equal(topic.novelty.gating, false);
        assert.equal(topic.noveltyReplay.requests, 4); assert.equal(topic.noveltyReplay.networkCalls, 0);
      }
    }
    assert.equal(rows[0].cost.calls, 18); assert.equal(rows[1].cost.calls, 78);
    assert.equal(rows[0].cost.tokens, 180); assert.equal(rows[1].cost.tokens, 780);
    assert.deepEqual(rows[0].topics.map(topic => topic.visibleCardIds), rows[1].topics.map(topic => topic.visibleCardIds));
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
  it('matched execution retains three preregistered branches, every seed and the extra cost', () => {
    const branch = report.rows.find(row => row.state === 'measured' && row.scope === 'execution');
    assert.ok(branch && branch.state === 'measured' && branch.scope === 'execution');
    const control = report.execution.control!;
    assert.deepEqual(control.topics.map(row => row.runs.length), [10, 2, 2]);
    assert.deepEqual(branch.topics.map(row => row.runs.length), [30, 2, 2]);
    assert.equal(control.rerunRate.value, 1); assert.equal(branch.rerunRate.value, 1);
    assert.equal(control.registryAccuracy.value, 1); assert.equal(branch.registryAccuracy.value, 1);
    assert.deepEqual(control.cost, { calls: 18, tokens: 180, ms: 0, physical: 32 });
    assert.deepEqual(branch.cost, { calls: 18, tokens: 180, ms: 0, physical: 52 });
    assert.equal(control.rerunCost.physical, 14); assert.equal(branch.rerunCost.physical, 34);
    for (const [index, topic] of branch.topics.entries()) {
      assert.equal(topic.contract.contractHash, control.topics[index].contract.contractHash);
      assert.equal(topic.plan.planHash, control.topics[index].plan.planHash);
      assert.equal(topic.usage.physical, control.topics[index].usage.physical);
      assert.equal(topic.nativeStatus, 'completed'); assert.equal(topic.state.status, 'STOPPED');
      assert.equal(topic.runs.every(run => run.isolation?.verified === false), true);
      assert.ok(topic.traceBytes <= report.registration.caps.traceBytes);
      assert.equal(new Set(topic.branches.map(row => row.hypothesisHash)).size, 1);
    }
    assert.deepEqual(branch.topics[0].branches.map(row => row.attemptOrdinal), [1, 2, 3]);
    assert.equal(context.loaded.topics[0].contract.attemptCap, 1, 'The original registration is immutable');
    assert.equal(report.bundles.length, 26); assert.ok(report.bundles.every(row => row.refusedAsRegistered));
  });
  it('failure probes retain partial branches, failed runs, refused metrics and all incurred cost', () => {
    const [thrown, cancelled] = report.execution.failureProbes.map(row => row.topic);
    assert.equal(thrown.runs.length, 6); assert.equal(thrown.observations.length, 5); assert.equal(thrown.partialBranches, 1);
    assert.equal(thrown.runs.find(row => row.status === 'failed')!.exitStatus, 1);
    assert.equal(thrown.cost.physical, 12); assert.equal(thrown.rerunCost.physical, 5);
    assert.equal(cancelled.runs.length, 3); assert.equal(cancelled.observations.length, 2); assert.equal(cancelled.partialBranches, 1);
    assert.equal(cancelled.runs.filter(row => row.stopReason === 'cancelled').length, 1);
    assert.equal(cancelled.cost.physical, 9); assert.equal(cancelled.rerunCost.physical, 2);
    for (const row of [thrown, cancelled]) {
      assert.equal(row.nativeStatus, 'failed'); assert.equal(row.state.status, 'STOPPED'); assert.equal(row.failures.program, 1);
      assert.equal(row.expectedRuns, 10); assert.equal(row.cost.calls, 6); assert.equal(row.cost.tokens, 60);
      const failed = new Set(row.runs.filter(run => run.status === 'failed').map(run => run.id));
      assert.equal(row.observations.some(observation => failed.has(observation.experimentRunId)), false);
    }
  });
  it('decision controls retain honest negative results and the cost of ineffective replication and repair', async () => {
    assert.equal(report.gate.analysis, true); assert.ok(report.analysis.probes.every(row => row.matched));
    for (const row of report.analysis.rows) {
      assert.equal(row.confoundDetection.value, 1); assert.equal(row.negativeResultHandling.value, 1); assert.equal(row.branchSelectionCompliance.value, 1);
      for (const topic of row.topics) {
        for (const review of topic.reviews) assert.equal(review.artifactId, await researchArtifactIdOf(new Uint8Array(review.bytes)));
        assert.ok(topic.decisions.every(decision => decision.details!.reviewArtifactIds.every(id => topic.reviews.some(review => review.artifactId === id))));
      }
      const embedding = row.topics.find(topic => topic.topicId === 'embedder-width')!;
      assert.equal(embedding.analyses.find(value => value.id === embedding.finalAnalysisId)!.support, 'not-supported');
      assert.equal(embedding.decisions.find(value => value.id === embedding.finalDecisionId)!.kind, 'Stop');
    }
    const [control, branching] = report.analysis.rows.map(row => row.topics[0]);
    assert.equal(branching.runs.length - control.runs.length, 0); assert.equal(branching.cost.calls - control.cost.calls, 12);
    const [a, b] = report.analysis.repair;
    assert.equal(b.runs.length - a.runs.length, 4); assert.equal(b.cost.calls - a.cost.calls, 12);
    assert.ok(b.branches.every(branch => branch.status === 'failed'));
    assert.ok(b.decisions.every(decision => decision.kind !== 'Proceed'));
    assert.match(renderDocument(report), /Persistent initializer fault/);
  });
  it('selection retains not-run rows and cannot silently enable an unknown or duplicate id', async () => {
    const selected = await buildReport({ context, rows: ['artifact-oracle'] });
    assert.equal(selected.rows.length, 8); assert.equal(selected.rows[0].state, 'measured');
    assert.ok(selected.rows.slice(1).every(row => row.state === 'not-run'));
    assert.equal(selected.gate.oracle, true);
    assert.equal(selected.gate.analysis, false); assert.equal(selected.gate.writing, false); assert.equal(selected.decision, 'drift');
    assert.equal(validateResearchReportShape(selected).valid, true);
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
      value => { value.gate.analysis = false; },
      value => { value.gate.writing = false; },
      value => { value.writing.control!.writerCalls = 0; },
      value => { value.analysis.probes[0].matched = false; },
      value => { value.analysis.rows[0].cost.physical++; },
      value => { value.analysis.repair[0].reviewCalls++; },
      value => { value.decision = 'drift'; },
      value => { const row = value.rows.find(row => row.state === 'measured' && row.scope === 'pre-execution')!;
        if (row.state === 'measured' && row.scope === 'pre-execution') row.topics[0].state.planHash = '0'.repeat(64); },
      value => { const row = value.rows.find(row => row.state === 'measured' && row.scope === 'pre-execution')!;
        if (row.state === 'measured' && row.scope === 'pre-execution') {
          row.topics[0].usage.completion++; row.usage.completion++;
        } },
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

});
