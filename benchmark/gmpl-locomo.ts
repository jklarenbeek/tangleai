/** Default is keyless planning. No live switch, environment loading or network fallback. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from './lib/args.ts';
import {ROOT,createGmplLocomoPlan,buildGmplLocomoReport,renderGmplLocomo} from './lib/gmpl-locomo.ts';
import type {Bundle} from './lib/gmpl-locomo.types.ts';
const args=parseArgs(process.argv.slice(2),{flags:['plan','check'],values:['replay','out-dir']});
if(args.rest.length||args.flags.has('plan')&&args.values.has('replay'))throw Error('Use --plan or --replay PATH');
for(const v of args.values.values())if(v.startsWith('--')||v.includes('='))throw Error('Malformed option value');
globalThis.fetch=async()=>{throw Error('GMPL LoCoMo plan/replay forbids network access');};
const bundle=args.values.has('replay')?JSON.parse(await readFile(args.values.get('replay')!,'utf8')) as Bundle:undefined;
const work=await createGmplLocomoPlan({binding:bundle?.binding});
const report=await buildGmplLocomoReport(work,bundle),dir=args.values.get('out-dir');
if(dir&&!args.flags.has('check'))await mkdir(dir,{recursive:true});
for(const [path,bytes] of [[dir?join(dir,'gmpl-locomo.json'):join(ROOT,'benchmark/results/gmpl-locomo.json'),JSON.stringify(report,null,2)+'\n'],[dir?join(dir,'GMPL_LOCOMO.md'):join(ROOT,'docs/GMPL_LOCOMO.md'),renderGmplLocomo(report)]]){
  if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error(`LoCoMo artifact drift: ${path}`);}else await writeFile(path,bytes);
}
console.log(`GMPL LoCoMo ${report.plan.dataset.status}: ${report.plan.sample.selected}/64 selected; ${report.replay?.tier??'plan only'}`);
