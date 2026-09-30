import {it} from 'node:test';
import assert from 'node:assert/strict';
import {heraRegistryDocument,heraConfigCatalog} from '@tangleai/hera';
import {fixture} from './fixture.ts';
it('the eight-role registry pins artifacts and refuses an undeclared tool',async()=>{
  const f=await fixture();assert.equal(f.registry.document.roles.length,8);
  assert.deepEqual(f.registry.document.tools.map(t=>t.id),['hera-evidence']);
  assert.deepEqual(f.agents.filter(a=>a.tools.length).map(a=>a.id),['retriever']);
  const bad=structuredClone(f.agents);bad[0].tools=['shell'];
  const result=await heraRegistryDocument(f.catalog,{agents:bad});assert.equal(result.valid,false);
  if(!result.valid){assert.equal(result.issues[0].code,'THERA1003');assert.equal(result.issues[0].path,'/tools/0');}
  const config=await heraConfigCatalog('scripted',{calls:24});assert.ok(config.valid);assert.deepEqual(config.value.profiles,['scripted']);
});
