import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
for (const runtime of ['node', 'bun']) {
  it(`${runtime} snapshots preserve WAL outcome records and zero-effect replay`, { timeout: 60_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tangle backup é-'));
    try {
      const { stdout } = await run(runtime, [fileURLToPath(new URL('./backup-fixture.ts', import.meta.url)), directory], { timeout: 50_000 });
      assert.deepEqual(JSON.parse(stdout), { runtime, domains: 2, writes: 0, sourceReads: 0 });
    } finally {
      // Windows may still be releasing filesystem handles when the child exits.
      // Node bounds these OS cleanup retries; persistent failures still fail.
      await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
    await assert.rejects(access(directory), { code: 'ENOENT' });
  });
}
