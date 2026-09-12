import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { loadOutcomeFixtures } from '../../benchmark/lib/outcome-fixtures.ts';
import { buildOutcomeReport, validateOutcomeReport, requireCapability, renderReport, renderDocument, acceptActivationTrace, baselineScore } from '../../benchmark/lib/outcome-conformance.ts';
const source={head:'a'.repeat(40),clean:false,files:[{path:'fixture',sha256:'b'.repeat(64)}],sha256:''};
source.sha256=await canonicalSha256({head:source.head,files:source.files});
const rehash=async(r:Awaited<ReturnType<typeof buildOutcomeReport>>)=>{const {reportId,...body}=r;r.reportId=await canonicalSha256(body);return r;};
describe('registered outcome measurement',()=>{
 it('freezes 32 decisions, 24 available, 8 pending and 24 disjoint held-out cases',async()=>{
  const f=await loadOutcomeFixtures();assert.equal(f.quality.length,32);assert.equal(f.quality.filter(c=>c.outcome!==null).length,24);assert.equal(f.held.length,24);assert.equal(f.lifecycle.scenarios.length,24);
  assert.equal(f.manifest.registrationId,'65f2b022355c23a173e44a1056b1a06e83da8f6b4eb25ba94e22218d715d3e58');
 });
 it('preserves the strict tolerance boundary and finite-input rule',()=>{
  assert.equal(baselineScore('direction-delta',{predicted:0},{actual:.049}),'success');
  assert.equal(baselineScore('direction-delta',{predicted:0},{actual:.05}),'partial');
  assert.equal(baselineScore('direction-delta',{predicted:0},{actual:-.01}),'failure');
  assert.throws(()=>baselineScore('direction-delta',{predicted:NaN},{actual:0}));
 });
 it('the preserved oracle baseline cannot establish integrated capability',async()=>{const r=await buildOutcomeReport({source});requireCapability(r,'oracle');requireCapability(r,'complete');const baseline=JSON.parse(await readFile('benchmark/results/outcome-baseline.json','utf8'));assert.throws(()=>requireCapability(baseline,'complete'));assert.equal(baseline.rows.find((v:{id:string})=>v.id==='checked-scripted').utility,null);});
 it('unsafe control fails evidence and approval gates',()=>{assert.equal(acceptActivationTrace({active:true,evidence:false,approval:true}),false);assert.equal(acceptActivationTrace({active:true,evidence:true,approval:false}),false);assert.equal(acceptActivationTrace({active:true,evidence:true,approval:true}),true);});
 it('rejects missing or forged runtime evidence and unsupported capability flags after rehash',async()=>{
  const r=await buildOutcomeReport({source});requireCapability(r,'resolution');
  for(const change of [(x:typeof r)=>{x.traces=[];},(x:typeof r)=>{x.traces[0].records.pop();},(x:typeof r)=>{x.capabilities.complete=false;},(x:typeof r)=>{x.capabilities.resolution=false;}]){
   const x=structuredClone(r);change(x);await rehash(x);await assert.rejects(()=>validateOutcomeReport(x));
  }
 });
 it('two runs are byte-identical and all observed probes hold',async()=>{const a=await buildOutcomeReport({source}),b=await buildOutcomeReport({source});assert.equal(renderReport(a),renderReport(b));assert.equal(renderDocument(a),renderDocument(b));assert.ok([...a.probes,...a.rows.flatMap(r=>r.probes)].every(p=>p.holds));assert.equal(a.rows[1].utility,.25);});
 it('refuses hidden unscored outcomes, altered denominators, false probes and extra fields after rehash',async()=>{
  const r=await buildOutcomeReport({source});
  for(const mutate of [(x:typeof r)=>{x.rows[1].counts.scored--;},(x:typeof r)=>{x.rows[1].cases.pop();},(x:typeof r)=>{x.rows[1].cases[0].utility=1;},(x:typeof r)=>{x.probes[0].holds=false;},(x:typeof r)=>{(x as unknown as Record<string,unknown>).secret='x';}]){
   const x=structuredClone(r);mutate(x);await rehash(x);await assert.rejects(()=>validateOutcomeReport(x));
  }
 });
 it('rejects missing or substituted fixture bytes and held-out overlap',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'outcome-fixture-'));try{
   await cp('benchmark/fixtures/outcome',join(dir,'benchmark/fixtures/outcome'),{recursive:true});
   const path=join(dir,'benchmark/fixtures/outcome/held-out.json');const held=JSON.parse(await readFile(path,'utf8'));held[0].input={base:11};held[0].outcome={actual:11.1};await writeFile(path,JSON.stringify(held));await assert.rejects(()=>loadOutcomeFixtures(dir),/digest/);
   const mp=join(dir,'benchmark/fixtures/outcome/manifest.json');const m=JSON.parse(await readFile(mp,'utf8'));m.files.find((v:{path:string})=>v.path==='held-out.json').digest=await canonicalSha256(held);const {registrationId,...body}=m;m.registrationId=await canonicalSha256(body);await writeFile(mp,JSON.stringify(m));await assert.rejects(()=>loadOutcomeFixtures(dir),/overlap/);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('redirects every output, checks drift and rejects unknown or absent capability flags',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'outcome-cli-'));try{
   const args=['benchmark/outcome-conformance.ts','--out-dir',dir];execFileSync(process.execPath,args);execFileSync(process.execPath,[...args,'--check']);
   await writeFile(join(dir,'OUTCOME_BENCHMARK.md'),'drift');assert.throws(()=>execFileSync(process.execPath,[...args,'--check'],{stdio:'pipe'}));
   assert.throws(()=>execFileSync(process.execPath,[...args,'--require','unregistered'],{stdio:'pipe'}));assert.throws(()=>execFileSync(process.execPath,[...args,'--live'],{stdio:'pipe'}));
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
