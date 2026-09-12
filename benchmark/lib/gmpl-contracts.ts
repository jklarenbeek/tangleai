/** Actual public contract observations compared with separately registered expectations. */
import {compileMasRuntime,type MasHostBindings} from '@tangleai/mas';
import {gmplArtifacts,createGmplCatalog,renderGmplPrompt,validateGmplPromptArtifact,validateGmplEvidence,type GmplPromptArtifact} from '@tangleai/gmpl';
import {prepareGmplPattern} from './gmpl-patterns.ts';
import type {Case} from './gmpl-conformance.types.ts';
export async function measureGmplContracts(cases:Case[]){
  const catalog=await createGmplCatalog(gmplArtifacts);if(!catalog.valid)throw Error(JSON.stringify(catalog.issues));
  let renders=0;
  for(const artifact of catalog.value.document.prompts)for(const variables of [{query:'synthetic',evidence:[]},{query:'synthetic',evidence:[],context:{nested:['{{query}}','$literal']}}]){
    if(!renderGmplPrompt(artifact,variables).valid)throw Error(`render failed ${artifact.id}`);renders++;
  }
  const observations:Record<string,Record<string,unknown>>={};
  const codePath=(value:Awaited<ReturnType<typeof validateGmplPromptArtifact>>)=>{
    if(value.valid)throw Error('unsafe contract accepted');const issue=value.issues[0];return {code:issue.code,path:issue.path};
  };
  const fixture=cases[0];
  for(const id of ['hidden-evidence-id','changed-evidence-digest','unsupported-final-citation']){
    const result=structuredClone(fixture.script.result);
    if(id==='changed-evidence-digest')result.claims[0].citations[0].digest='0'.repeat(64);
    else result.claims[0].citations[0].id=id==='hidden-evidence-id'?'hidden-source':cases[4].input.evidence[0].id;
    const checked=validateGmplEvidence(result,fixture.input.evidence);if(checked.valid)throw Error(`${id} accepted`);
    observations[id]={code:checked.issues[0].code,path:checked.issues[0].path};
  }
  const minority=cases.find(c=>c.oracle.requiredFindings.length)!;
  const missing=validateGmplEvidence({...minority.script.result,findings:[]},minority.input.evidence,minority.script.result.findings);
  if(missing.valid)throw Error('supported finding silently deleted');observations['minority-findings-not-overwritten']={code:missing.issues[0].code,path:missing.issues[0].path};
  const stale=structuredClone(gmplArtifacts.prompts[0]) as GmplPromptArtifact;stale.role.instructions+=' changed';
  observations['stale-artifact-refused']=codePath(await validateGmplPromptArtifact(stale));
  const p=await prepareGmplPattern({pattern:'parallel-analysis',participants:1});
  const adapter=[...p.bindings.messageAdapters.values()][0];
  // Alias the registered adapter to the probe's named capability for a precise pointer oracle.
  const mismatched=new Map(p.bindings.messageAdapters);mismatched.set('gmpl',{...adapter,id:'gmpl',version:'stale'});
  const bound=compileMasRuntime(p.validated,p.plan,p.snapshot,{store:{} as MasHostBindings['store'],taskHandlers:p.bindings.taskHandlers,toolBindings:{},contextProviders:{},clientFor:()=>({complete:async()=>{throw Error('contract probe cannot dispatch');}}),now:()=>'',clock:()=>0,messageAdapters:mismatched});
  if(bound.valid)throw Error('mismatched adapter accepted');const issue=bound.issues.find(i=>i.path==='/messageAdapters/gmpl');if(!issue)throw Error('wrong adapter refusal');
  observations['mismatched-adapter-refused']={code:issue.code,path:issue.path};
  return {observations,artifacts:{packs:catalog.value.document.prompts.length,validRenders:renders,catalogRevision:catalog.value.document.revision}};
}
