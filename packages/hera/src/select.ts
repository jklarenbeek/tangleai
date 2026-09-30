/** Versioned, deterministic selection; offered experience never earns utility. */
import { cosineSimilarity } from '@jarenjs/core/vector';
import { sameIdentity } from '@tangleai/context';
import { heraRefuse, type HeraOutcome } from './errors.ts';
import { validateHeraShape } from './schema.ts';
import type { HeraExperience, HeraProfile, HeraLearningConfig } from './contracts.gen.ts';
export interface HeraSelectionOptions {
  scope:string; selectorVersion:string; selectorWeights:HeraLearningConfig['selectorWeights']; selectorCap:number;
}
export interface HeraSelectionScore { id:string;score:number;similarity:number;utility:number;novelty:number;selectionPenalty:number; }
export interface HeraSelection { experiences:HeraExperience[];scores:HeraSelectionScore[];candidates:number;selectorVersion:string; }
/** Insight vectors are retained with their experience under the profile's embedding identity. */
export function selectExperiences(library:readonly HeraExperience[],profile:HeraProfile,options:HeraSelectionOptions):HeraOutcome<HeraSelection> {
  if(options.selectorVersion!=='mmr-v1')return heraRefuse('THERA1002','/selectorVersion','The selector version is not supported.');
  if(!options.scope||!Number.isSafeInteger(options.selectorCap)||options.selectorCap<0||(['similarity','utility','novelty','selectionPenalty'] as const).some(k=>!Number.isFinite(options.selectorWeights[k])||options.selectorWeights[k]<0))
    return heraRefuse('THERA1001','/selector','Selection requires explicit scope, nonnegative weights and an integer cap.');
  const vector=(v:readonly number[])=>Array.isArray(v)&&v.length===profile.embeddedBy.dims&&v.every(Number.isFinite);
  if(!vector(profile.embedding))return heraRefuse('THERA1009','/profile/embedding','The query vector does not match its declared identity.');
  const candidates=library.filter(e=>e.status==='active');
  for(const [index,entry] of candidates.entries()){
    if(entry.scope!==options.scope)return heraRefuse('THERA1004','/library/'+index+'/scope','An offered experience crosses the requested scope.');
    if(!sameIdentity(entry.profile.embeddedBy,profile.embeddedBy)||!vector(entry.profile.embedding)||!vector(entry.insightEmbedding))
      return heraRefuse('THERA1009','/library/'+index+'/profile/embeddedBy','Experience profile and insight vectors must match the query identity.');
    const shape=validateHeraShape<HeraExperience>('heraExperience',entry);if(!shape.valid)return shape;
  }
  if(new Set(candidates.map(e=>e.id)).size!==candidates.length)return heraRefuse('THERA1002','/library','Duplicate experience identities are ambiguous.');
  const maximum=candidates.reduce((n,e)=>Math.max(n,e.selectionCount),0),selected:HeraExperience[]=[],scores:HeraSelectionScore[]=[];
  const remaining=[...candidates];
  while(remaining.length&&selected.length<options.selectorCap){
    const ranked=remaining.map(entry=>{
      const similarity=cosineSimilarity(profile.embedding,entry.profile.embedding);
      const novelty=selected.length?Math.max(...selected.map(other=>cosineSimilarity(entry.insightEmbedding,other.insightEmbedding))):0;
      const selectionPenalty=entry.selectionCount/(1+maximum),w=options.selectorWeights;
      return {entry,measurement:{id:entry.id,similarity,novelty,utility:entry.utility,selectionPenalty,
        score:w.similarity*similarity+w.utility*entry.utility-w.novelty*novelty-w.selectionPenalty*selectionPenalty}};
    }).sort((a,b)=>b.measurement.score-a.measurement.score||(a.entry.id<b.entry.id?-1:a.entry.id>b.entry.id?1:0));
    selected.push(ranked[0].entry);scores.push(ranked[0].measurement);remaining.splice(remaining.indexOf(ranked[0].entry),1);
  }
  return {valid:true,value:{experiences:structuredClone(selected),scores,candidates:candidates.length,selectorVersion:options.selectorVersion}};
}
