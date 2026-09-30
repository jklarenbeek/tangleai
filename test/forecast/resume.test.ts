import { it } from 'node:test';
import assert from 'node:assert/strict';
import { measureForecastResume } from '../../benchmark/lib/forecast-resume.ts';
it('a three-checkpoint replay survives a forced stop after every stage and resumes to the same artifact ids and report bytes',async () => {
  const report = await measureForecastResume();
  assert.equal(report.stages.length,10); assert.equal(report.stages.reduce((n,s) => n + s.stops,0),27);
  assert.ok(report.stages.every(s => s.stops === s.resumed && s.extraCalls === 0 && s.artifactDigest === report.artifactDigest));
  assert.equal(report.logicalCalls,12); assert.equal(report.physicalRequests,0); assert.equal(report.duplicateDeliveries,3);
});
