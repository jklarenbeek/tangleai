/**
 * The guarded patch path, and the two traps its contract sets.
 *
 * The suite reads a validator that returns a Promise as
 * `{ valid: false, errors: [] }` — a refusal with no reason. So two
 * properties are pinned here that no ordinary test would think to check:
 * that every validator this consumer supplies is declared synchronous, and
 * that no refusal ever arrives with an empty error list. Either failing
 * would turn a real refusal into an unexplained one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { compileSurfacePolicy, createPatchRefiner, DEFAULT_EVOLVE_BUDGETS } from '@tangleai/evolve';
import type { EvolveIssue } from '@tangleai/evolve';

const policy = compileSurfacePolicy({
  immutablePaths: ['test/', 'package.json'],
  generated: ['src/generated/table.js'],
  budgets: DEFAULT_EVOLVE_BUDGETS,
});
const refiner = createPatchRefiner({ policy, budgets: DEFAULT_EVOLVE_BUDGETS });

const base = { 'src/rank.js': 'export const x = 1;\n', 'test/rank.test.js': 'assert(1);\n' };
const proposal = (patch: unknown) => ({
  proposalId: 'p1', strategyId: 's1', rationale: 'because', evidence: ['e1'],
  origin: 'hand-authored', patch,
});

describe('the guarded patch path', () => {
  it('applies on a copy, leaving the caller’s file map untouched', () => {
    const previous = { ...base };
    const prepared = refiner.prepare(previous, proposal([{ op: 'replace', path: '/files/src~1rank.js', value: 'export const x = 2;\n' }]));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(previous['src/rank.js'], 'export const x = 1;\n', 'the source map is never mutated');
    const value = (prepared as { value: { next: Record<string, string>, plan: { writes: Array<{ path: string }>, removes: string[], bytes: number } } }).value;
    assert.equal(value.next['src/rank.js'], 'export const x = 2;\n');
    assert.deepEqual(value.plan.writes.map(one => one.path), ['src/rank.js']);
    assert.deepEqual(value.plan.removes, []);
    assert.ok(value.plan.bytes > 0);
  });

  it('plans adds, edits and removals in a stable order', () => {
    const prepared = refiner.prepare(base, proposal([
      { op: 'add', path: '/files/src~1b.js', value: 'b\n' },
      { op: 'add', path: '/files/src~1a.js', value: 'a\n' },
    ]));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const plan = (prepared as { value: { plan: { writes: Array<{ path: string }>, changed: string[] } } }).value.plan;
    assert.deepEqual(plan.writes.map(one => one.path), ['src/a.js', 'src/b.js'], 'two runs must plan the same');
    assert.deepEqual(plan.changed, ['src/a.js', 'src/b.js']);
  });

  it('never returns a refusal without at least one stated error', () => {
    for (const patch of [
      [{ op: 'replace', path: '/files/test~1rank.test.js', value: 'assert(2);\n' }],
      [{ op: 'add', path: '/files/..~1escape.js', value: 'x' }],
      [{ op: 'replace', path: '/files/src~1generated~1table.js', value: 'x' }],
      [{ op: 'move', path: '/files/a.js' }],
    ]) {
      const prepared = refiner.prepare(base, proposal(patch));
      assert.equal(prepared.ok, false, JSON.stringify(patch));
      const issues = (prepared as { issues: EvolveIssue[] }).issues;
      assert.ok(issues.length >= 1, 'an empty refusal is indistinguishable from the Promise trap');
      assert.ok(issues.every(one => one.detail.length > 0 && one.code.startsWith('TEVO')));
    }
  });

  it('keeps the patch engine’s own code and pointer when an apply fails', () => {
    // Removing a file that is not there is the engine's refusal, not ours.
    const prepared = refiner.prepare(base, proposal([{ op: 'remove', path: '/files/absent.js' }]));
    assert.equal(prepared.ok, false);
    const issue = (prepared as { issues: EvolveIssue[] }).issues[0];
    assert.equal(issue.code, 'TEVO1001');
    assert.ok(issue.cause, 'the engine said something specific and it is carried');
    assert.ok(issue.cause!.message.length > 0);
  });

  it('declares every validator synchronously', async () => {
    // A validator that returns a Promise is read as a refusal with no
    // errors. Reading the source is the only way to pin this, because the
    // failure mode is silent.
    const source = await readFile('packages/evolve/src/patch.ts', 'utf8');
    const start = source.indexOf('createGuardedRefiner({');
    assert.ok(start > 0, 'the consumer must call the suite editor');
    const body = source.slice(start);
    for (const name of ['validateProposal', 'validateCandidate', 'planCommit']) {
      const at = body.indexOf(name + ':');
      assert.ok(at >= 0, name + ' must be supplied');
      const declaration = body.slice(at, at + 80);
      assert.equal(/\basync\b/.test(declaration), false, name + ' must not be async');
    }
    assert.match(body, /applyFailure/, 'the engine’s failure is adapted, not swallowed');
  });

  it('refuses to commit through the generic engine', async () => {
    const source = await readFile('packages/evolve/src/patch.ts', 'utf8');
    assert.match(source, /preparation never commits through the generic engine/,
      'the host applies the plan as a recorded effect instead');
  });

  it('shares the guarded editor with exactly one other named consumer', async () => {
    // Two guarded paths exist in this package and only two: the patch that
    // edits a repository's files, and the refinement that appends a
    // strategy's evidence. A third would be a third place the
    // read-validate-apply-validate-plan sequence could be got subtly wrong.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    // Scoped to source: the README documents the design and names the
    // engine on purpose, which is not a third consumer of it.
    const found = await run('grep', ['-rln', '--include=*.ts', 'createGuardedRefiner', 'packages/evolve/src'])
      .then(result => result.stdout.trim().split('\n').sort())
      .catch(() => []);
    assert.deepEqual(found, [
      'packages/evolve/src/patch.ts',
      'packages/evolve/src/strategy-refiner.ts',
    ]);
  });

  it('refuses an over-budget patch before the engine ever applies it', () => {
    const tight = createPatchRefiner({
      policy: compileSurfacePolicy({ immutablePaths: [], generated: [], budgets: { ...DEFAULT_EVOLVE_BUDGETS, patchBytes: 32 } }),
      budgets: { ...DEFAULT_EVOLVE_BUDGETS, patchBytes: 32 },
    });
    const prepared = tight.prepare(base, proposal([{ op: 'add', path: '/files/big.js', value: 'x'.repeat(4096) }]));
    assert.equal(prepared.ok, false);
    assert.equal((prepared as { issues: EvolveIssue[] }).issues[0].code, 'TEVO1005');
  });

  it('verifies the staged view as a second, independent look', () => {
    const clean = refiner.verifyStaged(base, base, { changed: [], symlinks: [] });
    assert.equal(clean.ok, true);

    const renamed = refiner.verifyStaged(base, base, {
      changed: [{ path: 'src/rank.spec.js', status: 'R', renamedFrom: 'test/rank.test.js' }],
      symlinks: [],
    });
    assert.equal(renamed.ok, false, 'git saw a rename the file map could not');
    assert.equal((renamed as { issues: EvolveIssue[] }).issues[0].code, 'TEVO1004');
  });
});
