import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nodeDriver} from '@jarenjs/db/node';
import {openTangleDb,createHeraStore} from '@tangleai/store';
import {createMemoryHeraStore,HERA_RECORD_KINDS,emptyHeraHead,planPromptActivation,heraContentIdOf,type HeraStore} from '@tangleai/hera';
import {fixture,lifecycle,scope,authority} from './fixture.ts';
it('one lifecycle has identical outcomes in memory, SQLite memory and SQLite file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-store-'));
  try{
    const expected=await lifecycle(createMemoryHeraStore({scope}));
    for(const path of [':memory:',join(dir,'state.sqlite')]){
      const db=await openTangleDb({driver:nodeDriver(),path});
      try{assert.deepEqual(await lifecycle(createHeraStore(db,{scope})),expected);}
      finally{await db.close();}
    }
    const reopened=await openTangleDb({driver:nodeDriver(),path:join(dir,'state.sqlite')});
    try{assert.deepEqual(await createHeraStore(reopened,{scope}).listSnapshots({scope}),expected.snapshots);}
    finally{await reopened.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
for(const backend of ['memory','sqlite'] as const)it(`${backend}: rollback leaves no partial state`,async()=>{
  let fail=false;const probe=(step:string)=>{if(fail&&step==='put:head')throw new Error('injected activation failure');};
  const db=backend==='sqlite'?await openTangleDb({driver:nodeDriver()}):null;
  const store:HeraStore=db?createHeraStore(db,{scope,applyProbe:probe}):createMemoryHeraStore({scope,applyProbe:probe});
  const dump=async()=>Promise.all(HERA_RECORD_KINDS.map(kind=>store.query(kind,{scope})));
  try{
    const f=await fixture();assert.ok((await store.put('agent',f.agents[0],authority)).valid);assert.ok((await store.put('promptVersion',f.prompts[0],authority)).valid);
    const before=await dump(),head=emptyHeraHead(scope,'prompt',f.prompts[0].agentId),plan=planPromptActivation(head,head,f.prompts[0]);assert.ok(plan.valid);
    fail=true;await assert.rejects(store.transitionHead(plan.value,authority),/injected/);fail=false;
    assert.deepEqual(await dump(),before);
    assert.ok((await store.transitionHead(plan.value,authority)).valid);
    const second={...f.prompts[0],operationalRules:[{text:'A second active version.',derivedFrom:[]}],status:'active' as const};second.id=await heraContentIdOf(second);
    const refused=await store.put('promptVersion',second,authority);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'THERA1006');
    assert.equal((await store.listPromptVersions({agentId:f.prompts[0].agentId,status:'active'})).length,1);
    const beforeRefusal=await dump();
    const refusedTransaction=await store.transaction(authority,async tx=>{
      await tx.put('agent',f.agents[1]);
      await assert.rejects(tx.put('agent',{...f.agents[1],title:'Conflicting bytes'}));
      return 'caller caught the refusal';
    });
    assert.equal(refusedTransaction.valid,false);
    assert.deepEqual(await dump(),beforeRefusal);
  }finally{await db?.close();}
});
