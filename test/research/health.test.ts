import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLessonRefiner, RESEARCH_LESSON_DEFAULTS, RESEARCH_DOMAIN_LESSON_POLICIES, DECAY_HYPOTHESES,
  type LessonRefinerOptions, type ResearchMemoryState, type ResearchOutcome, type ResearchStoreOutcome } from '@tangleai/research';
import { researchControlPlaneParity } from '../../benchmark/lib/research-domain-probes.ts';
import { validateResearchReportShape } from '../../benchmark/lib/research-validation.ts';
import type { ResearchReport } from '../../benchmark/lib/research.types.ts';
import { memoryHarness, stored } from './store-harness.ts';
import { validatedCorrectionFixture } from './lessons-refiner-fixtures.ts';
import { lessonScope, procedure, reviseLesson } from './lessons-store-fixtures.ts';

function refused(result: ResearchOutcome<unknown> | ResearchStoreOutcome<unknown>, code: string, detail?: string) {
  const issues = 'valid' in result ? result.valid ? [] : result.issues : result.ok ? [] : [result.issue];
  assert.equal(issues[0]?.code, code, JSON.stringify(result)); if (detail) assert.ok(issues[0].detail.includes(detail), issues[0].detail);
  return issues[0];
}
it('refuses cross-scope reads, active-base changes and leaked origin task IDs', async () => {
  const h = await memoryHarness();
  try {
    const f = await validatedCorrectionFixture(h.store), before = await h.capture();
    refused(await createLessonRefiner({ ...f.options, scope: { ...lessonScope, taskFamily: 'foreign' } }).prepare(f.request), 'TRSH2003');
    const next = await procedure('# Another checked procedure\n\nRetain independent review.\n'); stored(await h.store.lessons.putProcedure(next));
    let reads = 0;
    refused(await createLessonRefiner({ ...f.options, read: async () => ({ snapshot: ++reads === 1 ? f.snapshot : next, set: null }) }).commit(f.request), 'TRSH2007');
    const leaked = await reviseLesson(f.lesson, body => { body.proposal.edit.operations[0] = { op: 'create_file', path: 'references/leak.md', group: 'leak', content: 'The answer for training-topic is retained.\n' }; });
    stored(await h.store.lessons.putProposal(leaked));
    const issue = refused(await createLessonRefiner(f.options).materialize({ proposalIds: [leaked.id] }), 'TRSH2005');
    assert.equal(issue.cause?.code, 'TT2S1006');
    assert.equal((await h.capture() as ResearchMemoryState).rows.filter(row => row.table === 'lessonSets').length, 0);
    assert.ok(before);
  } finally { await h.close(); }
});
for (const hook of ['compile', 'validateProposal', 'validateBundle', 'validateCandidate', 'planCommit'] as const)
  it(`refuses a thenable from ${hook} with its name in both preparation and native commit`, async () => {
    const h = await memoryHarness();
    try {
      const f = await validatedCorrectionFixture(h.store), before = await h.capture();
      const hooks = { [hook]: () => Promise.reject(new Error('Rejected async hook.')) } as Pick<LessonRefinerOptions, typeof hook>;
      const wrapped = createLessonRefiner({ ...f.options, ...hooks });
      refused(await wrapped.prepare(f.request), 'TRSH2004', hook);
      refused(await wrapped.commit(f.request), 'TRSH2004', hook); assert.deepEqual(await h.capture(), before);
    } finally { await h.close(); }
  });

it('profile defaults follow the measured gate without inventing activation authority', async () => {
  const report: ResearchReport = JSON.parse(await readFile('benchmark/results/research.json', 'utf8'));
  assert.equal(validateResearchReportShape(report).valid, true);
  assert.deepEqual(report.ablation.gate, { writebackEligible: false, fullAutoEligible: false });
  assert.equal(report.lessons.defaultWriteback, RESEARCH_LESSON_DEFAULTS.writeback);
  assert.equal(RESEARCH_LESSON_DEFAULTS.writeback, 'experimental-off');
  const winningDecay = report.ablation.pairs.filter(pair => pair.id.startsWith('decay:') && pair.eligible);
  assert.deepEqual(winningDecay, [], 'No decay hypothesis earns a positive, safe paired gate.');
  assert.equal(report.lessons.defaultDecay, 'none');
  assert.equal(RESEARCH_LESSON_DEFAULTS.decayHypothesisId, report.lessons.defaultDecay);
  assert.ok(DECAY_HYPOTHESES.some(row => row.id === report.lessons.defaultDecay));
  for (const policy of Object.values(RESEARCH_DOMAIN_LESSON_POLICIES)) assert.deepEqual(policy, RESEARCH_LESSON_DEFAULTS);
  const leaked = report.lessons.rows.find(row => row.id === 'lesson-refusal:leaked-origin')!;
  assert.equal(leaked.counts.leaked, 1); assert.equal(leaked.native?.code, 'TRSH2005');
  assert.equal(leaked.native?.activationEventId, null); assert.equal(leaked.activated, false);
});
it('the retained control-plane census still describes the actual stage sources', async () => {
  const report: ResearchReport = JSON.parse(await readFile('benchmark/results/research.json', 'utf8'));
  const actual = await researchControlPlaneParity();
  assert.deepEqual(actual, report.domains.parity);
  assert.equal(actual.profileLiterals, 0); assert.equal(actual.domainComparisons, 0);
  assert.ok(actual.sources.length > 0);
});
it('research lesson code has no second head writer and activation only appends its native audit', async () => {
  const root = 'packages/research/src/lessons', files = (await readdir(root)).filter(name => name.endsWith('.ts'));
  assert.ok(files.includes('activation.ts') && files.includes('outcome.ts'));
  for (const file of files) {
    const source = await readFile(join(root, file), 'utf8');
    assert.doesNotMatch(source, /\b(?:planHeadTransition|planPromotion|compareAndSwap|setHead|putHead)\b/, file);
    assert.doesNotMatch(source, /\.put\(\s*['"](?:heads|activations|activationEvents)['"]/, file);
  }
  const source = await readFile(join(root, 'activation.ts'), 'utf8');
  assert.match(source, /lessonOutcomeRecord\(outcomes, binding, input.activationEventId, 'activationEvent'\)/);
  assert.match(source, /await tx\.put\('lessons', lesson.projectId, lesson.id, lesson\)/);
  assert.doesNotMatch(source, /outcomes\.(?:promote|rollback|approve)\(/);
});

for (const kind of ['rejected-promise', 'rejected-thenable', 'throwing-accessor'])
  it(`a ${kind} plan validator stays a refusal through process settlement`, () => {
    const child = spawnSync(process.execPath, ['test/research/domain-validator-rejection-fixture.ts', kind], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.equal(child.signal, null);
    assert.deepEqual(JSON.parse(child.stdout), { kind, code: 'TRSH2008', unhandled: false, modelCalls: 0, runnerInvocations: 0 });
  });
