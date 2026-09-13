/** Explicit full-corpus keyless source qualification on the selected actual backend. */
import { writeFile } from 'node:fs/promises';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import { createTemporalMemoryStore } from '@tangleai/memory/temporal';
import { parseArgs } from './lib/args.ts';
import { loadLongMemEval } from './lib/longmemeval.ts';
import { qualifyLongMemEvalRoundtrip } from './lib/longmemeval-roundtrip.ts';
const args = parseArgs(process.argv.slice(2), { flags: ['require'], values: ['backend', 'json'] });
if (args.rest.length) throw Error('unexpected argument');
const backend = args.values.get('backend') ?? 'sqlite';
if (!['memory', 'sqlite'].includes(backend)) throw Error('backend must be memory or sqlite');
const data = await loadLongMemEval(process.cwd());
if (data.status !== 'available') {
  console.log(JSON.stringify({ status: data.status, reason: data.reason }));
  if (data.status === 'failed' || args.flags.has('require')) process.exitCode = 1;
} else {
  const result = await qualifyLongMemEvalRoundtrip(data.value, async () => {
    if (backend === 'memory') return { store: createTemporalMemoryStore(), close: async () => {} };
    const db = await openTangleDb(); return { store: createTemporalDbStore(db), close: () => db.close() };
  }, (completed, total) => { if (completed % 50 === 0) process.stderr.write(`LongMemEval source roundtrip ${completed}/${total}\n`); });
  const output = JSON.stringify({ backend: backend === 'memory' ? 'memory' : process.versions.bun ? 'bun-sqlite' : 'node-sqlite', result }, null, 2) + '\n';
  if (args.values.has('json')) await writeFile(args.values.get('json')!, output); else console.log(output);
}
