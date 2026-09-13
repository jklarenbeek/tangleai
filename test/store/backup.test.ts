import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of ['node', 'bun']) {
  it(`${runtime} snapshots preserve WAL outcome records and zero-effect replay`, { timeout: 60_000 }, async () => {
    const { stdout } = await runRuntimeFixture(runtime, [fileURLToPath(new URL('./backup-fixture.ts', import.meta.url))], { timeout: 50_000 });
    assert.deepEqual(JSON.parse(stdout), { runtime, domains: 2, writes: 0, sourceReads: 0 });
  });
}
