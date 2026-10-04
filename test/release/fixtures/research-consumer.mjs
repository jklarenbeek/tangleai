import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openTangleDb, createResearchStore, researchRunLogId, createRunLog } from '@tangleai/store';
import { exerciseResearchConsumer, qualifyResearchBrowser, qualifyResearchDiscoveryBrowser, qualifyResearchReasoningBrowser, qualifyResearchExecutionBrowser, qualifyResearchAnalysisBrowser } from './research-browser.mjs';
import { runResearchExample } from './research-example.mjs';

assert.match(import.meta.resolve('@tangleai/research'), /\.js$/);
const directory = process.env.TANGLE_FIXTURE_DIRECTORY; assert.ok(directory);
const original = globalThis.fetch; globalThis.fetch = () => { throw new Error('Research consumer forbids network access'); };
let db;
try {
  const expected = { state: 'LITERATURE_GATE', attempts: 1, replayed: true, bytes: [97, 98, 99],
    artifactId: 'art-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', refusal: 'TRSH1001' };
  assert.deepEqual(await qualifyResearchBrowser(), expected);
  assert.deepEqual(await qualifyResearchDiscoveryBrowser(), { doi: '10.5555/packed', rawHash: true, requests: 1, misses: 0, networkCalls: 0 });
  assert.deepEqual(await qualifyResearchReasoningBrowser(), { packs: 7, participants: 3, separateSynthesizer: true, generatedPlanSchema: true });
  assert.deepEqual(await qualifyResearchExecutionBrowser(), { status: 'ok', value: 2, signature: true, physical: 1, isolated: false, forged: 'TRSH1006', network: 'TRSH1010' });
  assert.deepEqual(await qualifyResearchAnalysisBrowser(), { support: 'not-supported', underpowered: true, decision: 'Stop', candidates: 1, reviewers: 2 });
  const path = join(directory, 'research.db'); db = await openTangleDb({ path });
  const run = await exerciseResearchConsumer(createResearchStore(db)); assert.deepEqual(run.summary, expected);
  const runLogId = await researchRunLogId(db, 'packed-research'); assert.ok(runLogId);
  await db.close(); db = await openTangleDb({ path });
  const replay = await createResearchStore(db).commitStage(run.plan); assert.ok(replay.ok && replay.replayed);
  assert.equal((await createRunLog(db).frames(runLogId)).length, 1);
  const lifecycle = await runResearchExample(join(directory, 'research-lifecycle.db'));
  assert.equal(lifecycle.status, 'COMPLETE'); assert.equal(lifecycle.approvals, 3);
  assert.equal(lifecycle.executions, 10); assert.equal(lifecycle.replayExecutions, 0); assert.equal(lifecycle.artifactIds.length, 26);
  assert.deepEqual(lifecycle.spend, { turns: 0, tokens: 0, ms: 0 });
  console.log(JSON.stringify({ researchInstalled: true, reopened: true, ...expected }));
} finally { await db?.close(); globalThis.fetch = original; }
