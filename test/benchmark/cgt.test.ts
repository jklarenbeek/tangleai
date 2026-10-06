import { before, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { buildCgtReport, loadCgtFixture, validateCgtReport, validateCgtReportShape, verifyCgtReport,
  renderReport, renderDocument, planCgtLive, authorizeCgtLive, requireCapability, REPORT_PATH, DOCUMENT_PATH } from '../../benchmark/lib/cgt.ts';
import { assertCgtGuards, CGT_GUARD_CODES, generateCgtFixture, lookupKey, questionOf, renderCgtRule } from '../../benchmark/lib/cgt-fixture.ts';
import { CGT_LIVE_ROWS, createCgtRetrieval, createCgtRuleFollower } from '../../benchmark/lib/cgt-rows.ts';
import { cgtChanceBand, observeCgtAnswer, scoreAnswer } from '../../benchmark/lib/cgt-scorer.ts';
import { cgtMain } from '../../benchmark/cgt.ts';
import type { CgtFixture, CgtReport } from '../../benchmark/lib/cgt.types.ts';

const exec = promisify(execFile), root = resolve(import.meta.dirname, '../..');
const equalBytes = (actual: string, expected: string, label: string) =>
  assert.equal(Buffer.compare(Buffer.from(actual), Buffer.from(expected)), 0, label);
let fixture: CgtFixture, report: CgtReport;
before(async () => { fixture = await loadCgtFixture(root); report = await buildCgtReport({ root }); });
const rehash = async (value: CgtReport) => { const { reportId: _id, ...body } = value; return { ...body, reportId: await canonicalSha256(body) }; };

it('CGT derives a stable, closed, disjoint fixture with held-out pairs and inputs', async () => {
  assert.deepEqual(await generateCgtFixture(fixture.manifest), fixture);
  assert.notEqual((await generateCgtFixture({ ...fixture.manifest, seed: fixture.manifest.seed + 1 })).fixtureId, fixture.fixtureId);
  assert.deepEqual(fixture.sessions.map(s => s.ordinal), [1, 2, 3, 4, 5, 6]);
  const records = fixture.sessions.flatMap(s => s.experiences), seen = new Set(records.map(lookupKey));
  const ids = [...records, ...fixture.questions, ...fixture.poison, ...fixture.crossScope].map(value => value.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(records.length, 272);
  for (const session of fixture.sessions) for (const concept of fixture.rule.concepts)
    assert.ok(session.experiences.some(value => value.conceptIds.length === 1 && value.conceptIds[0] === concept.id));
  for (const item of fixture.questions) {
    assert.ok(fixture.rule.vocabulary.includes(item.truth));
    if (item.partition === 'exact-pair') assert.equal(seen.has(lookupKey(item)), true);
    else assert.equal(seen.has(lookupKey(item)), false);
    if (item.partition === 'novel') assert.equal(fixture.coveredPairs.some(pair => JSON.stringify(pair) === JSON.stringify(item.conceptIds)), false);
  }
  assert.equal(new Set(fixture.rule.vocabulary).size, 32);
  assert.equal(fixture.poison.every(item => item.poison && item.trust === 'untrusted'), true);
  assert.equal(fixture.crossScope.every(item => item.scope !== fixture.manifest.scope), true);
  await assert.rejects(generateCgtFixture({ ...fixture.manifest, sessions: 17 }), /manifest/);
  await assert.rejects(generateCgtFixture({ ...fixture.manifest, invented: true }), /manifest/);
});

it('CGT uses the inherited normalizer and counts failed or malformed answers as losses', () => {
  assert.equal(scoreAnswer('  THE AB,C! ', 'abc'), 1);
  assert.equal(scoreAnswer('', ''), 0);
  assert.equal(scoreAnswer('the', ''), 0);
  assert.equal(scoreAnswer(null, 'abc'), 0);
  assert.equal(scoreAnswer('abc extra', 'abc'), 0);
  const item = fixture.questions[0];
  for (const [answer, expected] of [[null, 'unanswered'], [{ token: item.truth }, 'malformed'], ['outside-vocabulary', 'malformed']] as const) {
    const observed = observeCgtAnswer(item, { answer }, fixture.rule.vocabulary);
    assert.equal(observed.score, 0); assert.equal(observed.failure, expected);
  }
  const refusal = observeCgtAnswer(item, { answer: item.truth, failure: 'refused' }, fixture.rule.vocabulary);
  assert.equal(refusal.score, 0);
  const rateLimited = observeCgtAnswer(item, { answer: null, failure: 'rateLimited' }, fixture.rule.vocabulary);
  assert.equal(rateLimited.failure, 'rateLimited');
  assert.throws(() => cgtChanceBand(0, 32), /denominator/);
});

it('CGT publishes the oracle and supplied-rule ceilings beside the memorizer loss', () => {
  const row = (id: string) => report.rows.find(value => value.rowId === id)!;
  for (const name of ['oracle', 'scripted-rule-follower']) {
    assert.deepEqual([row(name).cgc, row(name).seenPair, row(name).paraphrase, row(name).retention], [1, 1, 1, 1]);
    assert.equal(row(name).bySession.every(value => value.cgc === 1), true);
  }
  const band = report.registration.chanceBand;
  for (const name of ['seeded-random', 'scripted-memorizer', 'scripted-retrieval']) {
    assert.ok(row(name).cgc! >= band.low && row(name).cgc! <= band.high);
    for (const session of row(name).bySession) assert.deepEqual(session.observations.map(value => value.prediction),
      row('seeded-random').observations.filter(value => value.partition === 'novel').map(value => value.prediction));
  }
  assert.equal(row('scripted-memorizer').seenPair, 1);
  assert.equal(row('scripted-retrieval').seenPair, row('scripted-memorizer').seenPair);
  assert.deepEqual(row('scripted-retrieval').retrieval, { queries: 2032, returned: 16256, skipped: 0 });
  assert.ok(row('scripted-memorizer').cgc! < row('scripted-memorizer').seenPair!);
  assert.ok(renderDocument(report).includes('not the paper’s uniform-all-pairs'));
});

it('CGT rule controls consume their document and native retrieval has no oracle fallback', async () => {
  const query = fixture.questions.find(value => value.partition === 'novel')!;
  const document = structuredClone(fixture.rule);
  document.answerSubstitution = document.answerSubstitution.map(value => (value + 1) % 32);
  const wrong = createCgtRuleFollower(renderCgtRule(document));
  assert.equal(scoreAnswer((await wrong(questionOf(query), [])).answer, query.truth), 0);
  assert.equal((await createCgtRuleFollower('{}')(questionOf(query), [])).failure, 'refused');
  const expected = fixture.questions.find(value => value.partition === 'exact-pair')!;
  const fallback = fixture.rule.vocabulary.find(value => value !== expected.truth)!;
  const retrieval = await createCgtRetrieval(fixture, new Map([[expected.id, fallback]]));
  assert.equal((await retrieval.store.list()).length, report.registration.experienceBudget);
  assert.deepEqual(retrieval.embeddedBy, { model: 'hash-trigram-128', dims: 128 });
  const absent = await retrieval.answer(questionOf(expected), []);
  assert.equal(absent.answer, fallback); assert.deepEqual(absent.retrievedIds, []);
  const found = await retrieval.answer(questionOf(expected), fixture.sessions.flatMap(value => value.experiences));
  assert.equal(found.answer, expected.truth);
  assert.ok(found.retrievedIds!.includes(expected.experienceIds[0]));
  assert.ok(found.retrievedIds!.length <= fixture.manifest.retrievalK);
});

function corrupt(value: CgtFixture, code: typeof CGT_GUARD_CODES[number]): void {
  if (code === 'holdout-shares-experience') value.questions.find(item => item.partition === 'novel')!.experienceIds.push(value.sessions[0].experiences[0].id);
  if (code === 'validation-retrievable') value.retrievalExperienceIds.push(value.questions.find(item => item.partition === 'novel')!.id);
  if (code === 'poison-in-partition') value.sessions[0].experiences.push(structuredClone(value.poison[0]));
  if (code === 'cross-scope-in-partition') value.sessions[0].experiences.push(structuredClone(value.crossScope[0]));
}
for (const code of CGT_GUARD_CODES) it(`CGT rejects ${code} before a row runs, including process failure`, async () => {
  const broken = structuredClone(fixture); corrupt(broken, code);
  let ran = 0;
  assert.throws(() => assertCgtGuards(broken), new RegExp(code));
  await assert.rejects(buildCgtReport({ root, fixture: broken, rows: { onRow: () => { ran++; } } }), new RegExp(code));
  assert.equal(ran, 0);
  const program = `import {loadCgtFixture,buildCgtReport} from './benchmark/lib/cgt.ts';
    const value=await loadCgtFixture(process.cwd()); (${corrupt.toString()})(value,process.argv[1]);
    await buildCgtReport({fixture:value,rows:{onRow(){console.log('ROW-RAN');}}});`;
  await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', program, code], { cwd: root }), (error: unknown) => {
    const failure = error as Error & { code: number; stdout: string; stderr: string };
    assert.equal(failure.code, 1); assert.match(failure.stderr, new RegExp(code)); assert.doesNotMatch(failure.stdout, /ROW-RAN/); return true;
  });
});

