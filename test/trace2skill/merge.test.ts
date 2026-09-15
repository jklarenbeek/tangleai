/**
 * Hierarchical consolidation: the tree a pool is cut into, the refusals that
 * keep it honest, and the gate one merge group answers to.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryTrace2SkillStore, mergePatches, planMergeTree, renderMergeEvidence, supportOf,
  draftsOf, changelogActionOf, changelogLine,
  type AnalystResult, type SkillChatClient, type SkillPatch, type SkillSnapshot,
} from '@tangleai/trace2skill';
import { mergeAuthoredOutput } from '../../benchmark/lib/trace2skill-script.ts';
import {
  RUN_ID, SCOPE, forbiddenTerms, operationsOf, patchOf, readFrozenSkill, readPatchDocuments,
  runRecord, type FixturePatchDocument,
} from './fixture.ts';

const frozen: SkillSnapshot = await readFrozenSkill();
const documents = await readPatchDocuments();
const forbidden = await forbiddenTerms();
const run = runRecord({ s0Hash: frozen.bundle.id });

const POOL = ['redundant-a', 'redundant-b', 'redundant-c', 'units-a', 'units-b'];

/** A stored rollout is addressed by its idempotency key, so a test one is a digest too. */
const rolloutIdOf = (taskId: string): string => {
  const seed = [...taskId].reduce((total, character) => (total * 31 + character.charCodeAt(0)) % 0xffff, 7);
  return seed.toString(16).padStart(4, '0').repeat(16);
};

async function poolPatches(names: readonly string[] = POOL): Promise<SkillPatch[]> {
  return Promise.all(names.map(async name => {
    const document = documents.get(name) as FixturePatchDocument;
    return patchOf({
      baseHash: document.baseHash ?? frozen.bundle.id,
      sourceRolloutIds: [rolloutIdOf(document.origin.rollout)],
      reasoning: document.rationale, operations: operationsOf(document),
    });
  }));
}

/** One analyst row per pooled patch, so the merge can attribute its support. */
function analysisFor(patch: SkillPatch, role: AnalystResult['role']): AnalystResult {
  return {
    id: `${patch.id.slice(0, 32)}${'0'.repeat(32)}`, runId: RUN_ID, role, rolloutId: patch.sourceRolloutIds[0],
    s0Hash: frozen.bundle.id, status: 'patch', exclusion: null, diagnosis: '{}', repair: null,
    patchId: patch.id, spend: { calls: 1, tokens: 8, cost: null },
    idempotencyKey: `${patch.id.slice(0, 32)}${'1'.repeat(32)}`,
  };
}

/** A merge operator over the instrument's own rendering, so one rule answers both. */
function scriptedOperator(options: { delay?: (groupId: string) => number, answer?: (inputs: SkillPatch[]) => unknown } = {}) {
  const order: string[] = [];
  let calls = 0;
  return {
    get calls() { return calls; },
    get order() { return order; },
    client(group: { id: string, inputs: SkillPatch[] }): SkillChatClient {
      return {
        endpoint: { provider: 'test' },
        async complete(): Promise<{ message: { role: string, content: string }, finishReason: string, usage: { total_tokens: number } }> {
          calls++;
          const wait = options.delay?.(group.id) ?? 0;
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          order.push(group.id);
          const value = options.answer?.(group.inputs) ?? mergeAuthoredOutput(group.inputs);
          return { message: { role: 'assistant', content: JSON.stringify(value) }, finishReason: 'stop', usage: { total_tokens: 64 } };
        },
      };
    },
  };
}

async function seeded(patches: readonly SkillPatch[]): Promise<ReturnType<typeof createMemoryTrace2SkillStore>> {
  const store = createMemoryTrace2SkillStore();
  for (const patch of patches) {
    assert.ok((await store.putPatch(patch)).valid);
    assert.ok((await store.putAnalysis(analysisFor(patch, 'error'))).valid);
  }
  return store;
}

it('the planner cuts a pool into sorted contiguous groups and names every one of them', async () => {
  const ids = (await poolPatches()).map(patch => patch.id).sort();
  const planned = planMergeTree(ids, { bMerge: 4, lMax: 3 });
  assert.ok(planned.valid, planned.valid ? '' : JSON.stringify(planned.issues));
  assert.equal(planned.value.terminal, 'hierarchical');
  assert.equal(planned.value.levelCount, 2);
  assert.equal(planned.value.groupCount, 3);
  assert.deepEqual(planned.value.levels.map(level => level.groups.map(group => group.id)),
    [['merge-1-1', 'merge-1-2'], ['merge-2-1']]);
  assert.deepEqual(planned.value.levels[0].groups.map(group => group.members.length), [4, 1]);
  assert.deepEqual(planned.value.levels[1].groups[0].members, ['merge-1-1', 'merge-1-2']);
  assert.equal(planned.value.finalGroupId, 'merge-2-1');
  // A shuffled pool is the same tree: membership follows the sorted order.
  const shuffled = planMergeTree([...ids].reverse(), { bMerge: 4, lMax: 3 });
  assert.ok(shuffled.valid);
  assert.deepEqual(shuffled.value, planned.value);
});

