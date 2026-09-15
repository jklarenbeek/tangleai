/**
 * Strategies written through the owners that already exist.
 *
 * The ledger owns skill validation and the outcome store owns memory
 * carriers, so the interesting assertions here are about what is NOT
 * invented: a refused skill comes back carrying the ledger's own reason,
 * and a second identical registration writes nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLedger } from '@tangleai/context/ledger';
import { createMemoryOutcomeStore } from '@tangleai/outcomes';
import { createStrategyLibrary } from '@tangleai/evolve';

const AT = '2026-01-01T00:00:00.000Z';
const now = () => AT;

const registration = {
  strategyId: 'narrow-the-loop',
  skillId: 'skill-narrow-loop',
  memoryId: 'memory-narrow-loop',
  name: 'Narrow the loop',
  when: 'a ranking loop rescans rows it already rejected',
  instructions: 'Hoist the invariant out of the loop body and keep the comparison total.',
  evidence: ['experiment/e1'],
  origin: 'hand-authored' as const,
  revision: 'r1',
  at: AT,
};

const library = () => {
  const ledger = createLedger({ now });
  const outcomeStore = createMemoryOutcomeStore();
  return { ledger, outcomeStore, strategies: createStrategyLibrary({ ledger: ledger as never, outcomeStore }) };
};

describe('the strategy library', () => {
  it('writes one skill and one memory carrier, and is a read the second time', async () => {
    const { ledger, outcomeStore, strategies } = library();

    const first = await strategies.register(registration);
    assert.equal(first.ok, true);
    assert.equal((first as { value: { writes: number } }).value.writes, 1);

    const skills = await ledger.listSkills();
    assert.ok(Array.isArray(skills));
    assert.equal(skills.length, 1, 'one skill, in the ledger that owns skills');
    assert.equal(skills[0].id, registration.skillId);

    const carrier = await outcomeStore.memories.get(registration.memoryId);
    assert.ok(carrier, 'the outcome lifecycle resolves against a memory carrier');
    assert.deepEqual((carrier as { tags: string[] }).tags, ['evolve-strategy']);
    assert.equal((carrier as { confidence: number }).confidence, 0.5);

    const second = await strategies.register(registration);
    assert.equal(second.ok, true);
    assert.equal((second as { value: { writes: number } }).value.writes, 0, 'a resumed run cannot double-count');
    assert.equal((await ledger.listSkills() as unknown[]).length, 1);
  });

  it('carries the ledger refusal as the cause rather than restating it', async () => {
    const { strategies } = library();
    const refused = await strategies.register({ ...registration, when: '' });
    assert.equal(refused.ok, false);
    const issue = (refused as { issues: Array<{ code: string, path: string, cause?: { message: string } }> }).issues[0];
    assert.equal(issue.code, 'TEVO1011');
    assert.equal(issue.path, '/skillId');
    assert.ok(issue.cause, 'the ledger said why, and that survives the translation');
    assert.ok(issue.cause!.message.length > 0);
  });

  it('preserves the ledger reason when recall has no embedder', async () => {
    const { strategies } = library();
    assert.equal((await strategies.register(registration)).ok, true);

    const recalled = await strategies.recall({ near: 'ranking loop' });
    assert.equal(recalled.ok, false, 'recall without an embedder cannot rank');
    const issue = (recalled as { issues: Array<{ code: string, cause?: { message: string } }> }).issues[0];
    assert.equal(issue.code, 'TEVO1011');
    assert.ok(issue.cause!.message.length > 0, 'the ledger owns the reason');
  });

  it('lists and gets what it registered', async () => {
    const { strategies } = library();
    await strategies.register(registration);
    await strategies.register({ ...registration, strategyId: 'a-second', skillId: 'skill-2', memoryId: 'memory-2' });

    const listed = await strategies.list();
    assert.equal(listed.ok, true);
    assert.deepEqual((listed as { value: Array<{ strategyId: string }> }).value.map(row => row.strategyId),
      ['a-second', 'narrow-the-loop'], 'a stable order, so two runs render the same');

    const found = await strategies.get('narrow-the-loop');
    assert.equal((found as { value: { skillId: string } | null }).value?.skillId, registration.skillId);
    assert.equal((await strategies.get('absent') as { value: unknown }).value, null);
  });
});
