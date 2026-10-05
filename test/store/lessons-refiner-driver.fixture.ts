import assert from 'node:assert/strict';
import { openTangleDb, createResearchStore, RESEARCH_COLLECTIONS, TRACE2SKILL_COLLECTIONS } from '@tangleai/store';
import { faultProbe, memoryHarness } from '../research/store-harness.ts';
import { runLessonRefinerParity, type LessonRefinerHarness } from '../research/lessons-refiner-parity.ts';

async function sqlite(): Promise<LessonRefinerHarness> {
  const db = await openTangleDb(), probe = faultProbe();
  return { store: createResearchStore(db, { applyProbe: probe.applyProbe }), ...probe, close: () => db.close(),
    async capture() {
      const result: Record<string, unknown[]> = {};
      for (const name of [...Object.keys(RESEARCH_COLLECTIONS), ...Object.keys(TRACE2SKILL_COLLECTIONS), 'runs', 'run_frames']) {
        const rows: unknown[] = [];
        for await (const row of db.collection(name).query({ $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r' })) rows.push(row);
        result[name] = rows;
      }
      return result;
    } };
}
const memory = await runLessonRefinerParity(memoryHarness), native = await runLessonRefinerParity(sqlite);
assert.deepEqual(native, memory);
process.stdout.write(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', ...native }) + '\n');
