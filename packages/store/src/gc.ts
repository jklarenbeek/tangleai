/** Explicit collection of unreferenced retained document evidence; version records remain auditable. */
import type {DocumentVersion,DocumentSource} from '@tangleai/documents/contracts';
import type {TangleDb} from './db.ts';
import {asRows} from './memory-store.ts';
export interface DocumentGarbageCandidate {readonly versionId:string;readonly sourceId:string;readonly chunkIds:readonly string[];readonly elementIds:readonly string[];readonly parentIds:readonly string[];}
export interface DocumentReferenceResolver {
    name:string;
    /** Resolve preloaded host/report references. The database transaction is open;
     * this callback must not call its root store or perform a model request. */
    resolve(candidate:Readonly<DocumentGarbageCandidate>):readonly string[]|Promise<readonly string[]>;
}
export interface DocumentGarbageResult {dryRun:boolean;eligible:DocumentGarbageCandidate[];deleted:DocumentGarbageCandidate[];retained:Array<{versionId:string;referencedBy:string[]}>;}
export async function collectDocumentGarbage(db:TangleDb,options:{resolvers?:readonly DocumentReferenceResolver[];dryRun?:boolean}={}):Promise<DocumentGarbageResult>{
    const dryRun=options.dryRun??true,resolvers=options.resolvers??[];
    if(typeof dryRun!=='boolean'||new Set(resolvers.map(row=>row.name)).size!==resolvers.length||resolvers.some(row=>!row.name.trim()||typeof row.resolve!=='function'))throw new TypeError('Document garbage collection requires a boolean dryRun and distinct named reference resolvers.');
    return db.transaction(async scope=>{
        const versions=asRows(await scope.collection<DocumentVersion>('document_versions').execute<DocumentVersion>({$for:{row:'$[*]'},$where:{$or:[{$eq:['$row.status','superseded']},{$eq:['$row.status','failed']}]},$orderby:'$row.id',$return:'$row'}));
        const sources=asRows(await scope.collection<DocumentSource>('sources').execute<DocumentSource>({$for:{row:'$[*]'},$return:'$row'}));
        const chats=asRows(await scope.collection('chats').execute<{id:string;citations?:string[]}>({$for:{row:'$[*]'},$return:{id:'$row.id',citations:'$row.citations'}}));
        // The native recursive JSONPath includes nested summary values without a second tree walker.
        const runs=asRows(await scope.collection('runs').execute<{id:string;values:unknown[]}>({$for:{row:'$[*]'},$return:{id:'$row.id',values:['$row.summary','$row.summary..*']}}));
        const graph:Array<{table:string;id:string;versionId?:string;chunkId?:string;supportChunkIds?:string[]}>=[];
        for(const table of ['projections','chunk_profiles','entity_claims','relation_claims','entities','relations']){
            const rows=asRows(await scope.collection('lightrag_'+table).execute<{id:string;versionId?:string;chunkId?:string;supportChunkIds?:string[]}>({$for:{row:'$[*]'},$return:{id:'$row.id',versionId:'$row.versionId',chunkId:'$row.payload.chunkId',supportChunkIds:'$row.payload.supportChunkIds'}}));
            graph.push(...rows.map(row=>({...row,table})));
        }
        const result:DocumentGarbageResult={dryRun,eligible:[],deleted:[],retained:[]};
        for(const version of versions){
            const ids=async(table:string)=>asRows(await scope.collection(table).execute<{id:string}>({$for:{row:'$[*]'},$where:{$eq:['$row.versionId',{$const:version.id}]},$orderby:'$row.id',$return:{id:'$row.id'}})).map(row=>row.id);
            const candidate:DocumentGarbageCandidate={versionId:version.id,sourceId:version.sourceId,chunkIds:await ids('document_chunks'),elementIds:await ids('document_elements'),parentIds:await ids('document_parents')};
            if(!candidate.chunkIds.length&&!candidate.elementIds.length&&!candidate.parentIds.length)continue;
            const addresses=new Set([version.id,...candidate.chunkIds,...candidate.elementIds,...candidate.parentIds]),references:string[]=[];
            for(const source of sources)if(source.activeVersionId===version.id)references.push('source:'+source.id);
            for(const row of graph)if(row.versionId===version.id||row.chunkId&&addresses.has(row.chunkId)||row.supportChunkIds?.some(id=>addresses.has(id)))references.push('graph:'+row.table+':'+row.id);
            for(const row of chats)if(row.citations?.some(id=>addresses.has(id)))references.push('chat:'+row.id);
            for(const row of runs)if(row.values.some(value=>typeof value==='string'&&addresses.has(value)))references.push('run:'+row.id);
            for(const resolver of resolvers){
                const input=Object.freeze({...candidate,chunkIds:Object.freeze([...candidate.chunkIds]),elementIds:Object.freeze([...candidate.elementIds]),parentIds:Object.freeze([...candidate.parentIds])});
                const found=await resolver.resolve(input);
                if(!Array.isArray(found)||found.some(value=>typeof value!=='string'||!value.trim()))throw new TypeError('A document reference resolver must return nonblank reference ids.');
                references.push(...found.map(reference=>resolver.name+':'+reference));
            }
            if(references.length)result.retained.push({versionId:version.id,referencedBy:[...new Set(references)].sort()});else result.eligible.push(candidate);
        }
        // Every reference resolver completes before the first delete.
        if(!dryRun)for(const candidate of result.eligible){
            for(const [table,keys]of [['document_chunks',candidate.chunkIds],['document_elements',candidate.elementIds],['document_parents',candidate.parentIds]]as const)
                for(const key of keys)await scope.collection(table).delete(key);
            result.deleted.push(candidate);
        }
        return result;
    },{mode:'immediate'});
}
