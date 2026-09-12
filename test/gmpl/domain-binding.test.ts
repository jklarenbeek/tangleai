import {it} from 'node:test';
import assert from 'node:assert/strict';
import {gmplSchemaOf,type GmplDomainBinding} from '@tangleai/gmpl';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
for(const pattern of ['parallel-analysis','peer-review'] as const)it(`${pattern} checks domain input before dispatching a paid role`,async()=>{
  const schema=structuredClone(gmplSchemaOf('gmplInput')) as {properties:Record<string,unknown>};schema.properties.query={const:'Only this query is permitted'};
  const domain:Omit<GmplDomainBinding,'revision'>={id:'restricted-review',title:'Restricted review',payloadSchema:schema,projection:{id:'text-answer',version:'1',kind:'text',scale:null},rolePrompts:{},requiredCapabilities:[]};
  const p=await prepareGmplPattern({pattern},'pattern',{domain});
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:()=>({result:fixture.script.result})});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,0);assert.match(d.trace.run.failure!.error.detail,/TGMPL1001/);
});
it('peer review supports its declared one-reviewer lower bound',async()=>{
  const p=await prepareGmplPattern({pattern:'peer-review',participants:1}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('reviewer')?{result,assessment:'accept',issues:[],strengths:[]}:{result}});
  assert.equal(d.status,'completed');assert.equal(d.usage.roles,2);
});

it('domain replacement changes data identities while preserving participant topology and round policy',async()=>{
  const {prepareGmplExample}=await import('../../examples/gmpl.ts');
  const a=await prepareGmplExample('document-review'),b=await prepareGmplExample('estimate-panel');
  const topology=(p:typeof a)=>[p.validated.workflow,...p.snapshot.document.subgraphs.map(s=>s.workflow)].map(raw=>{
    const w=raw as typeof p.validated.workflow;
    return {entry:w.entry,exit:w.exit,nodes:w.nodes.map(n=>({id:n.id,kind:n.kind})),messages:w.messages.map(m=>({from:m.from,to:m.to}))};
  });
  assert.deepEqual(topology(a),topology(b));assert.deepEqual(a.materialized.parameters,b.materialized.parameters);
  assert.notEqual(a.materialized.domain.revision,b.materialized.domain.revision);
  assert.notDeepEqual(a.materialized.domain.payloadSchema,b.materialized.domain.payloadSchema);
  assert.notDeepEqual(a.snapshot.document.roles,b.snapshot.document.roles);assert.notEqual(a.catalog.revision,b.catalog.revision);
  assert.notEqual(a.input.evidence[0].digest,b.input.evidence[0].digest);
});
it('example required capabilities identify an actual bound stage adapter',async()=>{
  const {prepareGmplExample}=await import('../../examples/gmpl.ts');
  const p=await prepareGmplExample('document-review');
  for(const c of p.materialized.domain.requiredCapabilities)assert.equal(p.bindings.messageAdapters.get(c.id)?.version,c.version);
});
