import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createLightRagStore, openTangleDb } from '@tangleai/store';
import schema from '@tangleai/lightrag/schemas/lightrag' with {type:'json'};
import { qualifyLightRagBrowser } from './lightrag-browser.mjs';
assert.match(import.meta.resolve('@tangleai/lightrag'),/\.js$/);
assert.equal(schema.$id,'https://tangleai.dev/schemas/lightrag-contracts');
const root=process.env.TANGLE_FIXTURE_DIRECTORY;assert.ok(root);
const db=await openTangleDb({path:join(root,'lightrag.db')});
try {
    const memory=await qualifyLightRagBrowser(),durable=await qualifyLightRagBrowser(createLightRagStore(db));
    assert.deepEqual(durable,memory);assert.deepEqual(memory,{writes:5,replayWrites:0,newClaims:1,revision:1,entities:1,support:['consumer-chunk'],fold:'cedar',shape:true});
    assert.equal((await db.integrityCheck()).ok,true);
} finally {await db.close();}
const reopened=await openTangleDb({path:join(root,'lightrag.db')});
try {const store=createLightRagStore(reopened);assert.equal((await store.listEntities()).length,1);assert.equal((await store.activeProjectionFor('consumer-source')).head.revision,1);}
finally {await reopened.close();}
console.log('Installed graph contracts, atomic activation, replay and durable reopen passed.');
