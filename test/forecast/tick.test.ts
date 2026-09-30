import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);
for (const runtime of [process.execPath,'bun']) it('runs one injected-clock CLI tick and a zero-spend second tick on ' + runtime,async () => {
  const dir = await mkdtemp(join(tmpdir(),'forecast-tick-'));
  try {
    const args = ['scripts/forecast-tick.ts','--db',join(dir,'forecast.db'),'--now','2025-01-25T00:00:00.000Z','--fixture'];
    const first = JSON.parse((await execute(runtime,args)).stdout), second = JSON.parse((await execute(runtime,args)).stdout);
    assert.equal(first.started,3); assert.equal(first.logicalCalls,12); assert.equal(first.physicalRequests,0); assert.equal(first.clock,'injected'); assert.deepEqual(first.failed,[]);
    assert.equal(second.started,0); assert.equal(second.logicalCalls,0); assert.equal(second.physicalRequests,0);
    const absent = join(dir,'absent.db');
    await assert.rejects(execute(runtime,['scripts/forecast-tick.ts','--db',absent,'--fixture']),/requires --now/);
    await assert.rejects(execute(runtime,['scripts/forecast-tick.ts','--db',absent]),/TFCT1012/);
    await assert.rejects(access(absent));
  } finally { await rm(dir,{ recursive: true,force: true,maxRetries: 8,retryDelay: 50 }); }
});
