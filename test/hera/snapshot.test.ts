import {it} from 'node:test';import assert from 'node:assert/strict';
import {createMemoryHeraStore,emptyHeraHead,heraContentIdOf,planHeraLibraryTransition,prepareHeraSnapshot,stageSnapshot,activateSnapshot,readHeraFrozenLibrary} from '@tangleai/hera';
import {fixture,lifecycle,scope,authority} from './fixture.ts';
it('library membership and snapshot activation are atomic, and old frozen membership remains readable',async()=>{
  const store=createMemoryHeraStore({scope}),f=await fixture();await lifecycle(store);
  const initial=(await store.getSnapshot(f.snapshot.id))!,firstHead=(await store.readHead(emptyHeraHead(scope,'snapshot').id))!;
  const first=await store.transaction(authority,async tx=>{const staged=await stageSnapshot(tx,initial,{experienceIds:[f.experience.id]});await activateSnapshot(tx,firstHead,staged.snapshot);return staged.snapshot.id;});assert.ok(first.valid);
  const parent=(await store.getSnapshot(first.value))!,snapshotHead=(await store.readHead(firstHead.id))!,libraryHead=(await store.readHead(emptyHeraHead(scope,'library').id))!;
  const content={...f.experience,insight:'Prefer the checked current source.',parents:[f.experience.id]},next={...content,id:await heraContentIdOf(content)};
  const plan=await planHeraLibraryTransition(libraryHead,libraryHead,[f.experience],[next]);assert.ok(plan.valid);
  const applied=await store.transaction(authority,async tx=>{await tx.put('experience',next);await tx.transitionHead(plan.value);const staged=await stageSnapshot(tx,parent,{experienceIds:[next.id]});await activateSnapshot(tx,snapshotHead,staged.snapshot);return staged.snapshot.id;});assert.ok(applied.valid,JSON.stringify(applied));
  assert.equal((await store.getExperience(f.experience.id))?.status,'archived');assert.equal((await store.getSnapshot(parent.id))?.status,'archived');
  assert.deepEqual((await readHeraFrozenLibrary({store},parent)).map(e=>e.insight),[f.experience.insight]);assert.deepEqual((await readHeraFrozenLibrary({store},(await store.getSnapshot(applied.value))!)).map(e=>e.id),[next.id]);
  const before=await store.listExperiences({scope}),counter=store.counters().learningWrites,loserContent={...next,insight:'A losing replacement.'},loser={...loserContent,id:await heraContentIdOf(loserContent)};
  const lost=await store.transaction(authority,async tx=>{await tx.put('experience',loser);await tx.transitionHead(plan.value);});assert.equal(lost.valid,false);if(!lost.valid)assert.equal(lost.issues[0].code,'THERA1006');
  assert.deepEqual(await store.listExperiences({scope}),before);assert.equal(store.counters().learningWrites,counter);
});
it('a snapshot with unchanged membership and prompts is a no-op rather than a new version',async()=>{
  const f=await fixture(),result=await prepareHeraSnapshot(f.snapshot,{});assert.ok(result.valid);assert.equal(result.value.noOp,true);assert.equal(result.value.snapshot.id,f.snapshot.id);
});
