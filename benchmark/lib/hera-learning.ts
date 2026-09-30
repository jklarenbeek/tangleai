/** A frozen authored sequence measures bounded learning transitions and declared transfer failures. */
import {resolveProfile} from '@tangleai/config';
import {openTangleDb,createHeraStore,createMasStore} from '@tangleai/store';
import {createHeraLearner,createHeraGroupRunner,heraRevisionOf,type HeraLearningResult,type HeraGroupExecution,type HeraLearningHost,type HeraTask,type HeraExperienceView} from '@tangleai/hera';
import {createHeraExampleState,createHeraExampleSegments,heraValue,HERA_EXAMPLE_CONFIG} from '../../examples/hera.ts';
import {loadHeraScripts,createHeraFixtureEvidence} from './hera-runner.ts';
import {heraPromptField,heraScriptedReflection,heraScriptedConsolidation,heraScriptedRope} from './hera-learning-scripts.ts';
import {heraQuality} from './hera-quality.ts';
import {officialScore,normalizeAnswer} from './locomo-parity.ts';
import type {HeraFixture} from './hera-qa.ts';
import type {Row} from './hera-qa.types.ts';
export async function runHeraExperience(fixture:HeraFixture,root:string,flags={experience:true,rope:false,mutation:false}){
  const registration=await loadHeraScripts(root),{sequence,consolidation}=registration,db=await openTangleDb({jobs:{now:()=>1000000,random:()=>0.5}});
  let tick=0,requests=0,replayCalls=0;const now=()=>`tick-${String(tick++).padStart(6,'0')}`;
  const budget={calls:24,tokens:65536,ms:120000,turns:6,nodes:15,depth:15,fanOut:12,concurrency:4},config={...HERA_EXAMPLE_CONFIG,flags},rowId=flags.rope?(flags.experience?'hera-no-mutation':'hera-no-experience'):'hera-no-rope';
  const trainingIds=sequence.training.map(t=>t.taskId),heldOutIds=sequence.heldOut;
  for(const [split,ids] of [['training',trainingIds],['held-out',heldOutIds]] as const)if(JSON.stringify([...ids].sort())!==JSON.stringify(fixture.questions.filter(q=>q.split===split).map(q=>q.id).sort()))throw Error('The learning sequence differs from the registered task split.');
  try{
    const {embedder,embeddedBy,evidence}=await createHeraFixtureEvidence(db,fixture.corpus,fixture.manifest.revision),store=createHeraStore(db,{scope:rowId}),masStore=createMasStore(db,{now});
    const state=await createHeraExampleState(store,{corpusRevision:fixture.manifest.revision,embeddedBy,config});let snapshot=state.snapshot;
    const resolved=await resolveProfile({...state.profiles,request:{kind:'profile',profile:'scripted',overrides:null}});if(!resolved.ok)throw Error(JSON.stringify(resolved.issues));
    const truth=new Map(fixture.questions.map(q=>[q.id,q.gold.answer]));
    const evaluator={identity:state.snapshot.identities.evaluator,async score(task:HeraTask,answer:string){const success=normalizeAnswer(answer)===normalizeAnswer(truth.get(task.id)!);return {primaryScore:Number(success),success};}};
    const initialWrites=store.counters().learningWrites,executions:Array<{question:HeraFixture['questions'][number];result:HeraGroupExecution;learning:HeraLearningResult|null}>=[];
    const guard=(request:unknown)=>{if(/"(?:gold|goldAddress|split)"\s*:/.test(JSON.stringify(request)))throw Error('Scoring metadata leaked into a learning prompt.');};
    for(const [index,id] of [...trainingIds,...heldOutIds].entries()){
      const question=fixture.questions.find(q=>q.id===id)!,recipe=sequence.training.find(r=>r.taskId===id),bank=registration.scripts[id].fixed;
      const task:HeraTask={id,scope:store.scope,query:question.query,corpusRevision:fixture.manifest.revision,split:question.split,evaluator:evaluator.identity,goldAddress:'fixture:'+id};
      const host:HeraLearningHost={store,masStore,profiles:state.profiles,segments:createHeraExampleSegments(db,masStore),evidence,embedder,evaluator,now,clock:()=>1000000,concurrency:4,
        consolidationPolicy:{revision:registration.revision,async conflicts(advantage,library){
          if(id!==sequence.conflict.taskId)return [];
          const targets=sequence.conflict.targets.map(key=>library.find(e=>e.insight===consolidation.guidance[key]));if(targets.some(e=>!e))throw Error('The registered conflict lost its library target.');
          return [{targetIds:[targets[0]!.id,targets[1]!.id],sourceInsightIds:advantage.insights.map(i=>i.id),reason:sequence.conflict.reason}];
        }},
        controlClientFor:(_profile,_identity,stage)=>({endpoint:{provider:'ollama'},complete:async request=>{
          requests++;guard(request);let value:unknown;
          if(stage==='profile')value=registration.orchestrator.profile;
          else if(stage.startsWith('plan/')){
            const shape=Number(stage.split('/')[1])===1?'parallel':'serial',plan=structuredClone(registration.orchestrator.plans[shape]);
            const offered=heraPromptField<HeraExperienceView[]>(request,'Offered experiences: '),target=offered.find(e=>e.insight===consolidation.guidance[sequence.application[shape]]);
            plan.appliedExperienceIds=target?[target.id]:[];value=plan;
          }else if(stage==='learn/reflection')value=heraScriptedReflection(request,registration.reflection);
          else if(stage==='learn/consolidation'&&recipe?.consolidation)value=heraScriptedConsolidation(request,consolidation,recipe.consolidation);
          else if(stage.startsWith('learn/rope/'))value=heraScriptedRope(request,registration.rope,id,stage.endsWith('proposal')?'proposal':'contrast');
          else throw Error('Unregistered learning stage '+stage);
          return {message:{content:JSON.stringify(value)},usage:{prompt_tokens:7,completion_tokens:3}};
        }}),
        clientFor:(_profile,_identity,node)=>({endpoint:{provider:'ollama'},complete:async raw=>{
          requests++;guard(raw);const request=raw as {responseFormat?:unknown;messages:Array<{role:string;content:unknown}>};
          const source:Record<string,string>={'query-decomposer':'decompose',retriever:'retrieve-1','evidence-selector':'select','conclude-agent':'conclude'},script=bank[source[node.role]];
          if(!script)throw Error('Unregistered learning role '+node.role);
          if(script.tool&&!request.responseFormat&&!request.messages.some(m=>m.role==='tool'))return {message:{role:'assistant',content:'',toolCalls:[{id:'tool-'+node.id,name:'hera-evidence',arguments:JSON.stringify(script.tool)}]},finishReason:'tool_calls',usage:{prompt_tokens:7,completion_tokens:3}};
          const value=structuredClone(request.responseFormat?script.normalization:script.completion) as Record<string,unknown>;
          if(node.role==='conclude-agent'){
            const evolved=JSON.stringify(request).includes(registration.rope.lossMarker);
            if(recipe?.[node.id.startsWith('p-')?'parallel':'serial']==='incorrect'&&!(evolved&&registration.rope.replayImproves.includes(id)))value.answer=sequence.incorrectAnswer;
            if(evolved&&registration.rope.heldOutLosses.includes(id))value.answer=sequence.incorrectAnswer;
          }
          return {message:{role:'assistant',content:JSON.stringify(value)},finishReason:'stop',usage:{prompt_tokens:7,completion_tokens:3}};
        }})};
      const request={task,snapshot,mode:recipe?'learn' as const:'evaluate' as const,groupIndex:index,budget,groupConcurrency:2};
      const learner=createHeraLearner(host),runner=createHeraGroupRunner(host),beforeWrites=store.counters().learningWrites;
      let learning:HeraLearningResult|null=null,result:HeraGroupExecution;
      if(recipe){
        learning=heraValue(await learner.run({...request,learningBudget:budget}));const before=requests,replay=heraValue(await learner.run({...request,learningBudget:budget}));replayCalls+=requests-before;
        if(await heraRevisionOf(learning)!==await heraRevisionOf(replay))throw Error('Learning replay changed its retained result.');
        result=heraValue(await runner.run(request));snapshot=learning.snapshot;
      }else{
        const denied=await learner.run({...request,mode:'learn'});if(denied.valid||denied.issues[0].code!=='THERA1004')throw Error('Held-out learning was not refused.');
        result=heraValue(await runner.run(request));const before=requests;heraValue(await runner.run(request));replayCalls+=requests-before;
        if(store.counters().learningWrites!==beforeWrites)throw Error('Held-out evaluation wrote learning state.');
      }
      executions.push({question,result,learning});
    }
    const all=executions.flatMap(e=>e.result.trajectories),controls=executions.flatMap(e=>[e.result.group.controlUsage!,...(e.learning?[e.learning.usage]:[])]),trained=executions.flatMap(e=>e.learning?[e.learning]:[]);
    const scored=executions.map(({question,result})=>{const best=result.trajectories.find(t=>t.id===result.group.ranking[0]),score=officialScore({category:question.category,prediction:best?.answer??'',answer:truth.get(question.id)!});return {category:question.category,split:question.split,f1:score.scored?score.f1:0,success:Number(best?.success===true),citationRecall:best?.metrics.citationRecall??0,answered:best?.status==='completed'};});
    const sum=(read:(entry:typeof executions[number])=>number)=>executions.reduce((n,e)=>n+read(e),0),spent=(e:typeof executions[number])=>e.learning?.spent??e.result.group.budget.spent;
    const refused=(await store.query('operation',{limit:10000})).filter(o=>o.stage.startsWith('learning.refused/')),learningWrites=store.counters().learningWrites-initialWrites;
    const churn=trained.reduce((n,r)=>({add:n.add+r.libraryChurn.add,merge:n.merge+r.libraryChurn.merge,prune:n.prune+r.libraryChurn.prune,keep:n.keep+r.libraryChurn.keep}),{add:0,merge:0,prune:0,keep:0});
    const mixed=trained.filter(r=>r.mixedGroup).length;
    const promptChurn=new Map<string,{agentId:string;activated:number;rejected:number}>(),trials={activated:0,rejected:0,malformed:0,unevaluated:0},replayCost={calls:0,tokens:0,ms:0};
    for(const result of trained){for(const [agentId,counts] of Object.entries(result.promptChurn)){const total=promptChurn.get(agentId)??{agentId,activated:0,rejected:0};total.activated+=counts.activated;total.rejected+=counts.rejected;promptChurn.set(agentId,total);}
      for(const key of ['activated','rejected','malformed','unevaluated'] as const)trials[key]+=result.trials[key];for(const key of ['calls','tokens','ms'] as const)replayCost[key]+=result.replayCost[key];}
    const row:Row={id:rowId,kind:'ablation',status:'run',reason:null,tier:'scripted',seeds:[17753],
      identity:{snapshotId:snapshot.id,model:snapshot.identities.model,decoder:snapshot.identities.decoder,corpusRevision:fixture.manifest.revision,evaluatorId:evaluator.identity.id,toolIds:snapshot.identities.tools,budget,learningBudget:budget},
      quality:heraQuality(scored),heldOutQuality:heraQuality(scored.filter(s=>s.split==='held-out')),
      cost:{calls:sum(e=>spent(e).calls),promptTokens:all.reduce((n,t)=>n+t.tokens.prompt,0)+controls.reduce((n,c)=>n+c.promptTokens,0),completionTokens:all.reduce((n,t)=>n+t.tokens.completion,0)+controls.reduce((n,c)=>n+c.completionTokens,0),
        unknownTokenRequests:all.reduce((n,t)=>n+t.tokens.unknownRequests,0)+controls.reduce((n,c)=>n+c.unknownTokenRequests,0),estimatedTokens:all.reduce((n,t)=>n+t.tokens.estimated,0)+controls.reduce((n,c)=>n+c.estimatedTokens,0),
        ms:sum(e=>spent(e).ms),unknownMsRequests:all.reduce((n,t)=>n+t.calls,0)+controls.reduce((n,c)=>n+c.unknownMsRequests,0),money:null,
        trainingCalls:sum(e=>e.question.split==='training'?spent(e).calls:0),heldOutCalls:sum(e=>e.question.split==='held-out'?spent(e).calls:0)},
      failures:{skipped:0,failed:all.filter(t=>t.status==='failed').length,refusedCandidates:sum(e=>e.result.group.refusals!.invalidCandidates),budgetStops:all.filter(t=>t.stopReason==='TMAS2009').length,orphans:all.filter(t=>t.status==='orphan').length,
        headConflicts:refused.filter(o=>o.issues.some(i=>i.code==='THERA1006')).length,refusedLearningWrites:refused.filter(o=>o.issues.some(i=>i.code==='THERA1004')).length},
      learning:{mixedGroupRate:mixed/trained.length,mixedGroups:mixed,evaluatedGroups:trained.length,groupsWithoutMixedOutcome:trained.reduce((n,r)=>n+r.groupsWithoutMixedOutcome,0),librarySize:snapshot.experienceIds.length,libraryCap:config.libraryCap,
        libraryChurn:churn.add+churn.merge+churn.prune,libraryOperations:churn,promptChurn:[...promptChurn.values()].sort((a,b)=>a.agentId.localeCompare(b.agentId)),replayCost,trials,mutationAcceptance:0,negativeTransferByProfile:[],writes:learningWrites,flags:config.flags},topology:null};
    if(replayCalls||requests!==row.cost!.calls||snapshot.experienceIds.length>config.libraryCap)throw Error('Learning purchase, replay or library capacity census drift.');
    return {row,identity:resolved.identity,requests,replayCalls,learningWrites};
  }finally{await db.close();}
}
