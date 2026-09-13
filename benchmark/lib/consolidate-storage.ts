/** Execute the same storage assertions in memory and both actual SQLite runtimes. */
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';
import { createConsolidationMemoryProbeHost, runConsolidationStoreProbes } from './consolidate-store-probes.ts';
export type ConsolidationStorageRow = Awaited<ReturnType<typeof runConsolidationStoreProbes>> & { backend: string; legacyMemoriesPreserved: number | null };
export async function consolidationStorageControls(): Promise<ConsolidationStorageRow[]> {
  const memory = { backend: 'memory', legacyMemoriesPreserved: null, ...await runConsolidationStoreProbes(createConsolidationMemoryProbeHost) };
  const rows: ConsolidationStorageRow[] = [memory];
  for (const runtime of [process.execPath, 'bun']) {
    const { stdout } = await runRuntimeFixture(runtime, ['benchmark/scripts/consolidation-store.ts']);
    const row = JSON.parse(stdout) as ConsolidationStorageRow;
    if (row.backend !== (runtime === 'bun' ? 'bun-sqlite' : 'node-sqlite') || JSON.stringify(row.cases) !== JSON.stringify(memory.cases)
      || row.legacyMemoriesPreserved !== 1 || row.passed !== memory.passed || row.failed !== 0 || row.physicalRequests !== 0)
      throw new Error('consolidation backend qualification differs');
    rows.push(row);
  }
  return rows;
}
