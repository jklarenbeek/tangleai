import {it} from 'node:test';
import assert from 'node:assert/strict';
import {instantiateMasTemplate} from '@tangleai/mas';
import {prepareHeraScaffold,heraConfigCatalog,HERA_DEFAULT_LIMITS} from '@tangleai/hera';
import {fixture} from './fixture.ts';
it('the fixed comparison is one caps-only MAS template with two invocations of the retriever',async()=>{
  const f=await fixture(),config=await heraConfigCatalog('scripted',{...HERA_DEFAULT_LIMITS});assert.ok(config.valid);
  const p=await prepareHeraScaffold({...f,config:config.value},{kind:'fixed'});assert.ok(p.valid,JSON.stringify(p));
  assert.deepEqual(p.value.validated.workflow.nodes.filter(n=>n.kind==='agent'&&n.role==='retriever').map(n=>n.id),['retrieve-1','retrieve-2']);
  assert.equal(p.value.validated.workflow.nodes.length,7);
  assert.ok(p.value.template.bindings.every(b=>b.mode==='caps'));
  const lower=await instantiateMasTemplate(p.value.template,{caps:{calls:12,concurrency:2}});assert.ok(lower.valid);assert.equal(lower.value.workflow.limits.calls,12);
  const raised=await instantiateMasTemplate(p.value.template,{caps:{calls:25}});assert.equal(raised.valid,false);
  const repeat=await prepareHeraScaffold({...f,config:config.value},{kind:'fixed'});assert.ok(repeat.valid);assert.equal(p.value.plan.executableRevision,repeat.value.plan.executableRevision);
  const single=await prepareHeraScaffold({...f,config:config.value},{kind:'single-turn'});assert.ok(single.valid,JSON.stringify(single));assert.equal(single.value.validated.workflow.nodes.filter(n=>n.kind==='agent').length,1);
});
