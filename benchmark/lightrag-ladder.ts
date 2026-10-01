/** Operational scale receipt; checking verifies the retained observation, never re-times it. */
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseArgs} from './lib/args.ts';
import {measureLightRagLadder,readLightRagLadder} from './lib/lightrag-ladder.ts';
const args=parseArgs(process.argv.slice(2),{flags:['check'],values:['json']});if(args.rest.length)throw Error('Unexpected graph scale arguments.');
const path=args.values.get('json')??'benchmark/results/lightrag-ladder.json';
globalThis.fetch=async()=>{throw Error('The registered graph scale ladder forbids network requests.');};
const receipt=args.flags.has('check')?await readLightRagLadder(path):await measureLightRagLadder({onProgress:line=>console.error(line)});
if(!args.flags.has('check')){await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(receipt,null,2)+'\n');}
console.log(JSON.stringify({receiptId:receipt.receiptId,sizes:receipt.sizes,backendDecision:receipt.backendDecision,physicalRequests:receipt.physicalRequests}));
