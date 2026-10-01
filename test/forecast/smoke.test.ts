import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runForecastExample } from '../../examples/forecast.ts';
it('the keyless forecast walkthrough reopens its durable decisions and outcomes with zero new writes or calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'forecast-smoke-')),fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network forbidden');};
  try{const path=join(dir,'forecast.db'),first=await runForecastExample(path),second=await runForecastExample(path);assert.deepEqual(first.checkedHeads,second.checkedHeads);assert.equal(first.promotions,1);assert.equal(first.ineligible,2);assert.ok(first.writes>0);assert.equal(first.logicalCalls,89);assert.equal(second.writes,0);assert.equal(second.logicalCalls,0);assert.equal(second.replayed,23);assert.equal(first.physicalRequests+second.physicalRequests,0);}
  finally{globalThis.fetch=fetch;await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:50});}
});
