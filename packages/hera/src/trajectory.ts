/** Persist the durable MAS attempts, including failed and uncertain purchases. */
import type { TraceView, MasWorkflow } from '@tangleai/mas';
import { heraIssue } from './errors.ts';
import { heraRevisionOf } from './identity.ts';
import type { HeraTrajectory, HeraTrajectoryStep, HeraTopology, HeraTask, HeraLearningSnapshot } from './contracts.gen.ts';
import type { HeraAnswerEvidence } from './evidence.ts';
import type { HeraTaskScore } from './evaluator.ts';
const bounded = (value:unknown,maxChars:number):HeraTrajectoryStep['inputView'] => {
  const text=typeof value==='string'?value:JSON.stringify(value);
  return {state:text.length>maxChars?'truncated':'retained',text:text.slice(0,maxChars),originalBytes:new TextEncoder().encode(text).byteLength};
};
export async function assembleHeraTrajectory(input:{id:string;groupId:string;task:HeraTask;snapshot:HeraLearningSnapshot;topology:HeraTopology;
  trace:TraceView;workflow:MasWorkflow;identityId:string;answer:HeraAnswerEvidence;score:HeraTaskScore;maxChars:number}) {
  const {trace,topology,task}=input;
  const attempts=trace.attempts.filter(a=>a.kind==='agent').sort((a,b)=>a.seq-b.seq);
  const steps:HeraTrajectoryStep[]=[];
  for(const a of attempts){
    const node=topology.nodes.find(n=>n.id===a.invocationId);
    if(!node)throw new TypeError('A MAS attempt names an invocation outside the frozen topology.');
    const usage=a.usage as typeof a.usage & {unknownTokenRequests?:number;estimatedTokens?:number};
    const inbound=trace.messages.filter(m=>m.to.path===a.path).sort((l,r)=>l.index-r.index).map(m=>({source:m.from.path,port:m.to.port,value:m.payload}));
    const transcript=a.transcript;
    const toolAddresses=a.toolSteps.flatMap(s=>{
      if(s.name!=='hera-evidence'||s.result.state!=='retained'||s.result.text===null)return [];
      const result=JSON.parse(s.result.text) as {units?:Array<{address?:unknown}>}|null;
      return Array.isArray(result?.units)?result.units.flatMap(e=>typeof e.address==='string'?[e.address]:[]):[];
    });
    steps.push({id:await heraRevisionOf([input.id,a.id]),scope:task.scope,trajectoryId:input.id,invocationId:a.invocationId,agentId:node.agentId,
      promptVersionId:node.promptVersionId,masAttemptId:a.id,inputView:bounded({query:task.query,context:inbound},input.maxChars),
      transcriptView:transcript.text===null?{state:'omitted',text:'',originalBytes:transcript.size}: {...bounded(transcript.text,input.maxChars),
        ...(transcript.state==='truncated'?{state:'truncated' as const}:{}),originalBytes:Math.max(new TextEncoder().encode(transcript.text).byteLength,transcript.size)},
      toolSteps:a.toolSteps.map(s=>({name:s.name,input:s.arguments,output:s.result,status:a.status==='uncertain'?'uncertain':s.state==='ok'?'completed':'failed'})),
      evidenceAddresses:[...new Set([...a.contextReads.flatMap(r=>r.addresses),...toolAddresses])],
      usage:{calls:usage.calls,promptTokens:usage.promptTokens,completionTokens:usage.completionTokens,
        unknownTokenRequests:usage.unknownTokenRequests??usage.calls,estimatedTokens:usage.estimatedTokens??0,ms:a.spend.ms,unknownMsRequests:usage.calls},
      spend:{calls:a.spend.turns,tokens:a.spend.tokens,ms:a.spend.ms},stopReason:a.stopReason,at:a.finishedAt??a.startedAt});
  }
  const failure=trace.run.failure;
  const orphan=attempts.some(a=>a.status==='uncertain'||a.status==='running') || !['completed','failed'].includes(trace.run.status);
  const status=orphan?'orphan':trace.run.status==='completed'?'completed':'failed';
  const issue=failure?heraIssue(failure.error.code==='TMAS2009'||failure.error.code==='TMAS2006'?'THERA1007':'THERA1009',
    '/execution/'+(failure.node??''),failure.error.detail,failure.error):orphan?heraIssue('THERA1007','/execution','The durable attempt has no terminal outcome.'):null;
  const sum=(read:(s:HeraTrajectoryStep)=>number)=>steps.reduce((n,s)=>n+read(s),0);
  const trajectory:HeraTrajectory={id:input.id,scope:task.scope,taskId:task.id,snapshotId:input.snapshot.id,topologyId:topology.id,
    masRunId:trace.run.id,groupId:input.groupId,invocationOrder:attempts.map(a=>a.invocationId),answer:input.answer.answer,
    claimEnvelopeId:status==='completed'?input.answer.envelopeId:null,citations:input.answer.citations,primaryScore:input.score.primaryScore,success:input.score.success,
    tokens:{prompt:sum(s=>s.usage.promptTokens),completion:sum(s=>s.usage.completionTokens),unknownRequests:sum(s=>s.usage.unknownTokenRequests),estimated:sum(s=>s.usage.estimatedTokens)},
    calls:sum(s=>s.usage.calls),stopReason:failure?.error.code??status,failure:issue?{node:failure?.node??null,issue}:null,
    stepIds:steps.map(s=>s.id),status,identityId:input.identityId,metrics:{citationRecall:status==='completed'?input.answer.citationRecall:0,unsupported:input.answer.unsupported,evaluator:input.score.metrics??{}}};
  return {trajectory,steps};
}
