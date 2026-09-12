import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryOutcomeStore,scopeIdOf,DEFAULT_OUTCOME_POLICY } from '@tangleai/outcomes';
import { beginOperation,finishOperation } from '../../packages/outcomes/src/operations.ts';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { OutcomeRefusal, reject } from '../../packages/outcomes/src/errors.ts';
const scopeId=await scopeIdOf({namespace:'test',domain:'scalar',subject:'request'});
const command={scopeId,artifactKey:'a',requestKey:'r',at:'2026-01-01T00:00:00.000Z',input:{value:1}};
describe('durable outcome request reservations',()=>{
 it('completed replay returns its exact result without effects, while altered input conflicts',async()=>{
  const store=createMemoryOutcomeStore(),first=await beginOperation(store,'probe',command);
  const result=await finishOperation(store,first.operation,command.at,async()=>({id:'value'}));assert.ok(result.ok);
  const again=await beginOperation(store,'probe',command);assert.ok(again.replay?.ok);assert.equal(again.replay.writes,0);assert.deepEqual(again.replay.value,result.value);
  await assert.rejects(()=>beginOperation(store,'other',command),(e:unknown)=>e instanceof OutcomeRefusal&&e.issues[0].code==='OUTC1007');
 });
 it('eleven concurrent reservations admit ten, before any proposer dispatch',async()=>{
  const store=createMemoryOutcomeStore();const results=await Promise.all(Array.from({length:11},(_,i)=>beginOperation(store,'reflect',{...command,requestKey:String(i)},DEFAULT_OUTCOME_POLICY).then(()=>true).catch((e:unknown)=>{assert.ok(e instanceof OutcomeRefusal);assert.equal(e.issues[0].code,'OUTC1014');return false;})));assert.equal(results.filter(Boolean).length,10);
 });
 it('in-progress and uncertain dispatch never automatically resume',async()=>{
  const store=createMemoryOutcomeStore(),first=await beginOperation(store,'reflect',command,DEFAULT_OUTCOME_POLICY);
  await assert.rejects(()=>beginOperation(store,'reflect',command,DEFAULT_OUTCOME_POLICY),(e:unknown)=>e instanceof OutcomeRefusal&&e.issues[0].code==='OUTC1019');
  await persistenceFor(store).transaction(tx=>tx.put('operations',{...first.operation,state:'dispatched'}));
  await assert.rejects(()=>beginOperation(store,'reflect',command,DEFAULT_OUTCOME_POLICY),(e:unknown)=>e instanceof OutcomeRefusal&&e.issues[0].code==='OUTC1017');
 });
 it('a failed refusal receipt leaves an explicit retry, rather than a permanently reserved request',async()=>{
  let armed=false;const store=createMemoryOutcomeStore({applyProbe(step){if(armed&&step==='put:records'){armed=false;throw Error('refusal receipt failed');}}});
  const first=await beginOperation(store,'probe',command);armed=true;const failed=await finishOperation(store,first.operation,command.at,async()=>reject('OUTC1007','already complete'));
  assert.ok(!failed.ok);assert.equal(failed.issues[0].code,'OUTC1015');
  const retry=await beginOperation(store,'probe',command);const result=await finishOperation(store,retry.operation,command.at,async()=>reject('OUTC1007','already complete'));
  assert.ok(!result.ok);assert.equal(result.issues[0].code,'OUTC1007');assert.deepEqual((await beginOperation(store,'probe',command)).replay,result);
 });
});
