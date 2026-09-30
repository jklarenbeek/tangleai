import {it} from 'node:test';
import assert from 'node:assert/strict';
import {nodeDriver} from '@jarenjs/db/node';
import {openTangleDb,createHeraStore} from '@tangleai/store';
import {heraContentIdOf} from '@tangleai/hera';
import {fixture,scope,authority} from '../hera/fixture.ts';
it('HERA physical keys separate identical role ids across opaque scopes',async()=>{
  const db=await openTangleDb({driver:nodeDriver()});
  try{
    const f=await fixture(),left=createHeraStore(db,{scope}),right=createHeraStore(db,{scope:'other/"scope'});
    assert.ok((await left.put('agent',f.agents[0],authority)).valid);
    const other={...f.agents[0],scope:right.scope,title:'Other scope'};
    assert.ok((await right.put('agent',other,{scope:right.scope,mode:'learn'})).valid);
    assert.equal((await left.get('agent',other.id))!.title,f.agents[0].title);
    assert.equal((await right.get('agent',other.id))!.title,'Other scope');
    assert.equal((await left.query('agent',{})).length,1);
    const crossed={...f.experience,scope:right.scope};crossed.id=await heraContentIdOf(crossed);
    const refused=await left.put('experience',crossed,authority);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'THERA1004');
    const bad=await left.put('agent',{...f.agents[0],title:'Different immutable bytes'},authority);assert.equal(bad.valid,false);if(!bad.valid)assert.equal(bad.issues[0].code,'THERA1002');
  }finally{await db.close();}
});
