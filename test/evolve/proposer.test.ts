import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { createPatchRefiner, compileSurfacePolicy, ok, refuseOne } from '@tangleai/evolve';
import { createModelProposer } from '../../packages/evolve/src/proposer.ts';
import { loadSelectionRegistration } from '../../benchmark/lib/evolve-selection.ts';
import { experimentBudgets } from '../../benchmark/lib/evolve-host.ts';

const identity = { proposalId: 'example', strategyId: 'strategy', messages: [] };
const valid = { proposalId: identity.proposalId, strategyId: identity.strategyId, rationale: 'An evidenced change.', evidence: ['fixture'], patch: [{ op: 'add', path: '/files/x', value: 'ok' }], origin: 'model' };
function rig(options: { tier?: 'scripted' | 'live', tokens?: number, reply?: unknown, prepare?: () => ReturnType<typeof ok> | ReturnType<typeof refuseOne> } = {}) {
  let calls = 0;
  const budget = createBudgetAccount({ turns: 3, tokens: options.tokens ?? 200, ms: 1000 }, () => 0);
  const proposer = createModelProposer({ tier: options.tier ?? 'scripted', budget,
    prepare: options.prepare ?? (() => ok(true)),
    client: { endpoint: { provider: 'openai' }, complete: async () => {
      calls++; return { message: { content: options.reply ?? JSON.stringify(valid) }, usage: { total_tokens: 64 } };
    } },
  });
  return { proposer, budget, calls: () => calls };
}

describe('budgeted model proposals', () => {
  it('requires explicit authorization before a live client or budget is touched', async () => {
    const held = rig({ tier: 'live' });
    const refused = await held.proposer.propose(identity);
    assert.ok(!refused.ok && refused.issues[0].code === 'TEVO1010');
    assert.equal(held.calls(), 0);
    assert.deepEqual(held.budget.spent(), { turns: 0, tokens: 0, ms: 0 });
    assert.ok((await held.proposer.propose({ ...identity, authorize: true })).ok);
    assert.equal(held.calls(), 1);
  });
  it('prints the frozen CLI plan and refuses an unauthorized live run', async () => {
    await assert.rejects(promisify(execFile)(process.execPath, ['benchmark/evolve.ts', '--live', '--model', 'example/model', '--tokens', '512']), (error: unknown) => {
      const failed = error as { stdout: string, stderr: string };
      assert.deepEqual(JSON.parse(failed.stdout), { arm: 'live-model', rounds: 3, attempts: 6, model: 'example/model', tokenCeiling: 512 });
      assert.match(failed.stderr, /TEVO1010.*--authorize/);
      return true;
    });
  });
  it('charges a malformed reply once, refuses its schema and never repairs', async () => {
    const held = rig({ reply: '{"proposalId":' });
    const result = await held.proposer.propose(identity);
    assert.ok(!result.ok && result.issues[0].code === 'TEVO1001');
    assert.equal(held.calls(), 1);
    assert.equal(held.budget.spent().tokens, 64);
  });
  it('stops before a call at zero tokens and refuses a reply exhausting the ceiling', async () => {
    const zero = rig({ tokens: 0 });
    assert.equal((await zero.proposer.propose(identity)).ok, false);
    assert.equal(zero.calls(), 0);
    const held = rig({ tokens: 64 });
    const result = await held.proposer.propose(identity);
    assert.ok(!result.ok && result.issues[0].code === 'TEVO1005');
    assert.equal((await held.proposer.propose(identity)).ok, false);
    assert.equal(held.calls(), 1);
  });
  it('refuses identity replacement and preserves the guarded surface refusal', async () => {
    const changed = rig({ reply: JSON.stringify({ ...valid, strategyId: 'different' }) });
    const result = await changed.proposer.propose(identity);
    assert.ok(!result.ok && result.issues[0].code === 'TEVO1002');
    const held = rig({ prepare: () => refuseOne('TEVO1004', '/patch', 'goalpost: immutable') });
    const refused = await held.proposer.propose(identity);
    assert.ok(!refused.ok && refused.issues[0].code === 'TEVO1004');
  });
  it('bounds concurrent calls and releases its guard after a client failure', async () => {
    let release!: () => void, calls = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const proposer = createModelProposer({ tier: 'scripted', budget: createBudgetAccount({ turns: 2 }, () => 0), prepare: () => ok(true),
      client: { endpoint: { provider: 'openai' }, complete: async () => { calls++; await waiting; throw new Error('offline'); } } });
    const pending = proposer.propose(identity);
    assert.equal((await proposer.propose(identity)).ok, false);
    release();
    assert.equal((await pending).ok, false);
    assert.equal((await proposer.propose(identity)).ok, false);
    assert.equal(calls, 2);
  });
});

describe('registered adversarial model replies', () => {
  let loaded: Awaited<ReturnType<typeof loadSelectionRegistration>>;
  let prepare: ReturnType<typeof createPatchRefiner>['prepare'];
  const files: Record<string, string> = {};
  before(async () => {
    loaded = await loadSelectionRegistration();
    const { manifest } = loaded.fixture;
    for (const file of manifest.files) files[file.path] = await readFile(manifest.fixture.repo + '/' + file.path, 'utf8');
    const budgets = experimentBudgets(manifest);
    prepare = createPatchRefiner({ budgets, policy: compileSurfacePolicy({
      immutablePaths: [...manifest.policy.immutable.paths, ...manifest.policy.immutable.prefixes],
      generated: manifest.policy.immutable.generated.map(one => one.path), budgets,
    }) }).prepare;
  });
  it('refuses the model goalpost at exactly the hand-authored twin code', async () => {
    const entry = loaded.registration.modelReplies.find(row => row.expect.code === 'TEVO1004' && row.expect.reason === 'goalpost')!;
    const twin = loaded.fixture.proposals.find(row => row.document.id === entry.proposalId)!.document;
    const hand = prepare(files, { proposalId: twin.id, strategyId: twin.strategyId, rationale: twin.rationale, evidence: [twin.evidence], patch: twin.patch, origin: 'hand-authored' });
    const proposer = createModelProposer({ tier: 'scripted', budget: createBudgetAccount(loaded.registration.model, () => 0), prepare: proposal => prepare(files, proposal),
      client: { endpoint: { provider: 'openai' }, complete: async () => loaded.replies.get(entry.round + '-' + entry.attempt) } });
    const model = await proposer.propose({ proposalId: twin.id, strategyId: twin.strategyId, messages: [] });
    assert.ok(!hand.ok && !model.ok);
    assert.equal(hand.issues[0].code, 'TEVO1004');
    assert.equal(model.issues[0].code, hand.issues[0].code);
  });
});
