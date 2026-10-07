import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it((runtime === 'bun' ? 'Bun' : 'Node') + ' retains native SQLite refusal codes through experiential host boundaries', async () => {
  const result = await runRuntimeFixture(runtime, ['test/store/experiential-error-driver.fixture.ts'], { env: { NODE_TEST_CONTEXT: undefined } });
  assert.deepEqual(JSON.parse(result.stdout), { runtime: runtime === 'bun' ? 'bun' : 'node', nativeCode: 'JD2063',
    preservedRefusals: 12, physicalRequests: 0, writes: 0, setupIdentityWrites: 1,
    hostEffects: { runAttempts: 1, pinAttempts: 0, clients: 0 },
    boundaryEffects: { policyReadCommits: 0, policyWriteAttempts: 1, nativeEnqueueAttempts: 1, retainedReservations: 1, replayWrites: 0, backendSubmissions: 0 } });
});