it('CGT refuses rehashed census, score, identity and discrimination forgeries', async () => {
  const mutations: ((value: CgtReport) => void)[] = [
    value => { value.rows[0].sampleCount.novel++; },
    value => { value.rows[0].cgc = 0; },
    value => { value.registration.covered++; },
    value => { value.rows[0].observations[0].truth = 'invented'; },
    value => { value.rows[0].bySession[0].experienceBudget++; },
    value => { value.rows[0].failures.refused++; },
    value => { value.capabilities.live = true; },
    value => { value.rows[0].tier = 'scripted'; },
    value => { value.alpha[0].status = 'run'; value.alpha[0].accuracy = 1; },
    value => { value.rows[1].observations[0].retrievedIds = [fixture.poison[0].id]; },
  ];
  for (const mutate of mutations) { const forged = structuredClone(report); mutate(forged); await assert.rejects(validateCgtReport(await rehash(forged)), /cgt report/); }
  const live = structuredClone(report);
  live.rows[5] = { ...structuredClone(live.rows[0]), rowId: 'frozen-none', tier: 'live' };
  assert.equal(validateCgtReportShape(live).valid, false);
  const extra = { ...report, hiddenAuthority: true };
  assert.equal(validateCgtReportShape(extra).valid, false);
  assert.throws(() => requireCapability(report, 'live'), /not measured/);
  assert.throws(() => requireCapability(report, 'unknown'), /unknown/);
});

