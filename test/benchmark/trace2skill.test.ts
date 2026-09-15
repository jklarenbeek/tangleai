import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { trace2SkillPrompt } from '@tangleai/trace2skill';
import { analyticEnvelope } from '../../benchmark/lib/report-envelope.ts';
import { createFixtureAdapter } from '../../benchmark/lib/trace2skill-adapter.ts';
import { isRefusal, loadTrace2SkillFixture, operationsOf } from '../../benchmark/lib/trace2skill-fixture.ts';
import {
  buildTrace2SkillReport, executeSkillMode, failureCounts, heldOutRegressions, renderDocument, renderReport,
  reportCapabilities, requireCapability, resolveDeltas, scriptCoverage, summarizeRow,
  validateTrace2SkillReport, DOCUMENT_PATH, REPORT_PATH,
} from '../../benchmark/lib/trace2skill-report.ts';
import { createScriptedWire, executorUnit, registeredUnits } from '../../benchmark/lib/trace2skill-script.ts';
import {
  buildTrace2SkillLiveRecord, liveAuthorizationOf, renderLiveRecord, validateTrace2SkillLiveRecord,
  FROZEN_LIVE_ENV, LIVE_RECORD_PATH,
} from '../../benchmark/lib/trace2skill-live.ts';
import { readAiEnv } from '../../benchmark/lib/ai-env.ts';
import type { Condition, Row, Trace2skillReport } from '../../benchmark/lib/trace2skill.types.ts';
import type { Trace2skillLive } from '../../benchmark/lib/trace2skill-live.types.ts';

/** One row by condition. Positional indexes move whenever a table gains a row. */
const rowOf = (value: Trace2skillReport, prefix: 'deepening' | 'creation', condition: Condition): Row =>
  value.tables[prefix].find((entry) => entry.condition === condition) as Row;

const exec = promisify(execFile);
const files = [{ path: 'frozen', sha256: '1'.repeat(64) }];
const source = { files, sha256: await canonicalSha256({ files }) };
const report = await buildTrace2SkillReport({ source });

async function rehash(value: Trace2skillReport): Promise<Trace2skillReport> {
  const { reportId: _, ...rest } = value;
  value.reportId = await canonicalSha256(rest as unknown as Record<string, unknown>);
  return value;
}

/** Recompute every derived member, so a mutation is tested on its own merits. */
async function refresh(value: Trace2skillReport): Promise<Trace2skillReport> {
  value.tables.deepening = resolveDeltas(value.tables.deepening, 'frozen-s0');
  value.tables.creation = resolveDeltas(value.tables.creation, 'draft-s0');
  const rows = [...value.tables.deepening, ...value.tables.creation];
  value.failures = failureCounts(rows, value.issues);
  value.capabilities = reportCapabilities(rows, value.probes);
  value.envelope = analyticEnvelope(rows.map((row) => row.id));
  return rehash(value);
}

/** A frozen row promoted to a complete measurement, for the refusal tests. */
function fabricatedRun(value: Trace2skillReport): Row {
  const oracle = value.tables.deepening.find((row) => row.condition === 'oracle') as Row;
  return summarizeRow({
    id: 'deepening:frozen-s0', condition: 'frozen-s0', status: 'run', reason: null,
    skill: { bundleId: '2'.repeat(64), hash: '3'.repeat(64), mode: 'deepening' },
    tasks: structuredClone(oracle.tasks), calls: 8,
  });
}

