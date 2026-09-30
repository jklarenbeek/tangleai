/** Task performance precedes cost; unlabelled trajectories cannot masquerade as failures. */
import type { HeraTrajectory, HeraRolloutGroup } from './contracts.gen.ts';
export function rankTrajectories(trajectories:readonly HeraTrajectory[]) {
  const ranked=[...trajectories].sort((a,b)=>{
    if(a.primaryScore===null&&b.primaryScore!==null)return 1;
    if(b.primaryScore===null&&a.primaryScore!==null)return -1;
    return (b.primaryScore??0)-(a.primaryScore??0)
      ||(a.tokens.prompt+a.tokens.completion)-(b.tokens.prompt+b.tokens.completion)
      ||(a.id<b.id?-1:a.id>b.id?1:0);
  });
  return {ranked,unevaluatedIds:ranked.filter(t=>t.primaryScore===null).map(t=>t.id)};
}
export function mixedOutcome(trajectories:readonly HeraTrajectory[]):HeraRolloutGroup['mixedOutcome'] {
  const evaluated=trajectories.filter(t=>t.primaryScore!==null),success=evaluated.some(t=>t.success===true),failure=evaluated.some(t=>t.success===false);
  return {value:success&&failure,reason:success&&failure?'evaluated success and failure':evaluated.length===0?'no evaluated trajectories':success?'all evaluated trajectories succeeded':'all evaluated trajectories failed'};
}
