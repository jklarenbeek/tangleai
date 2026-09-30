import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,cp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {authorForecastFixture} from './forecast-fixture.ts';
import {loadForecastFixtures} from '../../benchmark/lib/forecast-fixtures.ts';
import {scoreForecast,parseBoxed,cutoffAdmits,analyticBand} from '../../benchmark/lib/forecast-oracle.ts';
import {buildForecastReport,validateForecastReport,renderReport,renderDocument,requireCapability} from '../../benchmark/lib/forecast-report.ts';
import type {Forecast} from '../../benchmark/lib/forecast.types.ts';
const source={head:'a'.repeat(40),clean:false,files:[{path:'fixture',sha256:'b'.repeat(64)}],sha256:''};
source.sha256=await canonicalSha256({head:source.head,files:source.files});
const rehash=async(r:Forecast)=>{const {reportId:_,...body}=r;r.reportId=await canonicalSha256(body);return r;};
describe('registered forecasting measurement',()=>{
  it('freezes six questions, eighteen checkpoints, five resolutions and the authored harnesses',async()=>{
    const f=await loadForecastFixtures();assert.deepEqual(f.manifest.census,{questions:6,checkpoints:18,resolutions:5,pending:1,resolvedCheckpoints:15,snapshots:64,postCutoff:3,undated:2});
    assert.equal(f.manifest.registrationId,'cdc0d6cd4b53dc5100e22bdeed372ad008ad42c4b78d061d036d0374dfb4a4b4');
    assert.equal(f.manifest.seedHarnessDigest,'314cf26cc10be0a2166304685e10ddcf2886c05c4e17825d80980595d92c27fb');
    assert.deepEqual(f.manifest.candidateDigests,['1becc4519ccf3720263b1f64f021b7ccd96acf66cb21cfd30b9adc1f41a1ffe0','c745be447db96521a5677636d8f4fea1bb4c4d47d335041fcb48d8447b2f277d']);
    for(const [path,value] of Object.entries(await authorForecastFixture()))assert.deepEqual(JSON.parse(await readFile(join('benchmark/fixtures/forecast',path),'utf8')),value,path);
  });
  it('scores exact tolerance boundaries and unknown labels without guessing a boxed answer',()=>{
    const numeric={id:'numeric/v1' as const,tolerance:2,range:[0,30]};
    assert.equal(scoreForecast(numeric,20,18).utility,1);assert.equal(scoreForecast(numeric,24,18).utility,.5);assert.equal(scoreForecast(numeric,24.00001,18).utility,0);
    assert.throws(()=>scoreForecast(numeric,NaN,18));assert.throws(()=>scoreForecast(numeric,18,Infinity));
    const choice={id:'choice/v1' as const,options:['yes','no']};assert.equal(scoreForecast(choice,'yes','yes').utility,1);assert.deepEqual(scoreForecast(choice,'maybe','yes').diagnostics,{unknownLabel:true});
    assert.equal(parseBoxed('Earlier \\boxed{no}, final \\boxed{yes}'),'yes');assert.throws(()=>parseBoxed('Probably yes'));assert.throws(()=>parseBoxed('\\boxed{}'));
    const at='2025-01-10T00:00:00.000Z';assert.equal(cutoffAdmits({availableAt:at},at).admitted,true);assert.equal(cutoffAdmits({availableAt:'2025-01-10T00:00:00.001Z'},at).reason,'post-cutoff');assert.equal(cutoffAdmits({availableAt:null},at).reason,'undated');
  });
  it('enumerates the exact sum distribution including the clipped numeric partial band',()=>{
    const choice={id:'choice/v1' as const,options:['yes','no']},band=analyticBand([{adapter:choice,outcome:'yes'},{adapter:choice,outcome:'no'}]);
    assert.deepEqual(band.distribution.map(x=>x.probability),[.25,0,.5,0,.25]);assert.equal(band.expected,.5);
    const clipped=analyticBand([{adapter:{id:'numeric/v1',tolerance:1,range:[0,10]},outcome:0}]);
    assert.ok(Math.abs(clipped.expected-.2)<1e-12);assert.ok(Math.abs(clipped.distribution.reduce((n,v)=>n+v.probability,0)-1)<1e-12);
  });
  it('reaches the oracle ceiling, retains pending cases and counts injected evidence once',async()=>{
    const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Keyless forecasting reached fetch.');};
    try{const r=await buildForecastReport({source});assert.equal(r.rows[0].utility,1);assert.deepEqual(r.rows[0].counts,{planned:18,available:15,pending:3,scored:15,failed:0,notRun:0});
      assert.equal(r.rows[1].utility,.2);assert.equal(r.band.low,.1);assert.equal(r.band.high,2/3);assert.equal(r.rows[2].utility,.8);assert.deepEqual(r.rows[2].byHorizon.map(h=>h.utility),[.6,.8,1]);
      assert.equal(r.refusals.postCutoff,3);assert.equal(r.refusals.undated,2);assert.equal(r.refusals.ids.length,5);assert.ok(r.rows.slice(3).every(row=>row.status==='implementation-missing'&&row.utility===null&&row.counts.notRun===15));
      requireCapability(r,'oracle');assert.throws(()=>requireCapability(r,'complete'),/no-harness, static-harness, scaffold-no-harness, evolving-harness/);
    }finally{globalThis.fetch=fetch;}
  });
  it('refuses a row missing any model, tool, prompt, note, scorer, cutoff or cost identity',async()=>{
    const r=await buildForecastReport({source});
    for(const key of ['configuration','toolset','promptRevision','noteSchemaRevision','scorer','cutoffPolicy']){
      const x=structuredClone(r);delete (x.rows[0].identity as unknown as Record<string,unknown>)[key];await assert.rejects(validateForecastReport(await rehash(x)));
      const missing=structuredClone(r);(missing.rows[0].identity as unknown as Record<string,unknown>)[key]=null;await assert.rejects(validateForecastReport(await rehash(missing)));
    }
    const x=structuredClone(r);delete (x.rows[0] as unknown as Record<string,unknown>).cost;await assert.rejects(validateForecastReport(await rehash(x)));
  });
  it('rejects hidden cases, forged scores, denominators, audit totals, capabilities and false probes after rehash',async()=>{
    const r=await buildForecastReport({source});
    for(const change of [(x:Forecast)=>{x.rows[0].cases.pop();},(x:Forecast)=>{x.rows[0].counts.scored--;},(x:Forecast)=>{x.rows[0].cases[0].utility=0;},(x:Forecast)=>{x.rows[3].status='measured';},(x:Forecast)=>{x.refusals.postCutoff--;},(x:Forecast)=>{x.evidenceAudit[0].admitted.push('q01-c1-future');},(x:Forecast)=>{x.capabilities.complete=true;},(x:Forecast)=>{(x.probes[0] as {holds:boolean}).holds=false;},(x:Forecast)=>{(x as unknown as Record<string,unknown>).unregistered=true;},(x:Forecast)=>{x.band.high=1;}]){
      const x=structuredClone(r);change(x);await assert.rejects(validateForecastReport(await rehash(x)));
    }
  });
  it('refuses substituted bytes and rehashed cross-question evidence pools',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'forecast-fixture-'));try{
      await cp('benchmark/fixtures/forecast',join(dir,'benchmark/fixtures/forecast'),{recursive:true});const base=join(dir,'benchmark/fixtures/forecast'),path=join(base,'questions.json'),q=JSON.parse(await readFile(path,'utf8'));q[0].checkpoints[0].snapshotIds[0]='q02-c1-a';
      await writeFile(path,JSON.stringify(q));await assert.rejects(loadForecastFixtures(dir),/digest/);
      const mp=join(base,'manifest.json'),m=JSON.parse(await readFile(mp,'utf8'));m.files.find((f:{path:string})=>f.path==='questions.json').digest=await canonicalSha256(q);const {registrationId:_,...body}=m;m.registrationId=await canonicalSha256(body);await writeFile(mp,JSON.stringify(m));await assert.rejects(loadForecastFixtures(dir),/crosses a question/);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it('renders two clock-free runs byte-identically',async()=>{
    const a=await buildForecastReport({source}),b=await buildForecastReport({source});assert.equal(renderReport(a),renderReport(b));assert.equal(renderDocument(a),renderDocument(b));
    assert.doesNotMatch(renderReport(a),/hostname|\/tmp\/|recordedAt/);assert.match(renderDocument(a),/1\.000 over 15\/18/);
  });
  it('publishes a valid current-source report and its exact generated document',async()=>{
    const report=JSON.parse(await readFile('benchmark/results/forecast.json','utf8')) as Forecast;await validateForecastReport(report);
    assert.equal(await readFile('docs/FORECAST_BENCHMARK.md','utf8'),renderDocument(report));
    for(const file of report.source.files)assert.equal(createHash('sha256').update(await readFile(file.path)).digest('hex'),file.sha256,file.path);
    assert.ok(report.source.files.every(f=>!f.path.includes('benchmark/results/')));
  });
  it('redirects every output, checks drift without writing and refuses unknown capabilities and live execution',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'forecast-cli-')),other=await mkdtemp(join(tmpdir(),'forecast-cli-'));try{
      const run=(args:string[])=>execFileSync(process.execPath,['benchmark/forecast.ts',...args],{stdio:'pipe'});
      run(['--out-dir',dir]);run(['--out-dir',other]);
      for(const file of ['forecast.json','FORECAST_BENCHMARK.md'])assert.equal(await readFile(join(dir,file),'utf8'),await readFile(join(other,file),'utf8'));
      const path=join(dir,'forecast.json'),before=(await stat(path)).mtimeMs;run(['--out-dir',dir,'--check']);assert.equal((await stat(path)).mtimeMs,before);
      await writeFile(join(dir,'FORECAST_BENCHMARK.md'),'drift');assert.throws(()=>run(['--out-dir',dir,'--check']));
      for(const args of [['--require','unregistered'],['--require','complete'],['--live'],['--unknown'],['stray']])assert.throws(()=>run(args));
    }finally{await rm(dir,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
  });
});
