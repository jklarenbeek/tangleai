import assert from 'node:assert/strict';
import {nodeDriver} from '@jarenjs/db/node';
import {createHashEmbedder} from '@tangleai/models/embed';
import {createScriptedPlanner} from '@tangleai/lightrag';
import {createDesktop,type Desktop,type DesktopOptions} from '../../apps/desktop/src/server.ts';
import {runLightRagExample} from '../../examples/lightrag.ts';

export const GRAPH_QUESTION='Where does Cedar Guild keep equipment?';
export async function lightRagDesktop(options:Pick<DesktopOptions,'dbPath'|'watch'|'presetSettings'>={}){
    const embedder=createHashEmbedder({dims:32});let requests=0;
    const desktop=await createDesktop({...options,driver:nodeDriver(),presetSettings:{...options.presetSettings,embed:{provider:'custom',baseUrl:'http://embedding.fixture/v1',model:embedder.model,apiKey:null}},
        fetch:async(url,init)=>{
            assert.equal(String(url),'http://embedding.fixture/v1/embeddings');requests++;
            const body=JSON.parse(String(init?.body));assert.equal(body.model,embedder.model);
            const vectors=await embedder.embed(body.input);
            return Response.json({model:embedder.model,data:vectors.map((embedding,index)=>({index,embedding:Array.from(embedding)})),usage:{prompt_tokens:3,total_tokens:3}});
        },lightrag:{plannerFor:()=>createScriptedPlanner([{text:GRAPH_QUESTION,lowKeywords:['Cedar Guild'],highKeywords:['equipment']}])}});
    try{await runLightRagExample(desktop.db);}catch(cause){await desktop.close();throw cause;}
    return {desktop,requests:()=>requests};
}
export async function graphCall(desktop:Desktop,path:string){
    const reply=await desktop.dispatcher.dispatch({method:'GET',url:path,headers:{},body:null});
    return {status:reply.status,value:JSON.parse(typeof reply.body==='string'?reply.body:new TextDecoder().decode(reply.body))};
}
export async function retainedReadState(desktop:Desktop){
    return Object.fromEntries(await Promise.all(['chats','runs','config_identities'].map(async name=>[name,
        await desktop.db.collection(name).execute({$for:{row:'$[*]'},$return:'$row'})])));
}
