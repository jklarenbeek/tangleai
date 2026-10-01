import {it} from 'node:test';
import assert from 'node:assert/strict';
import {estimateTokens} from '@tangleai/core/tokens';
import {serializeLightRagContext} from '@tangleai/lightrag';
import {graphClaim,graphEntity,graphEdge} from '../fixtures/lightrag-records.ts';
async function fixture(){const a=await graphClaim('Cedar'),b=await graphClaim('Willow',{ordinal:1}),entities=[await graphEntity(a),await graphEntity(b)],edge=await graphEdge(entities[0],entities[1]);
    return {mode:'hybrid' as const,entities,relations:[edge.row],chunks:[{id:a.chunkId,sourceId:a.sourceId,versionId:a.versionId,text:'Verbatim source.\nSecond line remains.',score:1}],citations:[{chunkId:a.chunkId,sourceId:a.sourceId,url:'https://docs.example/guide',title:'Guide',headingPath:[],elementIds:['element']}]};}
it('one serializer preserves verbatim chunks, section order, directed relations and exact citation targets',async()=>{
    const input=await fixture(),result=serializeLightRagContext(input);assert.deepEqual(result,serializeLightRagContext(input));assert.equal(result.sections.chunks,'['+input.chunks[0].id+'] Verbatim source.\nSecond line remains.');assert.match(result.sections.relations,/Cedar → Willow/);assert.deepEqual(result.suppliedChunkIds,[input.chunks[0].id]);assert.equal(result.tokenCount,estimateTokens(result.text));assert.ok(result.text.indexOf('Entities\n')<result.text.indexOf('Relations\n'));assert.ok(result.text.indexOf('Relations\n')<result.text.indexOf('Chunks\n'));
});
it('omitting original text preserves the graph section evidence vocabulary',async()=>{
    const input=await fixture(),full=serializeLightRagContext(input),ablated=serializeLightRagContext({...input,mode:'hybrid-no-original',chunks:[]});assert.equal(ablated.sections.chunks,'');assert.equal(ablated.sections.entities,full.sections.entities);assert.equal(ablated.sections.relations,full.sections.relations);assert.deepEqual(ablated.suppliedChunkIds,full.suppliedChunkIds);assert.ok(ablated.tokenCount<full.tokenCount);
});
it('unsupported context items refuse and an empty context consumes zero estimated tokens',async()=>{
    const input=await fixture();assert.throws(()=>serializeLightRagContext({...input,citations:[]}),/citation target/);assert.throws(()=>serializeLightRagContext({...input,citations:[...input.citations,...input.citations]}),/citation target/);
    assert.deepEqual(serializeLightRagContext({mode:'hybrid',entities:[],relations:[],chunks:[],citations:[]}),{sections:{entities:'',relations:'',chunks:''},text:'',suppliedChunkIds:[],tokenCount:0});
});
