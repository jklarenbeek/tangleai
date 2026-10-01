import type { DocumentChunk } from '@tangleai/documents/contracts';
import type { GraphExtractionReply } from '../../packages/lightrag/src/contracts.gen.ts';
import { loadLightRagFixture,createLightRagFixtureCorpus } from '../../benchmark/lib/lightrag.ts';
export function graphTestChunk():DocumentChunk{return {id:'chunk',sourceId:'source',versionId:'version',text:'Cedar operates the workshop and funds the register.',elementIds:['element'],order:0,tokenCount:12,headingPath:[],embedding:[1,0],embeddedBy:{model:'fixture',dims:2}};}
export const extractionReply:GraphExtractionReply={entities:[{name:'Cedar',type:'ORGANIZATION',description:'Cedar operates the workshop.'}],relations:[],contentKeywords:['equipment']};
export async function graphFixture(){
    const loaded=await loadLightRagFixture(),corpus=await createLightRagFixtureCorpus(loaded),replies:Record<string,GraphExtractionReply>={};
    for(const reply of loaded.fixture.extraction){
        replies[corpus.idByKey.get(reply.chunk)!]={entities:reply.entities.map(({key:_,...row})=>row),relations:reply.relations.map(({key:_,...row})=>row),contentKeywords:reply.contentKeywords};
    }
    return {...corpus,loaded,replies};
}
