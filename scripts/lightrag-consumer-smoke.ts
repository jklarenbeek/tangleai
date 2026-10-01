/** The installed consumer runs this same keyless example with both graph adapters. */
import {openTangleDb} from '@tangleai/store';
import {runLightRagExample} from '../examples/lightrag.ts';
const previous=globalThis.fetch;let requests=0;
globalThis.fetch=async()=>{requests++;throw Error('LightRAG consumer forbids ambient network access.');};
const db=await openTangleDb();
try{
    const result=await runLightRagExample(db);
    if(requests!==0||!result.memoryParity||result.answer.disposition!=='no-model'||!result.gcDryRun)throw Error('The keyless graph consumer did not complete its registered path.');
    console.log(JSON.stringify({tier:'scripted',requests,...result},null,2));
}finally{await db.close();globalThis.fetch=previous;}
