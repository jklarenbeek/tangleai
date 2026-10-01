import { createMemoryForecastStore, createHarnessRefiner, forecastMust, forecastQuestionCreate, forecastHarnessStage, forecastHarnessProvisional, forecastQuery, forecastPromptRevisions, forecastExecutorToolset, forecastRevision, sealForecastRecord, SEED_HARNESS, createForecastContract } from '@tangleai/forecast';
export async function qualifyForecastBrowser() {
  const store=createMemoryForecastStore(),at='2025-01-01T00:00:00.000Z',prompts=await forecastPromptRevisions(),tools=await forecastExecutorToolset('evolving-harness');
  const question=await sealForecastRecord('questions',{scopeKey:'browser/forecast',prompt:'Which proposal will be selected?',issuedAt:at,expectedResolutionAt:'2025-02-01T00:00:00.000Z',status:'open',adapter:{id:'choice/v1',version:'1',options:['approve','reject']},checkpointPolicy:{ordinals:[1,2],scheduledAt:[at,'2025-01-02T00:00:00.000Z']},startedFromCheckedVersionId:null,latestProvisionalVersionId:null,promptRevision:prompts.executor,toolsetRevision:tools.revision});
  forecastMust(await forecastQuestionCreate(store,question));
  const parent=await sealForecastRecord('harnesses',{scopeKey:question.scopeKey,questionId:null,parentVersionId:null,document:SEED_HARNESS,digest:await forecastRevision(SEED_HARNESS),status:'staged',checkedVersionId:null,provenance:{seed:true,revisionId:null,retrospectiveId:null},recordedAt:at});
  forecastMust(await forecastHarnessStage(store,parent));
  const source='note:'+await forecastRevision('browser supplied note');let writes=0;
  const refiner=await createHarnessRefiner({parent,context:{questionPrompt:question.prompt,questionId:question.id,checkpointIds:[],adapterOptions:question.adapter.options,evidenceExcerpts:[],toolResultExcerpts:[]},sources:[source],now:()=>at,commit:async plan=>{
    const staged=await sealForecastRecord('harnesses',{...parent,questionId:question.id,parentVersionId:parent.id,document:plan.document,digest:plan.digest,provenance:{seed:false,revisionId:null,retrospectiveId:null}});
    forecastMust(await forecastHarnessStage(store,staged));writes++;return forecastMust(await forecastHarnessProvisional(store,staged.id));
  }});
  const item={component:'evidenceHandling',text:'Compare independent observations before updating the judgment.',sources:[source]};
  const refused=await refiner.prepareGuidance([{...item,text:'Remember the approve outcome on 2025-02-01.'}]);
  if(refused.valid)throw Error('Browser forecast admitted a volatile fact.');
  const staged=await refiner.commitGuidance([item]);if(!staged.ok)throw Error(JSON.stringify(staged));
  const versions=forecastMust(await forecastQuery(store,'harnesses',{questionId:question.id}));
  return {writes,versions:versions.length,status:versions[0].status,refusal:refused.errors[0].code,contractRevision:await createForecastContract().revision()};
}
