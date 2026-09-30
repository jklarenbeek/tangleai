import assert from 'node:assert/strict';
import {join} from 'node:path';
import {nodeDriver} from '@jarenjs/db/node';
import {openTangleDb,createHeraStore} from '@tangleai/store';
import {createGmplCatalog} from '@tangleai/gmpl';
import {heraArtifacts,createHeraAgents,emptyHeraHead,planPromptActivation} from '@tangleai/hera';
import schema from '@tangleai/hera/schemas/hera' with {type:'json'};
import {qualifyHeraBrowser} from './hera-browser.mjs';
assert.match(import.meta.resolve('@tangleai/hera'),/\.js$/);assert.ok(schema.$defs.heraLearningSnapshot);
const browser=await qualifyHeraBrowser();assert.equal(browser.packs,13);assert.equal(browser.roles,8);assert.ok(browser.staleRefused);
const catalog=await createGmplCatalog(heraArtifacts);assert.ok(catalog.valid);
const created=await createHeraAgents(catalog.value,{scope:'installed',profile:'scripted',at:'2020-01-01T00:00:00.000Z'});assert.ok(created.valid);
const directory=process.env.TANGLE_FIXTURE_DIRECTORY;assert.ok(directory);
const db=await openTangleDb({driver:nodeDriver(),path:join(directory,'hera.sqlite')});
try{
  const store=createHeraStore(db,{scope:'installed'}),authority={scope:'installed',mode:'learn'};
  const agent=created.value.agents[0],prompt=created.value.prompts[0];
  assert.ok((await store.putAgent(agent,authority)).valid);assert.ok((await store.putPromptVersion(prompt,authority)).valid);
  const initial=emptyHeraHead(authority.scope,'prompt',agent.id),plan=planPromptActivation(initial,initial,prompt);assert.ok(plan.valid);
  assert.ok((await store.transitionHead(plan.value,authority)).valid);
  const refused=await store.transitionHead(plan.value,authority);assert.equal(refused.valid,false);assert.equal(refused.issues[0].code,'THERA1006');
  console.log(JSON.stringify({heraInstalled:true,packs:13,roles:8,staleHeadRefused:true}));
}finally{await db.close();}
