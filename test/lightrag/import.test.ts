import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
const exec=promisify(execFile);
function browserContext() {
    class NoClock extends Date { constructor(value:string|number) { if(value===undefined)throw Error('Unexpected root clock read.');super(value); } static override now():number {throw Error('Unexpected root clock read.');} }
    const browser={crypto:globalThis.crypto,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,atob,btoa,console,Date:NoClock,performance:{now:()=>0},
        fetch:()=>{throw Error('Unexpected provider access.');},graphEntry:undefined as {planContribution:unknown}|undefined,
        graphQualification:undefined as Promise<unknown>|undefined};
    return Object.assign(browser,{window:browser,self:browser});
}
async function browserProgram(entry:string,verify:(source:string)=>Promise<void>) {
    const directory=await mkdtemp(join(tmpdir(),'lightrag-browser-'));
    try {
        const input=join(directory,'entry.mjs'),output=join(directory,'graph.js');await writeFile(input,entry);
        await exec('bun',['build',input,'--target=browser','--format=iife','--outfile='+output]);
        await verify(await readFile(output,'utf8'));
    }finally{await rm(directory,{recursive:true,force:true});}
}
it('the public root evaluates without filesystem, database, network or clock capabilities',async()=>{
    const path=fileURLToPath(import.meta.resolve('@tangleai/lightrag'));
    await browserProgram(`import * as graph from ${JSON.stringify(path)};globalThis.graphEntry=graph;`,async source=>{
        const browser=browserContext();vm.runInNewContext(source,browser);assert.equal(typeof browser.graphEntry!.planContribution,'function');
        assert.throws(()=>vm.runInNewContext('fetch("https://fixture.example")',browser),/Unexpected provider access/);
        assert.throws(()=>vm.runInNewContext('Date.now()',browser),/Unexpected root clock read/);
    });
});
it('the public graph transaction runs in a browser bundle without a database driver or provider',async()=>{
    const path=resolve('test/release/fixtures/lightrag-browser.mjs');
    await browserProgram(`import {qualifyLightRagBrowser} from ${JSON.stringify(path)};globalThis.graphQualification=qualifyLightRagBrowser();`,async source=>{
        const browser=browserContext();browser.Date=Date;vm.runInNewContext(source,browser);
        let observed:unknown;try { observed=await browser.graphQualification; } catch(error) { throw Error(JSON.stringify(error)); }
        assert.deepEqual(JSON.parse(JSON.stringify(observed)),{writes:5,replayWrites:0,newClaims:1,revision:1,entities:1,support:['consumer-chunk'],fold:'cedar',shape:true});
    });
});

it('the public graph preparation runs in a browser bundle with injected time and no provider',async()=>{
    const path=resolve('test/release/fixtures/lightrag-browser.mjs');
    await browserProgram(`import {qualifyLightRagPreparation} from ${JSON.stringify(path)};globalThis.graphQualification=qualifyLightRagPreparation();`,async source=>{
        const browser=browserContext();vm.runInNewContext(source,browser);
        let observed:unknown;try{observed=await browser.graphQualification;}catch(error){throw Error(JSON.stringify(error));}
        assert.deepEqual(JSON.parse(JSON.stringify(observed)),{entities:2,relations:1,claims:3,embeddingCalls:2,calls:2,decisions:0,partial:false,lookups:1,packs:4,valid:true});
    });
});

it('the public retrieval planner and serializer run in a browser bundle with no provider or ambient clock',async()=>{
    const path=resolve('test/release/fixtures/lightrag-browser.mjs');
    await browserProgram(`import {qualifyLightRagRetrieval} from ${JSON.stringify(path)};globalThis.graphQualification=qualifyLightRagRetrieval();`,async source=>{
        const browser=browserContext();vm.runInNewContext(source,browser);
        const observed=await browser.graphQualification;
        assert.deepEqual(JSON.parse(JSON.stringify(observed)),{entities:1,citations:1,localCalls:1,withinBudget:true,noOriginal:true,sameCitations:true,timingsOmitted:true,answer:{disposition:'no-model',citation:'consumer-chunk',rendered:true,sharedSchema:true}});
    });
});