it('a group size below two and a plan deeper than the run allows are refused, never truncated', () => {
  const ids = Array.from({ length: 9 }, (_, index) => `p${index}`);
  const small = planMergeTree(ids, { bMerge: 1, lMax: 3 });
  assert.ok(!small.valid);
  assert.equal(small.issues[0].code, 'TT2S1008');
  assert.equal(small.issues[0].path, '/bMerge');

  const deep = planMergeTree(ids, { bMerge: 2, lMax: 3 });
  assert.ok(!deep.valid, 'nine patches need four levels at a group size of two');
  assert.equal(deep.issues[0].code, 'TT2S1008');
  assert.match(deep.issues[0].detail, /9 patches need 4 levels/);
  assert.match(deep.issues[0].detail, /allows 3/);

  // The exact power of a group size is still one division per level.
  const exact = planMergeTree(Array.from({ length: 1000 }, (_, index) => `q${index}`), { bMerge: 10, lMax: 3 });
  assert.ok(exact.valid, exact.valid ? '' : JSON.stringify(exact.issues));
  assert.equal(exact.value.levelCount, 3);

  const twice = planMergeTree(['a', 'a'], { bMerge: 2, lMax: 3 });
  assert.ok(!twice.valid);
  assert.equal(twice.issues[0].code, 'TT2S1008');
});

