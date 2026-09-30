/** A HERA policy consumer of the suite's guarded engine; JSON Patch remains its owner. */
import {createGuardedRefiner} from '@jarenjs/core/guarded';
import {equalsJson} from '@jarenjs/core/object';
import {applyJSONPatch,createJSONPatch} from '@jarenjs/json/patch';
import {parseJSONPointer} from '@jarenjs/json/pointer';
import {changedLeafPaths} from '@tangleai/outcomes';
import type {GmplPromptArtifact} from '@tangleai/gmpl';
import {compileEffectivePrompt,heraRoleTools} from './prompt.ts';
import {validateHeraRecord,validateHeraShape} from './schema.ts';
import {heraRefuse,type HeraOutcome} from './errors.ts';
import type {HeraAgentDefinition,HeraLearningConfig,HeraPromptVersion,HeraPromptTrial,HeraTrajectory,HeraPromptPatch} from './contracts.gen.ts';
type Blocks={operationalRules:string[];behavioralPrinciples:string[]};
const blockNames=['operationalRules','behavioralPrinciples'] as const;
const blocks=(prompt:HeraPromptVersion):Blocks=>({operationalRules:prompt.operationalRules.map(r=>r.text),behavioralPrinciples:prompt.behavioralPrinciples.map(r=>r.text)});
const normalized=(text:string)=>text.normalize('NFKC').trim().replace(/\s+/g,' ').replace(/[.!?]+$/,'').toLowerCase();
/** Deliberately limited registered policy; no unmeasured semantic classifier. */
export const HERA_PROMPT_NEGATION_PAIRS:ReadonlyArray<readonly [string,string]>=[['retain citations','discard citations'],['verify evidence','ignore evidence']];
export function conflictingPromptRules(a:string,b:string):boolean{
  const left=normalized(a),right=normalized(b);
  if(HERA_PROMPT_NEGATION_PAIRS.some(([x,y])=>(left===x&&right===y)||(left===y&&right===x)))return true;
  const polarity=(text:string)=>({negative:/^(?:never|do not|don't)\s+/.test(text),body:text.replace(/^(?:always|never|do not|don't)\s+/,'')});
  const x=polarity(left),y=polarity(right);return x.negative!==y.negative&&x.body===y.body;
}
export interface HeraPromptIntegration {promptVersion:HeraPromptVersion;patch:HeraPromptPatch;changed:string[];noOp:boolean;}
export async function integratePrompt(input:{agent:HeraAgentDefinition;active:HeraPromptVersion;candidate:HeraPromptVersion;trial:HeraPromptTrial;
  control:HeraTrajectory;replay:HeraTrajectory;artifact:GmplPromptArtifact;config:HeraLearningConfig;patch?:unknown}):Promise<HeraOutcome<HeraPromptIntegration>>{
  const {agent,active,candidate,trial,control,replay,artifact,config}=input;
  if(!Object.values(config.promptBounds).every(n=>Number.isSafeInteger(n)&&n>0))return heraRefuse('THERA1008','/bounds','Prompt bounds must be positive safe integers.');
  for(const prompt of [active,candidate]){const checked=await validateHeraRecord('promptVersion',prompt);if(!checked.valid)return checked;}
  for(const [name,value] of [['heraAgentDefinition',agent],['heraPromptTrial',trial],['heraTrajectory',control],['heraTrajectory',replay]] as const){
    const checked=validateHeraShape(name,value);if(!checked.valid)return heraRefuse('THERA1008',checked.issues[0].path,checked.issues[0].detail);
  }
  const compiled=await compileEffectivePrompt(artifact,candidate);if(!compiled.valid)return heraRefuse('THERA1008',compiled.issues[0].path,compiled.issues[0].detail);
  const previous=blocks(active),target=blocks(candidate),patch=input.patch??createJSONPatch(previous,target),bounds=config.promptBounds;
  const problem=(docPath:string,message:string)=>({code:'THERA1008',docPath,message});
  const bad=(docPath:string,message:string)=>({valid:false,errors:[problem(docPath,message)]});
  const guarded=createGuardedRefiner({
    read:async()=>previous,
    validateProposal(raw:unknown){
      const shape=validateHeraShape<HeraPromptPatch>('heraPromptPatch',raw);if(!shape.valid)return bad(shape.issues[0].path,shape.issues[0].detail);
      if(shape.value.length>bounds.maxOps)return bad('/patch','The prompt patch exceeds its operation cap.');
      for(const [index,operation] of shape.value.entries()){
        const path=parseJSONPointer(operation.path),block=path[0] as keyof Blocks;
        if('value' in operation){
          const proposed=Array.isArray(operation.value)?operation.value:[operation.value];
          if(proposed.some(text=>!trial[block].some(rule=>rule.text===text&&rule.derivedFrom.length>0
            &&rule.derivedFrom.every(id=>trial.bufferTrajectoryIds.includes(id)||id===trial.controlTrajectoryId||id===trial.replayTrajectoryId))))
            return bad('/patch/'+index+'/value','A proposed rule must belong to its declared block and retained trial evidence.');
        }
      }
      return true;
    },
    apply(document:Blocks,proposal:HeraPromptPatch){return applyJSONPatch(document,proposal);},
    applyFailure:()=>problem('/patch','The prompt patch does not apply to the captured blocks.'),
    validateCandidate(next:Blocks,before:Blocks){
      const shape=validateHeraShape<Blocks>('heraPromptBlocks',next);if(!shape.valid)return bad(shape.issues[0].path,shape.issues[0].detail);
      if(!equalsJson(next,target))return bad('/patch','The integrated blocks differ from the whole-run tested candidate.');
      if(candidate.agentId!==agent.id||active.agentId!==agent.id||trial.agentId!==agent.id||candidate.scope!==agent.scope||active.scope!==agent.scope||trial.scope!==agent.scope
        ||candidate.parentId!==active.id||candidate.status!=='candidate'||candidate.envelopeRevision!==active.envelopeRevision)return bad('/agent','Prompt integration cannot change role, scope, parent or envelope.');
      if(!equalsJson([...agent.tools].sort(),heraRoleTools(agent.id)))return bad('/tools','Prompt integration cannot grant or remove role tools.');
      if(compiled.value!==candidate.effectivePrompt||!compiled.value.startsWith(artifact.role.instructions))return bad('/effectivePrompt','The role instructions must remain an exact prefix.');
      if(trial.candidatePromptVersionId!==candidate.id||trial.controlTrajectoryId!==control.id||trial.replayTrajectoryId!==replay.id
        ||control.taskId!==replay.taskId||control.topologyId!==replay.topologyId||control.snapshotId!==replay.snapshotId||control.identityId!==replay.identityId)
        return bad('/trial','The trial must compare the same whole topology and frozen task identities.');
      if(trial.pins&&(trial.pins.taskId!==control.taskId||trial.pins.topologyId!==control.topologyId||trial.pins.snapshotId!==control.snapshotId||trial.pins.identityId!==control.identityId||trial.pins.activePromptVersionIds[agent.id]!==active.id))return bad('/trial/pins','The measured trial differs from its frozen role or execution pins.');
      if(control.primaryScore===null||replay.primaryScore===null||replay.status!=='completed')return bad('/trial/replay','An unsuccessful or unevaluated replay cannot activate a prompt.');
      const delta={score:replay.primaryScore-control.primaryScore,tokens:replay.tokens.prompt+replay.tokens.completion-control.tokens.prompt-control.tokens.completion};
      if(!equalsJson(delta,trial.delta))return bad('/trial/delta','Trial deltas must match their retained trajectories.');
      if(!(delta.score>0||(delta.score===0&&delta.tokens<0&&control.tokens.unknownRequests===0&&replay.tokens.unknownRequests===0)))
        return bad('/trial/delta','Activation requires higher task score, or a tie with fewer known provider tokens.');
      if(blockNames.some(block=>candidate[block].some(rule=>!rule.derivedFrom.length||rule.derivedFrom.some(id=>!trial.bufferTrajectoryIds.includes(id)))))return bad('/derivedFrom','The tested candidate must retain its original failure provenance.');
      const rules=blockNames.flatMap(name=>next[name]);
      if(rules.length>bounds.maxRules||new TextEncoder().encode(candidate.effectivePrompt).byteLength>bounds.maxBytes)return bad('/bounds','The prompt exceeds its registered rule or byte cap.');
      const seen=new Set<string>();for(const [index,rule] of rules.entries()){
        if(seen.has(normalized(rule)))return bad('/rules/'+index,'A prompt cannot contain duplicate normalized rules.');seen.add(normalized(rule));
        if(rules.slice(0,index).some(other=>conflictingPromptRules(rule,other)))return bad('/rules/'+index,'The registered negation policy refuses conflicting rules.');
      }
      if(changedLeafPaths(before,next).length>bounds.maxOps)return bad('/patch','The changed-leaf churn exceeds the registered cap.');
      return true;
    },
    planCommit(next:Blocks,before:Blocks){return {promptVersion:candidate,patch,changed:changedLeafPaths(before,next),noOp:equalsJson(before,next)};},
    commit:async()=>{throw new TypeError('Prompt preparation activates only through a fenced domain transaction.');},
  });
  const result=guarded.prepare(previous,patch);
  if(!result.valid||!result.plan){const issue=result.errors?.[0] as {docPath?:string;message?:string}|undefined;return heraRefuse('THERA1008',issue?.docPath??'/patch',issue?.message??'Prompt integration refused.');}
  return {valid:true,value:result.plan as HeraPromptIntegration};
}
