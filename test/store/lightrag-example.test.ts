import {it} from 'node:test';
import assert from 'node:assert/strict';
import {openTangleDb} from '@tangleai/store';
import {runLightRagExample} from '../../examples/lightrag.ts';
it('the public graph corpus example promotes and reverts through the same evidence boundary',async()=>{
    const db=await openTangleDb();try{assert.deepEqual(await runLightRagExample(db),{unchanged:'unchanged',replayWrites:0,removedDocumentWrites:2,reactivated:true,reactivationClaims:0,reactivationCalls:0,reactivationExtractions:0,head:4,retainedVersions:1,activeEntities:2,activeRelations:1});}finally{await db.close();}
});
