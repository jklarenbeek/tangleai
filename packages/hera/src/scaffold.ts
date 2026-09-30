/** Fixed comparison scaffolds are host-pinned MAS templates with caps-only bindings. */
import { agentInvocation, taskInvocation, defineMasWorkflow, masMessage, masTemplateVersionIdOf,
  instantiateMasTemplate, validateMasWorkflow, planMasWorkflow, type MasRegistrySnapshot,
  type MasConfigCatalog, type MasTemplate, type WorkflowLimits, type MessageEdge } from '@tangleai/mas';
import type { GmplCatalog } from '@tangleai/gmpl';
import { deepFreeze } from '@jarenjs/core/object';
import { heraRefuse, type HeraOutcome } from './errors.ts';
import type { HeraAgentDefinition } from './contracts.gen.ts';
import { HERA_ANSWER_SCHEMA } from './evidence.ts';
export const HERA_DEFAULT_LIMITS: WorkflowLimits = Object.freeze({calls:24,tokens:65536,ms:120000,toolRounds:2,fanOut:4,concurrency:4,iterations:1,contextChars:32768,traceBytes:1048576});
/** Invocation ids are separate from role ids; the two retrievers share one role. */
export const HERA_FIXED_NODES = deepFreeze([
  {id:'decompose',agentId:'query-decomposer',dependsOn:[] as string[]},
  {id:'retrieve-1',agentId:'retriever',dependsOn:['decompose']},
  {id:'retrieve-2',agentId:'retriever',dependsOn:['decompose']},
  {id:'select',agentId:'evidence-selector',dependsOn:['retrieve-1','retrieve-2']},
  {id:'answer',agentId:'answer-generator',dependsOn:['select']},
  {id:'conclude',agentId:'conclude-agent',dependsOn:['answer']},
]);
export interface HeraScaffoldHost { registry: MasRegistrySnapshot; config: MasConfigCatalog; catalog: GmplCatalog; agents: readonly HeraAgentDefinition[]; }
/** A template version includes the frozen registry and profiles of its host. */
export async function createHeraFixedTemplate(host: HeraScaffoldHost, kind:'fixed'|'single-turn'='fixed'): Promise<HeraOutcome<MasTemplate>> {
  const declarations = kind==='single-turn' ? [HERA_FIXED_NODES[5]] : HERA_FIXED_NODES;
  const text = {type:'string',minLength:1};
  const outputs = new Map(declarations.map(n=>[n.id,host.catalog.prompt('hera-'+n.agentId)?.outputSchema]));
  const nodes = [], messages:MessageEdge[] = [];
  for (const declaration of declarations) {
    const agent = host.agents.find(a=>a.id===declaration.agentId), role=host.registry.document.roles.find(r=>r.id===declaration.agentId);
    const artifact=host.catalog.prompt('hera-'+declaration.agentId);
    if (!agent || !role || !artifact) return heraRefuse('THERA1002','/roles','The fixed scaffold requires all of its registered role artifacts.');
    const input:Record<string,Record<string,unknown>|boolean> = {query:text};
    if (kind==='fixed') {
      if (declaration.id.startsWith('retrieve-')) input.subquery={type:'string',minLength:1};
      else if (declaration.dependsOn.length) input.context=declaration.dependsOn.length===1
        ? outputs.get(declaration.dependsOn[0])! : {type:'array',items:outputs.get(declaration.dependsOn[0])!};
    }
    nodes.push(agentInvocation({id:declaration.id,role:agent.id,profile:agent.profile,instructionsRevision:role.instructionsRevision,
      input,output:{result:artifact.outputSchema},tools:agent.tools,context:['documents','memory'],messageAdapter:'hera-'+artifact.id}));
    if (kind==='fixed') for (const dependency of declaration.dependsOn) messages.push(masMessage([dependency,'result'],[declaration.id,declaration.id.startsWith('retrieve-')?'subquery':'context'],{
      ...(declaration.id.startsWith('retrieve-')?{select:{$get:["$.queries",Number(declaration.id.at(-1))-1]}}:{}),
      aggregation:declaration.dependsOn.length>1?'ordered-list':'one'}));
  }
  nodes.push(taskInvocation({id:'validate',handler:'hera-validate-answer',input:{answer:outputs.get('conclude')!},output:{result:HERA_ANSWER_SCHEMA}}));
  messages.push(masMessage(['conclude','result'],['validate','answer']));
  const workflow = await defineMasWorkflow({workflowId:'hera-'+kind,title:'HERA '+kind,description:'Cited bounded role execution through the shared runtime.',
    input:{type:'object',properties:{query:text,evidence:{type:'array'},binding:{type:'string'}},required:['query','evidence','binding'],additionalProperties:false},
    output:{type:'object',properties:{result:HERA_ANSWER_SCHEMA},required:['result'],additionalProperties:false},
    entry:declarations.map(n=>({port:'query',to:{node:n.id,port:'query'}})),exit:[{port:'result',from:{node:'validate',port:'result'}}],nodes,messages,
    registryRevision:host.registry.revision,configRegistryRevision:host.config.revision,profile:host.agents[0].profile,limits:{...HERA_DEFAULT_LIMITS}});
  const properties=Object.fromEntries(Object.entries(HERA_DEFAULT_LIMITS).map(([key,max])=>[key,{type:'integer',minimum:0,maximum:max}]));
  const template:MasTemplate={$masTemplate:'0.1',templateId:'hera-'+kind,versionId:'0'.repeat(64),parentVersionId:null,title:'HERA '+kind,
    description:'Frozen role scaffold; specialization can only lower limits.',provenance:{author:'hera'},fragment:workflow as unknown as Record<string,unknown>,
    parameters:{schema:{type:'object',properties:{caps:{type:'object',properties,additionalProperties:false}},required:['caps'],additionalProperties:false}},
    bindings:Object.keys(properties).map(key=>({parameterPointer:'/caps/'+key,targetPointer:'/limits/'+key,mode:'caps'}))};
  template.versionId=await masTemplateVersionIdOf(template as unknown as Record<string,unknown>);
  return {valid:true,value:template};
}
export async function prepareHeraScaffold(host: HeraScaffoldHost, options:{kind:'fixed'|'single-turn';caps?:Partial<WorkflowLimits>}) {
  const template=await createHeraFixedTemplate(host,options.kind);if(!template.valid)return template;
  const instance=await instantiateMasTemplate(template.value,{caps:options.caps??{}});
  if(!instance.valid)return heraRefuse('THERA1003','/caps','The scaffold cannot raise its registered caps.',instance.issues);
  const validated=await validateMasWorkflow(instance.value.workflow,host.registry,host.config);
  if(!validated.valid)return heraRefuse('THERA1003','/workflow','The scaffold failed MAS validation.',validated.issues);
  const plan=await planMasWorkflow(validated.value);
  if(!plan.valid)return heraRefuse('THERA1003','/plan','The scaffold could not be lowered.',plan.issues);
  return {valid:true as const,value:{template:template.value,validated:validated.value,plan:plan.value,registry:host.registry,config:host.config}};
}
