/** Frozen orchestration measures actual control and candidate purchases on the original corpus. */
import {resolveProfile} from '@tangleai/config';
import {openTangleDb,createHeraStore,createMasStore} from '@tangleai/store';
import {createHeraGroupRunner,heraRevisionOf,summarizeTopology,type HeraGroupExecution,type HeraTask} from '@tangleai/hera';
import {createHeraExampleState,createHeraExampleSegments,heraValue} from '../../examples/hera.ts';
import {loadHeraScripts,createHeraFixtureEvidence} from './hera-runner.ts';
import {officialScore,normalizeAnswer} from './locomo-parity.ts';
import type {HeraFixture} from './hera-qa.ts';
import type {Row} from './hera-qa.types.ts';
import {heraQuality} from './hera-quality.ts';
import {HERA_GROUP_BUDGET,heraBudgetPolicyId,heraPromptSizes,measureHeraCase,heraCosts} from './hera-measurement.ts';
export async function runHeraFrozen(fixture:HeraFixture,root:string){
  const registration=await loadHeraScripts(root),db=await openTangleDb({jobs:{now:()=>1000000,random:()=>0.5}});
  let tick=0,requests=0,replayCalls=0;const now=()=>`tick-${String(tick++).padStart(6,'0')}`;
  const budget=HERA_GROUP_BUDGET;
  try{
    const {embedder,embeddedBy,evidence}=await createHeraFixtureEvidence(db,fixture.corpus,fixture.manifest.revision);
    const store=createHeraStore(db,{scope:'hera-frozen'}),masStore=createMasStore(db,{now}),state=await createHeraExampleState(store,{corpusRevision:fixture.manifest.revision,embeddedBy});
    const resolved=await resolveProfile({...state.profiles,request:{kind:'profile',profile:'scripted',overrides:null}});if(!resolved.ok)throw Error(JSON.stringify(resolved.issues));
    const truth=new Map(fixture.questions.map(q=>[q.id,q.gold.answer]));
    const evaluator={identity:state.snapshot.identities.evaluator,async score(task:HeraTask,answer:string){const success=normalizeAnswer(answer)===normalizeAnswer(truth.get(task.id)!);return {primaryScore:Number(success),success};}};
    const initialWrites=store.counters().learningWrites,executions:Array<{question:HeraFixture['questions'][number];result:HeraGroupExecution}>=[];
    const guard=(request:unknown)=>{if(/"(?:gold|goldAddress|split)"\s*:/.test(JSON.stringify(request)))throw Error('Scoring metadata leaked into orchestration input.');};
    for(const question of fixture.questions){
      const bank=registration.scripts[question.id].fixed,plans=registration.orchestrator.proposals[question.id];
      const task:HeraTask={id:question.id,scope:store.scope,query:question.query,corpusRevision:fixture.manifest.revision,split:question.split,evaluator:evaluator.identity,goldAddress:'fixture:'+question.id};
      const runner=createHeraGroupRunner({store,masStore,profiles:state.profiles,segments:createHeraExampleSegments(db,masStore),evidence,embedder,evaluator,now,clock:()=>1000000,concurrency:4,
        controlClientFor:(_profile,_identity,stage)=>({endpoint:{provider:'ollama'},complete:async request=>{
          requests++;guard(request);const value=stage==='profile'?registration.orchestrator.profile:registration.orchestrator.plans[plans[Number(stage.split('/')[1])]];
          if(!value)throw Error('Unregistered control script '+stage);return {message:{content:JSON.stringify(value)},usage:{prompt_tokens:7,completion_tokens:3}};
        }}),
        clientFor:(_profile,_identity,node)=>({endpoint:{provider:'ollama'},complete:async raw=>{
          requests++;guard(raw);const request=raw as {responseFormat?:unknown;messages:Array<{role:string;content:unknown}>};
          const source:Record<string,string>={'query-decomposer':'decompose',retriever:'retrieve-1','evidence-selector':'select','conclude-agent':'conclude'},script=bank[source[node.role]];
          if(!script)throw Error('Unregistered frozen role script '+node.role);
          if(script.tool&&!request.responseFormat&&!request.messages.some(m=>m.role==='tool'))return {message:{role:'assistant',content:'',toolCalls:[{id:'tool-'+node.id,name:'hera-evidence',arguments:JSON.stringify(script.tool)}]},finishReason:'tool_calls',usage:{prompt_tokens:7,completion_tokens:3}};
          return {message:{role:'assistant',content:JSON.stringify(request.responseFormat?script.normalization:script.completion)},finishReason:'stop',usage:{prompt_tokens:7,completion_tokens:3}};
        }})});
      const request={task,snapshot:state.snapshot,mode:'evaluate' as const,groupIndex:0,budget,groupConcurrency:2},result=heraValue(await runner.run(request)),before=requests,replay=heraValue(await runner.run(request));
      if(await heraRevisionOf(replay)!==await heraRevisionOf(result))throw Error('Frozen group replay drift');replayCalls+=requests-before;executions.push({question,result});
    }
    const sum=(read:(entry:typeof executions[number])=>number)=>executions.reduce((n,e)=>n+read(e),0),all=executions.flatMap(e=>e.result.trajectories);
    const scored=executions.map(({question,result})=>{const best=result.trajectories.find(t=>t.id===result.group.ranking[0]),score=officialScore({category:question.category,prediction:best?.answer??'',answer:truth.get(question.id)!});return {category:question.category,f1:score.scored&&best?.status==='completed'?score.f1:0,success:Number(best?.success===true),citationRecall:best?.metrics.citationRecall??0,answered:best?.status==='completed',split:question.split};});
    const measurements=await Promise.all(executions.map((entry,index)=>measureHeraCase({question:entry.question,score:scored[index],store,trajectories:entry.result.trajectories,snapshotId:entry.result.group.snapshotId,
      spent:entry.result.group.budget.spent,allowance:{calls:budget.calls,tokens:budget.tokens,ms:budget.ms},controls:[entry.result.group.controlUsage!]})));
    const row:Row={id:'query-specific-frozen',kind:'ablation',status:'run',reason:null,tier:'scripted',seeds:[17753],
      measurements,promptSizes:await heraPromptSizes(store,state.snapshot),
      identity:{snapshotId:state.snapshot.id,model:state.snapshot.identities.model,decoder:state.snapshot.identities.decoder,corpusRevision:fixture.manifest.revision,evaluatorId:evaluator.identity.id,toolIds:state.snapshot.identities.tools,budget,budgetPolicyId:await heraBudgetPolicyId()},
      heldOutQuality:heraQuality(scored.filter(c=>c.split==='held-out')),quality:heraQuality(scored),
      cost:heraCosts(measurements),
      failures:{skipped:0,failed:all.filter(t=>t.status==='failed').length,refusedCandidates:sum(e=>e.result.group.refusals!.invalidCandidates),budgetStops:all.filter(t=>t.stopReason==='TMAS2009').length,orphans:all.filter(t=>t.status==='orphan').length,headConflicts:0,refusedLearningWrites:store.counters().refusedLearningWrites},learning:null,
      topology:summarizeTopology(all,executions.flatMap(e=>e.result.topologies),{includeFailed:true})};
    const learningWrites=store.counters().learningWrites-initialWrites;
    if(learningWrites||replayCalls||requests!==row.cost!.calls)throw Error('Frozen group purchase or authority census drift');
    return {row,identity:resolved.identity,requests,replayCalls,learningWrites,refusals:{invalidCandidates:sum(e=>e.result.group.refusals!.invalidCandidates),duplicateCandidates:sum(e=>e.result.group.refusals!.duplicateCandidates),appliedNotOffered:sum(e=>e.result.group.refusals!.appliedNotOffered)}};
  }finally{await db.close();}
}
