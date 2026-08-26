/**
 * @tangleai/pipeline — the memory loop as an executable jaren-dag.
 *
 * The scenario is the walking skeleton's: a near-verbatim repeat for
 * the gate, a paraphrase for the crystallizer, a numeric contradiction
 * for the judge. It runs twice — over the in-memory store and over the
 * SQLite store — and must tell the same story, which is the proof that
 * the MemoryStore seam holds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { createMemoryUnitStore, type MemoryStore, type MemoryUnitInput } from '@tangleai/memory';
import { openTangleDb, createDbMemoryStore } from '@tangleai/store';
import {
  createPipeline,
  dagToMermaid,
  PIPELINE_NODES,
  type DagNodeRecord,
} from '@tangleai/pipeline';

const OBSERVATIONS: MemoryUnitInput[] = [
  { text: 'The staging database lives on host db-staging.internal port 5432', evidence: 'ops handbook §3', tags: ['ops'], at: '2026-08-20T09:00:00Z' },
  { text: 'The staging database lives on host db-staging.internal port 5432.', evidence: 'ops handbook §3 (retold)', tags: ['ops'], at: '2026-08-21T09:00:00Z' },
  { text: 'The staging database is on db-staging.internal at port 5432', evidence: 'deploy log 2026-08-22', tags: ['ops'], at: '2026-08-22T10:00:00Z' },
  { text: 'The API rate limit is 100 requests per minute', evidence: 'gateway config v1', tags: ['api'], at: '2026-08-19T08:00:00Z' },
  { text: 'The API rate limit is 500 requests per minute', evidence: 'gateway config v2', tags: ['api'], at: '2026-08-23T08:00:00Z' },
];

let tick = 0;
const now = (): string => `2026-08-24T13:00:${String(tick++ % 60).padStart(2, '0')}Z`;

async function runOver(store: MemoryStore): Promise<{ report: any, records: DagNodeRecord[] }> {
  const records: DagNodeRecord[] = [];
  const pipeline = createPipeline({ store, now });
  const report = await pipeline.run(OBSERVATIONS, { onNode: (r) => records.push(r) });
  // every stored vector carries the identity of the embedder that wrote it
  for (const unit of await store.list()) {
    assert.deepEqual(unit.embeddedBy, { model: 'hash-trigram-256', dims: 256 });
    assert.equal(unit.embedding?.length, 256);
  }
  return { report, records };
}

function assertStory(report: any): void {
  assert.equal(report.observations, 5);
  assert.equal(report.embedded, 5, 'all observations arrived without vectors');
  assert.equal(report.model, 'hash-trigram-256', "the suite's reference embedder is the offline default");
  assert.equal(report.novelty.filtered, 1, 'the near-verbatim repeat is gated');
  assert.equal(report.novelty.admitted, 4);
  assert.equal(report.contradiction.contradictions, 1, 'the rate-limit conflict is caught');
  assert.equal(report.crystallize.merged, 1, 'the paraphrase pair crystallizes');
  // 4 admitted − 1 absorbed by crystallization (deleted; `mergedFrom` is
  // its tombstone) = 3 records, of which the contradiction loser is
  // superseded audit trail — leaving 2 live memories.
  assert.equal(report.memories.total, 3);
  assert.equal(report.memories.live, 2);
}

describe('createPipeline', () => {
  it('tells the skeleton story over the in-memory store', async () => {
    const { report, records } = await runOver(createMemoryUnitStore());
    assertStory(report);

    const seen = records.map((r) => r.id);
    for (const id of PIPELINE_NODES) {
      assert.ok(seen.includes(id), `onNode saw '${id}'`);
    }
    assert.ok(records.every((r) => r.status === 'ok'));
    assert.ok(seen.indexOf('novelty') < seen.indexOf('contradiction'),
      'contradiction resolves after the gate');
    assert.ok(seen.indexOf('contradiction') < seen.indexOf('crystallize'),
      'crystallization is last — the twice-learned ordering rule');
  });

  it('tells the same story over the SQLite store', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    const { report } = await runOver(createDbMemoryStore(db.collection('memories')));
    assertStory(report);
    await db.close();
  });

  it('a failing embedder fails the run closed with the node named', async () => {
    const store = createMemoryUnitStore();
    const pipeline = createPipeline({
      store,
      embedder: { model: 'broken', dims: undefined, embed: async () => { throw new Error('wire down'); } },
    });
    await assert.rejects(
      () => pipeline.run(OBSERVATIONS),
      (error: any) => error.nodeId === 'embed' || /embed/.test(String(error.message)),
    );
    assert.deepEqual(await store.list(), [], 'nothing was admitted by a failed run');
  });
});

describe('dagToMermaid', () => {
  it('projects the executable document, not a drawing beside it', () => {
    const text = dagToMermaid();
    assert.match(text, /flowchart TD/);
    for (const id of PIPELINE_NODES) {
      assert.ok(text.includes(id), `mermaid names '${id}'`);
    }
  });
});
