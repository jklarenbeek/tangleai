import {it} from 'node:test';import assert from 'node:assert/strict';
import {integratePrompt,createHeraPromptVersion,heraContentIdOf,validateHeraShape,conflictingPromptRules,type HeraTrajectory,type HeraPromptTrial,type HeraPromptVersion} from '@tangleai/hera';
import {fixture,config,scope,at} from './fixture.ts';
async function integrationFixture(rules?:HeraPromptVersion['operationalRules']){
  const f=await fixture(),agent=f.agents.find(a=>a.id==='retriever')!,active={...f.prompts.find(p=>p.agentId===agent.id)!,status:'active' as const},artifact=f.catalog.prompt(agent.artifactId)!;
  const created=await createHeraPromptVersion(artifact,{scope,at,parentId:active.id,operationalRules:rules??[{text:'Verify evidence.',derivedFrom:['control']}],behavioralPrinciples:[{text:'Retain citations.',derivedFrom:['control']}]});assert.ok(created.valid);
  const candidate=created.value,base={scope,taskId:'q',snapshotId:f.snapshot.id,topologyId:'topology',masRunId:'control-run',groupId:'group',invocationOrder:['retrieve'],answer:'wrong',claimEnvelopeId:null,citations:[],calls:1,stopReason:'completed',failure:null,stepIds:['step'],status:'completed' as const,identityId:'a'.repeat(64),metrics:{citationRecall:0,unsupported:[]}};
  const control:HeraTrajectory={...base,id:'control',primaryScore:0,success:false,tokens:{prompt:10,completion:5,unknownRequests:0,estimated:0}};
  const replay:HeraTrajectory={...base,id:'replay',masRunId:'replay-run',answer:'correct',primaryScore:1,success:true,tokens:{prompt:20,completion:10,unknownRequests:0,estimated:0}};
  const content={scope,agentId:agent.id,bufferId:'b'.repeat(64),executionRunIds:[replay.masRunId],pins:{taskId:'q',snapshotId:f.snapshot.id,corpusRevision:f.snapshot.identities.corpusRevision,topologyId:control.topologyId,activePromptVersionIds:f.snapshot.activePromptVersionIds,identityId:control.identityId,evidenceRevision:'fixture',contextAdapter:'documents' as const,limits:{calls:10,tokens:1000,ms:1000}},failedInvocationIds:['retrieve'],bufferTrajectoryIds:['control'],axis:'efficiency' as const,candidatePromptVersionId:candidate.id,controlTrajectoryId:control.id,replayTrajectoryId:replay.id,
    delta:{score:1,tokens:15},operationalRules:structuredClone(candidate.operationalRules),behavioralPrinciples:structuredClone(candidate.behavioralPrinciples),decision:'activated' as const,reason:'The whole replay improved.'};
  const trial:HeraPromptTrial={...content,id:await heraContentIdOf(content)};
  return {agent,active,candidate,artifact,control,replay,trial,config};
}
it('the constrained patch schema refuses envelope paths, unknown verbs and noncanonical indexes',()=>{
  for(const patch of [[{op:'replace',path:'/effectivePrompt',value:'role rewrite'}],[{op:'move',from:'/operationalRules/0',path:'/behavioralPrinciples/0'}],[{op:'add',path:'/operationalRules/01',value:'rule'}],
    [{op:'replace',path:'/operationalRules',value:[1]}],[{op:'remove',path:'/__proto__'}]])assert.equal(validateHeraShape('heraPromptPatch',patch).valid,false);
  assert.ok(validateHeraShape('heraPromptPatch',[{op:'add',path:'/operationalRules/-',value:'Verified rule.'},{op:'replace',path:'/behavioralPrinciples',value:[]}]).valid);
});
it('guarded integration accepts higher quality or a tie with fewer known provider tokens',async()=>{
  const input=await integrationFixture(),before=structuredClone(input),first=await integratePrompt(input);assert.ok(first.valid,JSON.stringify(first));assert.equal(first.value.noOp,false);
  assert.equal(first.value.promptVersion.id,input.candidate.id);assert.ok(first.value.promptVersion.effectivePrompt.startsWith(input.artifact.role.instructions));assert.deepEqual(input,before);
  input.replay.primaryScore=0;input.replay.success=false;input.replay.tokens={prompt:5,completion:3,unknownRequests:0,estimated:0};input.trial.delta={score:0,tokens:-7};
  assert.ok((await integratePrompt(input)).valid);
  input.replay.tokens.unknownRequests=1;const unknown=await integratePrompt(input);assert.equal(unknown.valid,false);if(!unknown.valid)assert.equal(unknown.issues[0].path,'/trial/delta');
});
it('guarded integration rejects unsupported categories, changed roles/tools, caps and non-improvements',async()=>{
  const input=await integrationFixture();
  const cases:Array<{change:(v:typeof input)=>void|Promise<void>;path:string}>=[
    {change:v=>{v.trial.operationalRules=[];},path:'/patch/0/value'},
    {change:v=>{v.trial.operationalRules[0].derivedFrom=['invented'];},path:'/patch/0/value'},
    {change:v=>{v.agent.tools.push('write-file');},path:'/tools'},
    {change:async v=>{v.candidate.agentId='conclude-agent';v.candidate.id=await heraContentIdOf(v.candidate);},path:'/envelopeRevision'},
    {change:v=>{v.config.promptBounds.maxRules=1;},path:'/bounds'},
    {change:v=>{v.config.promptBounds.maxBytes=1;},path:'/bounds'},
    {change:v=>{v.config.promptBounds.maxOps=1;},path:'/patch'},
    {change:v=>{v.replay.primaryScore=0;v.replay.success=false;v.trial.delta!.score=0;},path:'/trial/delta'},
    {change:v=>{v.replay.primaryScore=null;v.replay.success=null;},path:'/trial/replay'},
    {change:v=>{v.replay.topologyId='partial-role';},path:'/trial'},
  ];
  for(const c of cases){const changed=structuredClone(input);await c.change(changed);const result=await integratePrompt(changed);assert.equal(result.valid,false,JSON.stringify(result));if(!result.valid){assert.equal(result.issues[0].code,'THERA1008');assert.equal(result.issues[0].path,c.path);}}
});
it('duplicate and registered contradictory rules are refused across prompt blocks',async()=>{
  for(const rules of [[{text:'Verify evidence.',derivedFrom:['control']},{text:'  VERIFY   EVIDENCE! ',derivedFrom:['control']}],[{text:'Do not retain citations.',derivedFrom:['control']}],[{text:'Discard citations.',derivedFrom:['control']}]]){
    const input=await integrationFixture(rules),result=await integratePrompt(input);assert.equal(result.valid,false);if(!result.valid)assert.ok(result.issues[0].path.startsWith('/rules/'));
  }
  assert.equal(conflictingPromptRules('Always verify evidence.','Never verify evidence.'),true);assert.equal(conflictingPromptRules('Check dates.','Verify citations.'),false);
});
