/** Keyless MAS host. The durable runtime owns scheduling, loops and waits. */
import { compileMasRuntime, createMasConfigCatalog, createMasRegistrySnapshot, defineMasWorkflow,
  MasInfrastructureCrash, agentInvocation, masRevisionOf, validateMasWorkflow, planMasWorkflow,
  type MasChatCompletion, type MasIssue, type MasHostBindings, type MasRegistrySnapshot, type MasConfigCatalog,
  type ValidatedMasWorkflow, type MasWorkflowPlan, type MasChatClient } from '@tangleai/mas';
import { createMasStore, openTangleDb, createMasSegmentHandlers, enqueueMasSegment, ensurePendingMasSegments } from '@tangleai/store';
import {gmplSchemaOf} from '@tangleai/gmpl';
import schema from '../schemas/gmpl-conformance.schema.json' with { type: 'json' };
import manifest from '../fixtures/gmpl/manifest.json' with { type: 'json' };
import type { Input, Result, Usage, Visibility } from './gmpl-conformance.types.ts';

export const emptyUsage = (): Usage => ({ roles:0, completion:0, normalization:0, repair:0, physical:0,
  tools:0, context:0, promptTokens:0, completionTokens:0, unknownTokenRequests:0, activeMs:0,
  traceBytes:0, replays:0, restores:0, money:null, moneyReason:'scripted; live monetary cost unmeasured' });
