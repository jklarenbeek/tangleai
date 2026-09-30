/** Keyless forecasting instrument; every output honors the selected destination. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from './lib/args.ts';
import {buildForecastReport,requireCapability,renderReport,renderDocument,REPORT_PATH,DOCUMENT_PATH} from './lib/forecast-report.ts';
const args=parseArgs(process.argv.slice(2),{flags:['check','live'],values:['out-dir','require']});
if(args.rest.length)throw Error('Unexpected forecast positional arguments.');
if(args.flags.has('live'))throw Error('No live plan is registered yet.');
globalThis.fetch=async()=>{throw Error('Forecast conformance must not make a network call.');};
const report=await buildForecastReport();requireCapability(report,args.values.get('require')??'oracle');
const dir=args.values.get('out-dir');if(dir&&!args.flags.has('check'))await mkdir(dir,{recursive:true});
for(const [path,bytes] of [[dir?join(dir,'forecast.json'):REPORT_PATH,renderReport(report)],[dir?join(dir,'FORECAST_BENCHMARK.md'):DOCUMENT_PATH,renderDocument(report)]]){
  if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error('Forecast artifact drift: '+path);}else await writeFile(path,bytes);
}
console.log(`Forecast: ${report.reportId}; oracle ${report.rows[0].utility}; ${report.rows.filter(r=>r.status==='implementation-missing').length} missing mechanisms.`);
