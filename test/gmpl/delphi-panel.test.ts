import {it} from 'node:test';
import assert from 'node:assert/strict';
import {gmplSchemaOf,type GmplDomainBinding,type GmplRoundState} from '@tangleai/gmpl';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
const numeric:Omit<GmplDomainBinding,'revision'>={id:'estimate-panel',title:'Estimate panel',payloadSchema:gmplSchemaOf('gmplInput'),projection:{id:'estimate-answer',version:'1',kind:'numeric',scale:{minimum:0,maximum:1}},rolePrompts:{},requiredCapabilities:[]};
const contextOf=(messages:Array<{role:string;content:string}>)=>JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);
for(const estimates of [[0.1,0.9],[0.5,0.5]])it(`Delphi uses sample deviation of estimates ${estimates}`,async()=>{
  const p=await prepareGmplPattern({pattern:'delphi-panel',participants:2,maxRounds:1},'pattern',{domain:numeric}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('panelist')?{result,answerKey:node,estimate:estimates[Number(node.at(-1))-1],confidence:0.9}:{result}});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));const aggregate=d.trace.attempts.find(a=>a.invocationId==='aggregate'&&a.status==='completed')!.output as {state:GmplRoundState};
  const stats=aggregate.state.peerFeedback!.statistics;assert.equal(stats.mean,0.5);assert.equal(stats.median,0.5);assert.equal(stats.sampleStddev,estimates[0]===0.1?0.5656854249492381:0);
  assert.equal((d.output as {result:{disposition:string}}).result.disposition,estimates[0]===0.1?'no-consensus':'completed');assert.equal(d.usage.roles,3);
});
it('Delphi peers see only anonymous prior feedback while host attribution and dissent survive',async()=>{
  const p=await prepareGmplPattern({pattern:'delphi-panel'}),result={...fixture.script.result,findings:fixture.script.result.findings.map(f=>({...f,id:'PRIVATE_FINDING',origin:'PRIVATE_ORIGIN',reason:'PRIVATE_PERSONA supports this claim'}))};
  const seen:number[]=[];
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:(node,i,phase,messages)=>{
    if(node.startsWith('panelist')){
      if(phase==='completion'){
        const c=contextOf(messages);seen.push(c.round);assert.equal(c.participant,node);assert.equal(c.round,i);
        if(i===1){assert.equal(c.peerFeedback,null);assert.equal(c.ownPrevious,null);}
        else {assert.equal(c.peerFeedback.round,i-1);assert.deepEqual(c.peerFeedback.responses.map((r:{alias:string})=>r.alias),['panel-1','panel-2','panel-3','panel-4','panel-5']);assert.ok(!JSON.stringify(c).includes('PRIVATE_'));}
      }
      return {result,answerKey:Number(node.at(-1))%2?'A':'B',estimate:null,confidence:0.9};
    }return {result};
  }});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(d.usage.roles,16);assert.equal(seen.length,15);assert.equal((d.output as {result:{disposition:string}}).result.disposition,'no-consensus');
  assert.ok(JSON.stringify(d.trace).includes('PRIVATE_ORIGIN'));assert.ok(JSON.stringify(d.trace).includes(fixture.input.evidence[0].id));
});
it('Delphi early agreement stops polls and supported contradictions block agreement',async()=>{
  const p=await prepareGmplPattern({pattern:'delphi-panel',participants:2});
  for(const contradictory of [false,true]){
    const result={...fixture.script.result,findings:fixture.script.result.findings.map(f=>({...f,contradictory}))};
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('panelist')?{result,answerKey:'same',estimate:null,confidence:0.9}:{result}});
    assert.equal(d.status,'completed');assert.equal(d.usage.roles,contradictory?7:3);assert.equal((d.output as {result:{disposition:string}}).result.disposition,contradictory?'no-consensus':'completed');
  }
});
it('Delphi refuses missing participants and out-of-scale numeric estimates',async()=>{
  const p=await prepareGmplPattern({pattern:'delphi-panel',participants:2},'pattern',{domain:numeric}),result=fixture.script.result;
  for(const missing of [false,true]){
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>{if(missing&&node==='panelist-2')throw Error('panel member unavailable');return {result,answerKey:'A',estimate:2,confidence:0.9};}});
    assert.equal(d.status,'failed');assert.ok(!d.visibility.some(v=>v.node==='synthesis'));assert.ok(d.usage.physical>=1);if(!missing)assert.match(d.trace.run.failure!.error.detail,/TGMPL1006/);
  }
});
it('Delphi checks the bound projector identity before any run',async()=>{
  await assert.rejects(prepareGmplPattern({pattern:'delphi-panel'},'pattern',{answerProjector:{id:'wrong',version:'1',project:()=>({valid:true,value:{key:'A',estimate:null}})}}),/TGMPL1007/);
});
for(const threshold of [0.2,0.19999999999999])it(`Delphi compares the unrounded sample deviation to threshold ${threshold}`,async()=>{
  const p=await prepareGmplPattern({pattern:'delphi-panel',participants:2,maxRounds:1,threshold},'pattern',{domain:numeric}),result=fixture.script.result,estimates=[0.3585786437626905,0.6414213562373094];
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('panelist')?{result,answerKey:node,estimate:estimates[Number(node.at(-1))-1],confidence:0.9}:{result}});
  assert.equal(d.status,'completed');const out=d.trace.attempts.find(a=>a.invocationId==='aggregate')!.output as {state:GmplRoundState};assert.ok(Math.abs(out.state.peerFeedback!.statistics.sampleStddev!-0.2)<1e-14);
  assert.equal(out.state.peerFeedback!.statistics.converged,threshold===0.2);
});
