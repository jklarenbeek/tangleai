import assert from 'node:assert/strict';
import { join } from 'node:path';
import { measureForecastResume } from '../lib/forecast-resume.ts';
import { openTangleDb } from '@tangleai/store';
import { fixtureForecastHost } from '../lib/forecast-host-fixture.ts';
import { forecastWorkerSegments } from '../../scripts/forecast-segments.ts';
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw Error('The forecast runtime fixture requires parent-owned scratch.');
let transportCalls = 0;
globalThis.fetch = async () => { transportCalls++; throw Error('Forecast runtime conformance cannot use transport.'); };
const report = await measureForecastResume(directory);
const path = join(directory,'worker.db'), instant = () => '2025-01-25T00:00:00.000Z';
for (const pass of [1,2]) {
  const db = await openTangleDb({ path,jobs: { now: () => Date.parse(instant()) } });
  try {
    const f = await fixtureForecastHost({ db,instant,segments: store => forecastWorkerSegments(db,store) }), tick = await f.host.tick(instant());
    assert.equal(tick.started,pass === 1 ? 3 : 0); assert.deepEqual(tick.refused,[]);
    assert.equal(f.counters.reduce((n,c) => n + c.calls(),0),pass === 1 ? 12 : 0);
  } finally { await db.close(); }
}
assert.equal(transportCalls,0);
console.log(JSON.stringify({ ...report,backend: process.versions.bun ? 'bun-sqlite' : 'node-sqlite',transportCalls,workerTicks: 2,secondTickStarts: 0 }));
