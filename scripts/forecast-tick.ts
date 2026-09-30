/** One manual forecast tick. Live bindings are always an explicit host module. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTangleDb, createForecastStore, createMasStore } from '@tangleai/store';
import { createForecastHost, type ForecastHostOptions } from '@tangleai/forecast';
import { parseArgs } from '../benchmark/lib/args.ts';
import { fixtureForecastHost } from '../benchmark/lib/forecast-host-fixture.ts';
import { forecastWorkerSegments } from './forecast-segments.ts';

const args = parseArgs(process.argv.slice(2),{ flags: ['fixture'],values: ['db','now','host'] });
if (args.rest.length || !args.values.get('db')) throw Error('forecast:tick requires --db <path>.');
const fixture = args.flags.has('fixture'), suppliedNow = args.values.get('now'), modulePath = args.values.get('host');
if (fixture && !suppliedNow) throw Error('A fixture tick requires --now; replay has no wall-clock fallback.');
if (fixture && modulePath || !fixture && !modulePath) throw Error('TFCT1012: Choose --fixture or supply --host <module> exporting forecastBindings.');
const instant = suppliedNow ?? new Date().toISOString();
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant) || !Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString() !== instant) throw Error('Invalid --now instant.');
let physicalRequests = 0;
if (fixture) globalThis.fetch = async () => { physicalRequests++; throw Error('Fixture ticks cannot call a provider.'); };
const db = await openTangleDb({ path: args.values.get('db')!,jobs: { now: suppliedNow ? () => Date.parse(instant) : Date.now } });
try {
  let host: Awaited<ReturnType<typeof createForecastHost>>, counters: { calls(): number; physicalCalls(): number }[] = [];
  if (fixture) {
    const f = await fixtureForecastHost({ db,instant: () => instant,segments: store => forecastWorkerSegments(db,store) });
    host = f.host; counters = f.counters;
  } else {
    const module = await import(pathToFileURL(resolve(modulePath!)).href);
    if (typeof module.forecastBindings !== 'function') throw Error('TFCT1012: The host module must export forecastBindings.');
    const bindings: Pick<ForecastHostOptions,'profile'|'policy'|'executor'|'noteBuilder'> = await module.forecastBindings({ db,now: () => instant });
    const store = createMasStore(db,{ now: () => instant });
    host = await createForecastHost({ ...bindings,forecastStore: createForecastStore(db),masStore: store,now: () => instant,clock: suppliedNow ? () => Date.parse(instant) : () => Math.floor(performance.now()),segments: forecastWorkerSegments(db,store) });
  }
  const census = await host.tick(instant);
  console.log(JSON.stringify({ ...census,clock: suppliedNow ? 'injected' : 'wall',fixture,executableRevision: host.plan.executableRevision,...(fixture ? { logicalCalls: counters.reduce((n,c) => n + c.calls(),0),physicalRequests: physicalRequests + counters.reduce((n,c) => n + c.physicalCalls(),0) } : {}) }));
  if (census.refused.length || census.failed.length) process.exitCode = 1;
} finally { await db.close(); }
