import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createMasRegistrySnapshot,createMasConfigCatalog,defineMasWorkflow,taskInvocation,interactionInvocation,masMessage,validateMasWorkflow,planMasWorkflow} from '@tangleai/mas';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
const integer={type:'integer'},object={type:'object',properties:{n:integer},required:['n'],additionalProperties:false};
it('selected messages equal delivered values in a DAG and across durable control regions',async()=>{
  const snapshot=await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'selected-feeds',roles:[],handlers:['source','sum','finish'].map(id=>({id,title:id,effect:'pure',idempotency:'not-required'})),tools:[],contextAdapters:[],messageAdapters:[{id:'json-schema',version:'0.1'}],templates:[],subgraphs:[]});
  const catalog=await createMasConfigCatalog({profiles:['scripted'],tools:[],contexts:[]});assert.ok(snapshot.valid&&catalog.valid);
  const workflow=await defineMasWorkflow({workflowId:'selection-regression',title:'Selected feeds',description:'Selected values survive ordered aggregation and a control boundary.',profile:'scripted',
    input:{type:'object',properties:{n:integer},required:['n'],additionalProperties:false},output:{type:'object',properties:{n:integer},required:['n'],additionalProperties:false},
    nodes:[taskInvocation({id:'a',handler:'source',input:{n:integer},output:{value:object}}),taskInvocation({id:'b',handler:'source',input:{n:integer},output:{value:object}}),
      taskInvocation({id:'sum',handler:'sum',input:{values:{type:'array',items:integer}},output:{value:object}}),
      interactionInvocation({id:'human',input:{prompt:integer},output:{response:object},prompt:integer,response:object}),
      taskInvocation({id:'finish',handler:'finish',input:{n:integer},output:{n:integer}})],
    entry:[{port:'n',to:{node:'a',port:'n'}},{port:'n',to:{node:'b',port:'n'}}],exit:[{port:'n',from:{node:'finish',port:'n'}}],
    messages:[masMessage(['b','value'],['sum','values'],{select:'$.n',aggregation:'ordered-list'}),masMessage(['a','value'],['sum','values'],{select:'$.n',aggregation:'ordered-list'}),
      masMessage(['sum','value'],['human','prompt'],{select:'$.n'}),masMessage(['human','response'],['finish','n'],{select:'$.n'})],
    registryRevision:snapshot.value.revision,configRegistryRevision:catalog.value.revision});
  const validated=await validateMasWorkflow(workflow,snapshot.value,catalog.value);assert.ok(validated.valid,JSON.stringify(validated));
  const plan=await planMasWorkflow(validated.value);assert.ok(plan.valid);
  const received:unknown[]=[];
  const result=await driveGmplWorkflow({validated:validated.value,plan:plan.value,snapshot:snapshot.value,catalog:catalog.value},{input:{n:3},humanResponses:[{n:12}],response:()=>{throw Error('No provider allowed');},
    bindings:{taskHandlers:{source:async({node,value})=>({value:{n:Number(value.n)+(node==='b'?1:0)}}),sum:async({value})=>{received.push(value.values);return {value:{n:(value.values as number[]).reduce((n,x)=>n+x,0)}};},finish:async({value})=>{received.push(value.n);return {n:value.n};}}}});
  assert.equal(result.status,'completed',JSON.stringify(result.trace.run.failure));assert.deepEqual(result.output,{n:12});assert.deepEqual(received,[[4,3],12]);
  assert.deepEqual(result.trace.messages.map(m=>m.payload),[3,4,7,12]);assert.equal(result.trace.interactions[0].prompt,7);assert.equal(result.usage.physical,0);
});
