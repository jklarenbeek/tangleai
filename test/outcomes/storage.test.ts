import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createMemoryOutcomeStore, planHeadTransition, scopeIdOf, validateRecord, type OutcomeStore } from '@tangleai/outcomes';
import { openTangleDb,createOutcomeStore } from '@tangleai/store';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { sealRecord,keyId } from '../../packages/outcomes/src/identity.ts';
import { putRecord,readRecord,headFor } from '../../packages/outcomes/src/persistence.ts';
import { checkShape } from '../../packages/outcomes/src/schema.ts';
const at='2026-01-01T00:00:00.000Z',scope={namespace:'fixture',domain:'scalar',subject:'s'};
const scopeId=await scopeIdOf(scope),h='a'.repeat(64);
async function decision(){return sealRecord({schemaVersion:1,kind:'decision',scopeId,artifactKey:'test',recordedAt:at,decisionKey:'one',scope,adapter:{id:'scalar/v1',revision:h,inputSchema:h,outputSchema:h,resolutionSchema:h,artifactSchema:h,scorerRevision:h},input:{base:1},output:{predicted:1},decidedAt:at,cutoffAt:at,expectedResolutionAt:null,memoryIds:[],configuration:{kind:'scripted',revision:h},usedVersionId:null,staticPayload:{offset:0}});}
for(const mode of ['reference','sqlite'] as const)describe(`outcome atomic storage ${mode}`,()=>{
 async function fixture(){const dir=await mkdtemp(join(tmpdir(),'outcome-store-'));const db=mode==='sqlite'?await openTangleDb({path:join(dir,'state.db')}):null;let fail:string|null=null;const options={applyProbe:(step:string)=>{if(step===fail)throw Error('injected');}};const store=db?createOutcomeStore(db,options):createMemoryOutcomeStore(options);return {store,db,dir,setFail:(s:string|null)=>{fail=s;},close:async()=>{await db?.close();await rm(dir,{recursive:true,force:true});}};}
 it('validates immutable addresses, isolates reads and publishes no duplicate record',async()=>{const f=await fixture();try{
  const p=persistenceFor(f.store),r=await decision();assert.equal(await p.transaction(tx=>putRecord(tx,r)),1);assert.equal(await p.transaction(tx=>putRecord(tx,r)),0);
  await assert.rejects(()=>validateRecord({...r,artifactKey:'changed'}));await assert.rejects(()=>validateRecord({...r,recordedAt:'2026-02-30T00:00:00.000Z'}));
  const got=await p.transaction(tx=>readRecord(tx,r.id,scopeId));assert.equal(got.id,r.id);await assert.rejects(()=>p.transaction(tx=>readRecord(tx,r.id,'b'.repeat(64))));
  assert.ok(!Object.hasOwn(f.store,'transaction'));assert.ok(!Object.hasOwn(f.store,'setHead'));
 }finally{await f.close();}});
 it('faults after key/record publication roll back every write',async()=>{const f=await fixture();try{const p=persistenceFor(f.store),r=await decision();for(const step of ['put:keys','put:records','commit']){f.setFail(step);await assert.rejects(()=>p.transaction(tx=>putRecord(tx,r)));f.setFail(null);assert.equal(await p.transaction(tx=>tx.get('records',r.id)),undefined);assert.equal((await p.transaction(tx=>tx.query('keys',{}))).length,0);}assert.equal(await p.transaction(tx=>putRecord(tx,r)),1);}finally{await f.close();}});
 it('twenty head contenders give one winner, and revision fences ABA',async()=>{const f=await fixture();try{const p=persistenceFor(f.store),id=await keyId(scopeId,'head','test');const outcomes=await Promise.all(Array.from({length:20},()=>p.transaction(async tx=>{const next=planHeadTransition(await headFor(tx,scopeId,'test'),{versionId:null,revision:0},h);await tx.put('heads',{id,scopeId,artifactKey:'test',head:next,eventId:null});return true;}).catch(()=>false)));assert.equal(outcomes.filter(Boolean).length,1);await p.transaction(async tx=>{await tx.put('heads',{id,scopeId,artifactKey:'test',head:{versionId:h,revision:3},eventId:null});});await assert.rejects(()=>p.transaction(async tx=>planHeadTransition(await headFor(tx,scopeId,'test'),{versionId:h,revision:1},'b'.repeat(64))));}finally{await f.close();}});
 it('memory writes share the same atomic owner and remain detached',async()=>{const f=await fixture();try{await f.store.memories.put({id:'m',text:'x',evidence:'e',kind:'fact',tags:[],at,confidence:.5});const u=(await f.store.memories.get('m'))!;u.confidence=0;assert.equal((await f.store.memories.get('m'))!.confidence,.5);f.setFail('commit');await assert.rejects(()=>f.store.memories.put({...u,confidence:.7}));f.setFail(null);assert.equal((await f.store.memories.get('m'))!.confidence,.5);}finally{await f.close();}});
});
describe('outcome schema boundaries',()=>{
 it('rejects extra fields and non-JSON input before canonical hashing',async()=>{assert.throws(()=>checkShape('scope',{...scope,approve:true}));assert.throws(()=>checkShape('scope',{...scope,subject:' '}));assert.throws(()=>checkShape('json',{value:Infinity}));assert.throws(()=>checkShape('json',{value:undefined}));assert.equal(await scopeIdOf({subject:'s',domain:'scalar',namespace:'fixture'}),scopeId);});
 it('a file reopens and independent handles cannot both claim the same head',async()=>{const dir=await mkdtemp(join(tmpdir(),'outcome-two-handles-'));const path=join(dir,'db');let a=await openTangleDb({path,busyTimeout:0}),b=await openTangleDb({path,busyTimeout:0});try{const r=await decision();await persistenceFor(createOutcomeStore(a)).transaction(tx=>putRecord(tx,r));await a.close();a=await openTangleDb({path,busyTimeout:0});assert.equal((await persistenceFor(createOutcomeStore(a)).transaction(tx=>readRecord(tx,r.id,scopeId))).id,r.id);const id=await keyId(scopeId,'head','test');const results=await Promise.all([a,b].map(db=>persistenceFor(createOutcomeStore(db)).transaction(async tx=>{const next=planHeadTransition(await headFor(tx,scopeId,'test'),{versionId:null,revision:0},h);await tx.put('heads',{id,scopeId,artifactKey:'test',head:next,eventId:null});return true;}).catch(()=>false)));assert.equal(results.filter(Boolean).length,1);}finally{await a.close();await b.close();await rm(dir,{recursive:true,force:true});}});
});
