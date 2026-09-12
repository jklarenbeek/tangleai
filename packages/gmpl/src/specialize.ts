/** Immutable materialization, then safe MAS specialization/validation/planning. No execution. */
import {equalsJson} from '@jarenjs/core/object';
import {createMasRegistrySnapshot,createMasConfigCatalog,taskInvocation,masMessage,masRevisionOf,masTemplateVersionIdOf,masWorkflowVersionIdOf,
  instantiateMasTemplate,validateMasWorkflow,planMasWorkflow,type MasRegistrySnapshot,type MasConfigCatalog,
  type MasTemplate,type MasWorkflow,type WorkflowLimits} from '@tangleai/mas';
import {gmplRefuse,type GmplOutcome} from './errors.ts';
import {gmplVersionOf,gmplRevisionOf,immutableJson} from './identity.ts';
import {resolveGmplParameters,GMPL_LIMITS,type GmplCatalog} from './catalog.ts';
import {validateGmplShape,gmplSchemaOf} from './schema.ts';
import {buildDelphiRound} from './patterns/delphi-panel.ts';
import {buildClarification} from './patterns/clarification.ts';
import {buildBoundedPattern} from './patterns/controller.ts';
import {buildDebateRound} from './patterns/structured-debate.ts';
import {buildPeerReviewRound} from './patterns/peer-review.ts';
import {buildRedTeamRound} from './patterns/red-team.ts';
import {buildRoundConsumer} from './patterns/round.ts';
import {buildParallelAnalysis} from './patterns/parallel-analysis.ts';
import type {GmplDomainBinding,GmplPatternRecipe,GmplPatternParameters} from './contracts.gen.ts';
export interface GmplHostSnapshot {registry:MasRegistrySnapshot;config:MasConfigCatalog;profile:string;}
export interface GmplMaterializedTemplate {
  template:MasTemplate;registry:MasRegistrySnapshot;config:MasConfigCatalog;
  recipe:GmplPatternRecipe;domain:GmplDomainBinding;parameters:GmplPatternParameters;
  catalogRevision:string;hostRevision:string;revision:string;
}
export async function materializeGmplTemplate(recipe:GmplPatternRecipe,domain:GmplDomainBinding,host:GmplHostSnapshot,catalog:GmplCatalog):Promise<GmplOutcome<GmplMaterializedTemplate>>{
  try{
    const detached=immutableJson({recipe,domain});recipe=detached.recipe;domain=detached.domain;
    for(const [name,value] of [['gmplPatternRecipe',recipe],['gmplDomainBinding',domain]] as const){const s=validateGmplShape(name,value);if(!s.valid)return s as GmplOutcome<GmplMaterializedTemplate>;if(await gmplVersionOf(value)!==value.revision)return gmplRefuse('TGMPL1002','/revision','recipe or domain is stale');}
    const registered=catalog.recipe(recipe.id),boundDomain=catalog.domain(domain.id);
    if(!registered||!boundDomain)return gmplRefuse('TGMPL1003','/catalog','recipe and domain must belong to this catalog');
    if(registered.revision!==recipe.revision||boundDomain.revision!==domain.revision)return gmplRefuse('TGMPL1002','/revision','catalog binding differs');
    const parameters=resolveGmplParameters(recipe.parameters);if(!parameters.valid)return parameters;
    const registry=await createMasRegistrySnapshot(host.registry.document);if(!registry.valid)return registry;
    const {revision:_configRevision,...configDocument}=host.config;
    const config=await createMasConfigCatalog(configDocument);if(!config.valid)return config;
    if(registry.value.revision!==host.registry.revision||config.value.revision!==host.config.revision)return gmplRefuse('TGMPL1002','/host','host snapshot is stale');
    if(!config.value.profiles.includes(host.profile))return gmplRefuse('TGMPL1007','/host/profile','profile not declared by host');
    const limits:WorkflowLimits={...GMPL_LIMITS};
    for(const key of Object.keys(limits) as Array<keyof WorkflowLimits>){
      const ceiling=config.value.limits?.[key];if(ceiling!==undefined)limits[key]=Math.min(limits[key],ceiling);
      const requested=parameters.value.caps?.[key];if(requested!==undefined){if(requested>limits[key])return gmplRefuse('TGMPL1007',`/parameters/caps/${key}`,'parameters cannot widen host caps');limits[key]=requested;}
    }
    const prompts=recipe.stages.map(stage=>catalog.prompt(domain.rolePrompts[stage]??stage));
    if(prompts.some(p=>!p))return gmplRefuse('TGMPL1003','/recipe/stages','unknown prompt stage');
    for(const required of domain.requiredCapabilities){
      const found=registry.value.document.messageAdapters.find(a=>a.id===required.id)||registry.value.document.contextAdapters.find(a=>a.id===required.id);
      if(!found||!('version' in found)||found.version!==required.version)return gmplRefuse('TGMPL1007','/domain/requiredCapabilities',`host capability ${required.id} is unavailable`);
    }
    const context={catalog,domain,profile:host.profile,limits};
    let fragment:MasWorkflow;const subgraphs:MasWorkflow[]=[];
    if(parameters.value.pattern==='parallel-analysis')fragment=await buildParallelAnalysis(parameters.value.participants??2,context);
    else if(parameters.value.pattern==='peer-review'||parameters.value.pattern==='red-team'){
      const body=parameters.value.pattern==='peer-review'?await buildPeerReviewRound(parameters.value.participants??2,context):await buildRedTeamRound(parameters.value.participants??1,context);
      subgraphs.push(body);fragment=recipe.scope==='round'?await buildRoundConsumer(body,context):await buildBoundedPattern(body,context,{author:true,maxRounds:parameters.value.maxRounds??3});
    }else if(parameters.value.pattern==='structured-debate'){
      const body=await buildDebateRound(parameters.value.participants??2,context);subgraphs.push(body);fragment=await buildBoundedPattern(body,context,{author:false,synthesis:'analysis-merge',maxRounds:parameters.value.maxRounds??3});
    }else if(parameters.value.pattern==='clarification'){
      const built=await buildClarification(parameters.value.maxTurns??5,context);fragment=built.fragment;subgraphs.push(...built.subgraphs);
    }else if(parameters.value.pattern==='delphi-panel'){
      const body=await buildDelphiRound(parameters.value.participants??5,context);subgraphs.push(body);fragment=await buildBoundedPattern(body,context,{author:false,synthesis:'delphi-panel-aggregate',maxRounds:parameters.value.maxRounds??3});
    }else return gmplRefuse('TGMPL1003','/recipe','unknown pattern controller');
    const deliveries=fragment.entry;
    fragment={...fragment,entry:[{port:'input',to:{node:'validate-domain-input',port:'input'}}],nodes:[taskInvocation({id:'validate-domain-input',handler:'gmpl-domain-input',input:{input:gmplSchemaOf('gmplInput')},output:{input:gmplSchemaOf('gmplInput')},statePull:[{member:'/policy',as:'policy'}]}),...fragment.nodes],messages:[...deliveries.map((entry,i)=>masMessage(['validate-domain-input','input'],[entry.to.node,entry.to.port],{id:`domain-input-${i+1}`})),...fragment.messages]};
    const handlers=[...new Set([fragment,...subgraphs].flatMap(w=>w.nodes.filter(n=>n.kind==='task').map(n=>n.handler)))].map(id=>({id,title:id,effect:'pure' as const,idempotency:'not-required' as const}));
    const roles=await Promise.all(prompts.map(async a=>({id:a!.role.id,title:a!.role.title,instructions:a!.role.instructions,instructionsRevision:await masRevisionOf(a!.role.instructions),capabilities:[]})));
    const messageAdapters=[{id:'json-schema',version:'0.1'},...prompts.map(a=>({id:`gmpl-${a!.id}`,version:a!.revision}))];
    const merge=<T extends {id:string}>(base:T[],add:T[]):T[]=>{const entries=new Map(base.map(v=>[v.id,v]));for(const v of add){const previous=entries.get(v.id);if(previous&&!equalsJson(previous,v))throw Error(`host artifact collision '${v.id}'`);entries.set(v.id,v);}return [...entries.values()];};
    const snapshot=await createMasRegistrySnapshot({...registry.value.document,roles:merge(registry.value.document.roles,roles),handlers:merge(registry.value.document.handlers,handlers),messageAdapters:merge(registry.value.document.messageAdapters,messageAdapters),subgraphs:merge(registry.value.document.subgraphs,subgraphs.map(workflow=>({id:workflow.workflowId,versionId:workflow.versionId,workflow:workflow as unknown as Record<string,unknown>})))});
    if(!snapshot.valid)return snapshot;
    const workflow:MasWorkflow=JSON.parse(JSON.stringify(fragment));workflow.registry.revision=snapshot.value.revision;workflow.config.registryRevision=config.value.revision;
    workflow.state={schema:{type:'object',properties:{policy:gmplSchemaOf('gmplPolicy')},required:['policy'],additionalProperties:false},init:{policy:{parameters:parameters.value,domain,catalogRevision:catalog.document.revision,recipeRevision:recipe.revision}}};
    workflow.versionId=await masWorkflowVersionIdOf(workflow as unknown as Record<string,unknown>);
    const parameterSchema={type:'object',properties:{caps:{type:'object',properties:Object.fromEntries(Object.entries(limits).map(([k,max])=>[k,{type:'integer',minimum:0,maximum:max}])),additionalProperties:false}},additionalProperties:false};
    const template:MasTemplate={$masTemplate:'0.1',templateId:`gmpl-${recipe.id}-${domain.id}`,versionId:'0'.repeat(64),parentVersionId:null,title:recipe.id,description:`${recipe.revision}/${domain.revision}/${catalog.document.revision}`,provenance:{author:'gmpl'},fragment:workflow as unknown as Record<string,unknown>,parameters:{schema:parameterSchema},bindings:Object.keys(limits).map(k=>({parameterPointer:`/caps/${k}`,targetPointer:`/limits/${k}`,mode:'caps' as const}))};
    template.versionId=await masTemplateVersionIdOf(template as unknown as Record<string,unknown>);
    const payload={template:immutableJson(template),registry:snapshot.value,config:config.value,recipe,domain,parameters:parameters.value,catalogRevision:catalog.document.revision,hostRevision:await gmplRevisionOf({registry:registry.value.revision,config:config.value.revision,profile:host.profile})};
    const revision=await gmplRevisionOf({template:template.versionId,catalog:payload.catalogRevision,host:payload.hostRevision,recipe:recipe.revision,domain:domain.revision});
    return {valid:true,value:Object.freeze({...payload,revision})};
  }catch(error){return gmplRefuse('TGMPL1007','/materialization','materialization failed',error);}
}
export async function instantiateGmplPattern(materialized:GmplMaterializedTemplate,parameters:unknown,host:GmplHostSnapshot,catalog:GmplCatalog){
  try {
  const hostRevision=await gmplRevisionOf({registry:host.registry.revision,config:host.config.revision,profile:host.profile});
  if(materialized.catalogRevision!==catalog.document.revision||materialized.hostRevision!==hostRevision)return gmplRefuse('TGMPL1002','/revision','materialization pins differ from supplied host/catalog');
  const expectedRevision=await gmplRevisionOf({template:materialized.template.versionId,catalog:materialized.catalogRevision,host:materialized.hostRevision,recipe:materialized.recipe.revision,domain:materialized.domain.revision});
  if(expectedRevision!==materialized.revision)return gmplRefuse('TGMPL1002','/revision','materialized identity is stale');
  const checkedRegistry=await createMasRegistrySnapshot(materialized.registry.document);if(!checkedRegistry.valid)return checkedRegistry;
  if(checkedRegistry.value.revision!==materialized.registry.revision)return gmplRefuse('TGMPL1002','/revision','materialized registry is stale');
  const instance=await instantiateMasTemplate(materialized.template,parameters);if(!instance.valid)return instance;
  const validated=await validateMasWorkflow(instance.value.workflow,checkedRegistry.value,materialized.config);if(!validated.valid)return validated;
  const plan=await planMasWorkflow(validated.value);if(!plan.valid)return plan;
  return {valid:true as const,value:{...instance.value,validated:validated.value,plan:plan.value,snapshot:checkedRegistry.value,catalog:materialized.config,materialized}};
  }catch(error){return gmplRefuse('TGMPL1001','/template','invalid materialized template',error);}
}
