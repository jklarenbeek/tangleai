/** Keyless forecasting walkthrough over the public MAS and outcome boundaries. */
import { pathToFileURL } from 'node:url';
import { openTangleDb } from '@tangleai/store';
import { loadForecastFixtures } from '../benchmark/lib/forecast-fixtures.ts';
import { measureEvolvingForecast } from '../benchmark/lib/forecast-evolving.ts';
export async function runForecastExample(databasePath?: string) {
  const db = await openTangleDb({ ...(databasePath ? { path: databasePath } : {}),jobs: {} });
  try {
    const result = await measureEvolvingForecast(await loadForecastFixtures(),{ db }), c = result.lifecycle;
    return { domains: c.checkedHeads.map(h => h.scopeKey),resolutions: c.resolutions,scoredCheckpoints: c.scoredCheckpoints,promotions: c.promoted,retentions: c.retained,rejections: c.rejected,ineligible: c.ineligible,checkedHeads: c.checkedHeads,writes: result.writes,replayed: result.replayed,logicalCalls: result.logicalCalls,physicalRequests: result.physicalCalls };
  } finally { await db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--db' || !args[1])) throw Error('Usage: forecast [--db path]');
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('The keyless forecast walkthrough cannot reach a network.'); };
  try { console.log(JSON.stringify(await runForecastExample(args[1]),null,2)); }
  finally { globalThis.fetch = saved; }
}
