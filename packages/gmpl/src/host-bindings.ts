import type {MasMessageAdapter} from '@tangleai/mas';
import type {GmplCatalog} from './catalog.ts';
import type {GmplMaterializedTemplate} from './specialize.ts';
import {gmplRefuse,type GmplOutcome} from './errors.ts';
import {renderGmplPrompt} from './prompts.ts';
import {delphiTaskHandlers} from './delphi-tasks.ts';
import {bindGmplAnswerProjector,type GmplAnswerProjector} from './projection.ts';
import {clarificationTaskHandlers} from './clarification-tasks.ts';
import {debateTaskHandlers} from './debate-tasks.ts';
import {roundTaskHandlers} from './round-tasks.ts';
import {analysisTaskHandlers,taskValue} from './tasks.ts';
/** Pure content bindings only. The caller supplies MAS clients, context and store. */
export function createGmplHostBindings(materialized:GmplMaterializedTemplate,catalog:GmplCatalog,options:{answerProjector?:GmplAnswerProjector}={}){
  if(catalog.document.revision!==materialized.catalogRevision)return gmplRefuse('TGMPL1002','/revision','catalog changed after materialization');
  const adapters=new Map<string,MasMessageAdapter>();
  for(const stage of materialized.recipe.stages){
    const artifact=catalog.prompt(materialized.domain.rolePrompts[stage]??stage);
    if(!artifact)return gmplRefuse('TGMPL1003','/recipe/stages','stage artifact unavailable');
    const id=`gmpl-${artifact.id}`;
    adapters.set(id,Object.freeze({id,version:artifact.revision,render:(input:Parameters<MasMessageAdapter['render']>[0])=>taskValue(renderGmplPrompt(artifact,input.value.variables)).user}));
  }
  const projection=materialized.parameters.pattern==='delphi-panel'?bindGmplAnswerProjector(materialized.domain,options.answerProjector):null;
  if(projection&&!projection.valid)return projection;
  const value={taskHandlers:{...analysisTaskHandlers(),...roundTaskHandlers(),...debateTaskHandlers(),...clarificationTaskHandlers(),...(projection?.valid?delphiTaskHandlers(projection.value):{})},messageAdapters:adapters};
  return {valid:true as const,value};
}
