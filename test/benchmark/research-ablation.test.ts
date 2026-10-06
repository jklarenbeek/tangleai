import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareResearchAblation, validateResearchAblationShape, renderResearchAblation, buildResearchAblation, validateResearchAblation } from '../../benchmark/lib/research-ablation.ts';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import type { ResearchReport } from '../../benchmark/lib/research.types.ts';
import type { ResearchAblationRow, ResearchAblationReport } from '../../benchmark/lib/research-ablation.types.ts';

function row(id: string, scores: number[]): ResearchAblationRow {
  return { id, family: 'lessons', state: 'measured', scope: 'registered-experiment',
    topics: scores.map((primary, index) => ({ id: 'topic-' + index, hash: 'a'.repeat(64), seeds: [1, 2, 3],
      primary, claimSupport: primary, registryAccuracy: 1, preregistrationIntegrity: 1, completion: true, source: '/fixture/topics/' + index })),
    identityStatus: 'run', identityId: 'b'.repeat(64), comparisonIdentity: 'c'.repeat(64), promptRevisions: ['d'.repeat(64)],
    budget: { calls: 4, tokens: 100, ms: 1000, physical: 8 }, spend: { calls: 1, tokens: 10, ms: 1, physical: 2 },
    safetyRefusals: 0, outcomeEligible: true, refusals: [], provenance: ['/fixture'], limitations: [] };
}
function report(scores: number[] = [.7, .7, .7]): ResearchAblationReport {
  const a = row('baseline', [.5, .5, .5]), b = row('treatment', scores);
  const pairs = ['lessons-on-vs-off', 'gate-only-vs-full-auto', ...Array.from({ length: 6 }, (_, i) => 'pair-' + i)]
    .map(id => compareResearchAblation(id, a, b));
  return { registration: { id: 'research-ablation-v1', primary: 'claimSupport*registryAccuracy*preregistrationIntegrity',
    seed: 17753, resamples: 2000, level: .95, direction: 'treatment-minus-baseline' }, rows: [a, b], pairs,
    gate: { writebackEligible: pairs[0].eligible, fullAutoEligible: pairs[1].eligible }, limitations: ['Synthetic conformance, not empirical improvement.'] };
}
test('pairs preserve per-topic losses and native paired intervals', () => {
  const r = report([.9, .1, .9]), pair = r.pairs[0];
  assert.equal(pair.comparable, true);
  assert.deepEqual(pair.losses, [{ topicId: 'topic-1', delta: -.4 }]);
  assert.equal(pair.delta, .4 / 3);
  assert.ok(pair.interval!.low < 0);
  assert.equal(pair.eligible, false);
  assert.equal(validateResearchAblationShape(r).valid, true);
  assert.equal(renderResearchAblation(r).join('\n'), renderResearchAblation(structuredClone(r)).join('\n'));
});
test('differing seeds, budgets, identities, prompts and scopes are counted by field', () => {
  for (const field of ['seeds', 'budget', 'identityId', 'promptRevisions', 'scope'] as const) {
    const a = row('a', [.5, .5, .5]), b = row('b', [.8, .8, .8]);
    if (field === 'seeds') b.topics[0].seeds = [4];
    else if (field === 'budget') b.budget.calls = 5;
    else if (field === 'identityId') b.identityId = 'e'.repeat(64);
    else if (field === 'promptRevisions') b.promptRevisions = ['f'.repeat(64)];
    else b.scope = 'another-scope';
    const pair = compareResearchAblation('test', a, b);
    assert.equal(pair.comparable, false);
    assert.ok(pair.refusals.some(issue => issue.code === 'TRSH2012' && issue.path === '/' + field));
    assert.equal(pair.delta, null); assert.equal(pair.interval, null); assert.deepEqual(pair.topics, []);
    assert.equal(pair.eligible, false);
  }
});
test('unknown denominators and provenance refuse comparisons rather than borrow scores', () => {
  const a = row('a', [.5]), b = row('b', [.8]);
  a.topics[0].registryAccuracy = null; a.topics[0].primary = null;
  assert.ok(compareResearchAblation('test', a, b).refusals.some(issue => issue.path === '/primary'));
  a.topics[0].registryAccuracy = 1; a.topics[0].primary = .5; a.promptRevisions = [];
  assert.ok(compareResearchAblation('test', a, b).refusals.some(issue => issue.path === '/provenance'));
  a.promptRevisions = [...b.promptRevisions]; a.identityId = b.identityId = null;
  assert.ok(compareResearchAblation('test', a, b).refusals.some(issue => issue.path === '/provenance'));
  a.topics.push(structuredClone(a.topics[0])); b.topics.push(structuredClone(b.topics[0]));
  assert.ok(compareResearchAblation('test', a, b).refusals.some(issue => issue.path === '/topicIds'));
});
test('positive conformance still requires cost, safety, outcome and superiority gates', () => {
  const a = row('a', [.5, .5]), b = row('b', [.8, .8]);
  assert.equal(compareResearchAblation('test', a, b).eligible, true);
  assert.equal(compareResearchAblation('test', a, b, 'parity').eligible, false);
  for (const kind of ['unbounded', 'overspend', 'baseline-overspend', 'safety', 'outcome']) {
    const baseline = structuredClone(a), treatment = structuredClone(b);
    if (kind === 'unbounded') baseline.budget.ms = treatment.budget.ms = null;
    if (kind === 'overspend') treatment.spend.tokens = 101;
    if (kind === 'baseline-overspend') baseline.spend.tokens = 101;
    if (kind === 'safety') treatment.safetyRefusals = 1;
    if (kind === 'outcome') treatment.outcomeEligible = false;
    assert.equal(compareResearchAblation('test', baseline, treatment).eligible, false, kind);
  }
});
test('schema recomputes gates, product, losses, delta and physical cost', () => {
  const base = report();
  assert.equal(validateResearchAblationShape(base).valid, true);
  const changes: Array<(r: ResearchAblationReport) => void> = [r => { r.gate.writebackEligible = false; },
    r => { r.gate.fullAutoEligible = false; }, r => { r.rows[0].topics[0].primary = .7; },
    r => { r.pairs[0].losses.push({ topicId: 'invented', delta: -1 }); },
    r => { r.pairs[0].delta = 99; }, r => { r.pairs[0].cost.delta.physical = 99; },
    r => { r.pairs[0].purpose = 'parity'; }, r => { r.pairs[0].cost.withinBound = false; },
    r => { r.rows[1].outcomeEligible = false; }, r => { r.rows[0].spend.physical++; },
    r => { r.rows[1].safetyRefusals++; },
    r => { r.rows[1].topics[0].primary = r.rows[1].topics[0].claimSupport = .5; },
    r => { r.pairs[1].id = r.pairs[0].id; }];
  for (const change of changes) { const r = structuredClone(base); change(r); assert.equal(validateResearchAblationShape(r).valid, false); }
});
test('committed matrix binds all row families and reconstructs every refusal and tie', async () => {
  const input = JSON.parse(await readFile('benchmark/results/research.json', 'utf8')) as ResearchReport;
  const loaded = await loadResearchFixture(), first = await buildResearchAblation(input, loaded), second = await buildResearchAblation(input, loaded);
  assert.deepEqual(first, second); assert.deepEqual(first, input.ablation);
  assert.equal(first.rows.length, 32); assert.equal(first.pairs.length, 10);
  assert.deepEqual(first.gate, { writebackEligible: false, fullAutoEligible: false });
  assert.equal(first.rows.filter(row => row.family === 'external' && row.state === 'not-run').length, 1);
  assert.ok(first.pairs.find(pair => pair.id === 'debate-vs-fixed')!.refusals.some(issue => issue.path === '/primary'));
  const forged = structuredClone(first); forged.pairs[0].interval = { low: .1, high: .2 };
  assert.equal(await validateResearchAblation(forged, input, loaded), false);
});
