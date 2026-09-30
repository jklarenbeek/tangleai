import {it} from 'node:test';
import assert from 'node:assert/strict';
import {validateHeraShape,validateHeraRecord,heraContentIdOf,heraSchema} from '@tangleai/hera';
import {gmplSchema,validateGmplEvidence} from '@tangleai/gmpl';
import {fixture,scope} from './fixture.ts';
it('closed HERA contracts reject unknown fields, stale identities and invented utility',async()=>{
  const f=await fixture();
  for(const value of [{...f.experience,secret:'credential'},{...f.experience,utility:1},{...f.experience,successCount:2,useCount:1}]){
    const result=await validateHeraRecord('experience',value);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'THERA1001');
  }
  const moved={...f.experience,insight:'Changed'};const stale=await validateHeraRecord('experience',moved);assert.equal(stale.valid,false);if(!stale.valid)assert.equal(stale.issues[0].code,'THERA1002');
  assert.equal((await validateHeraRecord('experience',{...moved,id:await heraContentIdOf(moved)})).valid,true);
  assert.equal(validateHeraShape('heraTask',{}).valid,false);
  assert.equal(validateHeraShape('heraTask',{id:'task',scope,query:'q',corpusRevision:'a'.repeat(64),split:'training',evaluator:null,inject:()=>0}).valid,false);
});
it('topology schema refuses an unknown dependency before graph compilation',async()=>{
  const f=await fixture(),p=f.prompts[0];
  const t={id:'topology',scope,taskId:'task',snapshotId:f.snapshot.id,profile:f.experience.profile,nodes:[{id:'a',agentId:p.agentId,promptVersionId:p.id,dependsOn:['missing']}],offeredExperienceIds:[],appliedExperienceIds:[],generator:{kind:'fixed',configRevision:'a'.repeat(64)},validation:{valid:true,issues:[]},workflowVersionId:null};
  const bad=validateHeraShape('heraTopology',t);assert.equal(bad.valid,false);if(!bad.valid)assert.equal(bad.issues[0].code,'THERA1001');
  t.nodes[0].dependsOn=[];assert.equal(validateHeraShape('heraTopology',t).valid,true);
});
it('observation time and lifecycle status do not move immutable prompt content',async()=>{
  const {prompts}=await fixture();const p=prompts[0];
  assert.equal(await heraContentIdOf({...p,at:'another observation',status:'archived'}),p.id);
  assert.notEqual(await heraContentIdOf({...p,effectivePrompt:p.effectivePrompt+' altered'}),p.id);
});
it('role outputs use the GMPL citation and finding contract from its owner',()=>{
  assert.deepEqual(heraSchema.$defs.gmplClaim,gmplSchema.$defs.gmplClaim);
  assert.deepEqual(heraSchema.$defs.gmplFinding,gmplSchema.$defs.gmplFinding);
  const evidence=[{id:'p1',digest:'a'.repeat(64),text:'A supported fact.'}];
  const answer={answer:'A supported fact.',disposition:'completed',claims:[{text:'A supported fact.',citations:[{id:'p1',digest:'a'.repeat(64)}]}],findings:[]};
  assert.ok(validateHeraShape('heraConcludeAgentOutput',answer).valid);
  assert.ok(validateGmplEvidence(answer,evidence).valid);
  assert.equal(validateHeraShape('heraConcludeAgentOutput',{...answer,claims:[{text:'Unsupported',citations:[]}]}).valid,false);
});
