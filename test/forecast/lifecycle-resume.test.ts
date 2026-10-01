import {it} from 'node:test';
import assert from 'node:assert/strict';
import {measureForecastLifecycleResume} from '../../benchmark/lib/forecast-lifecycle-resume.ts';
it('resolution, scoring, retrospective and activation resume from every committed publication and MAS completion without extra purchases',async()=>{
 const r=await measureForecastLifecycleResume();assert.equal(r.stages.length,8);assert.equal(r.logicalCalls,30);assert.equal(r.physicalCalls,0);assert.equal(r.duplicates,2);assert.ok(r.stages.every(s=>s.stops===1&&s.extraCalls===0&&s.artifactDigest===r.artifactDigest));
});
