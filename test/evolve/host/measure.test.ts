/**
 * Measurement, and the bracket around the most dangerous thing this
 * campaign does.
 *
 * The base side runs the registered instrument in the OPERATOR'S OWN ROOT.
 * That is unavoidable — the base number has to come from the base — and it
 * is why the root is sealed before and after every batch. The test that
 * matters most here mutates the base between the two seals and asserts
 * `TEVO1003`: an instrument that writes into the base has invalidated
 * every number in the run, including the samples already taken, and the
 * only honest answer is to stop rather than to publish a comparison
 * against a moving target.
 *
 * The replay test is the other half of the same idea. A resumed experiment
 * must reproduce its measurement without spawning anything, which is why
 * the sample NUMBER lives in the effect record and not only in the text
 * the child printed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { measureFitness, measurePlan } from '@tangleai/evolve/host';
import type { WorktreeHost } from '@tangleai/evolve/host';

import { withEvolveRepository, stageProposal, operatorDigest, type EvolveRepositoryFixture } from './fixture.ts';

const LOWER = { name: 'comparisons', direction: 'lower' as const };

function measureOver(fixture: EvolveRepositoryFixture, experimentId: string, worktreePath: string, host?: WorktreeHost) {
  return measureFitness({
    driver: fixture.driver,
    effects: fixture.store,
    host: host ?? fixture.host,
    experimentId,
    worktreePath,
    repositoryRoot: fixture.repositoryRoot,
    args: fixture.instrumentArgs,
    metric: LOWER,
    samples: fixture.repository.budgets.samples,
    baseRevision: fixture.baseRevision,
    truth: fixture.truth,
    minDelta: 1,
    transcript: fixture.transcript,
  });
}

describe('planning a sample batch', () => {
  it('names each leg by its side, so two batches cannot be confused', () => {
    const base = measurePlan({
      experimentId: 'e1', side: 'measure-base', name: 'instrument-base',
      args: ['bench/fitness.mjs'], cwd: '/repo', samples: 3,
    });
    const candidate = measurePlan({
      experimentId: 'e1', side: 'measure-candidate', name: 'instrument',
      args: ['bench/fitness.mjs'], cwd: '/work', samples: 3,
    });
    assert.deepEqual(base.legs.map(leg => leg.id), ['base-sample-0', 'base-sample-1', 'base-sample-2']);
    assert.deepEqual(candidate.legs.map(leg => leg.id), ['candidate-sample-0', 'candidate-sample-1', 'candidate-sample-2']);
    assert.notEqual(base.id, candidate.id, 'each side is its own operation and its own job');
    for (const leg of [...base.legs, ...candidate.legs]) {
      assert.equal(leg.maxAttempts, 1, 'a sample is never retried into the answer somebody wanted');
    }
  });
});

describe('measuring against the base', () => {
  it('takes the registered sample count per side and reads the base as the registered truth', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-improve', 'improve-partial-select');
      const measured = await measureOver(fixture, 'e-improve', staged.path);
      assert.equal(measured.ok, true, JSON.stringify(measured));
      const value = (measured as {
        value: {
          record: { base: { samples: number[], median: number }, candidate: { median: number }, truth: number, delta: number },
          comparison: string, refused: number,
        },
      }).value;

      const samples = fixture.repository.budgets.samples;
      assert.equal(value.record.base.samples.length, samples, 'the base side took its registered samples');
      // The transcript holds one entry per leg that actually ran, which is
      // a precise count in a way the runner's total (git calls included) is not.
      assert.equal(fixture.transcript.size, samples * 2, 'and both sides ran, once per sample');
      assert.equal(value.record.base.median, fixture.truth,
        'the base measures exactly what the registration pins; anything else is drift');
      assert.equal(value.refused, 0);
      assert.equal(value.comparison, 'improved', 'bounded selection costs fewer comparisons');
      assert.ok(value.record.delta > 0, 'a positive delta always means better');
    });
  });

  it('calls a change that measures the same equal, not an improvement', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-noop', 'noop-comment');
      const measured = await measureOver(fixture, 'e-noop', staged.path);
      assert.equal(measured.ok, true, JSON.stringify(measured));
      const value = (measured as { value: { comparison: string, delta: number } }).value;
      assert.equal(value.comparison, 'equal', 'a comment costs nothing and earns nothing');
      assert.equal(value.delta, 0);
    });
  });

  it('leaves the repository root byte-identical, and at the registered revision', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-clean', 'noop-comment');
      const before = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
      const beforeDigest = await fixture.host.trackedDigest(fixture.repositoryRoot);

      assert.equal((await measureOver(fixture, 'e-clean', staged.path)).ok, true);

      const after = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
      const afterDigest = await fixture.host.trackedDigest(fixture.repositoryRoot);
      assert.equal(after, before, 'running the instrument in the base changed nothing in the base');
      assert.deepEqual(afterDigest, beforeDigest);

      const inspected = await fixture.host.inspect();
      assert.equal((inspected as { value: { revision: string } }).value.revision, fixture.baseRevision);
    });
  });
});

describe('the base guard', () => {
  it('refuses TEVO1003 when the base moves between the two seals', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-drift', 'noop-comment');

      // A genuine mutation, timed to land between the batch and the second
      // seal — exactly what a fitness instrument that writes would do. The
      // refusal then comes from the real digest comparison, not from a stub.
      let seals = 0;
      const drifting: WorktreeHost = {
        ...fixture.host,
        inspect: () => fixture.host.inspect(),
        trackedDigest: async (path: string) => {
          seals += 1;
          if (seals === 2) {
            await writeFile(join(fixture.repositoryRoot, 'src', 'rank.js'),
              '// the instrument wrote here\nexport function topK() { return []; }\n');
          }
          return fixture.host.trackedDigest(path);
        },
      };

      const measured = await measureOver(fixture, 'e-drift', staged.path, drifting);
      assert.equal(measured.ok, false, 'a base that moved makes every number in the run void');
      const issue = (measured as { issues: Array<{ code: string, path: string }> }).issues[0];
      assert.equal(issue.code, 'TEVO1003');
      assert.equal(issue.path, '/base');
    });
  });

  it('refuses before any spawn when the root is not at the registered base', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-wrong', 'noop-comment');
      const measured = await measureFitness({
        driver: fixture.driver, effects: fixture.store, host: fixture.host,
        experimentId: 'e-wrong', worktreePath: staged.path, repositoryRoot: fixture.repositoryRoot,
        args: fixture.instrumentArgs, metric: LOWER, samples: 3,
        baseRevision: '0'.repeat(40), truth: fixture.truth, transcript: fixture.transcript,
      });
      assert.equal(measured.ok, false);
      assert.equal((measured as { issues: Array<{ code: string, path: string }> }).issues[0].path, '/base/revision');
      assert.equal(fixture.transcript.size, 0, 'the instrument never ran');
    });
  });

  it('refuses a sample count that measures nothing', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-zero', 'noop-comment');
      const measured = await measureFitness({
        driver: fixture.driver, effects: fixture.store, host: fixture.host,
        experimentId: 'e-zero', worktreePath: staged.path, repositoryRoot: fixture.repositoryRoot,
        args: fixture.instrumentArgs, metric: LOWER, samples: 0,
        baseRevision: fixture.baseRevision, truth: fixture.truth, transcript: fixture.transcript,
      });
      assert.equal(measured.ok, false);
      assert.equal((measured as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');
      assert.equal(fixture.transcript.size, 0, 'refused before it read anything at all');
    });
  });
});

describe('an instrument that cannot be read', () => {
  it('is unverifiable rather than a regression when the candidate fails to measure', async () => {
    await withEvolveRepository(async (fixture) => {
      // The regression returns one record short, so the instrument exits
      // non-zero and prints no sample. Nothing readable is not a low score.
      const staged = await stageProposal(fixture, 'e-regress', 'regress-off-by-one');
      const measured = await measureOver(fixture, 'e-regress', staged.path);
      assert.equal(measured.ok, false, 'a side with nothing readable has no median to compare');
      const issues = (measured as { issues: Array<{ code: string, path: string }> }).issues;
      assert.ok(issues.every(issue => issue.code === 'TEVO1008'));
      assert.ok(issues.some(issue => issue.path.includes('measure-candidate')),
        'and the refusal names which side and which sample');
    });
  });
});

describe('replaying a measurement', () => {
  it('reads the recorded samples back without spawning the instrument again', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-replay', 'improve-partial-select');
      const first = await measureOver(fixture, 'e-replay', staged.path);
      assert.equal(first.ok, true, JSON.stringify(first));
      const ran = fixture.transcript.size;
      assert.equal(ran, fixture.repository.budgets.samples * 2);

      const again = await measureOver(fixture, 'e-replay', staged.path);
      assert.equal(again.ok, true, JSON.stringify(again));
      assert.equal(fixture.transcript.size, ran,
        'a replayed measurement must not run the instrument a second time');

      const firstRecord = (first as { value: { record: { id: string } } }).value.record;
      const againRecord = (again as { value: { record: { id: string } } }).value.record;
      assert.equal(againRecord.id, firstRecord.id, 'and it seals to the same identity');
    });
  });
});
