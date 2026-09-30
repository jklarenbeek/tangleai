/** Invocation-graph validation precedes the single MAS compiler. */
import { defineMasWorkflow,agentInvocation,taskInvocation,masMessage,validateMasWorkflow,planMasWorkflow,type MasRegistrySnapshot,type MasConfigCatalog } from '@tangleai/mas';
import type { GmplCatalog } from '@tangleai/gmpl';
import { heraRefuse,heraIssue,type HeraOutcome } from './errors.ts';
import { validateHeraShape } from './schema.ts';
import { HERA_ANSWER_SCHEMA } from './evidence.ts';
import { HERA_DEFAULT_LIMITS } from './scaffold.ts';
import type { HeraTopology,HeraPlanOutput,HeraLearningSnapshot,HeraAgentDefinition,HeraBudget } from './contracts.gen.ts';
export interface HeraTopologyRegistry {registry:MasRegistrySnapshot;agents:readonly HeraAgentDefinition[];}
export interface HeraTopologyValidation {order:string[];terminal:string;depth:number;fanOut:number;frontier:number;}
export function validateHeraTopology(topology:HeraTopology,snapshot:HeraLearningSnapshot,host:HeraTopologyRegistry,caps:HeraBudget):HeraOutcome<HeraTopologyValidation> {
  const fail=(path:string,detail:string)=>heraRefuse<HeraTopologyValidation>('THERA1003',path,detail);
  if(!validateHeraShape('heraBudget',caps).valid)return fail('/caps','Candidate caps must be finite nonnegative integers.');
  if(!topology||!Array.isArray(topology.nodes)||!Array.isArray(topology.appliedExperienceIds)||!Array.isArray(topology.offeredExperienceIds))return fail('/nodes','A candidate must declare its invocation and experience lists.');
  if(topology.nodes.some(n=>!n||typeof n!=='object'))return fail('/nodes','Every invocation must be an object.');
  if(topology.scope!==snapshot.scope||topology.snapshotId!==snapshot.id)return fail('/snapshotId','The topology must bind the requested frozen scope and snapshot.');
  if(topology.nodes.length>snapshot.config.maxAgents||topology.nodes.length>caps.nodes)return fail('/nodes','The candidate exceeds its registered invocation cap.');
  const nodes=topology.nodes,seen=new Set<string>();
  for(const [index,node] of nodes.entries()){
    if(seen.has(node.id))return fail('/nodes/'+index+'/id','Invocation ids must be distinct even when roles repeat.');seen.add(node.id);
  }
  const shape=validateHeraShape<HeraPlanOutput>('heraPlanOutput',{nodes:nodes.map(({promptVersionId,...node})=>node),appliedExperienceIds:topology.appliedExperienceIds});
  if(!shape.valid)return {valid:false,issues:shape.issues.map(i=>heraIssue('THERA1003',i.path,i.detail,i))};
  const byId=new Map(nodes.map(n=>[n.id,n])),outgoing=new Map(nodes.map(n=>[n.id,[] as string[]]));
  for(const [index,node] of nodes.entries()){
    const agent=host.agents.find(a=>a.id===node.agentId),role=host.registry.document.roles.find(r=>r.id===node.agentId);
    if(!agent||!role)return fail('/nodes/'+index+'/agentId','The role is not registered in the frozen pool.');
    if(!snapshot.activePromptVersionIds[node.agentId]||snapshot.activePromptVersionIds[node.agentId]!==node.promptVersionId)return fail('/nodes/'+index+'/promptVersionId','The prompt is not active in this snapshot.');
    for(const [toolIndex,tool] of (node.tools??agent.tools).entries())if(!agent.tools.includes(tool))return fail('/nodes/'+index+'/tools/'+toolIndex,'A candidate cannot widen its role tool allowlist.');
    for(const [dependencyIndex,dependency] of node.dependsOn.entries()){
      if(!byId.has(dependency))return fail('/nodes/'+index+'/dependsOn/'+dependencyIndex,'The dependency names no invocation.');
      outgoing.get(dependency)!.push(node.id);
    }
  }
  for(const [index,id] of topology.appliedExperienceIds.entries())if(!topology.offeredExperienceIds.includes(id))return fail('/appliedExperienceIds/'+index,'An applied experience was not offered.');
  const degrees=new Map(nodes.map(n=>[n.id,n.dependsOn.length])),order:string[]=[],depths=new Map<string,number>();let frontier=0;
  const ready=nodes.filter(n=>degrees.get(n.id)===0).map(n=>n.id);
  while(ready.length){
    frontier=Math.max(frontier,ready.length);const id=ready.shift()!,node=byId.get(id)!;order.push(id);
    depths.set(id,1+Math.max(0,...node.dependsOn.map(p=>depths.get(p)!)));
    for(const child of outgoing.get(id)!){degrees.set(child,degrees.get(child)!-1);if(degrees.get(child)===0)ready.push(child);}
  }
  if(order.length!==nodes.length){
    const index=nodes.findIndex(n=>degrees.get(n.id)!>0),dependencyIndex=nodes[index].dependsOn.findIndex(id=>degrees.get(id)!>0);
    return fail('/nodes/'+index+'/dependsOn/'+dependencyIndex,'The invocation graph contains a cycle.');
  }
  const terminals=nodes.filter(n=>outgoing.get(n.id)!.length===0);
  if(terminals.length!==1||terminals[0].agentId!=='conclude-agent')return fail('/nodes','The candidate requires exactly one terminal Conclude Agent.');
  const reaches=new Set<string>(),visit=(id:string):void=>{if(reaches.has(id))return;reaches.add(id);for(const dependency of byId.get(id)!.dependsOn)visit(dependency);};visit(terminals[0].id);
  if(reaches.size!==nodes.length)return fail('/nodes','Every invocation must contribute to the terminal answer.');
  const depth=Math.max(...depths.values()),fanOut=Math.max(0,...[...outgoing.values()].map(children=>children.length));
  if(depth>caps.depth)return fail('/caps/depth','The candidate exceeds the declared depth cap.');
  if(fanOut>caps.fanOut)return fail('/caps/fanOut','The candidate exceeds the declared fan-out cap.');
  if(caps.concurrency<1||caps.calls<1||caps.tokens<1||caps.ms<1)return fail('/caps','The candidate has no executable budget share.');
  return {valid:true,value:{order,terminal:terminals[0].id,depth,fanOut,frontier}};
}
export async function toMasWorkflow(topology:HeraTopology,snapshot:HeraLearningSnapshot,host:HeraTopologyRegistry&{catalog:GmplCatalog;config:MasConfigCatalog},caps:HeraBudget) {
  const validation=validateHeraTopology(topology,snapshot,host,caps);if(!validation.valid)return validation;
  const query={type:'string',minLength:1},context={type:'array',items:{type:'object'}},byId=new Map(topology.nodes.map(n=>[n.id,n]));
  const nodes=validation.value.order.map(id=>{
    const node=byId.get(id)!,agent=host.agents.find(a=>a.id===node.agentId)!,role=host.registry.document.roles.find(r=>r.id===node.agentId)!,artifact=host.catalog.prompt(agent.artifactId)!;
    return agentInvocation({id:node.id,role:node.agentId,profile:agent.profile,instructionsRevision:role.instructionsRevision,input:{query,...(node.dependsOn.length?{context}:{})},output:{result:artifact.outputSchema},tools:node.tools??agent.tools,context:agent.contextAdapters,messageAdapter:'hera-'+artifact.id});
  });
  const terminal=validation.value.terminal,terminalNode=nodes.find(n=>n.id===terminal)!;
  const validatorId='hera-validate-'+topology.id.slice(0,12);
  if(byId.has(validatorId))return heraRefuse('THERA1003','/nodes','A candidate reused its reserved validation-task id.');
  const workflow=await defineMasWorkflow({workflowId:'hera-query-'+topology.id,title:'Query-specific HERA',description:'Frozen role invocations with a pure evidence projection.',profile:host.agents[0].profile,
    input:{type:'object',properties:{query,evidence:{type:'array'},binding:{type:'string'}},required:['query','evidence','binding'],additionalProperties:false},output:{type:'object',properties:{result:HERA_ANSWER_SCHEMA},required:['result'],additionalProperties:false},
    nodes:[...nodes,taskInvocation({id:validatorId,handler:'hera-validate-answer',input:{answer:terminalNode.output.ports.result.schema},output:{result:HERA_ANSWER_SCHEMA}})],
    entry:nodes.map(n=>({port:'query',to:{node:n.id,port:'query'}})),exit:[{port:'result',from:{node:validatorId,port:'result'}}],
    messages:[...topology.nodes.flatMap(n=>n.dependsOn.map(dependency=>masMessage([dependency,'result'],[n.id,'context'],{aggregation:'ordered-list'}))),masMessage([terminal,'result'],[validatorId,'answer'])],
    limits:{...HERA_DEFAULT_LIMITS,calls:Math.min(caps.calls,HERA_DEFAULT_LIMITS.calls),tokens:Math.min(caps.tokens,HERA_DEFAULT_LIMITS.tokens),ms:Math.min(caps.ms,HERA_DEFAULT_LIMITS.ms),toolRounds:Math.min(caps.turns,HERA_DEFAULT_LIMITS.toolRounds),fanOut:Math.min(caps.fanOut,HERA_DEFAULT_LIMITS.fanOut),concurrency:Math.min(caps.concurrency,HERA_DEFAULT_LIMITS.concurrency)},registryRevision:host.registry.revision,configRegistryRevision:host.config.revision});
  const checked=await validateMasWorkflow(workflow,host.registry,host.config);if(!checked.valid)return heraRefuse('THERA1003','/workflow','The candidate failed MAS validation.',checked.issues);
  const plan=await planMasWorkflow(checked.value);if(!plan.valid)return heraRefuse('THERA1003','/plan','The candidate could not be lowered.',plan.issues);
  return {valid:true as const,value:{validated:checked.value,plan:plan.value,registry:host.registry,config:host.config}};
}
