import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createLightRagStore, openTangleDb } from '@tangleai/store';
import schema from '@tangleai/lightrag/schemas/lightrag' with {type:'json'};
import { qualifyLightRagBrowser, qualifyLightRagPreparation } from './lightrag-browser.mjs';
assert.match(import.meta.resolve('@tangleai/lightrag'),/\.js$/);
assert.equal(schema.$id,'https://tangleai.dev/schemas/lightrag-contracts');
const root=process.env.TANGLE_FIXTURE_DIRECTORY;assert.ok(root);
assert.deepEqual(await qualifyLightRagPreparation(),{entities:2,relations:1,claims:3,embeddingCalls:2,calls:2,decisions:0,partial:false,lookups:1,packs:4,valid:true});
const db=await openTangleDb({path:join(root,'lightrag.db')});
try {
    const memory=await qualifyLightRagBrowser(),durable=await qualifyLightRagBrowser(createLightRagStore(db));
    assert.deepEqual(durable,memory);assert.deepEqual(memory,{writes:5,replayWrites:0,newClaims:1,revision:1,entities:1,support:['consumer-chunk'],fold:'cedar',shape:true});
    assert.equal((await db.integrityCheck()).ok,true);
} finally {await db.close();}
const reopened=await openTangleDb({path:join(root,'lightrag.db')});
try {const store=createLightRagStore(reopened);assert.equal((await store.listEntities()).length,1);assert.equal((await store.activeProjectionFor('consumer-source')).head.revision,1);}
finally {await reopened.close();}
console.log('Installed graph preparation, contracts, atomic activation, replay and durable reopen passed.');

const {runLightRagExample}=await import('./lightrag-example.mjs');
const corpusDb=await openTangleDb();
try{assert.deepEqual(await runLightRagExample(corpusDb),{unchanged:'unchanged',replayWrites:0,removedDocumentWrites:2,reactivated:true,reactivationClaims:0,reactivationCalls:0,reactivationExtractions:0,head:4,retainedVersions:1,activeEntities:2,activeRelations:1});}
finally{await corpusDb.close();}
console.log('Installed document preparation, joint promotion, replacement, retraction, zero-call reactivation and reference-aware collection passed.');
