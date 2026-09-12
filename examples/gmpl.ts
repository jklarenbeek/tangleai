/** Keyless domain composition using public content APIs and the existing MAS worker. */
import {stringifyToml} from '@jarenjs/josl';
import {gmplArtifacts,GMPL_STAGES,compileGmplPromptPack,createGmplCatalog,gmplCatalogDocument,
  createGmplDomainBinding,createGmplRecipe,gmplSchemaOf,gmplTextDigest,materializeGmplTemplate,
  instantiateGmplPattern,createGmplHostBindings,type GmplPatternParameters,
  type GmplPatternResult,type GmplInput} from '@tangleai/gmpl';
import {createMasRegistrySnapshot,createMasConfigCatalog,compileMasRuntime,projectMasPlan,
  type MasChatCompletion} from '@tangleai/mas';
import {openTangleDb,createMasStore,createMasSegmentWorker,enqueueMasSegment,ensurePendingMasSegments} from '@tangleai/store';
import fixtures from './fixtures/gmpl-domains.json' with {type:'json'};

function value<T>(outcome:{valid:true;value:T}|{valid:false;issues:unknown[]}):T {
  if(!outcome.valid)throw Error(JSON.stringify(outcome.issues));return outcome.value;
}
export type ExampleDomain='document-review'|'estimate-panel';
/** Domain replacement changes immutable schemas, roles and capabilities, preserving pattern policy. */
export async function prepareGmplExample(domainId:ExampleDomain,parameters:GmplPatternParameters={pattern:'delphi-panel',participants:2}) {
  const fixture=fixtures[domainId],numeric=domainId==='estimate-panel';
  const prompts=await Promise.all(gmplArtifacts.prompts.map(async original=>{
    const pack=structuredClone(original.pack);pack.meta.id=`${domainId}-${original.id}`;pack.meta.role=`${domainId}-${pack.meta.role}`;
    pack.system.content+=`\nDomain: ${fixture.instructions}`;
    return value(await compileGmplPromptPack(stringifyToml(pack),{variables:original.variables,outputSchema:original.outputSchema}));
  }));
  const payloadSchema=structuredClone(gmplSchemaOf('gmplInput')) as {properties:Record<string,unknown>};
  payloadSchema.properties.query={type:'string',const:fixture.query};
  const stageCapability={id:`gmpl-${domainId}-${GMPL_STAGES[parameters.pattern][0]}`,version:prompts.find(p=>p.id===`${domainId}-${GMPL_STAGES[parameters.pattern][0]}`)!.revision};
  const domain=value(await createGmplDomainBinding({id:domainId,title:fixture.title,payloadSchema,
    projection:{id:numeric?'estimate-answer':'text-answer',version:'1',kind:numeric?'numeric':'text',scale:numeric?{minimum:0,maximum:1}:null},
    rolePrompts:Object.fromEntries(gmplArtifacts.prompts.map(p=>[p.id,`${domainId}-${p.id}`])),requiredCapabilities:[stageCapability]}));
  const recipe=value(await createGmplRecipe({id:parameters.pattern,parameters,stages:[...GMPL_STAGES[parameters.pattern]]}));
  const catalog=value(await createGmplCatalog(await gmplCatalogDocument({id:`example-${domainId}`,prompts:[...gmplArtifacts.prompts,...prompts],domains:[domain],recipes:[recipe]})));
  const registry=value(await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'gmpl-example',roles:[],handlers:[],tools:[],messageAdapters:[stageCapability],contextAdapters:[],templates:[],subgraphs:[]}));
  const config=value(await createMasConfigCatalog({profiles:[`scripted-${domainId}`],tools:[],contexts:[]}));
  const host={registry,config,profile:`scripted-${domainId}`};
  const materialized=value(await materializeGmplTemplate(recipe,domain,host,catalog));
  const prepared=value(await instantiateGmplPattern(materialized,{},host,catalog));
  const bindings=value(createGmplHostBindings(materialized,catalog));
  const input:GmplInput={caseId:domainId,query:fixture.query,evidence:await Promise.all(fixture.evidence.map(async (text,i)=>({id:`${domainId}-e${i+1}`,text,digest:await gmplTextDigest(text)})))};
  return {...prepared,bindings,materialized,contentCatalog:catalog,input};
}
/** A scripted host supplies fixture output and explicit typed human responses. No real provider. */
export async function runGmplExample(path:string,domain:ExampleDomain,parameters:GmplPatternParameters={pattern:'delphi-panel',participants:2},twoTurns=false) {
  const p=await prepareGmplExample(domain,parameters),w=p.validated.workflow,runId='gmpl-example';
  let calls=0,responses=0,reopens=0,tick=0;
  const now=()=>`tick-${String(tick++).padStart(6,'0')}`;
  const open=()=>openTangleDb({path,jobs:{now:()=>1_000_000,random:()=>0.5}});
  let db=await open(),store=createMasStore(db,{now});
  const fixture=fixtures[domain];
  const result:GmplPatternResult={answer:fixture.answer,disposition:'completed',claims:[{text:fixture.answer,citations:p.input.evidence.map(({id,digest})=>({id,digest}))}],findings:[]};
  const reply=(node:string,messages:Array<{role:string;content:unknown}>):unknown=>{
    if(node.startsWith('reviewer'))return {result,assessment:'accept',issues:[],strengths:[]};
    if(node.startsWith('attack')){const user=String(messages.find(m=>m.role==='user')?.content);return {result,strategy:JSON.parse(user.split('Declared stage context:\n')[1]).strategy};}
    if(node.startsWith('defense'))return {result,mitigations:[]};
    if(node==='resilience-judge')return {result,resilience:0.9,action:'accept'};
    if(node.startsWith('position'))return {result,stance:node};
    if(node.startsWith('rebuttal'))return {result,addresses:['position-1:claim-1']};
    if(node==='judge')return {result,action:'accept'};
    if(node.startsWith('panelist'))return {result,answerKey:fixture.answer,estimate:fixture.estimate,confidence:0.9};
    if(node==='inspect'||node==='resolve')return {result,resolved:!twoTurns||responses>=2,refinedQuery:p.input.query};
    if(node==='question')return {questions:[{id:'q1',text:responses===0?'Which scope should be used?':'Which reporting period should be used?'}]};
    return {result};
  };
  const compile=()=>value(compileMasRuntime(p.validated,p.plan,p.snapshot,{store,...p.bindings,toolBindings:{},contextProviders:{},
    clientFor:node=>({endpoint:{provider:'scripted'},complete:async (request):Promise<MasChatCompletion>=>{calls++;if(calls>128)throw Error('Example exceeded its request limit');return {message:{role:'assistant',content:JSON.stringify(reply(node.id,(request as {messages:Array<{role:string;content:unknown}>}).messages))},finishReason:'stop',usage:{prompt_tokens:7,completion_tokens:3}};}}),
    now,clock:()=>1_000_000,deadlineFor:()=> 'tick-999999'}));
  const reopen=async()=>{await db.close();db=await open();store=createMasStore(db,{now});reopens++;};
  try{
    if(!(await store.putWorkflowVersion(w)).ok)throw Error('Workflow registration failed');
    if(!(await store.putRegistrySnapshot(p.snapshot.document as unknown as Record<string,unknown>,p.snapshot.revision)).ok)throw Error('Registry registration failed');
    if(!(await store.createRun({runId,workflowId:w.workflowId,workflowVersionId:w.versionId,registryRevision:p.snapshot.revision,executableRevision:p.plan.executableRevision,configRegistryRevision:p.catalog.revision,profile:w.config.profile,input:{input:p.input},limits:{...w.limits}})).ok)throw Error('Run creation failed');
    await enqueueMasSegment(db,{runId,segment:0,workflowVersionId:w.versionId,registryRevision:p.snapshot.revision,executableRevision:p.plan.executableRevision});
    for(let segment=0;segment<3;segment++){
      const runtime=compile();let resolve!:()=>void,reject!:(error:unknown)=>void;
      const done=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
      const timeout=setTimeout(()=>reject(Error('Example worker deadline')),15000);
      const worker=createMasSegmentWorker(db,store,{executableRevisions:[p.plan.executableRevision],execute:async job=>{try{await runtime.executeSegment(job);resolve();}catch(error){reject(error);throw error;}},concurrency:1,pollInterval:1,owner:'gmpl-example'});
      worker.start();try{await done;}finally{clearTimeout(timeout);await worker.stop();}
      await reopen();
      const trace=await store.readTrace(runId);if(!trace)throw Error('Missing saved trace');
      if(trace.run.status==='completed')break;
      const waiting=trace.interactions.find(i=>i.status==='waiting');
      if(!twoTurns||!waiting||responses>=2)throw Error(JSON.stringify(trace.run.failure??trace.run.status));
      const response={answers:{q1:responses===0?'Use the documented pilot scope.':'Use the current reporting period.'}};
      if(!(await store.respondInteraction(waiting.id,response,waiting.revision,`scripted-turn-${responses+1}`)).ok)throw Error('Typed response rejected');
      responses++;await reopen();
      if((await ensurePendingMasSegments(db,store)).enqueued!==1)throw Error('Resume was not enqueued');
      if((await ensurePendingMasSegments(db,store)).examined!==0)throw Error('Resume was duplicated');
    }
    const trace=await store.readTrace(runId);if(trace?.run.status!=='completed')throw Error('Example did not complete');
    const before=JSON.stringify(trace),callsBefore=calls;
    await reopen();
    if((await ensurePendingMasSegments(db,store)).examined!==0||JSON.stringify(await store.readTrace(runId))!==before||calls!==callsBefore)throw Error('Completed replay changed effects');
    return {domain,pattern:parameters.pattern,calls,responses,reopens,replayCalls:calls-callsBefore,projection:projectMasPlan(p.plan),trace,result:trace.run.output};
  }finally{await db.close();}
}
