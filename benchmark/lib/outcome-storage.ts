/** Persistence conformance uses the trusted adapter seam, never a production head setter. */
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryOutcomeStore,planHeadTransition,scopeIdOf,assertCapacity } from '@tangleai/outcomes';
import { openTangleDb,createOutcomeStore } from '@tangleai/store';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { keyId } from '../../packages/outcomes/src/identity.ts';
import { headFor } from '../../packages/outcomes/src/persistence.ts';
import { OutcomeRefusal } from '../../packages/outcomes/src/errors.ts';
import type { Probe } from './outcome-conformance.types.ts';
import { equalsJson } from '@jarenjs/core/object';
export async function measureOutcomeStorage():Promise<Probe[]> {
 const result:Probe[]=[];const scopeId=await scopeIdOf({namespace:'probe',domain:'scalar',subject:'head'}),target='a'.repeat(64),id=await keyId(scopeId,'head','probe');
 const dir=await mkdtemp(join(tmpdir(),'outcome-storage-'));
 try{for(const mode of ['reference','sqlite'] as const){
  const db=mode==='sqlite'?await openTangleDb({path:join(dir,'state.db')}):null;let fault:string|null=null;
  const options={applyProbe:(s:string)=>{if(s===fault)throw Error('injected');}};
  const store=db?createOutcomeStore(db,options):createMemoryOutcomeStore(options);const p=persistenceFor(store);
  try{
   const outcomes=await Promise.all(Array.from({length:20},()=>p.transaction(async tx=>{const head=planHeadTransition(await headFor(tx,scopeId,'probe'),{versionId:null,revision:0},target);await tx.put('heads',{id,scopeId,artifactKey:'probe',head,eventId:null});return 'applied';}).catch(e=>{if(e instanceof OutcomeRefusal)return e.issues[0].code;throw e;})));
   const actual=[outcomes.filter(v=>v==='applied').length,outcomes.filter(v=>v==='OUTC1013').length];result.push({id:`${mode}-head-cas`,expected:[1,19],actual,holds:equalsJson(actual,[1,19]),capability:'storage'});
   let rollback=0;for(const step of ['put:keys','put:heads','commit']){
    fault=step;try{await p.transaction(async tx=>{await tx.put('keys',{id:target,scopeId,value:target});await tx.put('heads',{id:target,scopeId,artifactKey:'other',head:{versionId:target,revision:1},eventId:null});});}catch{rollback++;}fault=null;
    const empty=await p.transaction(async tx=>(await tx.get('keys',target))===undefined&&(await tx.get('heads',target))===undefined);if(!empty)throw Error('partial outcome transaction');
   }
   result.push({id:`${mode}-rollback`,expected:3,actual:rollback,holds:rollback===3,capability:'storage'});
   const page=await p.transaction(tx=>tx.query('heads',{scopeId,limit:1}));result.push({id:`${mode}-bounded-query`,expected:1,actual:page.length,holds:page.length===1,capability:'storage'});
  }finally{await db?.close();}
 }
 let refused=false;try{assertCapacity(9,1,10);}catch(e){refused=e instanceof OutcomeRefusal&&e.issues[0].code==='OUTC1014';}
 result.push({id:'version-capacity-guard',expected:true,actual:refused,holds:refused,capability:'storage'});
 return result;
 }finally{await rm(dir,{recursive:true,force:true});}
}
