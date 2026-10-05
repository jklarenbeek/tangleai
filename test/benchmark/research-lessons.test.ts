import { before, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { loadResearchFixture, researchBytesSha256, type LoadedResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { loadResearchLessonFixture, type LoadedLessonFixture } from '../../benchmark/lib/research-lessons-fixture.ts';
import { buildResearchLessonsReport, compareResearchLessons, validateResearchLessonsReportShape } from '../../benchmark/lib/research-lessons.ts';
import { compileResearchLessonOracle, lessonOracleEligibility, probeResearchLessonNegative } from '../../benchmark/lib/research-lessons-oracle.ts';
import { RESEARCH_LESSON_ROW_IDS, RESEARCH_LESSON_NEGATIVES } from '../../benchmark/lib/research-lessons-schema.ts';
import type { ResearchLessonsReport } from '../../benchmark/lib/research-lessons.types.ts';

let loaded: LoadedResearchFixture, fixture: LoadedLessonFixture, report: ResearchLessonsReport;
before(async () => { loaded = await loadResearchFixture(); fixture = await loadResearchLessonFixture(loaded); report = await buildResearchLessonsReport(loaded); });

it('the implemented lesson instrument is reproducible, keyless and refuses unearned writeback', async () => {
  const previous = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Unexpected network request.'); };
  try { assert.equal(JSON.stringify(await buildResearchLessonsReport(loaded)), JSON.stringify(report)); }
  finally { globalThis.fetch = previous; }
  assert.equal(requests, 0);
  assert.deepEqual(report.rows.map(row => row.id), RESEARCH_LESSON_ROW_IDS);
  assert.equal(report.rows[0].primary, .5); assert.equal(report.rows[5].primary, 1);
  assert.deepEqual(report.rows.slice(1, 5).map(row => [row.state, row.reason, row.primary]),
    Array.from({ length: 4 }, () => ['measured', null, .5]));
  assert.equal(report.gate.safety, true); assert.equal(report.gate.cost, true);
  assert.equal(report.gate.mechanism, true); assert.equal(report.gate.outcome, false); assert.equal(report.gate.writebackEligible, false);
  assert.equal(report.defaultWriteback, 'experimental-off'); assert.equal(report.defaultDecay, 'none');
  assert.ok(report.rows.every(row => row.identityStatus === 'not-run' && !row.activated));
  assert.deepEqual(report.pair.deltas, [0, 0, 0]); assert.deepEqual(report.pair.interval, { low: 0, high: 0, mean: 0, n: 3 });
  for (const row of report.rows.slice(1, 5)) {
    assert.equal(row.spend.calls, 1); assert.equal(row.spend.tokens, 48);
    assert.equal(row.preparationSpend.physical, 2 * report.rows[0].spend.physical);
    assert.equal(row.spend.physical, 3 * report.rows[0].spend.physical);
    assert.equal(row.native!.phase, 'approval'); assert.equal(row.native!.cause, 'OUTC1011');
    assert.equal(row.native!.activationEventId, null); assert.deepEqual(row.native!.injections, []);
    assert.equal(row.native!.validatedIds.length, 1); assert.equal(row.native!.validationRun!.rows.length, 3);
    assert.ok(row.native!.validationRun!.rows.every(row => row.score === row.baselineScore));
    assert.equal(row.native!.procedureReads.length, 3); assert.ok(row.native!.procedureReads.every(read => read.bundleHash === report.rows[0].bundleHash));
    assert.equal(row.bundleHash, report.rows[0].bundleHash); assert.equal(row.drift, 0);
    assert.deepEqual(row.refusals.map(r => [r.code, r.count]), [['TRSH2007', 1], ['OUTC1004', 3]]);
  }
  assert.deepEqual(report.rows[3].native!.decay.map(row => row.weight), [.75, .5, .25]);
  assert.deepEqual(report.rows[4].native!.decay.map(row => row.weight), [.75, .5, .25]);
});

it('every negative lesson control reaches its registered native refusal', async () => {
  for (const negative of fixture.negative) {
    const actual = await probeResearchLessonNegative(fixture, negative);
    assert.deepEqual({ code: actual.code, cause: actual.cause }, negative.expected, negative.id);
  }
  assert.deepEqual(report.rows.slice(6).map(row => row.id), RESEARCH_LESSON_NEGATIVES.map(id => 'lesson-refusal:' + id));
  assert.ok(report.rows.slice(6).every(row => row.matched && row.counts.rejected === 1));
  assert.ok(report.rows.slice(6).every(row => row.native?.matched && row.native.code === row.expectedCode && row.native.activationEventId === null));
  assert.deepEqual(report.rows.slice(6).map(row => row.native!.phase),
    ['approval', 'approval', 'proposal', 'proposal', 'approval', 'materialization', 'validation', 'materialization', 'materialization']);
  assert.equal(report.rows.at(-1)!.native!.cause, 'TRSH2004');
  assert.equal(report.rows.at(-1)!.observedCause, 'GUARDED', 'The pre-mechanism analytic result remains separately visible.');
  const volatile = report.rows.find(row => row.id === 'lesson-refusal:volatile')!;
  assert.ok(volatile.eligibilityIssues.some(issue => issue.includes('domain regressed')));
  assert.deepEqual(await lessonOracleEligibility([1, 1, 1], [.5, .5, .5], ['a', 'a', 'b']), []);
  assert.ok((await lessonOracleEligibility([.5, .5, .5], [.5, .5, .5], ['a', 'a', 'b']))
    .some(issue => issue.detail.includes('strictly improve')));
});

it('the oracle uses the skill compiler without mutating or activating its frozen input', async () => {
  const before = structuredClone(fixture.procedure), compiled = await compileResearchLessonOracle(fixture);
  assert.deepEqual(fixture.procedure, before);
  assert.equal(compiled.bundle.parentId, before.bundle.id);
  assert.equal(compiled.bundle.status, 'staged'); assert.notEqual(compiled.bundle.id, before.bundle.id);
  assert.match(compiled.files[0].content!, /Check the registered metric name, unit and direction/);
});

it('the report schema refuses missing evidence, forged summaries, gates and refusal causes', () => {
  assert.equal(validateResearchLessonsReportShape(report).valid, true);
  for (const name of ['originIds', 'scope', 'validationRunId', 'bundleHash', 'spend', 'identityStatus', 'comparisonIdentity']) {
    const changed = structuredClone(report);
    Reflect.deleteProperty(changed.rows[0], name);
    assert.equal(validateResearchLessonsReportShape(changed).valid, false, name);
  }
  const changes: Array<(value: ResearchLessonsReport) => void> = [
    value => { value.gate.writebackEligible = true; }, value => { value.gate.outcome = true; },
    value => { value.gate.safety = false; }, value => { value.gate.cost = false; },
    value => { value.rows[0].primary = 1; }, value => { value.rows[0].completion = 0; },
    value => { value.rows[0].topics[0].primary = 0; }, value => { value.rows[0].spend.physical++; },
    value => { value.rows[0].identityStatus = 'run'; }, value => { value.rows[6].refusals[0].cause = null; },
    value => { value.rows[6].matched = false; }, value => { value.rows[6].expectedCode = 'TRSH2003'; },
    value => { value.rows[6].counts.rejected = 0; }, value => { value.rows[6].activated = true; },
    value => { value.pair.negativeTransfer = 1; }, value => { value.pair.mean = 1; },
    value => { value.rows[0].topics.reverse(); }, value => { value.registration.decay.reverse(); },
    value => { value.rows[1].preparationSpend.calls = 0; },
    value => { value.rows[1].native!.validationRun!.bundleHash = '0'.repeat(64); },
    value => { value.rows[6].native!.matched = false; },
    value => { value.rows[6].native!.code = 'TRSH2003'; },
    value => { value.rows[1].native!.activationEventId = '0'.repeat(64); },
    value => { value.rows[1].native!.validatedIds = []; },
    value => { value.rows[1].native = null; },
    value => { value.rows[6].native = null; },
  ];
  for (const change of changes) {
    const changed = structuredClone(report); change(changed);
    assert.equal(validateResearchLessonsReportShape(changed).valid, false, change.toString());
  }
});

it('the paired statistic retains every loss and refuses changed input bindings', () => {
  const off = structuredClone(report.rows[0]), on = structuredClone(off);
  on.id = 'lessons-on'; on.topics[0].primary = 1; on.topics[1].primary = 0;
  const pair = compareResearchLessons(off, on);
  assert.deepEqual(pair.deltas, [.5, -.5, 0]); assert.equal(pair.negativeTransfer, 1);
  assert.equal(pair.mean, 0); assert.equal(pair.interval?.n, 3);
  assert.ok(pair.interval && pair.interval.low < 0 && pair.interval.high > 0);
  assert.deepEqual(compareResearchLessons(off, on), pair);
  on.comparisonIdentity = '0'.repeat(64);
  const refused = compareResearchLessons(off, on);
  assert.equal(refused.comparable, false); assert.ok(refused.issues.includes('input-mismatch'));
  assert.deepEqual(refused.deltas, []); assert.equal(refused.interval, null);
});

/** Rehashing a nested member cannot excuse invalid native content or another topic census. */
async function changedMember(path: string, alter: (value: any) => void): Promise<LoadedResearchFixture> {
  const changed = { ...loaded, files: new Map(loaded.files) };
  const value = JSON.parse(new TextDecoder().decode(changed.files.get('lessons/' + path)!)); alter(value);
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'); changed.files.set('lessons/' + path, bytes);
  const manifest = JSON.parse(new TextDecoder().decode(changed.files.get('lessons/manifest.json')!));
  manifest.files.find((file: { path: string }) => file.path === path).sha256 = researchBytesSha256(bytes);
  changed.files.set('lessons/manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'));
  return changed;
}
it('licence, inventory, lesson identity and frozen procedure bytes all fail closed', async () => {
  const missing = { ...loaded, files: new Map(loaded.files) }; missing.files.delete('lessons/origin.json');
  await assert.rejects(loadResearchLessonFixture(missing), /inventory/);
  const licence = { ...loaded, files: new Map(loaded.files) };
  const manifest = JSON.parse(new TextDecoder().decode(licence.files.get('lessons/manifest.json')!)); manifest.license = 'unknown';
  licence.files.set('lessons/manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  await assert.rejects(loadResearchLessonFixture(licence), /licence/);
  await assert.rejects(loadResearchLessonFixture(await changedMember('beneficial.json', value => { value.id = '0'.repeat(64); })), /content drift/);
  await assert.rejects(loadResearchLessonFixture(await changedMember('procedure.json', value => { value.files[0].content += '\nHidden change\n'; })), /content drift/);
  await assert.rejects(loadResearchLessonFixture(await changedMember('negative/poisoned.json', value => { value.expected.code = 'TRSH2003'; })), /expectation drift/);
  const { revision, ...body } = fixture.registration; assert.equal(revision, await canonicalSha256(body));
});
