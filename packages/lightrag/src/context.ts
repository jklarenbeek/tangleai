/** The engine and instrument render the same three evidence sections and citation vocabulary. */
import {estimateTokens} from '@tangleai/core/tokens';
import type {LightRagRetrieval,LightRagContextBundle} from './contracts.gen.ts';
import {immutableLightRagJson} from './identity.ts';
export type LightRagContextInput=Pick<LightRagRetrieval,'mode'|'entities'|'relations'|'chunks'|'citations'>;
export function serializeLightRagContext(input:LightRagContextInput):LightRagContextBundle{
    const allowed=new Set(input.citations.map(row=>row.chunkId)),supplied=new Set<string>(),names=new Map(input.entities.map(row=>[row.id,row.name]));
    if(allowed.size!==input.citations.length||input.chunks.some(row=>!allowed.has(row.id))||[...input.entities,...input.relations].some(row=>!row.supportChunkIds.some(id=>allowed.has(id))))
        throw new TypeError('Every context item requires a distinct supplied citation target.');
    const support=(ids:readonly string[])=>{const keys=[...new Set(ids)].filter(id=>allowed.has(id)).sort();for(const id of keys)supplied.add(id);return keys.join(', ');};
    const entities=input.entities.map(row=>`[${row.id}] ${row.name} (${row.types.join(', ')}) — ${row.profile} — support: ${support(row.supportChunkIds)}`).join('\n');
    const relations=input.relations.map(row=>`[${row.id}] ${names.get(row.sourceEntityId)??row.sourceEntityId} → ${names.get(row.targetEntityId)??row.targetEntityId} — ${row.themes.join(', ')} — strength: ${row.strength} — ${row.profile} — support: ${support(row.supportChunkIds)}`).join('\n');
    const chunks=input.mode==='hybrid-no-original'?'':input.chunks.map(row=>{if(allowed.has(row.id))supplied.add(row.id);return `[${row.id}] ${row.text}`;}).join('\n');
    const sections={entities,relations,chunks},text=Object.entries(sections).filter(([,content])=>content.length>0).map(([name,content])=>name[0].toUpperCase()+name.slice(1)+'\n'+content).join('\n\n');
    return immutableLightRagJson({sections,text,suppliedChunkIds:[...supplied].sort(),tokenCount:estimateTokens(text)});
}
