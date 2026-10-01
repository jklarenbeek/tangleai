/** Print the separately licensed parity protocol without making a provider request. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseArgs} from './lib/args.ts';
import {planLightRagParity} from './lib/lightrag-parity.ts';
const args=parseArgs(process.argv.slice(2),{flags:['license-ack','check'],values:['dataset','authorize','json']});if(args.rest.length)throw Error('Unexpected parity arguments.');
globalThis.fetch=async()=>{throw Error('A parity protocol plan cannot call a provider.');};
const report=await planLightRagParity({datasetPath:args.values.get('dataset'),licenseAcknowledged:args.flags.has('license-ack'),authorize:args.values.get('authorize')}),bytes=JSON.stringify(report,null,2)+'\n',path=args.values.get('json')??'benchmark/results/lightrag-parity.json';
if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error('Graph parity plan drift.');}else{await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
console.log(bytes);
