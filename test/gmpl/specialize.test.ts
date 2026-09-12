import {it} from 'node:test';
import assert from 'node:assert/strict';
import {materializeGmplTemplate,instantiateGmplPattern,createGmplHostBindings} from '@tangleai/gmpl';
import {fixtureCatalog,preparedAnalysis} from './helpers.ts';
it('catalog and materialization are immutable; participant count moves template identity',async()=>{
  const a=await preparedAnalysis(1),b=await preparedAnalysis(2);
  assert.notEqual(a.materialized.template.versionId,b.materialized.template.versionId);
  assert.equal(a.instance.workflow.nodes.filter(n=>n.kind==='agent').length,2);
  const again=await materializeGmplTemplate(a.recipe,a.domain,a.host,a.catalog);assert.ok(again.valid);assert.equal(again.value.revision,a.materialized.revision);
  assert.ok(Object.isFrozen(a.materialized.template.fragment));assert.ok(createGmplHostBindings(a.materialized,a.catalog).valid);
  const copy=structuredClone(a.materialized.template);(copy.fragment as {nodes:unknown[]}).nodes=[];
  assert.notEqual(JSON.stringify(copy),JSON.stringify(a.materialized.template));
});
it('specialization cannot widen host authority or patch topology',async()=>{
  const a=await preparedAnalysis(2,2);
  for(const params of [{caps:{concurrency:3}},{profile:'hidden'},{tools:['hidden']},{context:['hidden']},{participants:4},{nodes:[]}])assert.ok(!(await instantiateGmplPattern(a.materialized,params,a.host,a.catalog)).valid);
  const narrowed=await instantiateGmplPattern(a.materialized,{caps:{concurrency:1}},a.host,a.catalog);assert.ok(narrowed.valid);assert.equal(narrowed.value.workflow.limits.concurrency,1);
  const f=await fixtureCatalog({pattern:'parallel-analysis',caps:{calls:129}});const widened=await materializeGmplTemplate(f.recipe,f.domain,f.host,f.catalog);assert.ok(!widened.valid);assert.equal(widened.issues[0].code,'TGMPL1007');
});
