/** Explicit keyless matrix or cold purchase plan. This entrypoint never reads provider credentials. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from './lib/args.ts';
import { loadLongMemEval } from './lib/longmemeval.ts';
import { loadLocomo } from './lib/locomo.ts';
import { temporalConformanceContext } from './lib/temporal-conformance-source.ts';
import { runTemporalConformance } from './lib/temporal-conformance.ts';
import { temporalRuntimeAdapters } from './lib/temporal-runtime.ts';
import { runTemporalKeyless } from './lib/temporal-experiment.ts';
import { planTemporalPurchases, type TemporalModels } from './lib/temporal-live.ts';
import { temporalExperimentReport, temporalExperimentSummary, renderTemporalExperiment } from './lib/temporal-report.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['require', 'dry', 'check'], values: ['json', 'md', 'receipt', 'models'] });
if (args.rest.length) throw Error('unexpected positional argument');
const lme = await loadLongMemEval(process.cwd()), locomo = await loadLocomo(process.cwd());
if (lme.status !== 'available' || !locomo.available) {
  console.log(JSON.stringify({ status: lme.status === 'failed' ? 'failed' : 'unavailable', reason: lme.status === 'available' ? 'LoCoMo source unavailable' : lme.reason }));
  if (args.flags.has('require') || lme.status === 'failed') process.exitCode = 1;
} else {
  const context = await temporalConformanceContext(process.cwd()), ids = locomo.samples.map(s=>s.sample_id);
  const models = args.values.has('models') ? JSON.parse(await readFile(args.values.get('models')!, 'utf8')) as TemporalModels : undefined;
  const plan = await planTemporalPurchases(lme.value, ids, context.sourceHash, models);
  const report = args.flags.has('dry') ? null : temporalExperimentReport(await runTemporalKeyless(lme.value, ids, n=>{if(n%50===0)process.stderr.write(`LongMemEval matrix ${n}/${lme.value.length}\n`);}),
    await runTemporalConformance(context, await temporalRuntimeAdapters()), plan);
  if (report && (report.strict.failed || report.strict.passed !== report.strict.planned)) process.exitCode = 1;
  const output = JSON.stringify(report ?? plan, null, 2)+'\n';
  const publish = async (path: string, content: string) => { if(args.flags.has('check')) { if(await readFile(path,'utf8')!==content)throw Error(`generated output differs: ${path}`); } else await writeFile(path,content); };
  if (args.values.has('json')) await publish(args.values.get('json')!, output);
  if (args.values.has('receipt')) { if (!report) throw Error('a receipt requires the measured matrix'); await publish(args.values.get('receipt')!, JSON.stringify(temporalExperimentSummary(report),null,2)+'\n'); }
  if (args.values.has('md')) { if (!report) throw Error('dry plans are JSON; omit --md'); await publish(args.values.get('md')!, renderTemporalExperiment(report)); }
  if (args.flags.has('check') && !args.values.has('json') && !args.values.has('md') && !args.values.has('receipt')) throw Error('--check requires a comparison path');
  if (!args.values.has('json') && !args.values.has('md')) console.log(report ? renderTemporalExperiment(report) : output);
}
