/**
 * The closed shapes, and the capability that cannot be spelled.
 *
 * The last case is the load-bearing one: a principal carrying `merge` is
 * refused by the SCHEMA, not by a check somewhere downstream. That is the
 * difference between an authority a mutator is denied and an authority
 * the vocabulary does not contain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkShape, checkRecordShape, sealRecord, validateRecord, DEFAULT_EVOLVE_BUDGETS, AUTOMATION_PRINCIPAL } from '@tangleai/evolve';

const REVISION = 'a'.repeat(40);

const repository = {
  schemaVersion: 1,
  kind: 'repository',
  repositoryId: 'tangle',
  vcs: 'git',
  protectedRefs: ['main', 'master'],
  policy: {
    immutablePaths: ['test', 'benchmark'],
    generated: ['src/generated'],
    gate: { command: 'npm', args: ['run', 'check'] },
    instrument: { command: 'node', args: ['bench.mjs'], metric: { name: 'ndcg', direction: 'higher', schema: { type: 'object' } } },
    thresholdsPath: 'bench/truth.json',
  },
  allow: { commands: ['npm', 'node', 'git'] },
  budgets: DEFAULT_EVOLVE_BUDGETS,
};

describe('evolve record shapes', () => {
  it('seals a record and refuses one whose bytes do not match its id', async () => {
    const sealed = await sealRecord<{ id: string }>(repository);
    assert.equal(sealed.ok, true);
    assert.match((sealed as { value: { id: string } }).value.id, /^[a-f0-9]{64}$/);

    const tampered = { ...repository, id: 'b'.repeat(64) };
    const refused = await validateRecord(tampered);
    assert.equal(refused.ok, false);
    assert.equal((refused as { issues: Array<{ code: string, path: string }> }).issues[0].code, 'TEVO1002');
    assert.equal((refused as { issues: Array<{ code: string, path: string }> }).issues[0].path, '/id');
  });

  it('refuses an unknown member and a missing required member as TEVO1001', async () => {
    const unknown = checkRecordShape({ ...repository, id: 'c'.repeat(64), surprise: true });
    assert.equal(unknown.ok, false);
    assert.equal((unknown as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');

    const { protectedRefs: _dropped, ...missing } = repository;
    const incomplete = checkRecordShape({ ...missing, id: 'c'.repeat(64) });
    assert.equal(incomplete.ok, false);
    assert.equal((incomplete as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');
  });

  it('refuses a principal that claims a merge capability', () => {
    const accepted = checkShape('evolvePrincipal', AUTOMATION_PRINCIPAL);
    assert.equal(accepted.ok, true);

    const overreaching = checkShape('evolvePrincipal', { ...AUTOMATION_PRINCIPAL, merge: true });
    assert.equal(overreaching.ok, false, 'the schema is closed, so merge cannot be declared');
    assert.equal((overreaching as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');
  });

  it('refuses a negative budget and a second attempt per leg', () => {
    const negative = checkShape('evolveBudgets', { ...DEFAULT_EVOLVE_BUDGETS, patchBytes: -1 });
    assert.equal(negative.ok, false);

    const retried = checkShape('evolveBudgets', { ...DEFAULT_EVOLVE_BUDGETS, attemptsPerLeg: 2 });
    assert.equal(retried.ok, false, 'a single-send leg is never retried, so the schema pins it at one');
  });

  it('refuses a patch operation outside the file tree and a non-JSON value', async () => {
    const escaping = checkRecordShape({
      schemaVersion: 1, kind: 'patch', id: 'd'.repeat(64), patchId: 'p1',
      operations: [{ op: 'replace', path: '/config/secret', value: 1 }], files: 1, bytes: 10,
    });
    assert.equal(escaping.ok, false, 'a patch addresses files and nothing else');

    const cyclic: Record<string, unknown> = { schemaVersion: 1, kind: 'patch' };
    cyclic.self = cyclic;
    const refused = await sealRecord(cyclic);
    assert.equal(refused.ok, false);
    assert.equal((refused as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');
  });

  it('refuses a proposal missing its evidence and accepts one that carries it', async () => {
    const base = {
      schemaVersion: 1, kind: 'proposal', proposalId: 'p1', experimentId: 'e1',
      strategyId: 's1', patchId: 'patch1', rationale: 'narrow the loop',
      origin: 'hand-authored', configuration: { kind: 'scripted', revision: 'r1' },
    };
    const missing = checkRecordShape({ ...base, id: 'e'.repeat(64) });
    assert.equal(missing.ok, false, 'evidence is required, even when empty');

    const sealed = await sealRecord<{ id: string }>({ ...base, evidence: [] });
    assert.equal(sealed.ok, true);
  });

  it('refuses an experiment whose base revision is not a full commit', async () => {
    const experiment = {
      schemaVersion: 1, kind: 'experiment', experimentId: 'e1', repositoryId: 'tangle',
      baseRevision: REVISION, strategyId: 's1', proposalId: 'p1', status: 'proposed',
      runIdentityId: 'run/1', revision: 0, history: [],
    };
    assert.equal((await sealRecord(experiment)).ok, true);
    assert.equal(checkRecordShape({ ...experiment, id: 'f'.repeat(64), baseRevision: 'abc' }).ok, false);
  });
});