export interface PreparedDrive { validated: ValidatedMasWorkflow; plan: MasWorkflowPlan; snapshot: MasRegistrySnapshot; catalog: MasConfigCatalog; }
export interface ScriptedDriveOptions {
  clock?: { value:number };
  runLimits?: Record<string,number>;
  provider?: string;
  input: unknown;
  response: (node: string, invocation: number, phase: Visibility['phase'], messages: Visibility['messages']) => unknown | Promise<unknown>;
  complete?: (node:string, invocation:number, phase:Visibility['phase'], request:unknown)=>Promise<MasChatCompletion>;
  beforeCall?: (node: string, invocation: number, phase: Visibility['phase']) => Promise<void>;
  bindings?: Partial<Pick<MasHostBindings,'taskHandlers'|'messageAdapters'|'toolBindings'|'contextProviders'>>;
  databasePath?: string;
  crashBefore?: string;
  crashFsm?: { state: string; iteration?: number };
  crashBeforeSegmentCompletion?: boolean;
  reopenAfterResponse?: boolean;
  humanResponses?: unknown[];
  waitingResolution?: 'cancelled'|'expired';
  unknownUsage?: boolean;
}
export async function driveGmplWorkflow(prepared: PreparedDrive, options: ScriptedDriveOptions) {
  const clock=options.clock??{value:1_000_000};
  const open=()=>openTangleDb({...(options.databasePath?{path:options.databasePath}:{}),jobs:{now:()=>clock.value,random:()=>0.5}});
  let db=await open();
  try {
    let tick=0;
    const now=()=>`tick-${String(tick++).padStart(6,'0')}`;
    let armed=true,crashes=0,reopens=0;
    const makeStore=()=>{
      const base=createMasStore(db,{now});
      return {...base,putRunFsm:async (...args:Parameters<typeof base.putRunFsm>)=>{
        const result=await base.putRunFsm(...args);
        const snapshot=args[2] as {state:string;context?:{iteration?:number}};
        if(armed&&options.crashFsm&&snapshot.state===options.crashFsm.state&&(options.crashFsm.iteration===undefined||snapshot.context?.iteration===options.crashFsm.iteration)){armed=false;throw new MasInfrastructureCrash('scripted crash after durable FSM state');}
        return result;
      }};
    };
    let store=makeStore();
    const usage=emptyUsage(), visibility: Visibility[]=[], events:string[]=[];
    const cursors=new Map<string, { invocation:number; phase:Visibility['phase'] }>();
    const clientFor=(node:{id:string}):MasChatClient=>({ endpoint:{provider:options.provider??'scripted'}, complete:async request=>{
      const raw=request as { messages:Visibility['messages'] };
      const messages=raw.messages.map(m=>({role:m.role,content:typeof m.content==='string'?m.content:JSON.stringify(m.content)}));
      const cursor=cursors.get(node.id) ?? {invocation:0,phase:'completion' as const};
      const phase=cursor.phase;
      // The suite normalizer appends schema instructions; a fresh agent call
      // has no prior assistant turn. This also resets cursors across loop rounds.
      const fresh=!messages.some(m=>m.role==='assistant');
      if(fresh){cursor.invocation++;cursor.phase='completion';}
      const current=fresh?'completion':phase;
      const evidenceIds=[...new Set(messages.flatMap(m=>[...m.content.matchAll(/"id"\s*:\s*"([^"]+-e\d+)"/g)].map(x=>x[1])))];
      visibility.push({node:node.id,phase:current,messages,evidenceIds});
      usage.physical++;usage[current]++;if(current==='completion')usage.roles++;
      await options.beforeCall?.(node.id,cursor.invocation,current);
      if(options.complete){
        try{const completion=await options.complete(node.id,cursor.invocation,current,request);
          const u=completion.usage as {prompt_tokens?:number;completion_tokens?:number}|undefined;
          if(typeof u?.prompt_tokens==='number'&&typeof u?.completion_tokens==='number'){usage.promptTokens+=u.prompt_tokens;usage.completionTokens+=u.completion_tokens;}else usage.unknownTokenRequests++;
          cursor.phase=current==='completion'?'normalization':'repair';cursors.set(node.id,cursor);return completion;
        }catch(error){usage.unknownTokenRequests++;throw error;}
      }
      let reply:unknown;
      try { reply=await options.response(node.id,cursor.invocation,current,messages); }
      catch(error){usage.unknownTokenRequests++;throw error;}
      if(options.unknownUsage)usage.unknownTokenRequests++;else{usage.promptTokens+=7;usage.completionTokens+=3;}
      cursor.phase=current==='completion'?'normalization':'repair';cursors.set(node.id,cursor);
      return {message:{role:'assistant',content:typeof reply==='string'?reply:JSON.stringify(reply)},finishReason:'stop',
        ...(options.unknownUsage?{}:{usage:{prompt_tokens:7,completion_tokens:3}})};
    }});
    const compileRuntime=()=>compileMasRuntime(prepared.validated,prepared.plan,prepared.snapshot,{
      store,toolBindings:{},contextProviders:{},clientFor,now,clock:()=>clock.value,
      deadlineFor:()=> 'tick-999999',observer:{onNodeEnter:p=>{events.push(`${p}:enter`);},
        onNodeSettle:(p,s)=>{events.push(`${p}:${s}`);},onNodeReplay:p=>{usage.replays++;events.push(`${p}:replay`);},
        onNodeRestored:p=>{usage.restores++;events.push(`${p}:restored`);}},...options.bindings,
      taskHandlers:Object.fromEntries(Object.entries(options.bindings?.taskHandlers??{}).map(([id,handler])=>[id,async args=>{
        if(armed&&options.crashBefore&&(args.node===options.crashBefore||args.path===options.crashBefore)){armed=false;throw new MasInfrastructureCrash(`scripted crash before ${args.path}`);}
        return handler(args);
      }])),
    });
    let runtime=compileRuntime();
    if(!runtime.valid)throw Error(JSON.stringify(runtime.issues));
    const w=prepared.validated.workflow,runId='gmpl-measurement';
    const saved=await store.putWorkflowVersion(w);if(!saved.ok)throw Error(JSON.stringify(saved.issue));
    const registered=await store.putRegistrySnapshot(prepared.snapshot.document as unknown as Record<string,unknown>,prepared.snapshot.revision);if(!registered.ok)throw Error(JSON.stringify(registered.issue));
    const created=await store.createRun({runId,workflowId:w.workflowId,workflowVersionId:w.versionId,
      registryRevision:prepared.snapshot.revision,executableRevision:prepared.plan.executableRevision,
      configRegistryRevision:prepared.catalog.revision,profile:w.config.profile,input:structuredClone(options.input),limits:{...w.limits,...options.runLimits}});
    if(!created.ok)throw Error(JSON.stringify(created.issue));
    await enqueueMasSegment(db,{runId,segment:0,workflowVersionId:w.versionId,registryRevision:prepared.snapshot.revision,executableRevision:prepared.plan.executableRevision});
    const makeHandlers=()=>createMasSegmentHandlers(store,{executableRevisions:[prepared.plan.executableRevision],execute:segment=>{
      if(!runtime.valid)throw Error(JSON.stringify(runtime.issues));
      return runtime.value.executeSegment({...segment,completeSegment:async value=>{
        if(armed&&options.crashBeforeSegmentCompletion){armed=false;throw new MasInfrastructureCrash('scripted crash before segment completion');}
        await segment.completeSegment(value);
      }});
    },owner:'gmpl'});
    let handlers=makeHandlers();const kind=Object.keys(handlers)[0];let responseIndex=0,acceptedResponses=0;const responseIssues:MasIssue[]=[];
    const reopen=async()=>{
      if(!options.databasePath)throw Error('SQLite reopen needs an explicit temporary databasePath');
      await db.close();db=await open();store=makeStore();runtime=compileRuntime();if(!runtime.valid)throw Error(JSON.stringify(runtime.issues));handlers=makeHandlers();reopens++;
    };
    for(let segment=0;segment<32;segment++){
      const jobs=db.jobs!;
      const job=await jobs.claim({kinds:[kind],owner:'gmpl',leaseMs:60000});
      if(!job){
        const trace=await store.readTrace(runId);
        const interaction=trace?.interactions.find(i=>i.status==='waiting');
        if(interaction&&options.waitingResolution){const resolution=await store.resolveInteraction(interaction.id,options.waitingResolution,interaction.revision);if(!resolution.ok)throw Error(JSON.stringify(resolution.issue));break;}
        if(interaction && responseIndex<(options.humanResponses?.length??0)){
          const accepted=await store.respondInteraction(interaction.id,options.humanResponses![responseIndex++],interaction.revision,'gmpl-script');
          if(!accepted.ok){responseIssues.push(accepted.issue);break;}
          acceptedResponses++;
          if(options.reopenAfterResponse)await reopen();
          await ensurePendingMasSegments(db,store);
          const repeated=await ensurePendingMasSegments(db,store);if(repeated.examined!==0)throw Error('reconciliation was not idempotent');continue;
        }break;
      }
      try{
        const value=await handlers[kind](job.payload,{job,checkpoints:jobs.checkpointsFor(job),signal:new AbortController().signal} as never);
        await jobs.complete(job.lease,value??null);
      }catch(error){
        if(!(error instanceof MasInfrastructureCrash))throw error;
        crashes++;await jobs.fail(job.lease,error);clock.value+=300000;
        if(options.databasePath)await reopen();
      }
    }
    const trace=await store.readTrace(runId);if(!trace)throw Error('missing MAS trace');
    usage.activeMs=trace.run.budget.spent.ms;
    usage.tools=trace.attempts.reduce((n,a)=>n+a.usage.toolCalls,0);
    usage.context=trace.attempts.reduce((n,a)=>n+a.usage.contextReads,0);
    usage.traceBytes=Buffer.byteLength(JSON.stringify(trace));
    return {status:trace.run.status,output:trace.run.output,usage,visibility,events,trace,crashes,reopens,responses:acceptedResponses,responseIssues};
  }finally{await db.close();}
}

export function fixtureSchema(name: keyof typeof schema.$defs): Record<string,unknown> {
  const names = name === 'input' ? ['evidence'] : name === 'result' ? ['citation','claim','finding'] : Object.keys(schema.$defs);
  const defs = Object.fromEntries(names.map(key => [key, schema.$defs[key as keyof typeof schema.$defs]]));
  return {$id:`https://tangleai.dev/schemas/gmpl-fixture/${name}`,...schema.$defs[name],$defs:defs};
}
export async function prepareSingleAgent(calls=manifest.caps.calls,profile='scripted-v1'):Promise<PreparedDrive>{
  const instructions='Answer only from the supplied evidence. Cite evidence ids and digests. Preserve supported disagreements; abstain when information is missing.';
  const revision=await masRevisionOf(instructions);
  const snapshot=await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'gmpl-control',roles:[{id:'single-agent',title:'Single agent',instructions,instructionsRevision:revision,capabilities:[]}],handlers:[],tools:[],contextAdapters:[],messageAdapters:[{id:'json-schema',version:'0.1'}],templates:[],subgraphs:[]});
  const catalog=await createMasConfigCatalog({profiles:[profile],tools:[],contexts:[]});
  if(!snapshot.valid||!catalog.valid)throw Error('control registry refused');
  const input=gmplSchemaOf('gmplInput'),result=gmplSchemaOf('gmplPatternResult');
  const w=await defineMasWorkflow({workflowId:'gmpl-single-agent',title:'Paired single agent',description:'Equal input, output schema and total caps.',
    input:{type:'object',properties:{input},required:['input'],additionalProperties:false},output:{type:'object',properties:{result},required:['result'],additionalProperties:false},
    entry:[{port:'input',to:{node:'single-agent',port:'input'}}],exit:[{port:'result',from:{node:'single-agent',port:'result'}}],
    nodes:[agentInvocation({id:'single-agent',role:'single-agent',instructionsRevision:revision,profile,input:{input},output:{result}})],
    limits:{...manifest.caps,calls},registryRevision:snapshot.value.revision,configRegistryRevision:catalog.value.revision,profile});
  const validated=await validateMasWorkflow(w,snapshot.value,catalog.value);if(!validated.valid)throw Error(JSON.stringify(validated.issues));
  const plan=await planMasWorkflow(validated.value);if(!plan.valid)throw Error(JSON.stringify(plan.issues));
  return {validated:validated.value,plan:plan.value,snapshot:snapshot.value,catalog:catalog.value};
}
export async function driveSingleAgent(input:Input,result:Result,options:{repair?:boolean;calls?:number;unknownUsage?:boolean}={}){
  return driveGmplWorkflow(await prepareSingleAgent(options.calls),{input:{input},unknownUsage:options.unknownUsage,
    response:(_node,_iteration,phase,messages)=>{
      if(messages.some(m=>/"oracle"\s*:|"requiredFindings"\s*:/.test(m.content)))throw Error('oracle leaked into agent request');
      return options.repair && phase==='normalization'?{}:structuredClone(result);
    }});
}
