import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { buildHeraReport, validateHeraReport, renderHeraReport, renderHeraDocument, loadHeraFixture,
  planHeraFixtureMode, heraRoleInput, requireHeraCapability, createHeraDatasetPlan, HERA_ROWS } from '../../benchmark/lib/hera-qa.ts';
import { INIT_COMMAND, type LoadOutcome, type LocomoSample } from '../../benchmark/lib/locomo.ts';
import { createGmplLocomoPlan } from '../../benchmark/lib/gmpl-locomo.ts';
import type { HeraQa } from '../../benchmark/lib/hera-qa.types.ts';

const absent = { available: false as const, reason: 'test fixture absent', hint: INIT_COMMAND };
const sourceId = 'a'.repeat(64);
describe('the HERA registration', () => {
  let report: HeraQa;
  before(async () => { report = await buildHeraReport({ sourceId, dataset: absent }); });
  it('two keyless builds render byte-identical JSON and Markdown under frozen source metadata', async () => {
    const second = await buildHeraReport({ sourceId, dataset: absent });
    assert.equal(renderHeraReport(report), renderHeraReport(second));
    assert.equal(renderHeraDocument(report), renderHeraDocument(second));
    assert.equal(report.rows[0].quality!.f1, 1);
    assert.equal(report.totals.calls, 1418);
    assert.equal(report.totals.learningWrites, 265);
    assert.deepEqual(report.rows.map(r => r.id), HERA_ROWS);
    assert.equal(report.rows.filter(r => r.status === 'implementation-missing').length, 0);
    assert.deepEqual(report.refusals,{evalSplitInLearn:5,invalidCandidates:3,duplicateCandidates:7,appliedNotOffered:1});
  });
  it('an absent dataset never acquires synthetic questions or an eligible comparison', async () => {
    assert.equal(report.dataset.status, 'dataset-unavailable');
    assert.equal(report.split.training.ids.length + report.split.heldOut.ids.length, 0);
    assert.equal(report.locomo.questions.length, 0);
    assert.ok(report.locomo.rows.every(r => !r.eligible && r.status === 'dataset-unavailable'));
    assert.ok(report.pairs.every(p => !p.eligible));
  });
  it('refuses held-out learning and serializes no gold into any role input', async () => {
    const fixture = await loadHeraFixture();
    assert.equal(report.refusals.evalSplitInLearn, fixture.questions.filter(q => q.split === 'held-out').length);
    for (const question of fixture.questions) {
      const plan = planHeraFixtureMode('learn', question);
      assert.equal(plan.valid, question.split === 'training');
      if (!plan.valid) assert.equal(plan.issues[0].code, 'THERA1004');
      const input = heraRoleInput(question, fixture);
      assert.equal(JSON.stringify(input).includes('"gold"'), false);
      assert.equal(Object.hasOwn(input, 'split'), false);
      assert.equal(input.query, question.query);
    }
  });
  it('report verification refuses forged totals and identities even after resealing', async () => {
    for (const mutate of [
      (r: HeraQa) => { r.totals.run++; },
      (r: HeraQa) => { r.totals.calls++; },
      (r: HeraQa) => { r.totals.learningWrites++; },
      (r: HeraQa) => { r.rows[0].identity = null; },
      (r: HeraQa) => { r.rows[0].quality!.answered++; },
      (r: HeraQa) => { r.rows[7].status = 'implementation-missing'; },
      (r: HeraQa) => { r.split.training.sampleId = 'b'.repeat(64); },
      (r: HeraQa) => { r.pairs[2].eligible = true; r.pairs[2].delta = 0.5; },
      ...['snapshotId', 'model', 'decoder', 'corpusRevision', 'evaluatorId', 'toolIds', 'budget'].map(key =>
        (r: HeraQa) => { delete (r.rows[0].identity as unknown as Record<string, unknown>)[key]; }),
      (r: HeraQa) => { r.rows[0].quality = null; },
      (r: HeraQa) => { r.rows[0].cost = null; },
      (r: HeraQa) => { r.rows[6].learning!.mixedGroups++; },
      (r: HeraQa) => { r.rows[6].learning!.libraryOperations.add++; },
      (r: HeraQa) => { r.rows[6].learning!.librarySize=33; },
      (r: HeraQa) => { r.rows[7].heldOutQuality=null; },
      (r: HeraQa) => { r.rows[6].heldOutQuality=null; },
      (r: HeraQa) => { r.rows[5].learning!.trials.activated++; },
      (r: HeraQa) => { r.rows[5].learning!.promptChurn[0].rejected++; },
      (r: HeraQa) => { r.rows[5].learning!.replayCost.calls=10000; },
      (r: HeraQa) => { r.rows[6].learning!.replayCost.calls=1; },
      (r: HeraQa) => { delete r.rows[5].identity!.learningBudget; },
      (r: HeraQa) => { r.rows[6].heldOutQuality={...r.rows[6].quality!}; },
      (r: HeraQa) => { r.rows[7].learning!.mutationAcceptance.accepted++; },
      (r: HeraQa) => { r.rows[7].learning!.structuralCurve.pop(); },
      (r: HeraQa) => { r.rows[6].learning!.mutationAcceptance={proposed:1,validated:1,accepted:1,rejected:0}; },
    ]) {
      const changed = structuredClone(report); mutate(changed);
      const { reportId: _, ...content } = changed;
      changed.reportId = await canonicalSha256(content);
      await assert.rejects(validateHeraReport(changed));
    }
  });
  it('validates the published artifact and reproduces its document', async () => {
    const published = JSON.parse(await readFile('benchmark/results/hera-qa.json', 'utf8')) as HeraQa;
    await validateHeraReport(published);
    assert.equal(renderHeraDocument(published), await readFile('docs/HERA_BENCHMARK.md', 'utf8'));
  });
  it('freezes the seeded release-order split and shares GMPL evidence without sending gold', async () => {
    const samples: LocomoSample[] = [{ sample_id: 'synthetic', conversation: {
      speaker_a: 'Ada', speaker_b: 'Bob', session_1_date_time: '1:00 pm on 1 May, 2023',
      session_1: [{ speaker: 'Ada', dia_id: 'D1:1', text: 'The review recommends a pilot extension.' }],
    }, qa: [1, 2, 3, 4].flatMap(category => Array.from({ length: 40 }, (_, i) => ({
      question: `What does review ${category}/${i} recommend?`,
      answer: category === 3 ? 'pilot extension; continuation' : 'pilot extension',
      category: category as 1 | 2 | 3 | 4, evidence: ['D1:1'],
    }))) }];
    const dataset: LoadOutcome = { available: true, valid: true, samples, bytes: 1, sha256: await canonicalSha256(samples) };
    const plan = await createHeraDatasetPlan(dataset);
    assert.equal(plan.split.training.ids.length, 64);
    assert.equal(plan.split.heldOut.ids.length, 64);
    assert.equal(plan.split.training.sampleId, await canonicalSha256(plan.split.training.ids));
    assert.equal(plan.split.heldOut.sampleId, await canonicalSha256(plan.split.heldOut.ids));
    assert.equal(new Set([...plan.split.training.ids, ...plan.split.heldOut.ids]).size, 128);
    assert.deepEqual(plan.split, (await createHeraDatasetPlan(dataset)).split);
    for (const category of [1, 2, 3, 4]) {
      const questions = plan.questions.filter(q => q.category === category);
      assert.deepEqual(questions.map(q => q.split), [...Array(16).fill('training'), ...Array(16).fill('held-out')]);
    }
    assert.ok(plan.oracleByCategory.every(c => c.f1 === 1 && c.questions === 32));
    assert.equal(plan.category3UncutBelowCeiling, 32);
    const gmpl = await createGmplLocomoPlan({ dataset, sourceId });
    let shared = 0;
    for (const q of plan.questions) {
      const input = plan.inputs.get(q.id)!;
      assert.deepEqual(Object.keys(input), ['caseId', 'query', 'evidence']);
      assert.equal(JSON.stringify(input).includes('"gold"'), false);
      const baseline = gmpl.plan.questions.find(other => other.id === q.id);
      if (baseline) { shared++; assert.equal(q.evidenceId, baseline.evidenceId); assert.equal(q.inputId, baseline.inputId); }
    }
    assert.ok(shared > 0);
    const available = await buildHeraReport({ sourceId, dataset });
    assert.equal(available.dataset.status, 'available');
    assert.ok(available.locomo.rows.every(r => !r.eligible && r.status === 'not-run'));
  });
  it('makes zero network requests while building a keyless report', async () => {
    const previous = globalThis.fetch; let requests = 0;
    globalThis.fetch = (() => { requests++; throw new Error('Network forbidden'); }) as typeof fetch;
    try { await buildHeraReport({ sourceId, dataset: absent }); assert.equal(requests, 0); }
    finally { globalThis.fetch = previous; }
  });
  it('requires real mechanism rows before any capability beyond the instrument', () => {
    assert.doesNotThrow(() => requireHeraCapability(report, 'instrument'));
    assert.doesNotThrow(() => requireHeraCapability(report, 'baseline'));
    assert.doesNotThrow(() => requireHeraCapability(report, 'frozen'));
    assert.doesNotThrow(() => requireHeraCapability(report, 'experience'));
    assert.equal(report.scripted.maxConcurrentRetrievers, 2);
    assert.equal(report.scripted.replayCalls, 0);
    assert.doesNotThrow(() => requireHeraCapability(report, 'rope'));
    for (const capability of ['mutation','complete']) assert.doesNotThrow(() => requireHeraCapability(report, capability));
    assert.throws(() => requireHeraCapability(report, 'unknown'));
  });
  it('measures mixed and unmixed learning, all consolidation operations and unchanged held-out quality',()=>{
    const row=report.rows[6],learning=row.learning!;
    assert.deepEqual(learning.flags,{experience:true,rope:false,mutation:false});assert.equal(learning.mixedGroupRate,3/7);assert.equal(learning.groupsWithoutMixedOutcome,4);
    assert.deepEqual(learning.libraryOperations,{add:4,merge:1,prune:1,keep:1});assert.equal(learning.librarySize,2);assert.ok(learning.librarySize<=learning.libraryCap);
    assert.equal(row.failures.refusedLearningWrites,5);assert.equal(row.failures.headConflicts,0);assert.deepEqual(learning.replayCost,{calls:0,tokens:0,ms:0});
    assert.equal(row.cost!.trainingCalls,146);assert.equal(row.cost!.heldOutCalls,100);assert.equal(row.heldOutQuality!.planned,5);
    assert.equal(row.heldOutQuality!.f1,.8);assert.equal(report.rows[3].heldOutQuality!.f1,.8);assert.equal(report.rows[4].heldOutQuality!.f1,.8);
    assert.equal(row.quality!.f1,2/3);assert.equal(report.rows[3].quality!.f1,.9);
  });
  it('publishes paired prompt costs, per-role churn and the scripted held-out loss',()=>{
    for(const id of ['hera-no-experience','hera-no-mutation']){const row=report.rows.find(r=>r.id===id)!,learning=row.learning!;
      assert.equal(row.status,'run');assert.equal(learning.flags.rope,true);assert.equal(learning.flags.experience,id==='hera-no-mutation');
      assert.deepEqual(learning.promptChurn,[{agentId:'conclude-agent',activated:1,rejected:2}]);
      assert.deepEqual(learning.trials,{activated:1,rejected:1,malformed:1,unevaluated:0});assert.deepEqual(learning.replayCost,{calls:14,tokens:140,ms:0});
      assert.equal(row.heldOutQuality!.f1,.6);assert.ok(row.heldOutQuality!.f1<report.rows[6].heldOutQuality!.f1);assert.equal(row.failures.refusedLearningWrites,5);
      assert.deepEqual(row.identity!.learningBudget,report.rows[6].identity!.learningBudget);
    }
  });
  it('measures the persistent-failure intervention and retains every structural training point',()=>{
    const full=report.rows.find(r=>r.id==='hera-full')!,learning=full.learning!;
    assert.deepEqual(learning.flags,{experience:true,rope:true,mutation:true});
    assert.deepEqual(learning.mutationAcceptance,{proposed:1,validated:1,accepted:1,rejected:0});
    assert.deepEqual(learning.structuralCurve.slice(-3).map(p=>[p.taskId,p.bestScore,p.topology!.trajectories]),[['q08',0,2],['q08',0,2],['q08',1,3]]);
    assert.equal(learning.structuralCurve.length,7);assert.equal(full.cost!.trainingCalls,180);assert.equal(full.cost!.heldOutCalls,100);
    assert.equal(learning.mixedGroups,4);assert.equal(full.heldOutQuality!.f1,.6);assert.ok(full.heldOutQuality!.f1<report.rows[3].heldOutQuality!.f1);
    assert.equal(full.topology!.includesFailed,true);assert.equal(full.topology!.trajectories,25);assert.equal(full.topology!.diameter,2.04);
    assert.match(renderHeraDocument(report),/dependency-edge role transitions/);
  });
  it('refuses a tampered registered fixture before reading its truth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tangle-hera-fixture-'));
    try {
      await cp('benchmark/fixtures/hera', join(root, 'benchmark/fixtures/hera'), { recursive: true });
      const path = join(root, 'benchmark/fixtures/hera/corpus.json');
      await writeFile(path, (await readFile(path, 'utf8')).replace('Mira founded', 'Someone founded'));
      await assert.rejects(loadHeraFixture(root), /Fixture bytes changed/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

it('HERA CLI redirects every artifact, reproduces bytes and checks without writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tangle-hera-cli-'));
  const exec = promisify(execFile);
  const run = (...args: string[]) => exec(process.execPath, ['benchmark/hera-qa.ts', ...args], { maxBuffer: 1024 * 1024 });
  const committed = ['benchmark/results/hera-qa.json', 'docs/HERA_BENCHMARK.md'];
  const before = await Promise.all(committed.map(async path => ({ text: await readFile(path, 'utf8'), mtime: (await stat(path)).mtimeMs })));
  try {
    const a = join(root, 'a'), b = join(root, 'b');
    await run('--out-dir', a, '--require', 'mutation');
    await run('--out-dir', b);
    for (const name of ['hera-qa.json', 'HERA_BENCHMARK.md']) {
      const path = join(a, name), bytes = await readFile(path, 'utf8'), mtime = (await stat(path)).mtimeMs;
      assert.equal(bytes, await readFile(join(b, name), 'utf8'));
      await run('--out-dir', a, '--check');
      assert.equal((await stat(path)).mtimeMs, mtime);
      assert.equal(await readFile(path, 'utf8'), bytes);
    }
    await run('--require', 'complete', '--out-dir', a, '--check');
    for (const args of [['--live'], ['--unknown'], ['--require', 'unknown'], ['positional']]) await assert.rejects(run(...args));
    for (const [index, path] of committed.entries()) {
      assert.equal(await readFile(path, 'utf8'), before[index].text);
      assert.equal((await stat(path)).mtimeMs, before[index].mtime);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