describe('skill-evolution instrument', () => {
  it('two builds render byte-identically and the committed report carries no clock', async () => {
    const again = await buildTrace2SkillReport({ source });
    assert.equal(renderReport(again), renderReport(report));
    assert.equal(renderDocument(again), renderDocument(report));
    const committed = await readFile(REPORT_PATH, 'utf8');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(committed), 'the committed report holds a date');
    assert.ok(!/\d{2}:\d{2}:\d{2}/.test(committed), 'the committed report holds a time');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(await readFile(DOCUMENT_PATH, 'utf8')), 'the rendered document holds a date');
  });

  it('the committed report is exactly what the command produces', async () => {
    const fresh = await buildTrace2SkillReport();
    assert.equal(renderReport(fresh), await readFile(REPORT_PATH, 'utf8'));
    assert.equal(renderDocument(fresh), await readFile(DOCUMENT_PATH, 'utf8'));
  });

  it('the oracle reaches the analytic ceiling and the seeded row lands in its recorded band', async () => {
    const loaded = await loadTrace2SkillFixture();
    assert.equal(report.oracle.ceiling, 1);
    assert.equal(report.oracle.tasks, 8);
    for (const table of [report.tables.deepening, report.tables.creation]) {
      const oracle = table.find((row) => row.condition === 'oracle') as Row;
      assert.equal(oracle.status, 'run');
      assert.equal(oracle.metric.score, 1);
      assert.equal(oracle.metric.correct, 8);
      assert.equal(oracle.tasks.length, 8);
    }
    assert.deepEqual(report.oracle.band, loaded.oracle.randomBand);
    assert.equal(report.oracle.randomScore, loaded.oracle.randomDraw.score);
    assert.ok(report.oracle.randomScore >= report.oracle.band.low);
    assert.ok(report.oracle.randomScore <= report.oracle.band.high);
    assert.equal(report.oracle.inBand, true);
  });

  it('an evolve and test overlap is refused and counted', async () => {
    const loaded = await loadTrace2SkillFixture();
    const manifest = structuredClone(loaded.fixture);
    manifest.splits.evolve = [...manifest.splits.evolve, manifest.splits.test[0]];
    manifest.counts.evolve += 1;
    manifest.splits.evolveHash = await canonicalSha256([...manifest.splits.evolve].sort());
    const overlapped = await buildTrace2SkillReport({ source, manifest });
    assert.equal(overlapped.splits.disjoint, false);
    assert.equal(overlapped.splits.overlapRefused, 1);
    assert.equal(overlapped.capabilities.instrument, false);
    assert.throws(() => requireCapability(overlapped, 'instrument'), /capability unavailable/);
    assert.ok(overlapped.issues.some((issue) => issue.code === 'TT2S1006'));
    assert.ok((await validateTrace2SkillReport(overlapped, await loadTrace2SkillFixture({ manifest }))).valid);
    // Judged against the committed corpus instead, the same report is a
    // registration that does not describe it.
    assert.ok(!(await validateTrace2SkillReport(overlapped)).valid);
  });

  it('an attempted truth read outside evaluation is a counted leakage', async () => {
    const loaded = await loadTrace2SkillFixture();
    const adapter = await createFixtureAdapter(loaded);
    const task = loaded.splits.evolve[0];
    const leaked = adapter.executorTools(task).read_file(`truth/${task}.json`);
    assert.ok(isRefusal(leaked));
    assert.equal(leaked.code, 'TT2S1006');
    assert.equal(adapter.counts.leakage, 1);
    // The executor's prepared view never carries an answer to begin with.
    const prepared = adapter.prepare(task);
    assert.ok(!isRefusal(prepared));
    assert.ok(!JSON.stringify(prepared).includes('normalized'));
    // A row that leaked cannot also be a measurement.
    const mutated = structuredClone(report);
    const row = fabricatedRun(mutated);
    mutated.tables.deepening[1] = { ...row, counts: { ...row.counts, leakage: 1 } };
    assert.ok(!(await validateTrace2SkillReport(await refresh(mutated))).valid);
    // The registered answer is readable from evaluation and from repair.
    const verdict = adapter.evaluate(task, (loaded.readTruth('evaluate', task) as { answer: string }).answer);
    assert.ok(!isRefusal(verdict));
    assert.equal(verdict.label, 'correct');
    assert.equal(adapter.analystTools(task).truth_read(), (loaded.readTruth('evaluate', task) as { answer: string }).answer);
    assert.equal(adapter.counts.leakage, 1);
  });

  it('a missing script entry is a counted failure rather than a crash', async () => {
    const loaded = await loadTrace2SkillFixture();
    const trimmed = structuredClone(loaded.script);
    const dropped = trimmed.entries.pop();
    assert.ok(dropped !== undefined);
    const wire = await createScriptedWire(trimmed);
    const lookup = await wire.lookup(dropped.unit);
    assert.equal(lookup.found, false);
    assert.equal(wire.missing, 1);
    const row = summarizeRow({
      id: 'deepening:frozen-s0', condition: 'frozen-s0', status: 'not-run', reason: 'the scripted wire has no entry for one unit',
      skill: null, scriptMissing: 1,
      tasks: [{ taskId: 'task-01', label: 'failed', score: 0, stopReason: 'script-missing', turns: 0, tokens: 0 }],
    });
    assert.equal(row.counts.scriptMissing, 1);
    assert.equal(row.counts.failed, 1);
    assert.equal(row.metric.answered, 0);
    // The whole report survives a hole in the script and publishes it.
    const holed = await buildTrace2SkillReport({ source, script: trimmed });
    assert.ok(holed.issues.some((issue) => issue.detail.includes('no scripted entry')));
    assert.equal((holed.failures.find((failure) => failure.reason === 'fixture-issue') as { count: number }).count, 1);
    const coverage = await scriptCoverage({ ...loaded, script: trimmed });
    assert.equal(coverage.registered, registeredUnits(loaded.tasks, loaded.labels, loaded.tree).length);
    assert.equal(coverage.missing, 1);
  });

  it('the schema refuses a run row missing any identity member', async () => {
    const control = structuredClone(report);
    control.tables.deepening[1] = fabricatedRun(control);
    assert.ok((await validateTrace2SkillReport(await refresh(control))).valid, 'the fabricated control must itself validate');
    const mutations: Array<[string, (value: Trace2skillReport) => void]> = [
      ['skill', (value) => { value.tables.deepening[1] = { ...value.tables.deepening[1], skill: null }; }],
      ['identity.model', (value) => { delete (value.identity as Partial<Trace2skillReport['identity']>).model; }],
      ['identity.promptVersions', (value) => { delete (value.identity as Partial<Trace2skillReport['identity']>).promptVersions; }],
      ['identity.toolManifestHash', (value) => { delete (value.identity as Partial<Trace2skillReport['identity']>).toolManifestHash; }],
      ['identity.evaluatorId', (value) => { delete (value.identity as Partial<Trace2skillReport['identity']>).evaluatorId; }],
      ['identity.budgets', (value) => { delete (value.identity as Partial<Trace2skillReport['identity']>).budgets; }],
      ['splits', (value) => { delete (value as Partial<Trace2skillReport>).splits; }],
      ['cost', (value) => { delete (value.tables.deepening[1] as Partial<Row>).cost; }],
    ];
    for (const [name, mutate] of mutations) {
      const copy = structuredClone(control);
      mutate(copy);
      const outcome = await validateTrace2SkillReport(await rehash(copy));
      assert.ok(!outcome.valid, `a run row survived without ${name}`);
    }
  });

  it('the report refuses forged totals, hidden failures and false capabilities', async () => {
    const mutations: Array<(value: Trace2skillReport) => void> = [
      (value) => { rowOf(value, 'deepening', 'oracle').metric.correct += 1; },
      (value) => { rowOf(value, 'deepening', 'oracle').tasks.pop(); },
      (value) => { rowOf(value, 'deepening', 'random').metric.score = 1; },
      (value) => { rowOf(value, 'deepening', 'cross-model').status = 'run'; },
      (value) => { value.capabilities.complete = false; },
      (value) => { value.ablations.entries[0].score = 1; },
      (value) => { value.ablations.entries[0].vsEvolved = 1; },
      (value) => { value.ablations.entries[1].sameDirectoryAsMethod = false; },
      (value) => { value.ablations.entries[1].candidateBundleId = '0'.repeat(64); },
      (value) => { value.ablations.entries[1].candidateId = null; },
      (value) => { value.ablations.entries[0].sameDirectoryAsMethod = true; },
      (value) => { value.ablations.entries[2].status = 'not-run'; },
      (value) => { value.ablations.method.withheld += 1; },
      (value) => { value.ablations.method.candidateBundleId = '0'.repeat(64); },
      (value) => { value.capabilities.instrument = false; },
      (value) => { value.failures = value.failures.map((failure) => ({ ...failure, count: failure.count + 1 })); },
      (value) => { value.probes[0].state = 'pass'; value.probes[0].observed = { drift: 9 }; },
      (value) => { value.fixtureId = '0'.repeat(64); },
      (value) => { value.source.sha256 = '0'.repeat(64); },
      (value) => { rowOf(value, 'deepening', 'cross-model').reason = null; },
      (value) => { value.oracle.ceiling = 0.5; },
      (value) => { value.registrationId = '0'.repeat(64); },
      (value) => { value.identity.seed = 1; },
      (value) => { value.probes[0].id = 'unregistered'; },
      (value) => { value.identity.promptVersions.merge = '0'.repeat(64); },
      (value) => { value.identity.promptVersions.draft = 'draft-1'; },
      (value) => {
        const packs = value.probes.find((probe) => probe.id === 'versioned-prompt-packs') as Trace2skillReport['probes'][number];
        packs.observed = { packs: 5 };
        value.identity.promptVersions.executor = '1'.repeat(64);
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(report);
      mutate(copy);
      assert.ok(!(await validateTrace2SkillReport(await rehash(copy))).valid, 'a forged report validated');
    }
    assert.ok((await validateTrace2SkillReport(report)).valid);
  });

  it('every row that did not run says so honestly, and the capability gates follow the rows', () => {
    const rows = [...report.tables.deepening, ...report.tables.creation];
    // Transfer needs a second model or a second adapter and this instrument
    // builds neither; creation registers no evolve trajectory, so it stages no
    // candidate. All three are planned non-executions, not missing mechanisms.
    const unrun = ['deepening:cross-model', 'deepening:ood', 'creation:evolved-s-star'];
    for (const row of rows.filter((entry) => unrun.includes(entry.id))) {
      assert.equal(row.status, 'not-run', row.id);
      assert.deepEqual(row.tasks, []);
      assert.equal(row.metric.score, null);
      assert.deepEqual(row.deltas, { vsNoSkill: null, vsS0: null });
      assert.equal(row.cost.calls, 0);
      assert.ok(typeof row.reason === 'string' && row.reason.length > 0, row.id);
    }
    assert.deepEqual(rows.filter((row) => row.status === 'not-run').map((row) => row.id), unrun);
    assert.equal(rows.filter((row) => row.status === 'implementation-missing').length, 0);
    assert.deepEqual(report.capabilities, {
      instrument: true, contracts: true, rollouts: true, analysts: true,
      consolidation: true, evaluation: true, packs: true, complete: true,
    });
    assert.doesNotThrow(() => requireCapability(report, 'complete'));
    assert.throws(() => requireCapability(report, 'unknown'), /unknown skill-evolution requirement/);
    for (const probe of report.probes) {
      assert.equal(probe.state, 'pass', probe.id);
      assert.deepEqual(probe.observed, probe.expected, probe.id);
    }
    // A row a mechanism has not been built for is still a different thing, and
    // the gate still falls when one appears.
    const unbuilt = structuredClone(report);
    rowOf(unbuilt, 'deepening', 'ood').status = 'implementation-missing';
    assert.equal(reportCapabilities([...unbuilt.tables.deepening, ...unbuilt.tables.creation], unbuilt.probes).complete, false);
  });

  it('every ablation publishes its loss beside the method it removed a part of', () => {
    assert.equal(report.ablations.mode, 'deepening');
    assert.equal(report.ablations.method.candidateBundleId, report.consolidation.bundleId);
    assert.deepEqual(report.ablations.entries.map((entry) => entry.condition),
      ['retrieval-bank', 'single-call-error', 'sequential-merge']);
    const evolved = rowOf(report, 'deepening', 'evolved-s-star');
    for (const entry of report.ablations.entries) {
      const row = rowOf(report, 'deepening', entry.condition);
      assert.equal(entry.status, 'run', entry.condition);
      assert.equal(row.status, 'run', entry.condition);
      assert.equal(entry.score, row.metric.score, entry.condition);
      assert.equal(entry.vsEvolved, (row.metric.score as number) - (evolved.metric.score as number), entry.condition);
      assert.equal(row.tasks.length, 8, entry.condition);
      assert.ok(entry.replaces.length > 0, entry.condition);
      assert.ok(entry.counters.length > 0, entry.condition);
      assert.equal(new Set(entry.counters.map((count) => count.name)).size, entry.counters.length, entry.condition);
    }
    const bank = report.ablations.entries[0];
    const single = report.ablations.entries[1];
    const sequential = report.ablations.entries[2];
    const count = (entry: typeof bank, name: string): number =>
      entry.counters.find((value) => value.name === name)?.value as number;
    // The bank is the paper's retrieval baseline and it loses: it preloads no
    // directory and its records are diagnoses, so it earns the no-skill score.
    assert.equal(bank.candidateBundleId, null);
    assert.equal(bank.sameDirectoryAsMethod, false);
    assert.equal(bank.score, rowOf(report, 'deepening', 'no-skill').metric.score);
    assert.equal(bank.vsEvolved, -0.25);
    // Its similarity gate selected nothing: every held-out task retrieved the
    // whole bank, which is the honest reason the row loses.
    assert.equal(count(bank, 'emptyRetrievals'), 0);
    assert.equal(count(bank, 'retrieved'), count(bank, 'bankSkills') * 8);
    // The two consolidation ablations reach the directory the method reaches,
    // so what separates them is proof and cost, not a held-out number.
    for (const entry of [single, sequential]) {
      assert.equal(entry.sameDirectoryAsMethod, true, entry.condition);
      assert.equal(entry.candidateBundleId, report.ablations.method.candidateBundleId, entry.condition);
      assert.notEqual(entry.candidateId, report.ablations.method.candidateId, entry.condition);
      assert.equal(entry.vsEvolved, 0, entry.condition);
    }
    // Removing the evaluator buys a proposal on every failing trajectory; the
    // shared gate refuses the one the proven role excluded.
    assert.equal(count(single, 'proposed'), count(single, 'provenByMethod') + 1);
    assert.equal(count(single, 'refusedByGate'), 1);
    assert.equal(count(single, 'notProvenByMethod'), 1);
    assert.equal(count(single, 'unprovenPatches'), count(single, 'patches'));
    assert.ok(single.cost.calls < count(single, 'methodAnalystCalls'), 'the single call did not cost less than the loop');
    // Folding costs one merge per patch after the first, against the tree's groups.
    assert.equal(count(sequential, 'foldSteps'), count(sequential, 'pool') - 1);
    assert.ok(count(sequential, 'foldSteps') > count(sequential, 'methodGroups'));
    assert.equal(count(sequential, 'applications'), 1);
    assert.equal(count(sequential, 'withheld'), count(sequential, 'methodWithheld'));
  });

  it('the executed rows reproduce the registered held-out scores and their labels', async () => {
    const loaded = await loadTrace2SkillFixture();
    for (const [prefix, baseline] of [['deepening', 'frozen-s0'], ['creation', 'draft-s0']] as const) {
      const registered = loaded.oracle.heldOut[prefix] as unknown as Record<string, number>;
      const measured: Condition[] = prefix === 'deepening' ? ['no-skill', baseline, 'evolved-s-star'] : ['no-skill', baseline];
      for (const condition of measured) {
        const row = report.tables[prefix].find((entry) => entry.condition === condition) as Row;
        assert.equal(row.status, 'run', row.id);
        assert.equal(row.reason, null);
        assert.equal(row.tasks.length, 8, row.id);
        assert.equal(row.metric.score, registered[condition], row.id);
        assert.equal(row.cost.calls > 0, true, row.id);
        assert.equal(row.cost.live, false);
        assert.equal(row.counts.leakage, 0);
        for (const task of row.tasks) assert.equal(task.stopReason, 'complete', `${row.id}:${task.taskId}`);
        assert.equal(row.skill === null, condition === 'no-skill', row.id);
      }
      // Deltas are signed against this table's own baselines, losses included.
      const rows = report.tables[prefix].filter((entry) => entry.status === 'run');
      assert.ok(rows.every((entry) => entry.deltas.vsNoSkill !== null && entry.deltas.vsS0 !== null));
    }
    const frozen = report.tables.deepening.find((row) => row.condition === 'frozen-s0') as Row;
    assert.equal(frozen.skill?.bundleId, loaded.fixture.s0.bundleId);
    assert.equal(frozen.skill?.hash, loaded.fixture.s0.rootHash);
    assert.equal(frozen.deltas.vsNoSkill, 0.125);

    // The evolve half's labels are the registered ones, task by task.
    const distribution = report.probes.find((probe) => probe.id === 'evolve-label-distribution');
    const incorrect = new Set(loaded.labels.modes.deepening.conditions['frozen-s0'].incorrect);
    const evolve = loaded.splits.evolve;
    const budget = new Set(loaded.labels.budgetTasks);
    assert.deepEqual(distribution?.observed, {
      success: evolve.filter((id) => !incorrect.has(id) && !budget.has(id)).length,
      failure: evolve.filter((id) => incorrect.has(id) && !budget.has(id)).length,
      unanswered: evolve.filter((id) => budget.has(id)).length,
    });
    assert.deepEqual(report.probes.find((probe) => probe.id === 'labeled-rollout-envelope')?.observed,
      { rollouts: evolve.length, reasoningCaptured: true });
    // The prompt version a row's key names IS the compiled pack's revision.
    assert.deepEqual(report.identity.promptVersions.executor, trace2SkillPrompt('executor').revision);
    assert.deepEqual(report.identity.promptVersions.draft, trace2SkillPrompt('draft').revision);
  });

  it('the stored labels reproduce the adapter oracle task by task', async () => {
    const loaded = await loadTrace2SkillFixture();
    const executed = await executeSkillMode(loaded, 'deepening');
    assert.equal(executed.rollouts.length, loaded.splits.evolve.length);
    const incorrect = new Set(loaded.labels.modes.deepening.conditions['frozen-s0'].incorrect);
    const budget = new Set(loaded.labels.budgetTasks);
    for (const rollout of executed.rollouts) {
      const expected = budget.has(rollout.taskId) ? 'unanswered' : incorrect.has(rollout.taskId) ? 'failure' : 'success';
      assert.equal(rollout.label, expected, rollout.taskId);
      assert.equal(rollout.s0Hash, loaded.fixture.s0.bundleId, rollout.taskId);
      assert.equal(rollout.condition, 'frozen-s0');
      assert.equal(rollout.attempt, 1);
      assert.ok(rollout.reasoning.length > 0, `${rollout.taskId} kept no per-turn reasoning`);
      assert.equal(rollout.spend.calls > 0, true);
    }
    const stopped = executed.rollouts.find((rollout) => rollout.taskId === loaded.labels.budgetTasks[0]);
    assert.equal(stopped?.stopReason, 'budget-turns');
    assert.equal(stopped?.finalAnswer, '');
    assert.equal(stopped?.spend.calls, loaded.labels.turns.budget);
    assert.deepEqual(executed.issues, []);
  });

  it('each repairable rollout yields one evaluator-proven patch and the unrepairable one yields none', async () => {
    const loaded = await loadTrace2SkillFixture();
    const executed = await executeSkillMode(loaded, 'deepening');
    const fan = executed.analysts;
    assert.ok(fan !== null, 'the deepening mode analyses its own rollouts');
    assert.deepEqual(fan.issues, []);
    assert.equal(fan.counts.peerPatchesSeen, 0);
    assert.equal(fan.counts.baseHashMismatches, 0);
    assert.equal(fan.counts.refused, 0);

    const byTask = new Map(fan.units.map((unit) => [unit.taskId, unit]));
    const patches = new Map(fan.patches.map((patch) => [patch.id, patch]));
    for (const taskId of loaded.fixture.rollouts.repairable) {
      const unit = byTask.get(taskId);
      assert.ok(unit !== undefined, taskId);
      assert.equal(unit.role, 'error', taskId);
      const result = unit.result;
      assert.ok(result !== null, taskId);
      assert.equal(result.status, 'patch', taskId);
      assert.equal(result.exclusion, null, taskId);
      assert.ok(result.repair !== null, taskId);
      assert.equal(result.repair.attempts, 1, taskId);
      assert.equal(result.repair.evaluation.score, 1, `${taskId} stored a proof that did not pass`);
      const diagnosis = JSON.parse(result.diagnosis) as { failingStepIndexes: number[], evaluation: number };
      assert.ok(diagnosis.failingStepIndexes.length > 0, `${taskId} cites no failing span`);
      assert.equal(diagnosis.evaluation, 1, taskId);
      const patch = patches.get(result.patchId ?? '');
      assert.ok(patch !== undefined, taskId);
      assert.equal(patch.baseHash, loaded.fixture.s0.bundleId, taskId);
      assert.deepEqual(patch.sourceRolloutIds, [result.rolloutId], taskId);
      assert.deepEqual(patch.sourcePatchIds, [], `${taskId} built on a peer patch`);
      // The proven edits are the ones the corpus registered for this task.
      const registered = loaded.patches.find((document) => document.id === loaded.labels.analystPatches[taskId as keyof typeof loaded.labels.analystPatches]);
      assert.ok(registered !== undefined, taskId);
      assert.deepEqual(patch.operations, operationsOf(registered), taskId);
    }
    for (const taskId of loaded.fixture.rollouts.unrepairable) {
      const result = byTask.get(taskId)?.result;
      assert.ok(result !== null && result !== undefined, taskId);
      assert.equal(result.status, 'excluded', taskId);
      assert.equal(result.exclusion, 'exhausted', taskId);
      assert.equal(result.patchId, null, taskId);
      assert.ok(result.spend.calls > 0, `${taskId} lost the spend it incurred`);
    }
    // Every success is one call, and no success rollout reaches the repair surface.
    for (const unit of fan.units.filter((entry) => entry.role === 'success')) {
      assert.equal(unit.result?.spend.calls, 1, unit.taskId);
      assert.equal(unit.result?.repair, null, unit.taskId);
    }
  });

  it('the analyst block publishes both roles and every exclusion reason, zeros included', async () => {
    const loaded = await loadTrace2SkillFixture();
    assert.equal(report.analysts.mode, 'deepening');
    assert.deepEqual(report.analysts.roles.map((role) => role.role), ['success', 'error']);
    assert.equal(report.analysts.roles.reduce((total, role) => total + role.analyzed, 0), loaded.splits.evolve.length);
    assert.equal(report.analysts.exclusions.length, 6);
    assert.ok(report.analysts.exclusions.some((exclusion) => exclusion.count === 0), 'a reason nobody reached is still published');
    assert.equal(report.analysts.patches, report.analysts.roles.reduce((total, role) => total + role.patches, 0));
    const errors = report.analysts.roles.find((role) => role.role === 'error');
    assert.equal(errors?.patches, loaded.fixture.rollouts.repairable.length);
    assert.equal(errors?.excluded, loaded.fixture.rollouts.unrepairable.length);
    assert.ok((errors?.tokens ?? 0) > 0, 'the repair role reports what it spent');
    assert.equal(report.identity.promptVersions.successAnalyst, trace2SkillPrompt('success-analyst').revision);
    assert.equal(report.identity.promptVersions.errorAnalyst, trace2SkillPrompt('error-analyst').revision);

    const rendered = renderDocument(report);
    assert.ok(rendered.includes('## Analysts — patches beside exclusions'));
    for (const exclusion of report.analysts.exclusions) assert.ok(rendered.includes(exclusion.reason), exclusion.reason);
    assert.ok(rendered.includes('Isolation counters'));
  });

  it('the packs the roles render through are published beside the versions their keys name', async () => {
    const probe = report.probes.find((entry) => entry.id === 'versioned-prompt-packs');
    assert.equal(probe?.state, 'pass');
    assert.deepEqual(probe?.observed, { packs: 5 });
    assert.equal(report.capabilities.packs, true);
    for (const [role, key] of [['draft', 'draft'], ['executor', 'executor'], ['success-analyst', 'successAnalyst'],
      ['error-analyst', 'errorAnalyst'], ['merge', 'merge']] as const) {
      assert.equal(report.identity.promptVersions[key], trace2SkillPrompt(role).revision, role);
      assert.match(report.identity.promptVersions[key], /^[a-f0-9]{64}$/);
    }
    const rendered = renderDocument(report);
    assert.ok(rendered.includes('## Prompt packs'));
    for (const role of ['draft', 'executor', 'success-analyst', 'error-analyst', 'merge']) {
      assert.ok(rendered.includes(`| ${role} |`), role);
    }
    assert.ok(rendered.includes('legacy-packs/'), 'the document does not say where the retired packs live');
  });

  it('the committed pool produces the registered merge tree and exactly one staged directory', async () => {
    const loaded = await loadTrace2SkillFixture();
    const block = report.consolidation;
    assert.equal(block.mode, 'deepening');
    assert.equal(block.terminal, 'hierarchical');
    assert.equal(block.bMerge, loaded.tree.bMerge);
    assert.equal(block.lMax, loaded.tree.lMax);
    assert.equal(block.levels, loaded.tree.levels.length);
    assert.equal(block.groups, loaded.tree.levels.reduce((total, level) => total + level.groups.length, 0));
    assert.deepEqual(block.nodes.map((node) => [node.level, node.groupIndex, node.inputs]),
      loaded.tree.levels.flatMap((level) => level.groups.map((group, index) => [level.level, index + 1, group.members.length])));
    assert.equal(block.supportCount, loaded.tree.uniqueRolloutSupport);
    assert.equal(block.applications, 1, 'the run applies one patch once');
    assert.equal(block.unattributed, 0, 'every retained edit names a trajectory');
    assert.equal(block.withheldHunks, 0);
    assert.equal(block.discarded, block.nodes.reduce((total, node) => total + node.withheld, 0));
    assert.equal(block.changelog.length, 4);
    assert.ok(block.changelog.some((entry) => entry.count === 0), 'a decision nobody made is still published');
    assert.ok(block.candidateId !== null && block.bundleId !== null && block.finalPatchId !== null);
    assert.equal(block.calls, block.nodes.length, 'one structured call per merge group');
    assert.equal(report.identity.promptVersions.merge, trace2SkillPrompt('merge').revision);

    // The evolved row is scored with the directory the run actually staged.
    const evolved = report.tables.deepening.find((row) => row.condition === 'evolved-s-star') as Row;
    assert.equal(evolved.status, 'run');
    assert.equal(evolved.skill?.bundleId, block.bundleId);
    assert.notEqual(evolved.skill?.bundleId, loaded.fixture.s0.bundleId);

    const executed = await executeSkillMode(loaded, 'deepening');
    const staged = executed.consolidation?.snapshot;
    assert.ok(staged !== undefined && staged !== null);
    assert.equal(staged.bundle.origin, 'evolved');
    assert.equal(staged.bundle.status, 'staged');
    assert.equal(staged.bundle.parentId, loaded.fixture.s0.bundleId);
    assert.ok(staged.files.some((file) => file.path === 'references/units.md'), 'the created reference page landed');
    assert.deepEqual(executed.consolidation?.fanOut.nodes.map((node) => node.outputPatchId !== null), [true, true, true]);
  });

  it('the consolidation section publishes the tree, the decisions and the withheld conflicts', () => {
    const rendered = renderDocument(report);
    assert.ok(rendered.includes('## Consolidation — one patch, applied once'));
    for (const entry of report.consolidation.changelog) assert.ok(rendered.includes(entry.action), entry.action);
    assert.ok(rendered.includes('Conflicts withheld by a merge group'));
    assert.ok(rendered.includes('retained edits naming no trajectory'));
    assert.ok(rendered.includes((report.consolidation.candidateId ?? '').slice(0, 12)));
    assert.ok(rendered.includes('- deepening: no held-out task scores lower with `evolved-s-star`'));
    // A row nobody ran has no comparison; claiming it lost nothing would be a
    // mechanism claim about a mechanism this mode never exercised.
    assert.ok(rendered.includes('- creation: `evolved-s-star` did not run, so no comparison'));
  });

  it('a consolidation counter that disagrees with its probe or its nodes is not a report', async () => {
    const forgedPlan = structuredClone(report);
    forgedPlan.consolidation.levels += 1;
    assert.ok(!(await validateTrace2SkillReport(await rehash(forgedPlan))).valid);

    const forgedApplication = structuredClone(report);
    forgedApplication.consolidation.applications = 0;
    assert.ok(!(await validateTrace2SkillReport(await rehash(forgedApplication))).valid);

    const hiddenConflict = structuredClone(report);
    hiddenConflict.consolidation.discarded = 0;
    assert.ok(!(await validateTrace2SkillReport(await rehash(hiddenConflict))).valid);

    const orphan = structuredClone(report);
    orphan.consolidation.candidateId = null;
    assert.ok(!(await validateTrace2SkillReport(await rehash(orphan))).valid);
  });

  it('the held-out verdict is eligible, activates once and every refusal leaves the head alone', () => {
    const block = report.evaluation;
    assert.equal(block.mode, 'deepening');
    assert.equal(block.tasks, report.splits.test);
    assert.equal(block.answered, block.tasks);
    assert.equal(block.candidateBundleId, report.consolidation.bundleId);
    assert.equal(block.baselineBundleId, report.tables.deepening.find((row) => row.condition === 'frozen-s0')?.skill?.bundleId);
    assert.ok(block.meanDelta !== null && block.meanDelta > 0, 'the candidate improves the primary metric');
    assert.equal(block.eligible, true);
    assert.deepEqual(block.clauses, []);
    assert.deepEqual(block.regressions, []);
    assert.equal(block.policy.primaryMetric, 'mean-score');
    assert.equal(block.activations.activated, 1);
    assert.equal(block.activations.refused, 5);
    assert.equal(block.activations.attempted, 6);
    assert.equal(block.activations.revision, block.activations.previousRevision + 1);
    assert.equal(block.activations.versionId, block.candidateBundleId);
    assert.deepEqual(block.refusals.map((refusal) => refusal.scenario),
      ['regressing', 'under-covered', 'over-budget', 'evaluation-failed', 'stale-parent']);
    assert.deepEqual(block.refusals.map((refusal) => refusal.clause),
      ['/meanDelta', '/minAnsweredCoverage', '/costCeiling', '/leakage', '/parentId']);
    assert.ok(block.refusals.every((refusal) => refusal.refused && refusal.headUnchanged && refusal.priorReadable));
    assert.equal(block.refusals.find((refusal) => refusal.scenario === 'evaluation-failed')?.code, 'TT2S1006');
    // The held-out row the table publishes is the one the verdict was computed from.
    const evolved = report.tables.deepening.find((row) => row.condition === 'evolved-s-star') as Row;
    assert.equal(evolved.tasks.length, block.tasks);
  });

  it('the same run driven again spends nothing and stages the same candidate', () => {
    const block = report.evaluation;
    assert.equal(block.drives, 2);
    assert.equal(block.resumedCalls, 0);
    assert.equal(block.resumedWritten, 0);
    assert.equal(block.candidateStable, true);
  });

  it('the evaluation section publishes the gate, the losses and the refusal matrix', () => {
    const rendered = renderDocument(report);
    assert.ok(rendered.includes('## Held-out evaluation and activation'));
    assert.ok(rendered.includes('Eligibility comes only from the held-out split'));
    assert.ok(rendered.includes('Activation is a separate explicit call, never a stage'));
    for (const refusal of report.evaluation.refusals) assert.ok(rendered.includes(refusal.scenario), refusal.scenario);
    assert.ok(rendered.includes('No held-out task scores lower with the candidate'));
    assert.ok(rendered.includes('the five refused candidates are scripted'));
  });

  it('an activation counter that disagrees with its probe or its verdict is not a report', async () => {
    const forgedActivation = structuredClone(report);
    forgedActivation.evaluation.activations.activated = 0;
    assert.ok(!(await validateTrace2SkillReport(await rehash(forgedActivation))).valid);

    const hiddenClause = structuredClone(report);
    hiddenClause.evaluation.clauses = [{ code: 'TT2S1010', clause: '/meanDelta', detail: 'hidden' }];
    assert.ok(!(await validateTrace2SkillReport(await rehash(hiddenClause))).valid);

    const movedHead = structuredClone(report);
    movedHead.evaluation.activations.revision += 1;
    assert.ok(!(await validateTrace2SkillReport(await rehash(movedHead))).valid);

    const otherDirectory = structuredClone(report);
    otherDirectory.evaluation.candidateBundleId = '4'.repeat(64);
    assert.ok(!(await validateTrace2SkillReport(await rehash(otherDirectory))).valid);

    const unauthorized = structuredClone(report);
    unauthorized.evaluation.eligible = false;
    assert.ok(!(await validateTrace2SkillReport(await rehash(unauthorized))).valid);
  });

  it('an analyst counter that disagrees with its probe is not a report', async () => {
    const forged = structuredClone(report);
    forged.analysts.peerPatchesSeen = 1;
    assert.ok(!(await validateTrace2SkillReport(await rehash(forged))).valid);
    const inflated = structuredClone(report);
    const errors = inflated.analysts.roles.find((role) => role.role === 'error');
    assert.ok(errors !== undefined);
    errors.patches += 1;
    inflated.analysts.patches += 1;
    assert.ok(!(await validateTrace2SkillReport(await rehash(inflated))).valid);
  });

  it('a table without its own baseline row is not a report', async () => {
    for (const [prefix, baseline] of [['deepening', 'frozen-s0'], ['creation', 'draft-s0']] as const) {
      const dropped = structuredClone(report);
      dropped.tables[prefix] = dropped.tables[prefix].filter((row) => row.condition !== baseline);
      assert.ok(!(await validateTrace2SkillReport(await refresh(dropped))).valid, `${prefix} survived without ${baseline}`);
      // A candidate cannot be measured against a baseline that never ran.
      const unrun = structuredClone(report);
      const row = unrun.tables[prefix].find((entry) => entry.condition === baseline) as Row;
      Object.assign(row, summarizeRow({
        id: row.id, condition: row.condition, status: 'implementation-missing',
        reason: 'the starting directory was not executed', skill: null, tasks: [],
      }));
      const star = unrun.tables[prefix].find((entry) => entry.condition === 'evolved-s-star') as Row;
      Object.assign(star, summarizeRow({
        id: star.id, condition: 'evolved-s-star', status: 'run', reason: null,
        skill: { bundleId: '4'.repeat(64), hash: '5'.repeat(64), mode: prefix },
        tasks: structuredClone((report.tables[prefix].find((entry) => entry.condition === 'oracle') as Row).tasks), calls: 8,
      }));
      assert.ok(!(await validateTrace2SkillReport(await refresh(unrun))).valid, `${prefix} claimed a candidate without its baseline`);
    }
  });

  it('the document publishes the per-task losses beside the wins', async () => {
    const document = await readFile(DOCUMENT_PATH, 'utf8');
    assert.ok(document.includes('## Where a starting directory loses'));
    for (const [prefix, condition] of [['deepening', 'frozen-s0'], ['creation', 'draft-s0']] as const) {
      const losses = heldOutRegressions(report.tables[prefix], condition);
      assert.equal(losses.length, 0, 'this corpus registers no held-out regression');
      assert.ok(document.includes(`- ${prefix}: no held-out task scores lower with \`${condition}\``));
    }
    // A row that did lose is rendered task by task rather than averaged away.
    const worse = structuredClone(report.tables.deepening);
    const noSkill = worse.find((row) => row.condition === 'no-skill') as Row;
    const frozen = worse.find((row) => row.condition === 'frozen-s0') as Row;
    const won = noSkill.tasks.find((task) => task.score === 1) as Row['tasks'][number];
    frozen.tasks = frozen.tasks.map((task) => task.taskId === won.taskId ? { ...task, label: 'incorrect', score: 0 } : task);
    assert.deepEqual(heldOutRegressions(worse, 'frozen-s0'), [{ taskId: won.taskId, baseline: 1, candidate: 0 }]);
  });

  it('the committed report publishes every counter and names its analysis-only status', async () => {
    assert.deepEqual(report.failures.map((failure) => failure.reason),
      ['unanswered', 'excluded', 'failed', 'leakage', 'withheld', 'script-missing', 'fixture-issue']);
    for (const row of [...report.tables.deepening, ...report.tables.creation]) {
      assert.deepEqual(Object.keys(row.counts).sort(), ['excluded', 'failed', 'leakage', 'scriptMissing', 'unanswered', 'withheld']);
      assert.equal(row.cost.live, false);
    }
    const envelope = report.envelope as { identities: unknown[], rows: Array<{ identityStatus: string }> };
    assert.equal(envelope.identities.length, 0);
    assert.equal(envelope.rows.length, 15);
    for (const row of envelope.rows) assert.equal(row.identityStatus, 'not-run');
    const document = await readFile(DOCUMENT_PATH, 'utf8');
    assert.ok(document.includes('measure fixture sensitivity'));
    assert.ok(document.includes('not model quality'));
    assert.ok(document.includes('no improvement is claimed'));
    assert.ok(document.includes('## Ablations — the method with one part removed'));
    assert.ok(document.includes('No ablation scores higher than the method on this corpus.'));
    for (const entry of report.ablations.entries) assert.ok(document.includes(`\`${entry.condition}\` replaces `), entry.condition);
    // Transfer language may not appear in a product document while its rows are
    // not run; the benchmark document may name them only as unmeasured.
    assert.ok(document.includes('cross-model'));
    assert.ok(report.limitations.some((line) => line.includes('Transfer is unmeasured')));
  });

  it('transfer language appears in a product document only beside the row status that carries it', async () => {
    const rows = new Map(report.tables.deepening.map((row) => [row.condition as string, row.status]));
    assert.equal(rows.get('cross-model'), 'not-run');
    assert.equal(rows.get('ood'), 'not-run');
    // The product documents say what IS. The roadmap is open work by
    // definition and is excluded deliberately: every sentence in it names
    // something the repository does not have yet.
    const documents = ['packages/trace2skill/README.md', 'docs/PAPERS.md', 'docs/ARCHITECTURE.md', 'docs/BOUNDARY.md'];
    const unmeasured = /\bnot[- ]run\b|\bunmeasured\b|\bnot\b/i;
    let hits = 0;
    for (const path of documents) {
      const text = await readFile(path, 'utf8');
      // Sentences, not lines: a wrapped paragraph would otherwise let the
      // qualification sit on a different line from the claim.
      for (const sentence of text.replace(/\s+/g, ' ').split(/(?<=[.:])\s/)) {
        if (!/cross-model|out-of-distribution/i.test(sentence)) continue;
        hits++;
        assert.ok(unmeasured.test(sentence), `${path}: unqualified transfer claim — ${sentence.slice(0, 160)}`);
      }
    }
    assert.ok(hits > 0, 'no document mentions transfer at all, so the gate proved nothing');
  });

  it('the retrieval bank is the only clustering consumer and the evolve path retrieves nothing', async () => {
    const roots = ['benchmark/lib', 'packages/trace2skill/src'];
    const clustering: string[] = [];
    const retrieving: string[] = [];
    for (const root of roots) {
      for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const path = join(entry.parentPath, entry.name);
        if (root === 'benchmark/lib' && !entry.name.startsWith('trace2skill')) continue;
        const text = await readFile(path, 'utf8');
        if (text.includes('kMeans')) clustering.push(path);
        if (/recallSkills|retrieval:/.test(text)) retrieving.push(path);
      }
    }
    // One file, not one line: importing the kernel and calling it is two.
    assert.deepEqual(clustering, ['benchmark/lib/trace2skill-ablations.ts']);
    assert.deepEqual(retrieving, ['benchmark/lib/trace2skill-ablations.ts']);
  });

  it('the live tier is a frozen registration that spends nothing', async () => {
    const committed = JSON.parse(await readFile(LIVE_RECORD_PATH, 'utf8')) as Trace2skillLive;
    const loaded = await loadTrace2SkillFixture();
    const built = await buildTrace2SkillLiveRecord({ loaded, report: await buildTrace2SkillReport() });
    assert.equal(renderLiveRecord(built), await readFile(LIVE_RECORD_PATH, 'utf8'));
    assert.equal(committed.status, 'not-run');
    assert.equal(committed.calls, 0);
    assert.deepEqual(committed.spend, { calls: 0, tokens: 0 });
    assert.equal(committed.plan.authorized, false);
    assert.match(committed.plan.planId, /^[0-9a-f]{64}$/);
    assert.equal(committed.plan.keySource, 'OPENROUTER_AI_KEY');
    assert.ok((await validateTrace2SkillLiveRecord(committed)).valid);
    // No credential and no environment reading: the committed bytes are the
    // ones an unconfigured clone renders.
    assert.equal(FROZEN_LIVE_ENV.live, false);
    assert.ok(!renderLiveRecord(committed).includes('apiKey'));
    assert.equal(committed.plan.maxFreshTotal, committed.plan.rows.reduce((total, row) => total + row.maxFreshCalls, 0));
    assert.equal(committed.plan.rows.filter((row) => row.status === 'not-run').length, 3);
    // A forged record is refused: identity covers the whole plan.
    for (const mutate of [
      (value: Trace2skillLive) => { value.plan.maxCalls = 9999; },
      (value: Trace2skillLive) => { value.plan.rows[0].maxFreshCalls += 1; },
      (value: Trace2skillLive) => { value.plan.planId = '0'.repeat(64); },
    ]) {
      const copy = structuredClone(committed);
      mutate(copy);
      assert.ok(!(await validateTrace2SkillLiveRecord(copy)).valid, 'a forged live record validated');
    }
    // `--authorize` is the only door and a mismatched id is refused before any
    // ceiling is considered; a matching one reaches nothing.
    const keyed = await buildTrace2SkillLiveRecord({
      loaded, report, env: readAiEnv({ OPENROUTER_AI_KEY: 'not-a-real-key', TANGLE_AI_MODEL: 'test/model' }),
    });
    assert.notEqual(keyed.plan.planId, committed.plan.planId);
    assert.ok(!renderLiveRecord(keyed).includes('not-a-real-key'));
    assert.equal(keyed.status, 'not-run');
    assert.equal(liveAuthorizationOf(keyed.plan, 'wrong-id'), 'refused');
    assert.equal(liveAuthorizationOf(keyed.plan, undefined), keyed.plan.skipped === null ? 'dry-run' : 'skipped');
    assert.equal(liveAuthorizationOf({ ...keyed.plan, skipped: null }, keyed.plan.planId), 'unimplemented');
  });

  it('no provider request is possible and the trap is reached by zero calls', async () => {
    const original = globalThis.fetch;
    let outside = 0;
    globalThis.fetch = (async () => { outside++; throw new Error('network forbidden'); }) as typeof fetch;
    try {
      const built = await buildTrace2SkillReport({ source });
      const probe = built.probes.find((entry) => entry.id === 'no-provider-request-possible');
      assert.deepEqual(probe?.observed, { calls: 0 });
      assert.equal(probe?.state, 'pass');
      assert.equal(outside, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('the registered corpus, patch pool and merge tree agree with the fixture', async () => {
    const loaded = await loadTrace2SkillFixture();
    assert.deepEqual(loaded.issues, []);
    assert.equal(loaded.tasks.length, 24);
    assert.equal(loaded.splits.evolve.length, 16);
    assert.equal(loaded.splits.test.length, 8);
    assert.equal(loaded.patches.length, 13);
    for (const patch of loaded.patches) {
      assert.ok(patch.expectedCode === null || /^TT2S10(0[2456])$/.test(patch.expectedCode), patch.id);
    }
    assert.deepEqual(loaded.patches.filter((patch) => patch.withheld).map((patch) => patch.id), ['overlap-a', 'overlap-b']);
    assert.deepEqual(loaded.tree.pool, loaded.patches.filter((patch) => patch.expectedCode === null).map((patch) => patch.id));
    assert.equal(loaded.tree.levels.length, Math.ceil(Math.log(loaded.tree.pool.length) / Math.log(loaded.tree.bMerge)));
    assert.ok(loaded.tree.levels.every((level) => level.groups.every((group) => group.members.length <= loaded.tree.bMerge)));
    assert.ok(loaded.tree.levels.at(-1)?.groups.length === 1, 'a merge plan ends in one patch');
    assert.deepEqual(loaded.fixture.rollouts.repairable.map((id) => loaded.labels.analystPatches[id]).sort(),
      loaded.tree.pool.filter((id) => id.startsWith('redundant') || id.startsWith('units')).sort());
    assert.equal(loaded.skillFiles.get('SKILL.md')?.startsWith('# Tabular extraction'), true);
    assert.deepEqual(loaded.fixture.rollouts.unrepairable, ['task-06']);
    assert.equal(loaded.fixture.ablation.parameters.k, 5);
  });

  it('a corpus that moved is refused rather than measured', async () => {
    const loaded = await loadTrace2SkillFixture();
    const manifest = structuredClone(loaded.fixture);
    manifest.files[0].sha256 = '0'.repeat(64);
    const drifted = await buildTrace2SkillReport({ source, manifest });
    assert.ok(drifted.issues.some((issue) => issue.code === 'TT2S1002'));
    assert.equal(drifted.capabilities.instrument, false);
    assert.equal((drifted.probes.find((probe) => probe.id === 'fixture-hashes-verified')?.observed as { drift: number }).drift, 1);
  });

  it('the fixture generator is idempotent and its check writes nothing', async () => {
    const run = (...args: string[]) => exec(process.execPath, ['benchmark/scripts/trace2skill-fixture.ts', ...args], { maxBuffer: 1024 * 1024 });
    const manifest = join('benchmark', 'fixtures', 'trace2skill', 'manifest.json');
    const before = await stat(manifest);
    const first = await run('--check');
    assert.ok(first.stdout.includes('0 changed'));
    assert.equal((await stat(manifest)).mtimeMs, before.mtimeMs);
    await assert.rejects(run('--rebuild'));
  });

  it('the CLI redirects artifacts, detects drift without writing and refuses a live tier', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace2skill-'));
    try {
      const run = (...args: string[]) => exec(process.execPath, ['benchmark/trace2skill.ts', ...args], { maxBuffer: 4 * 1024 * 1024 });
      await run('--out-dir', dir, '--require', 'instrument');
      assert.deepEqual((await readdir(dir)).sort(), ['TRACE2SKILL_BENCHMARK.md', 'trace2skill-live.json', 'trace2skill.json']);
      const file = join(dir, 'trace2skill.json');
      const before = await stat(file);
      const bytes = await readFile(file, 'utf8');
      await run('--out-dir', dir, '--check');
      assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
      assert.equal(await readFile(file, 'utf8'), bytes);
      // The live path reaches a plan and stops: a run with no key states its
      // skip, and an authorization without --live is refused up front.
      const skipped = await exec(process.execPath, ['benchmark/trace2skill.ts', '--live', '--out-dir', dir],
        { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, OPENROUTER_AI_KEY: '' } });
      assert.ok(skipped.stdout.includes('live skipped:'));
      assert.ok(skipped.stdout.includes('nothing was spent and no request was made'));
      assert.ok(skipped.stdout.includes('0 provider request(s)'));
      await assert.rejects(run('--authorize', 'anything'), /means nothing without --live/);
      await assert.rejects(run('--require', 'unknown', '--out-dir', join(dir, 'unavailable')));
      await assert.rejects(stat(join(dir, 'unavailable')));
      for (const args of [['--wat'], ['--check=yes'], ['--out-dir'], ['--out-dir', '--check'], ['positional'], ['--live=yes']]) {
        await assert.rejects(run(...args));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
