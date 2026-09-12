import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildGmplReport,validateGmplReport,renderReport,renderDocument,requireCapability,loadCases} from '../../benchmark/lib/gmpl-conformance.ts';
import {contentId} from '../../benchmark/lib/gmpl-oracle.ts';
import {driveSingleAgent} from '../../benchmark/lib/gmpl-runner.ts';
import type {GmplConformance} from '../../benchmark/lib/gmpl-conformance.types.ts';
const exec=promisify(execFile);
const source={head:'1'.repeat(40),clean:true,files:[],sha256:await contentId({head:'1'.repeat(40),files:[]})};
const report=await buildGmplReport({source});
async function rehash(value:GmplConformance){const {reportId:_,...rest}=value;value.reportId=await contentId(rest);return value;}
describe('GMPL instrument',()=>{
  it('retains the fixed denominator and honest unavailable capabilities',()=>{
    assert.equal(report.rows.length,12);assert.deepEqual(report.coverage,{planned:288,executed:288,missing:0});
    assert.equal(report.probes.length,30);assert.equal(report.unsafeControls.length,3);
    assert.doesNotThrow(()=>requireCapability(report,'instrument'));
    assert.doesNotThrow(()=>requireCapability(report,'contracts'));
    assert.doesNotThrow(()=>requireCapability(report,'analysis'));
    assert.equal(report.artifacts.packs,14);assert.equal(report.artifacts.validRenders,28);
    assert.doesNotThrow(()=>requireCapability(report,'critique'));
    assert.doesNotThrow(()=>requireCapability(report,'interaction'));
    assert.doesNotThrow(()=>requireCapability(report,'comparison'));assert.doesNotThrow(()=>requireCapability(report,'complete'));
    assert.throws(()=>requireCapability(report,'unknown'));
    for(const row of report.rows){assert.equal(row.cases.length,24);if(row.kind==='pattern'&&row.counts['not-implemented']){assert.equal(row.utility,0);assert.equal(row.conditionalUtility,null);}}
    assert.ok(renderDocument(report).includes('Scripted conformance does not measure model quality'));
  });
  it('gmpl report refuses forged totals and hidden failures',async()=>{
    const mutations:Array<(r:GmplConformance)=>void>=[r=>{r.rows[0].counts.valid++;},r=>{r.rows[0].cases.pop();},r=>{r.rows[0].cases[0].caseId='foreign';},r=>{r.registrationId='0'.repeat(64);},r=>{r.source.sha256='0'.repeat(64);},r=>{r.rows[1].utility=0.9;},r=>{r.capabilities.complete=false;},r=>{r.probes[0].observed={wrong:true};},r=>{r.failures=[{reason:'forged',count:1}];},r=>{r.pairs[0].eligible=true;r.pairs[0].delta=1;},r=>{r.rows[1].cases[0].output!.claims[0].citations[0].id='hidden';}];
    for(const mutate of mutations){const copy=structuredClone(report);mutate(copy);assert.ok(!(await validateGmplReport(await rehash(copy))).valid);}
    assert.ok((await validateGmplReport(report)).valid);
  });
  it('gmpl counts every normalization and repair, including unknown usage and budget failure',async()=>{
    const [fixture]=await loadCases();const original=globalThis.fetch;let network=0;
    globalThis.fetch=async()=>{network++;throw Error('network forbidden');};
    try{
      const repaired=await driveSingleAgent(fixture.input,fixture.script.result,{repair:true,unknownUsage:true});
      assert.equal(repaired.status,'completed');assert.equal(repaired.usage.physical,3);
      assert.deepEqual([repaired.usage.completion,repaired.usage.normalization,repaired.usage.repair],[1,1,1]);
      assert.equal(repaired.usage.unknownTokenRequests,3);assert.equal(repaired.usage.promptTokens,0);
      const failed=await driveSingleAgent(fixture.input,fixture.script.result,{calls:1});
      assert.equal(failed.status,'failed');assert.equal(failed.usage.physical,1);assert.equal(network,0);
    }finally{globalThis.fetch=original;}
  });
  it('is reproducible with pinned source metadata',async()=>{
    const again=await buildGmplReport({source});assert.equal(renderReport(again),renderReport(report));assert.equal(renderDocument(again),renderDocument(report));
  });
  it('CLI redirects all artifacts, detects drift without writing, and rejects malformed arguments',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'gmpl-instrument-'));
    try{
      const run=(...args:string[])=>exec(process.execPath,['benchmark/gmpl-conformance.ts',...args],{maxBuffer:1024*1024});
      await run('--out-dir',dir,'--require','instrument');
      assert.deepEqual((await readdir(dir)).sort(),['GMPL_BENCHMARK.md','gmpl-conformance.json']);
      const file=join(dir,'gmpl-conformance.json'),before=await stat(file),bytes=await readFile(file,'utf8');
      await run('--out-dir',dir,'--check');assert.equal((await stat(file)).mtimeMs,before.mtimeMs);
      assert.equal(await readFile(file,'utf8'),bytes);
      await assert.rejects(run('--require','unknown','--out-dir',join(dir,'unavailable')));
      await assert.rejects(stat(join(dir,'unavailable')));
      for(const args of [['--wat'],['--check=yes'],['--out-dir'],['--out-dir','--check'],['positional']])await assert.rejects(run(...args));
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
