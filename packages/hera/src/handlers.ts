/** Read projections join retained evidence; no handler has write capabilities. */
import type {Handler,RequestContext} from '@jarenjs/contract/http';
import {createJSONPatch} from '@jarenjs/json/patch';
import {transformJson} from '@jarenjs/json/jslt';
import {toMermaid,diagramDocument} from '@jarenjs/mermaid';
import dagToFlowchart from '@jarenjs/mermaid/stylesheets/dag-to-flowchart.jslt.json' with {type:'json'};
import {projectMasPlan,type MasWorkflowPlan} from '@tangleai/mas';
import {emptyHeraHead} from './heads.ts';
import type {HeraStore,HeraRecordKind,HeraRecords} from './store.ts';
import type {HeraExperience,HeraPromptVersion,HeraPromptTrial,HeraTrajectory,HeraTrajectoryStep,HeraTopology,HeraSurfaceEvidence} from './contracts.gen.ts';
export type HeraReadStore=Pick<HeraStore,'scope'|'get'|'query'|'readHead'>;
export interface HeraHandlerOptions {store:HeraReadStore;}
export function createHeraHandlers({store}:HeraHandlerOptions):Record<string,Handler>{
  const get=async<K extends HeraRecordKind>(kind:K,id:string):Promise<HeraRecords[K]|undefined>=>{const record=await store.get(kind,id);return record?.scope===store.scope?record:undefined;};
  const head=async(kind:'snapshot'|'prompt',agentId?:string)=>{const empty=emptyHeraHead(store.scope,kind,agentId);return await get('head',empty.id)??empty;};
  const evidence=async(ids:readonly string[],stepIds?:readonly string[]):Promise<HeraSurfaceEvidence|undefined>=>{
    const trajectories=await Promise.all([...new Set(ids)].map(id=>get('trajectory',id)));
    if(trajectories.some(t=>!t||t.primaryScore===null))return undefined;
    const all=trajectories as HeraTrajectory[],steps=[...new Set(stepIds??all.flatMap(t=>t.stepIds))];
    if(!all.length||!steps.length)return undefined;
    const retained=await Promise.all(steps.map(id=>get('trajectoryStep',id)));
    if(retained.some(s=>!s||!all.some(t=>t.id===s.trajectoryId&&t.stepIds.includes(s.id))))return undefined;
    return {trajectoryIds:all.map(t=>t.id),stepIds:steps};
  };
  const experience=async(entry:HeraExperience)=>{
    const advantage=await get('advantage',entry.provenance.advantageId);if(!advantage)return undefined;
    const source=await evidence(advantage.sourceTrajectoryIds,[...new Set([...advantage.successFactors,...advantage.failureModes,...advantage.insights].flatMap(i=>i.stepIds))]);
    return source?{experience:entry,advantage,source}:undefined;
  };
  const prompt=async(version:HeraPromptVersion,history?:HeraPromptTrial[])=>{
    const trials=(history??await store.query('promptTrial',{scope:store.scope,agentId:version.agentId,limit:10000})).filter(t=>t.candidatePromptVersionId===version.id||version.sourceTrialIds.includes(t.id));
    const rules=[];
    for(const block of ['operationalRules','behavioralPrinciples'] as const)for(const [index,rule] of version[block].entries()){
      const source=await evidence(rule.derivedFrom);if(!source||!source.trajectoryIds.length)return undefined;rules.push({block,index,text:rule.text,source});
    }
    return {promptVersion:version,trials,rules};
  };
  const trajectory=async(id:string)=>{
    const value=await get('trajectory',id);if(!value)return undefined;
    const steps=await Promise.all(value.stepIds.map(id=>get('trajectoryStep',id)));
    if(steps.some(s=>!s||s.trajectoryId!==value.id))return undefined;
    return {trajectory:value,steps:steps as HeraTrajectoryStep[]};
  };
  type Input={id:string;scope:string;agentId:string;status?:string;limit?:number;fromId:string;toId:string};
  const reads:Record<string,(input:Input,context:RequestContext)=>Promise<unknown>>={
    async 'agents.list'(_input,ctx){
      const agents=await store.query('agent',{scope:store.scope,limit:10000}),rows=[];
      for(const agent of agents){const current=await head('prompt',agent.id),version=current.versionId?await get('promptVersion',current.versionId):null;
        if(current.versionId&&!version)return ctx.fail('not-found');rows.push({agent,head:current,promptVersion:version??null});}
      return {agents:rows};
    },
    async 'snapshots.list'(input,ctx){if(input.scope!==store.scope)return ctx.fail('not-found');return {snapshots:await store.query('snapshot',{scope:store.scope,limit:input.limit}),head:await head('snapshot')};},
    async 'snapshots.get'(input,ctx){const snapshot=await get('snapshot',input.id);return snapshot?{snapshot,head:await head('snapshot')}:ctx.fail('not-found');},
    async 'experiences.list'(input,ctx){if(input.scope!==store.scope)return ctx.fail('not-found');const rows=await Promise.all((await store.query('experience',{scope:store.scope,status:input.status,limit:input.limit})).map(experience));return rows.some(r=>!r)?ctx.fail('not-found'):{experiences:rows};},
    async 'experiences.get'(input,ctx){const entry=await get('experience',input.id),value=entry?await experience(entry):undefined;return value??ctx.fail('not-found');},
    async 'prompts.history'(input,ctx){if(!await get('agent',input.agentId))return ctx.fail('not-found');const trials=await store.query('promptTrial',{scope:store.scope,agentId:input.agentId,limit:10000}),rows=await Promise.all((await store.query('promptVersion',{scope:store.scope,agentId:input.agentId,limit:input.limit})).map(p=>prompt(p,trials)));return rows.some(r=>!r)?ctx.fail('not-found'):{versions:rows};},
    async 'prompts.get'(input,ctx){const version=await get('promptVersion',input.id),value=version?await prompt(version):undefined;return value??ctx.fail('not-found');},
    async 'prompts.diff'(input,ctx){const from=await get('promptVersion',input.fromId),to=await get('promptVersion',input.toId);if(!from||!to||from.agentId!==to.agentId||from.envelopeRevision!==to.envelopeRevision)return ctx.fail('not-found');
      const blocks=(v:HeraPromptVersion)=>({operationalRules:v.operationalRules,behavioralPrinciples:v.behavioralPrinciples});
      return {...input,patch:createJSONPatch(blocks(from),blocks(to)),fromLength:new TextEncoder().encode(from.effectivePrompt).length,toLength:new TextEncoder().encode(to.effectivePrompt).length,lengthUnit:'utf8-bytes'};
    },
    async 'groups.get'(input,ctx){const group=await get('rolloutGroup',input.id);if(!group)return ctx.fail('not-found');const operations=await store.query('operation',{scope:store.scope,groupId:group.id,limit:10000}),stages=new Map<string,{stage:string;state:'enabled'|'disabled'|'refused';operationIds:string[]}>();
      for(const op of operations){const state=op.status==='disabled'?'disabled':op.status==='failed'?'refused':'enabled',prior=stages.get(op.stage);stages.set(op.stage,{stage:op.stage,state:prior?.state==='refused'?'refused':state,operationIds:[...(prior?.operationIds??[]),op.id]});}
      return {group,operations,stages:[...stages.values()].sort((a,b)=>a.stage.localeCompare(b.stage))};
    },
    async 'trajectories.get'(input,ctx){return await trajectory(input.id)??ctx.fail('not-found');},
    async 'trajectories.mermaid'(input,ctx){
      const value=await trajectory(input.id),topology=value?await get('topology',value.trajectory.topologyId):undefined,record=value?await get('operation',value.trajectory.masRunId+':plan'):undefined;
      if(!value||!topology||!record||record.stage!=='execution.plan'||record.taskId!==value.trajectory.taskId||record.snapshotId!==value.trajectory.snapshotId)return ctx.fail('not-found');
      const saved=record.value as {plan:MasWorkflowPlan;executableRevision:string;promptVersionIds:Record<string,string>};
      if(!saved?.plan||saved.plan.executableRevision!==saved.executableRevision||!saved.promptVersionIds||topology.nodes.some(n=>!saved.promptVersionIds[n.agentId])
        ||value.steps.some(s=>saved.promptVersionIds[s.agentId]!==s.promptVersionId))return ctx.fail('not-found');
      const roles=roleProjection(topology,saved.promptVersionIds);return {trajectoryId:value.trajectory.id,topologyId:topology.id,executable:projectMasPlan(saved.plan),roles};
    },
    async 'trials.list'(input,ctx){if(!await get('agent',input.agentId))return ctx.fail('not-found');return {trials:await store.query('promptTrial',{scope:store.scope,agentId:input.agentId,limit:input.limit})};},
    async 'trials.get'(input,ctx){return await get('promptTrial',input.id)??ctx.fail('not-found');},
    async 'mutations.list'(input,ctx){if(input.scope!==store.scope)return ctx.fail('not-found');const mutations=await store.query('mutation',{scope:store.scope,limit:input.limit}),rows=[];
      for(const mutation of mutations){const parentTopology=await get('topology',mutation.parentTopologyId),topology=mutation.candidateTopologyId?await get('topology',mutation.candidateTopologyId):null;
        if(!parentTopology||(mutation.candidateTopologyId&&!topology))return ctx.fail('not-found');rows.push({mutation,parentTopology,topology:topology??null});}
      return {mutations:rows};
    },
  };
  return Object.fromEntries(Object.entries(reads).map(([id,read])=>['hera.'+id,(input:unknown,ctx:RequestContext)=>read(input as Input,ctx)]));
}
function roleProjection(topology:HeraTopology,promptVersionIds:Record<string,string>){
  const nodes=topology.nodes.map(n=>({id:n.id,roleId:n.agentId,dependsOn:[...n.dependsOn],promptVersionId:promptVersionIds[n.agentId]??n.promptVersionId})),byId=new Map(nodes.map(n=>[n.id,n])),roles=[...new Set(nodes.map(n=>n.roleId))],seen=new Set<string>(),edges=[];
  for(const node of nodes)for(const dependency of node.dependsOn){const from=byId.get(dependency)!.roleId,to=node.roleId,key=JSON.stringify([from,to]);if(!seen.has(key)){seen.add(key);edges.push({from,to});}}
  const ast=transformJson(dagToFlowchart,{nodes:Object.fromEntries(roles.map(id=>[id,{kind:'task'}])),edges});
  return {nodes,mermaid:toMermaid(diagramDocument('flowchart',{},ast,{hash:'0',direction:'TD',title:null}))};
}
