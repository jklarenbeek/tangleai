import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMasRegistrySnapshot,createMasConfigCatalog,defineMasWorkflow,loopInvocation,graphInvocation,interactionInvocation,validateMasWorkflow,planMasWorkflow} from '@tangleai/mas';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
const integer={type:'integer',minimum:0},state={type:'object',properties:{n:integer},required:['n'],additionalProperties:false};
const limits={calls:10,tokens:1000,ms:120000,toolRounds:1,fanOut:4,concurrency:2,iterations:3,contextChars:1000,traceBytes:1000000};
async function nested(){
  const body=await defineMasWorkflow({workflowId:'nested-wait-body',title:'Wait body',description:'Typed wait',profile:'scripted-v1',input:state,output:{type:'object',properties:{next:state},required:['next'],additionalProperties:false},nodes:[interactionInvocation({id:'human',input:{prompt:integer},output:{response:state},prompt:integer,response:state})],entry:[{port:'n',to:{node:'human',port:'prompt'}}],exit:[{port:'next',from:{node:'human',port:'response'}}],limits,registryRevision:null,configRegistryRevision:null});
  const child=await defineMasWorkflow({workflowId:'nested-wait-loop',title:'Wait loop',description:'Two typed turns',profile:'scripted-v1',input:state,output:{type:'object',properties:{result:state},required:['result'],additionalProperties:false},nodes:[loopInvocation({id:'turns',body:body.workflowId,input:{start:integer},output:{result:state},init:[{port:'start',to:'/n'}],feedback:[{from:'/next/n',to:'/n'}],result:[{port:'result',from:'/next'}],maxIterations:2,termination:{$eq:['$.output.next.n',2]}})],entry:[{port:'n',to:{node:'turns',port:'start'}}],exit:[{port:'result',from:{node:'turns',port:'result'}}],limits,registryRevision:null,configRegistryRevision:null});
  const registry=await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'nested-wait',roles:[],handlers:[],tools:[],contextAdapters:[],messageAdapters:[{id:'json-schema',version:'0.1'}],templates:[],subgraphs:[body,child].map(workflow=>({id:workflow.workflowId,versionId:workflow.versionId,workflow:workflow as unknown as Record<string,unknown>}))});
  const catalog=await createMasConfigCatalog({profiles:['scripted-v1'],tools:[],contexts:[]});assert.ok(registry.valid&&catalog.valid);
  const top=await defineMasWorkflow({workflowId:'nested-wait-root',title:'Nested waits',description:'Child loop waits',profile:'scripted-v1',input:state,output:child.output.schema,nodes:[graphInvocation({id:'nested',subgraph:child.workflowId,input:{n:integer},output:{result:state}})],entry:[{port:'n',to:{node:'nested',port:'n'}}],exit:[{port:'result',from:{node:'nested',port:'result'}}],limits,registryRevision:registry.value.revision,configRegistryRevision:catalog.value.revision});
  const validated=await validateMasWorkflow(top,registry.value,catalog.value);assert.ok(validated.valid,JSON.stringify(validated));const plan=await planMasWorkflow(validated.value);assert.ok(plan.valid);
  return {validated:validated.value,plan:plan.value,snapshot:registry.value,catalog:catalog.value};
}
it('nested graphs and loop iterations preserve durable waits and distinct response identities',async()=>{
  const p=await nested(),dir=await mkdtemp(join(tmpdir(),'mas-nested-wait-'));
  try{
    const options={input:{n:0},response:()=>{throw Error('no model allowed');}};
    const waiting=await driveGmplWorkflow(p,options);assert.equal(waiting.status,'waiting_for_input',JSON.stringify(waiting.trace.run.failure));
    const done=await driveGmplWorkflow(p,{...options,databasePath:join(dir,'wait.sqlite'),reopenAfterResponse:true,humanResponses:[{n:1},{n:2}]});
    assert.equal(done.status,'completed',JSON.stringify({run:done.trace.run,events:done.events,interactions:done.trace.interactions,crashes:done.crashes}));assert.deepEqual(done.output,{result:{n:2}});assert.equal(done.reopens,2);assert.equal(done.usage.physical,0);
    assert.equal(new Set(done.trace.interactions.map(i=>i.id)).size,2);assert.deepEqual(done.trace.interactions.map(i=>i.path),['nested/turns/1/human','nested/turns/2/human']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
it('an interaction response key replays identical bytes and refuses conflicting bytes',async()=>{
  const {openTangleDb,createMasStore}=await import('@tangleai/store');
  const p=await nested(),db=await openTangleDb(),store=createMasStore(db,{now:()=> 'tick-000000'});
  try{
    const w=p.validated.workflow;
    assert.ok((await store.createRun({runId:'response-key',workflowId:w.workflowId,workflowVersionId:w.versionId,registryRevision:p.snapshot.revision,executableRevision:p.plan.executableRevision,configRegistryRevision:p.catalog.revision,profile:w.config.profile,input:{n:0},limits})).ok);
    assert.ok((await store.claimRunSegment('response-key','test')).ok);assert.ok((await store.transitionRun('response-key',{kind:'wait'})).ok);
    const interaction=await store.createInteraction({runId:'response-key',node:'human',path:'round/1/human',prompt:'Choose n',responseSchema:state,expiry:null,segment:0});assert.ok(interaction.ok);
    const first=await store.respondInteraction(interaction.value.id,{n:1},0,'same-key');assert.ok(first.ok);
    assert.deepEqual(await store.respondInteraction(interaction.value.id,{n:1},0,'same-key'),first);
    const conflict=await store.respondInteraction(interaction.value.id,{n:2},0,'same-key');assert.ok(!conflict.ok);assert.equal(conflict.issue.code,'TMAS2007');
    assert.deepEqual((await store.getInteraction(interaction.value.id))?.response,{n:1});
  }finally{await db.close();}
});
