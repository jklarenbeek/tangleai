/** Keyless exact temporal measurement. Missing runtime/data remain explicit statuses. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from './lib/args.ts';
import { runTemporalConformance, renderTemporalConformance } from './lib/temporal-conformance.ts';
import { temporalConformanceContext } from './lib/temporal-conformance-source.ts';
import { temporalRuntimeAdapters } from './lib/temporal-runtime.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['require', 'complete', 'check'], values: ['json', 'md'] });
if (args.rest.length) throw new Error('unexpected positional argument');
const context = await temporalConformanceContext(process.cwd());
if (args.flags.has('require') && (context.lme.status !== 'available' || context.locomo.status !== 'available')) throw new Error('required corpus unavailable');
const report = await runTemporalConformance(context, await temporalRuntimeAdapters());
for (const [flag, content] of [['json', JSON.stringify(report, null, 2) + '\n'], ['md', renderTemporalConformance(report)]]) {
  const path = args.values.get(flag);
  if (!path) continue;
  if (args.flags.has('check')) { if (await readFile(path, 'utf8') !== content) throw new Error(`generated ${flag} differs: ${path}`); }
  else await writeFile(path, content);
}
if (args.flags.has('check') && !args.values.has('json') && !args.values.has('md')) throw new Error('--check requires an output path');
if (!args.values.has('md') && !args.values.has('json')) console.log(renderTemporalConformance(report));
if (!report.gate.instrumentPassed || (args.flags.has('complete') && !report.gate.implementationComplete)) process.exitCode = 1;
