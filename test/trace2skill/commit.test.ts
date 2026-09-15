/**
 * The one application. Every refusal of the negative pool is caught before a
 * byte is written, the frozen directory is the same afterwards, and a run that
 * has staged its candidate does not apply a second patch.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  consolidate, createCandidateCommitter, createMemoryTrace2SkillStore, isReplayOnly,
  type AnalystResult, type SkillChatClient, type SkillPatch, type SkillSnapshot,
} from '@tangleai/trace2skill';
import { mergeAuthoredOutput } from '../../benchmark/lib/trace2skill-script.ts';
import {
  RUN_ID, SCOPE, forbiddenTerms, operationsOf, patchOf, readFrozenSkill, readPatchDocuments, runRecord,
  type FixturePatchDocument,
} from './fixture.ts';

const frozen: SkillSnapshot = await readFrozenSkill();
const documents = await readPatchDocuments();
const forbidden = await forbiddenTerms();
const run = runRecord({ s0Hash: frozen.bundle.id });
const POOL = ['redundant-a', 'redundant-b', 'redundant-c', 'units-a', 'units-b'];

const rolloutIdOf = (taskId: string): string => {
  const seed = [...taskId].reduce((total, character) => (total * 31 + character.charCodeAt(0)) % 0xffff, 7);
  return seed.toString(16).padStart(4, '0').repeat(16);
};

async function documentPatch(name: string): Promise<SkillPatch> {
  const document = documents.get(name) as FixturePatchDocument;
  return patchOf({
    baseHash: document.baseHash ?? frozen.bundle.id,
    sourceRolloutIds: [rolloutIdOf(document.origin.rollout)],
    reasoning: document.rationale, operations: operationsOf(document),
  });
}

function analysisFor(patch: SkillPatch): AnalystResult {
  return {
    id: `${patch.id.slice(0, 32)}${'0'.repeat(32)}`, runId: RUN_ID, role: 'error', rolloutId: patch.sourceRolloutIds[0],
    s0Hash: frozen.bundle.id, status: 'patch', exclusion: null, diagnosis: '{}', repair: null,
    patchId: patch.id, spend: { calls: 1, tokens: 8, cost: null },
    idempotencyKey: `${patch.id.slice(0, 32)}${'1'.repeat(32)}`,
  };
}

function operator(inputs: { id: string, inputs: SkillPatch[] }): SkillChatClient {
  return {
    endpoint: { provider: 'test' },
    async complete() {
      return {
        message: { role: 'assistant', content: JSON.stringify(mergeAuthoredOutput(inputs.inputs)) },
        finishReason: 'stop', usage: { total_tokens: 64 },
      };
    },
  };
}

async function seededStore(pool: readonly SkillPatch[]): Promise<ReturnType<typeof createMemoryTrace2SkillStore>> {
  const store = createMemoryTrace2SkillStore();
  assert.ok((await store.putSnapshot(frozen)).valid);
  for (const patch of pool) {
    assert.ok((await store.putPatch(patch)).valid);
    assert.ok((await store.putAnalysis(analysisFor(patch))).valid);
  }
  return store;
}

const pool = await Promise.all(POOL.map(documentPatch));

it('the whole pool becomes one staged directory, applied exactly once', async () => {
  const store = await seededStore(pool);
  const result = await consolidate(run, pool, {
    store, client: group => operator(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.deepEqual(result.issues, []);
  const candidate = result.candidate;
  assert.ok(candidate !== null, 'the run stages one candidate');
  assert.equal(candidate.runId, run.id);
  assert.equal(candidate.parentId, frozen.bundle.id);
  assert.equal(candidate.finalPatchId, result.final?.id);
  assert.equal(candidate.scopeKey, SCOPE);
  assert.equal(result.counts.applications, 1);
  assert.equal(result.counts.unattributed, 0, 'every retained edit names a trajectory');
  assert.ok(candidate.semantic.valid && candidate.structural.valid);
  assert.ok(candidate.diffSummary.filesAdded >= 1 && candidate.diffSummary.linesAdded > 0);
  assert.ok(candidate.churn > 0);

  const staged = await store.getSnapshot(candidate.bundleId);
  assert.ok(staged.valid, staged.valid ? '' : JSON.stringify(staged.issues));
  assert.equal(staged.value.bundle.status, 'staged');
  assert.equal(staged.value.bundle.origin, 'evolved');
  assert.equal(staged.value.bundle.parentId, frozen.bundle.id);
  assert.ok(staged.value.files.some(file => file.path === 'references/units.md'));
  const root = staged.value.files.find(file => file.path === 'SKILL.md');
  assert.ok(root?.content?.includes('a comma for the decimal'), 'the merged euro rule landed in the root page');

  // The frozen directory is unchanged and still readable beside its child.
  const original = await store.getSnapshot(frozen.bundle.id);
  assert.ok(original.valid);
  assert.deepEqual(original.value.files.map(file => file.sha256), frozen.files.map(file => file.sha256));
  assert.equal((await store.listBy(SCOPE, 'candidates')).length, 1);
});

it('a single-patch pool is committed once without a merge call', async () => {
  const [only] = await Promise.all([documentPatch('redundant-a')]);
  const store = await seededStore([only]);
  const result = await consolidate(run, [only], {
    store, client: () => { throw new Error('a terminal pool must not reach the wire'); },
    snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.equal(result.fanOut.terminal, 'single');
  assert.equal(result.counts.calls, 0);
  assert.equal(result.counts.applications, 1);
  assert.equal(result.final?.id, only.id);
  assert.equal(result.candidate?.finalPatchId, only.id);
  assert.equal(result.candidate?.parentId, frozen.bundle.id);
  assert.equal((await store.listBy(RUN_ID, 'merges')).length, 0, 'a terminal pool records no merge node');
});

it('an intermediate merge result and a second application are both refused', async () => {
  const store = await seededStore(pool);
  const result = await consolidate(run, pool, {
    store, client: group => operator(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  const final = result.final as SkillPatch;
  const intermediate = result.fanOut.patches.find(patch => patch.id !== final.id) as SkillPatch;

  const committer = createCandidateCommitter({ store, run, frozen, finalPatchId: final.id, leaves: pool, forbidden });
  const refused = await committer.commit(intermediate);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1008');
  assert.equal(committer.applications, 0);

  const applied = await committer.commit(final);
  assert.ok(applied.valid, applied.valid ? '' : JSON.stringify(applied.issues));
  assert.equal(committer.applications, 1);
  const again = await committer.commit(final);
  assert.ok(!again.valid);
  assert.equal(again.issues[0].code, 'TT2S1008');
  assert.equal(committer.applications, 1);
});

it('every negative fixture is refused with its registered code and leaves the frozen directory alone', async () => {
  const store = await seededStore([]);
  const before = frozen.files.map(file => `${file.path}:${file.sha256}`).join('|');
  const committer = createCandidateCommitter({ store, run, frozen, finalPatchId: '0'.repeat(64), leaves: [], forbidden });

  for (const name of ['broken-link', 'format-breaking', 'invalid-target', 'non-atomic-create', 'stale-base', 'task-fact-leak']) {
    const document = documents.get(name) as FixturePatchDocument;
    const prepared = committer.prepare(await documentPatch(name));
    assert.ok(!prepared.valid, `${name} must not land`);
    assert.equal(prepared.issues[0].code, document.expectedCode, name);
    assert.equal(prepared.plan, null);
  }
  // The overlapping pair is one conflict and is compiled as one patch.
  const overlapping = await patchOf({
    baseHash: frozen.bundle.id,
    operations: ['overlap-a', 'overlap-b'].flatMap(name => operationsOf(documents.get(name) as FixturePatchDocument)),
  });
  const pair = committer.prepare(overlapping);
  assert.ok(!pair.valid);
  assert.equal(pair.issues[0].code, 'TT2S1004');

  assert.equal(frozen.files.map(file => `${file.path}:${file.sha256}`).join('|'), before);
  assert.equal((await store.listBy(SCOPE, 'bundles')).length, 1, 'only the frozen directory is stored');
  assert.equal((await store.listBy(SCOPE, 'candidates')).length, 0);
  assert.equal(committer.applications, 0);
});

it('a run that already staged its candidate replays it without a call or a second application', async () => {
  const store = await seededStore(pool);
  const first = await consolidate(run, pool, {
    store, client: group => operator(group), snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  const again = await consolidate(run, pool, {
    store, client: () => { throw new Error('a replay must not reach the wire'); },
    snapshot: frozen, modelIdentity: 'keyless', forbidden,
  });
  assert.equal(again.candidate?.id, first.candidate?.id);
  assert.equal(again.counts.calls, 0);
  assert.equal(again.counts.written, 0);
  assert.equal(again.counts.applications, 0, 'the application already happened');
  assert.ok(isReplayOnly(again, '/merges').valid, JSON.stringify(isReplayOnly(again, '/merges')));
  assert.equal((await store.listBy(SCOPE, 'candidates')).length, 1);
});

it('the guarded editor of the suite owns the application sequence', () => {
  const count = (pattern: string): number => {
    const found = execFileSync('sh', ['-c', `grep -rn "${pattern}" packages/trace2skill/src | wc -l`], { encoding: 'utf8' });
    return Number(found.trim());
  };
  assert.equal(count('createGuardedRefiner'), 2, 'one import and one construction, both in the committer');
  assert.deepEqual(
    execFileSync('grep', ['-rln', 'createGuardedRefiner', 'packages/trace2skill/src'], { encoding: 'utf8' }).trim().split('\n'),
    ['packages/trace2skill/src/commit.ts']);
  assert.equal(count("stage === 'snapshot'"), 0, 'no local snapshot/restore sequence exists');
  assert.equal(count('export function createCandidateCommitter'), 1);
});