it('CGT keeps all six live rows and frozen alpha unmeasured; dry plans spend nothing and contain no key', async () => {
  assert.deepEqual(report.rows.filter(row => row.tier === 'live').map(row => row.rowId), [...CGT_LIVE_ROWS]);
  assert.ok(report.rows.filter(row => row.tier === 'live').every(row => row.status === 'not-run' && row.cgc === null && row.cost === null));
  assert.ok(report.alpha.every(row => row.status === 'not-run' && row.accuracy === null));
  assert.ok(report.envelope.rows.every(row => row.identityStatus === 'not-run'));
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('unexpected network'); };
  try {
    const skipped = await planCgtLive({ root, env: {} });
    assert.equal(authorizeCgtLive(skipped), 'skipped');
    assert.throws(() => authorizeCgtLive(skipped, 'wrong-id'), /plan-id mismatch/);
    const env = { TANGLE_AI_PROVIDER: 'openrouter', TANGLE_AI_MODEL: 'fixture-model', OPENROUTER_AI_KEY: 'private-cgt-test-canary' };
    const plan = await planCgtLive({ root, env });
    assert.equal(plan.configured, true); assert.equal(plan.executable, false); assert.ok(Object.isFrozen(plan));
    assert.equal(authorizeCgtLive(plan), 'dry-run');
    assert.equal(authorizeCgtLive(plan, plan.planId), 'implementation-missing');
    assert.doesNotMatch(JSON.stringify(plan), /private-cgt-test-canary/);
    assert.equal((await planCgtLive({ root, env: { ...env, OPENROUTER_AI_KEY: 'rotated-canary' } })).planId, plan.planId);
    assert.notEqual((await planCgtLive({ root, env: { ...env, TANGLE_AI_MAX_CALLS: '1000' } })).planId, plan.planId);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

it('CGT source receipt must reconcile even after a report is rehashed', async () => {
  const forged = structuredClone(report);
  forged.source.head = 'f'.repeat(40);
  await assert.rejects(validateCgtReport(await rehash(forged)), /source receipt/);
});

it('CGT alpha cannot claim a measured model while that model row is not-run', async () => {
  const forged = structuredClone(report);
  forged.alpha[0] = { ...forged.alpha[0], status: 'run', accuracy: .5, reason: null };
  assert.equal(validateCgtReportShape(forged).valid, false);
  await assert.rejects(validateCgtReport(await rehash(forged)), /cgt report/);
});

it('CGT reproduces every committed measurement byte and keeps actual runtime provenance', async () => {
  const fresh = await buildCgtReport({ root });
  equalBytes(renderReport(fresh), renderReport(report), 'same-runtime report bytes');
  const committed = await validateCgtReport(JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8')));
  // Cross-runtime reproduction retains every observation and changes only the
  // host's observed Node/Bun versions and the identity that binds those versions.
  const expected = await rehash({ ...committed, runtime: { ...committed.runtime,
    node: process.versions.node, bun: process.versions.bun ?? null } });
  equalBytes(renderReport(report), renderReport(expected), 'committed measurement and source bytes');
  equalBytes(renderDocument(committed), await readFile(join(root, DOCUMENT_PATH), 'utf8'), 'committed document bytes');
  await verifyCgtReport(report, root);
});

it('CGT CLI redirects both outputs, checks without writing, rejects unknown options and restores fetch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tangle-cgt-'));
  try {
    const command = [join(root, 'benchmark/cgt.ts'), '--out-dir', dir];
    await exec(process.execPath, command, { cwd: root });
    const first = [await readFile(join(dir, 'cgt.json'), 'utf8'), await readFile(join(dir, 'CGT_BENCHMARK.md'), 'utf8')];
    await exec(process.execPath, command, { cwd: root });
    equalBytes(await readFile(join(dir, 'cgt.json'), 'utf8'), first[0], 'CLI JSON bytes');
    equalBytes(await readFile(join(dir, 'CGT_BENCHMARK.md'), 'utf8'), first[1], 'CLI Markdown bytes');
    await exec(process.execPath, [...command, '--check'], { cwd: root });
    await assert.rejects(exec(process.execPath, [join(root, 'benchmark/cgt.ts'), '--leak', 'validation-retrievable'], { cwd: root }), /unknown flag/);
    const original = globalThis.fetch;
    await assert.rejects(cgtMain(['--json', 'same', '--md', 'same'], { root }), /overlap/);
    assert.equal(globalThis.fetch, original);
    const manifest = await readFile(join(root, 'benchmark/fixtures/cgt/manifest.json'), 'utf8');
    await assert.rejects(cgtMain(['--json', 'benchmark/fixtures/cgt/manifest.json'], { root }), /instrument source/);
    await symlink(join(root, 'benchmark/fixtures/cgt/manifest.json'), join(dir, 'manifest-link'));
    await assert.rejects(cgtMain(['--json', join(dir, 'manifest-link')], { root }), /instrument source/);
    assert.equal(await readFile(join(root, 'benchmark/fixtures/cgt/manifest.json'), 'utf8'), manifest);
    await assert.rejects(cgtMain(['--json', 'packages/memory/cgt.json'], { root }), /instrument source/);
    await symlink(join(root, 'packages/memory/uncreated-cgt.json'), join(dir, 'dangling-link'));
    await assert.rejects(cgtMain(['--json', join(dir, 'dangling-link')], { root }), /dangling symlink/);
    await assert.rejects(cgtMain(['--seed', '1oops'], { root }), /invalid/);
    await assert.rejects(cgtMain(['--authorize', 'whatever'], { root }), /requires --live/);
    const live = await exec(process.execPath, [join(root, 'benchmark/cgt.ts'), '--live'], { cwd: root, env: { PATH: process.env.PATH } });
    const result = JSON.parse(live.stdout);
    assert.equal(result.status, 'skipped'); assert.equal(result.requests, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
