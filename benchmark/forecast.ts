/** Keyless forecasting instrument; every output honors the selected destination. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from './lib/args.ts';
import {buildForecastReport,requireCapability,renderReport,renderDocument,REPORT_PATH,DOCUMENT_PATH} from './lib/forecast-report.ts';
import {buildForecastLive,describeForecastLive,runForecastLive,FORECAST_LIVE_PATH} from './lib/forecast-live.ts';
import {readAiEnv} from './lib/ai-env.ts';
const args=parseArgs(process.argv.slice(2),{flags:['check','live'],values:['out-dir','require','authorize']});
if(args.rest.length)throw Error('Unexpected forecast positional arguments.');
const dir=args.values.get('out-dir');if(dir&&!args.flags.has('check'))await mkdir(dir,{recursive:true});
async function artifact(path:string,bytes:string){
  if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error('Forecast artifact drift: '+path);}else await writeFile(path,bytes);
}
const livePath=dir?join(dir,'forecast-live.json'):FORECAST_LIVE_PATH;
if(args.flags.has('live')){
  if(args.values.has('require')||args.flags.has('check')&&args.values.has('authorize'))throw Error('Live registration cannot use a keyless requirement or authorize in check mode.');
  const env=readAiEnv(),record=await buildForecastLive({env});
  await artifact(livePath,JSON.stringify(record,null,2)+'\n');console.log(describeForecastLive(record));
  const authorize=args.values.get('authorize');
  if(authorize&&authorize===record.plan.planId&&!record.plan.skipped){
    // An exclusive receipt protects a matching CLI invocation from purchasing twice.
    const executionPath=join(dir??'benchmark/results','forecast-live-'+record.plan.planId+'.json');
    await writeFile(executionPath,JSON.stringify({status:'started',planId:record.plan.planId})+'\n',{flag:'wx'});
    try{const result=await runForecastLive(record,{env,authorize,databasePath:executionPath.slice(0,-5)});await writeFile(executionPath,JSON.stringify(result,null,2)+'\n');console.log(`Execution ${result.execution!.executionId}; ${result.physicalRequests} provider requests.`);}
    catch(error){await writeFile(executionPath,JSON.stringify({status:'incomplete',planId:record.plan.planId,reason:'Execution stopped; retain the database and reconcile receipts before another authorization.'})+'\n');throw error;}
  }else{
    const result=await runForecastLive(record,{env,authorize,fetch:async()=>{throw Error('A forecast dry plan reached transport.');}});
    if(result.authorization==='refused')throw Error('Forecast authorization does not match the current planId.');
    console.log(`${result.authorization}: ${result.physicalRequests} provider requests.`);
  }
}else{
  if(args.values.has('authorize'))throw Error('Forecast authorization requires --live.');
  globalThis.fetch=async()=>{throw Error('Forecast conformance must not make a network call.');};
  const report=await buildForecastReport();requireCapability(report,args.values.get('require')??'oracle');
  for(const [path,bytes] of [[dir?join(dir,'forecast.json'):REPORT_PATH,renderReport(report)],[dir?join(dir,'FORECAST_BENCHMARK.md'):DOCUMENT_PATH,renderDocument(report)],[livePath,JSON.stringify(await buildForecastLive(),null,2)+'\n']])await artifact(path,bytes);
  console.log(`Forecast: ${report.reportId}; oracle ${report.rows[0].utility}; ${report.rows.filter(r=>r.status==='implementation-missing').length} missing mechanisms; claim ${report.claim.verdict}.`);
}