it('a plan the run does not allow refuses the whole pool before a single call', async () => {
  const pool = await poolPatches();
  const narrow = runRecord({ s0Hash: frozen.bundle.id, bMerge: 2, lMax: 1 });
  const fan = await mergePatches(narrow, pool, {
    store: await seeded(pool), client: () => { throw new Error('a refused plan must not reach the wire'); },
    snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.equal(fan.final, null);
  assert.deepEqual(fan.nodes, []);
  assert.equal(fan.counts.calls, 0, 'a refused plan spends nothing');
  assert.equal(fan.counts.refused, 1);
  assert.equal(fan.issues[0].code, 'TT2S1008');
  assert.match(fan.issues[0].detail, /5 patches need 3 levels/);
  assert.equal(fan.plan.pool.length, pool.length, 'the pool is refused, never truncated');
});

it('an empty pool and a single patch are explicit terminals that spend nothing', async () => {
  const empty = await mergePatches(run, [], {
    store: await seeded([]), client: () => { throw new Error('a terminal pool must not call the wire'); },
    snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.equal(empty.terminal, 'empty');
  assert.equal(empty.final, null);
  assert.deepEqual(empty.nodes, []);
  assert.equal(empty.counts.calls, 0);

  const [only] = await poolPatches(['redundant-a']);
  const single = await mergePatches(run, [only], {
    store: await seeded([only]), client: () => { throw new Error('a terminal pool must not call the wire'); },
    snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.equal(single.terminal, 'single');
  assert.equal(single.final?.id, only.id);
  assert.equal(single.counts.calls, 0);
  assert.equal(single.counts.errorSupport, 1);
});

it('the committed pool merges level by level into one patch that names every trajectory', async () => {
  const pool = await poolPatches();
  const store = await seeded(pool);
  const operator = scriptedOperator();
  const fan = await mergePatches(run, pool, {
    store, client: group => operator.client(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.deepEqual(fan.issues, []);
  assert.equal(fan.counts.levels, 2);
  assert.equal(fan.counts.groups, 3);
  assert.equal(fan.counts.merged, 3);
  assert.equal(operator.calls, 3);
  assert.equal(fan.nodes.length, 3);
  assert.deepEqual(fan.nodes.map(node => [node.level, node.groupIndex]), [[1, 1], [1, 2], [2, 1]]);

  const final = fan.final as SkillPatch;
  assert.equal(final.baseHash, frozen.bundle.id);
  assert.equal(final.supportCount, 5);
  assert.deepEqual([...final.sourceRolloutIds].sort(),
    ['task-01', 'task-03', 'task-13', 'task-17', 'task-22'].map(rolloutIdOf).sort());
  assert.equal(final.sourcePatchIds.length, 2, 'the final patch names the two groups of the level below it');
  assert.equal(final.validation.state, 'compiled');
  for (const line of final.changelog) assert.notEqual(changelogActionOf(line), null);

  const support = supportOf(final, new Map(pool.map(patch => [patch.sourceRolloutIds[0], 'error' as const])));
  assert.deepEqual(support, { successSupport: 0, errorSupport: 5 });
  assert.equal((await store.listBy(RUN_ID, 'merges')).length, 3);
});

it('shuffled completion order yields the same node identities and the same decisions', async () => {
  const pool = await poolPatches();
  const forward = scriptedOperator({ delay: groupId => (groupId === 'merge-1-1' ? 0 : 6) });
  const reversed = scriptedOperator({ delay: groupId => (groupId === 'merge-1-1' ? 6 : 0) });
  const first = await mergePatches(run, pool, {
    store: await seeded(pool), client: group => forward.client(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  const second = await mergePatches(run, pool, {
    store: await seeded(pool), client: group => reversed.client(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.notDeepEqual(forward.order, reversed.order, 'the two runs must actually finish in different orders');
  assert.deepEqual(first.nodes.map(node => node.id), second.nodes.map(node => node.id));
  assert.deepEqual(first.nodes.map(node => node.report), second.nodes.map(node => node.report));
  assert.equal(first.final?.id, second.final?.id);
});

it('a merged proposal meets the same gate every analyst patch met', async () => {
  const pool = await poolPatches(['redundant-a', 'redundant-b']);
  const leak = documents.get('task-fact-leak') as FixturePatchDocument;
  const leaked = await patchOf({ baseHash: frozen.bundle.id, operations: operationsOf(leak) });
  const refused = await mergePatches(run, pool, {
    store: await seeded(pool), snapshot: frozen, modelIdentity: 'keyless', forbidden, maxRepairs: 0,
    client: () => scriptedOperator({
      answer: inputs => ({
        reasoning: 'the group agreed',
        operations: leaked.operations,
        changelog: [{ action: 'kept', detail: 'one proposal', sourcePatchIds: [inputs[0].id] }],
      }),
    }).client({ id: 'merge-1-1', inputs: pool }),
  });
  assert.equal(refused.final, null);
  assert.ok(refused.issues.some(issue => issue.code === 'TT2S1006'), JSON.stringify(refused.issues));

  const foreign = await mergePatches(run, pool, {
    store: await seeded(pool), snapshot: frozen, modelIdentity: 'keyless', forbidden, maxRepairs: 0,
    client: group => scriptedOperator({
      answer: inputs => ({
        reasoning: 'the group agreed',
        operations: inputs[0].operations,
        changelog: [{ action: 'kept', detail: 'one proposal', sourcePatchIds: ['b'.repeat(64)] }],
      }),
    }).client(group),
  });
  assert.equal(foreign.final, null);
  assert.ok(foreign.issues.some(issue => issue.code === 'TT2S1007'), JSON.stringify(foreign.issues));
});

it('a stored level replays without spending a call and produces the same patch', async () => {
  const pool = await poolPatches();
  const store = await seeded(pool);
  const first = await mergePatches(run, pool, {
    store, client: group => scriptedOperator().client(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  const again = await mergePatches(run, pool, {
    store, client: () => { throw new Error('a replay must not reach the wire'); },
    snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.equal(again.counts.calls, 0);
  assert.equal(again.counts.written, 0);
  assert.equal(again.counts.reused, 3);
  assert.equal(again.final?.id, first.final?.id);
});

it('the evidence a group reads is the frozen directory and its own inputs, and the log round-trips', async () => {
  const pool = await poolPatches(['redundant-a', 'units-a']);
  const rendered = renderMergeEvidence(
    { bundle: frozen.bundle, files: draftsOf(frozen.files) }, pool,
    new Map(pool.map(patch => [patch.sourceRolloutIds[0], 'error' as const])), run.supportThreshold);
  const evidence = JSON.parse(rendered) as { skill: { bundleId: string, files: unknown[] }, patches: unknown[], supportThreshold: number };
  assert.equal(evidence.skill.bundleId, frozen.bundle.id);
  assert.equal(evidence.skill.files.length, 2);
  assert.equal(evidence.patches.length, 2);
  assert.equal(evidence.supportThreshold, run.supportThreshold);
  assert.ok(!rendered.includes('references/units.md\n'), 'the evidence carries no edited directory');

  const line = changelogLine({ action: 'routed-to-references', detail: 'moved into a reference page', sourcePatchIds: ['x'] });
  assert.equal(changelogActionOf(line), 'routed-to-references');
  assert.equal(changelogActionOf('not a decision'), null);
  assert.equal(SCOPE, frozen.bundle.scopeKey);
});
