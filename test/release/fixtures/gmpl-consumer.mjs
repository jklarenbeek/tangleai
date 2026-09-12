import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGmplCatalog,gmplArtifacts,renderGmplPrompt} from '@tangleai/gmpl';
import schema from '@tangleai/gmpl/schemas/gmpl' with {type:'json'};
import artifacts from '@tangleai/gmpl/artifacts' with {type:'json'};
import {runGmplExample} from './gmpl-example.mjs';
assert.match(import.meta.resolve('@tangleai/gmpl'),/\.js$/);
assert.ok(schema.$defs.gmplPatternResult);
assert.equal(artifacts.prompts.length,14);
assert.equal(artifacts.revision,gmplArtifacts.revision);
const catalog=await createGmplCatalog(artifacts);assert.ok(catalog.valid);
const rendered=renderGmplPrompt(catalog.value.prompt('analysis-analyst'),{query:'Installed fixture',evidence:[],context:{participant:'analyst-1'}});assert.ok(rendered.valid);
const dir=await mkdtemp(join(tmpdir(),'gmpl-installed-'));
const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Installed GMPL consumer forbids network access');};
try{
  const rows=[];
  for(const pattern of ['parallel-analysis','peer-review','red-team','structured-debate','clarification','delphi-panel']){
    const run=await runGmplExample(join(dir,pattern+'.db'),'document-review',{pattern},pattern==='clarification');
    assert.equal(run.trace.run.status,'completed');assert.ok(run.calls>0);assert.equal(run.replayCalls,0);assert.ok(run.reopens>=2);
    assert.ok(run.projection.regions.length>0);assert.equal(run.responses,pattern==='clarification'?2:0);
    rows.push({pattern,calls:run.calls,responses:run.responses});
  }
  const numeric=await runGmplExample(join(dir,'numeric.db'),'estimate-panel');assert.equal(numeric.trace.run.status,'completed');assert.equal(numeric.result.result.answer,'0.5');
  console.log(JSON.stringify({gmplInstalled:true,tier:'scripted',families:rows,numericDomain:true,duplicateCalls:0}));
}finally{globalThis.fetch=old;await rm(dir,{recursive:true,force:true});}
