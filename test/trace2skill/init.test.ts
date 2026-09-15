/**
 * The starting directory a run pins: imported from bytes, stored staged, and
 * addressed by the identity the corpus already registered. One executor
 * factory and one fan-out exist in the package, proven by grep rather than by
 * assertion.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createMemoryTrace2SkillStore, importS0, skillRootText } from '@tangleai/trace2skill';
import { FIXTURE_FILES, FROZEN_BUNDLE_ID, SCOPE } from './fixture.ts';

it('the frozen directory imports to the registered identity and is stored staged', async () => {
  const store = createMemoryTrace2SkillStore();
  const imported = await importS0(store, await FIXTURE_FILES(), { scopeKey: SCOPE, mode: 'deepening', origin: 'human-import' });
  assert.ok(imported.valid, imported.valid ? '' : JSON.stringify(imported.issues));
  assert.equal(imported.value.bundle.id, FROZEN_BUNDLE_ID);
  assert.equal(imported.value.bundle.status, 'staged');
  assert.equal(imported.value.bundle.origin, 'human-import');
  assert.equal(imported.value.files.length, 2);

  const stored = await store.getSnapshot(FROZEN_BUNDLE_ID);
  assert.ok(stored.valid);
  assert.equal(stored.value.files.length, 2);

  // Importing the same bytes twice is a replay, not a second directory.
  const again = await importS0(store, await FIXTURE_FILES(), { scopeKey: SCOPE, mode: 'deepening', origin: 'human-import' });
  assert.ok(again.valid);
  assert.equal(again.value.bundle.id, FROZEN_BUNDLE_ID);
  assert.equal((await store.listBy(SCOPE, 'bundles')).length, 1);
  assert.ok(store.stats().replays > 0);
});

it('a directory whose bytes name another scope is a different directory', async () => {
  const store = createMemoryTrace2SkillStore();
  const other = await importS0(store, await FIXTURE_FILES(), { scopeKey: 'other-scope', mode: 'deepening', origin: 'human-import' });
  assert.ok(other.valid);
  assert.notEqual(other.value.bundle.id, FROZEN_BUNDLE_ID);
});

it('the root page is handed out as bytes and an unreadable one refuses', async () => {
  const store = createMemoryTrace2SkillStore();
  const imported = await importS0(store, await FIXTURE_FILES(), { scopeKey: SCOPE, mode: 'deepening', origin: 'human-import' });
  assert.ok(imported.valid);
  const root = skillRootText(imported.value);
  assert.ok(root.valid);
  assert.ok(root.value.startsWith('# Tabular extraction'));

  const emptied = { ...imported.value, files: imported.value.files.map(file => ({ ...file, content: file.path === 'SKILL.md' ? null : file.content })) };
  const refused = skillRootText(emptied);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1005');
});

it('one executor factory and one fan-out per stage exist in the package', () => {
  const found = (pattern: string): string[] =>
    execFileSync('grep', ['-rln', pattern, 'packages/trace2skill/src'], { encoding: 'utf8' }).trim().split('\n').sort();
  // Three stages fan out and all of them consume the suite's ordered helper;
  // nothing here schedules work of its own.
  assert.deepEqual(found('mapConcurrent'), [
    'packages/trace2skill/src/analysts.ts', 'packages/trace2skill/src/merge.ts', 'packages/trace2skill/src/rollouts.ts',
  ]);
  assert.deepEqual(found('export function createSkillExecutor'), ['packages/trace2skill/src/executor.ts']);
  assert.deepEqual(found('export async function runRollouts'), ['packages/trace2skill/src/rollouts.ts']);
  assert.deepEqual(found('export async function dispatchAnalysts'), ['packages/trace2skill/src/analysts.ts']);
  assert.deepEqual(found('export function createRepairSandbox'), ['packages/trace2skill/src/analyst-tools.ts']);
  assert.deepEqual(found('export async function mergePatches'), ['packages/trace2skill/src/merge.ts']);
  assert.deepEqual(found('export function planMergeTree'), ['packages/trace2skill/src/merge.ts']);
  // The directory is used directly: no agent here is given a ledger or a
  // retrieval block, and nothing recalls a skill bank.
  const retrieval = execFileSync('sh', ['-c', 'grep -rln "recallSkills\\|retrieval:\\|ledger:" packages/trace2skill/src || true'], { encoding: 'utf8' }).trim();
  assert.equal(retrieval, '', 'the package must carry no retrieval path');
});
