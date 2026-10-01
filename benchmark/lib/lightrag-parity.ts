/** A licensed paper-corpus protocol is a plan, never a surrogate score. */
import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {lightRagPrompt,lightRagGenerationRevision} from '@tangleai/lightrag';
import {LIGHTRAG_JUDGE_PROMPT} from './lightrag-judge.ts';
import {createLightRagValidator} from './lightrag.ts';
import type {LightragParity} from './lightrag.types.ts';
import protocol from '../fixtures/lightrag/parity-protocol.json' with {type:'json'};
async function datasetIdentity(path:string):Promise<string>{
    const files:Array<{path:string;sha256:string}>=[];
    async function visit(full:string,relative:string){const info=await lstat(full);if(info.isSymbolicLink())throw Error('A parity dataset must have explicit files, without symlink traversal.');
        if(info.isDirectory()){for(const entry of (await readdir(full)).sort())await visit(join(full,entry),relative?relative+'/'+entry:entry);}
        else if(info.isFile())files.push({path:relative,sha256:createHash('sha256').update(await readFile(full)).digest('hex')});
        else throw Error('Unsupported parity dataset entry.');
    }
    await visit(path,'');if(!files.length)throw Error('The named parity dataset is empty.');return canonicalSha256(files);
}
export async function planLightRagParity(options:{datasetPath?:string;licenseAcknowledged?:boolean;authorize?:string}={}):Promise<LightragParity>{
    const datasetPath=options.datasetPath?resolve(options.datasetPath):null,licenseAcknowledged=options.licenseAcknowledged===true;
    const datasetSha256=datasetPath&&licenseAcknowledged?await datasetIdentity(datasetPath):null;
    const promptRevisions={extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision,planning:lightRagPrompt('graph-planner').revision,generation:await lightRagGenerationRevision(),judge:await canonicalSha256({prompt:LIGHTRAG_JUDGE_PROMPT})};
    const identity={datasetPath,datasetSha256,licenseAcknowledged,protocol,promptRevisions},planId=await canonicalSha256(identity);
    if(options.authorize!==undefined&&options.authorize!==planId)throw Error('Parity authorization differs from the frozen dataset/protocol plan; zero requests.');
    const authorized=options.authorize===planId,missing=[...(!datasetPath?['No separately obtained UltraDomain dataset path was supplied.']:[]),...(!licenseAcknowledged?['No dataset licence acknowledgement was supplied.']:[]),...(!authorized?['No matching separate parity authorization was supplied.']:[])];
    const reason=[...missing,'This entry records a protocol only. The four licensed corpora, generated questions, original prompt bytes, exact model snapshots, embedder, tokenizer, overlap and baseline settings need independent parity qualification before execution. The Tangle prompt revisions in this plan identify the mechanism port, not exact upstream prompt parity.'].join(' ');
    const result={document:'lightrag-parity' as const,planId,status:'not-run' as const,reason,...identity,authorized,physicalRequests:0 as const,paperComparison:false as const} as LightragParity;
    if(!createLightRagValidator()(result).valid)throw Error('Invalid graph parity plan.');return result;
}
