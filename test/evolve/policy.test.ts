/**
 * The immutable surface, tested against the registered proposals.
 *
 * These are not invented inputs. Each one is a file in the instrument's
 * fixture, written down before any mechanism existed, carrying the
 * decision it must produce. Reading them here is what makes this a
 * measurement rather than a self-agreeing test: the expectation was fixed
 * before the code that satisfies it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { compileSurfacePolicy, createPatchRefiner, loadProposal, DEFAULT_EVOLVE_BUDGETS } from '@tangleai/evolve';
import type { EvolveIssue } from '@tangleai/evolve';

const FIXTURES = 'benchmark/fixtures/evolve';

const manifest = JSON.parse(await readFile(join(FIXTURES, 'manifest.json'), 'utf8')) as {
  policy: { immutable: { paths: string[], prefixes: string[], generated: Array<{ path: string }> } },
  budgets: Record<string, number>,
};

const POLICY_INPUT = {
  immutablePaths: [...manifest.policy.immutable.paths, ...manifest.policy.immutable.prefixes],
  generated: manifest.policy.immutable.generated.map(one => one.path),
  budgets: { ...DEFAULT_EVOLVE_BUDGETS, ...manifest.budgets } as typeof DEFAULT_EVOLVE_BUDGETS,
};

const policy = compileSurfacePolicy(POLICY_INPUT);

/** The fixture repository as a file map, the way the host would read it. */
async function baseFiles(): Promise<Record<string, string>> {
  const root = join(FIXTURES, 'repo');
  const files: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = prefix === '' ? entry.name : prefix + '/' + entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), next);
      else files[next] = await readFile(join(dir, entry.name), 'utf8');
    }
  };
  await walk(root, '');
  return files;
}

async function proposal(id: string): Promise<unknown> {
  const raw = JSON.parse(await readFile(join(FIXTURES, 'proposals', id + '.json'), 'utf8')) as Record<string, unknown>;
  // The fixture's own shape; the loader's shape names the same things.
  return {
    proposalId: raw.id,
    strategyId: raw.strategyId,
    rationale: raw.rationale,
    evidence: [raw.evidence],
    origin: 'hand-authored',
    patch: raw.patch,
  };
}

const files = await baseFiles();
const refiner = createPatchRefiner({ policy, budgets: POLICY_INPUT.budgets });

/** Every registered refusal, with the code the registration fixed. */
const REGISTERED_REFUSALS: ReadonlyArray<[string, string, string]> = [
  ['edit-test-expectation', 'TEVO1004', 'goalpost'],
  ['edit-ci-workflow', 'TEVO1004', 'goalpost'],
  ['edit-gate-script', 'TEVO1004', 'goalpost'],
  ['move-threshold', 'TEVO1004', 'goalpost'],
  ['fabricate-metric', 'TEVO1004', 'goalpost'],
  ['rename-test-file', 'TEVO1004', 'goalpost'],
  ['edit-generated-table', 'TEVO1004', 'goalpost'],
  ['path-escape-dotdot', 'TEVO1004', 'escape'],
  ['oversized-patch', 'TEVO1005', 'over-budget'],
];

describe('the immutable surface', () => {
  it('refuses every registered goalpost and escape at its registered code', async () => {
    for (const [id, code, reason] of REGISTERED_REFUSALS) {
      const prepared = refiner.prepare(files, await proposal(id));
      assert.equal(prepared.ok, false, id + ' must be refused');
      const issues = (prepared as { issues: EvolveIssue[] }).issues;
      assert.ok(issues.length >= 1, id + ' must carry at least one error');
      assert.equal(issues[0].code, code, id + ' refused at ' + issues[0].code + ', expected ' + code);
      assert.match(issues[0].detail, new RegExp(reason), id + ' must say why: ' + issues[0].detail);
      assert.ok(issues[0].path.length > 0, id + ' must point somewhere');
    }
  });

  it('prepares the three proposals that are allowed to change source', async () => {
    for (const id of ['improve-partial-select', 'noop-comment', 'regress-off-by-one']) {
      const prepared = refiner.prepare(files, await proposal(id));
      assert.equal(prepared.ok, true, id + ' must prepare: ' + JSON.stringify(prepared));
      const plan = (prepared as { value: { plan: { changed: string[] } } }).value.plan;
      assert.deepEqual(plan.changed, ['src/rank.js'], id + ' changes only the file under study');
    }
  });

  it('catches a rename by content and a rename by basename', () => {
    const previous = { 'test/rank.test.js': 'assert(1);\n', 'src/rank.js': 'export const x = 1;\n' };
    // Removing an immutable file is BOTH a direct edit and a rename, and
    // both are reported: the reasons are searched rather than ordered,
    // because which one reads first is not the guarantee.
    const reasons = (issues: EvolveIssue[]) => issues.map(one => one.detail).join(' | ');

    const byContent = policy.check(previous, { 'src/rank.js': previous['src/rank.js'], 'src/moved.js': previous['test/rank.test.js'] });
    assert.ok(byContent.every(one => one.code === 'TEVO1004'));
    assert.match(reasons(byContent), /identical content/);

    const byName = policy.check(previous, { 'src/rank.js': previous['src/rank.js'], 'src/rank.test.js': 'assert(2);\n' });
    assert.ok(byName.every(one => one.code === 'TEVO1004'));
    assert.match(reasons(byName), /same basename/);

    // A rename of a file nobody protects is not a goalpost at all.
    const ordinary = policy.check({ 'src/a.js': 'x' }, { 'src/b.js': 'x' });
    assert.deepEqual(ordinary, []);
  });

  it('catches a rename only git can see, on the staged view', () => {
    const previous = { 'test/rank.test.js': 'assert(1);\n' };
    // The file map looks unchanged; git says a test file moved.
    const issues = policy.check(previous, previous, {
      changed: [{ path: 'src/rank.spec.js', status: 'R', renamedFrom: 'test/rank.test.js' }],
      symlinks: [],
    });
    assert.ok(issues.length >= 1, 'the second look is what catches a rename between read and write');
    assert.match(issues[0].detail, /git reports/);
  });

  it('reports a symlink among the changes as an escape', () => {
    const issues = policy.check({}, {}, { changed: [], symlinks: ['sneaky.txt'] });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'TEVO1004');
    assert.match(issues[0].detail, /escape/);
  });

  it('refuses a path that does not normalize, before asking what kind of file it is', () => {
    for (const path of ['../escape.js', '/etc/passwd', 'src\\rank.js', 'a/./b.js', 'a//b.js']) {
      const issues = policy.check({}, { [path]: 'x' });
      assert.ok(issues.length >= 1, path + ' must refuse');
      assert.equal(issues[0].code, 'TEVO1004');
      assert.match(issues[0].detail, /escape/, path);
    }
  });

  it('refuses two paths that differ only by case', () => {
    const issues = policy.check({ 'src/Rank.js': 'a' }, { 'src/Rank.js': 'a', 'src/rank.js': 'b' });
    assert.ok(issues.length >= 1);
    assert.match(issues[0].detail, /case-folds/);
  });

  it('is compiled from the repository, so no patch can reach it', () => {
    const before = [...policy.immutablePaths];
    // A patch that writes something policy-shaped changes nothing: the rules
    // came from the repository record, not from the tree.
    policy.check({}, { 'policy.json': JSON.stringify({ immutablePaths: [] }) });
    assert.deepEqual([...policy.immutablePaths], before);
  });
});
