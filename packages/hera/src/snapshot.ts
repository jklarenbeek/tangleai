/** Snapshot preparation is pure; activation belongs inside the library's transaction. */
import {equalsJson} from '@jarenjs/core/object';
import {heraContentIdOf,heraLibraryRevisionOf} from './identity.ts';
import {validateHeraRecord} from './schema.ts';
import {planSnapshotActivation} from './heads.ts';
import {HeraRefusal,heraRefuse,type HeraOutcome} from './errors.ts';
import type {HeraLearningSnapshot,HeraHead} from './contracts.gen.ts';
import type {HeraTransaction} from './store.ts';
export interface HeraSnapshotChanges {experienceIds?:readonly string[];activePromptVersionIds?:Record<string,string>;registryRevision?:string;}
export async function prepareHeraSnapshot(parent:HeraLearningSnapshot,changes:HeraSnapshotChanges):Promise<HeraOutcome<{snapshot:HeraLearningSnapshot;noOp:boolean}>>{
  const checked=await validateHeraRecord('snapshot',parent);if(!checked.valid)return checked;
  const experienceIds=[...(changes.experienceIds??parent.experienceIds)].sort();
  if(new Set(experienceIds).size!==experienceIds.length)return heraRefuse('THERA1002','/experienceIds','Snapshot membership cannot repeat a version.');
  const libraryRevision=await heraLibraryRevisionOf(experienceIds),activePromptVersionIds=structuredClone(changes.activePromptVersionIds??parent.activePromptVersionIds),registryRevision=changes.registryRevision??parent.registryRevision;
  const noOp=libraryRevision===parent.libraryRevision&&registryRevision===parent.registryRevision&&equalsJson(activePromptVersionIds,parent.activePromptVersionIds);
  if(noOp)return {valid:true,value:{snapshot:structuredClone(parent),noOp:true}};
  const content={...parent,parentId:parent.id,experienceIds,libraryRevision,activePromptVersionIds,registryRevision,status:'staged' as const};
  const snapshot={...content,id:await heraContentIdOf(content)},shape=await validateHeraRecord('snapshot',snapshot);if(!shape.valid)return shape;
  return {valid:true,value:{snapshot,noOp:false}};
}
export async function stageSnapshot(tx:HeraTransaction,parent:HeraLearningSnapshot,changes:HeraSnapshotChanges){
  const planned=await prepareHeraSnapshot(parent,changes);if(!planned.valid)throw new HeraRefusal(planned.issues);
  if(!planned.value.noOp)await tx.put('snapshot',planned.value.snapshot);return planned.value;
}
export async function activateSnapshot(tx:HeraTransaction,expected:HeraHead,candidate:HeraLearningSnapshot){
  const current=await tx.get('head',expected.id)??{...expected,versionId:null,revision:0},previous=current.versionId?await tx.get('snapshot',current.versionId):undefined;
  const planned=planSnapshotActivation(current,expected,candidate,previous);if(!planned.valid)throw new HeraRefusal(planned.issues);
  return tx.transitionHead(planned.value);
}
