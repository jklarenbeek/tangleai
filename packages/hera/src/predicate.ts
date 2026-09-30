/** A bounded versioned streak records evaluated group evidence, never model confidence. */
import {heraRevisionOf} from './identity.ts';
import {heraRefuse,type HeraOutcome} from './errors.ts';
import {validateHeraShape} from './schema.ts';
import type {HeraProfile,HeraFailureState} from './contracts.gen.ts';
export const HERA_FAILURE_PREDICATE='score-zero-consecutive-v1';
export const HERA_PROFILE_BUCKET='profile-tags-v1';
export function heraProfileBucket(profile:Pick<HeraProfile,'tags'>):Promise<string>{
  return heraRevisionOf({policy:HERA_PROFILE_BUCKET,tags:[...new Set(profile.tags.map(tag=>tag.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()))].sort()});
}
export function persistentFailure(previous:HeraFailureState|undefined,observation:{profileBucket:string;groupId:string;primaryScore:number|null},config:{consecutiveFailures:number}):HeraOutcome<{state:HeraFailureState;trigger:boolean;persistent:boolean;changed:boolean}>{
  const threshold=config.consecutiveFailures,{primaryScore,groupId,profileBucket}=observation;
  if(!Number.isSafeInteger(threshold)||threshold<1||!groupId||!profileBucket||(primaryScore!==null&&(!Number.isFinite(primaryScore)||primaryScore<0||primaryScore>1)))return heraRefuse('THERA1008','/predicate','The failure predicate requires a positive threshold and exact evaluated group identity.');
  if(previous){const valid=validateHeraShape<HeraFailureState>('heraFailureState',previous);if(!valid.valid)return valid;}
  if(previous&&(previous.predicateId!==HERA_FAILURE_PREDICATE||previous.bucketPolicy!==HERA_PROFILE_BUCKET||previous.threshold!==threshold))return heraRefuse('THERA1008','/predicate','The retained history uses another registered predicate, bucket policy or threshold.');
  const state:HeraFailureState=structuredClone(previous??{predicateId:HERA_FAILURE_PREDICATE,bucketPolicy:HERA_PROFILE_BUCKET,threshold,buckets:{}}),old=state.buckets[profileBucket];
  if(old&&(!Number.isSafeInteger(old.zeroStreak)||old.zeroStreak<0||old.zeroStreak>threshold||!Number.isFinite(old.lastScore)||old.lastScore<0||old.lastScore>1))return heraRefuse('THERA1008','/predicate/history','The retained streak is malformed.');
  if(old?.lastGroupId===groupId){
    if(primaryScore!==old.lastScore)return heraRefuse('THERA1002','/predicate/group','The same group cannot acquire another score.');
    return {valid:true,value:{state,trigger:false,persistent:old.zeroStreak>=threshold,changed:false}};
  }
  if(primaryScore===null)return {valid:true,value:{state,trigger:false,persistent:(old?.zeroStreak??0)>=threshold,changed:false}};
  const zeroStreak=primaryScore===0?Math.min(threshold,(old?.zeroStreak??0)+1):0,persistent=zeroStreak>=threshold,trigger=persistent&&!old?.triggered;
  state.buckets[profileBucket]={zeroStreak,triggered:primaryScore===0?(old?.triggered??false)||trigger:false,lastGroupId:groupId,lastScore:primaryScore};
  return {valid:true,value:{state,trigger,persistent,changed:true}};
}
