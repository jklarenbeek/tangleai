/** Document and graph promotion share one native immediate transaction and source fence. */
import { equalsJson } from '@jarenjs/core/object';
import type { TransactionStore } from '@jarenjs/db';
import { planHeadTransition,type Head } from '@tangleai/outcomes';
import { assertStoredDocumentBundle,type DocumentCorpusStore,type DocumentSource,type DocumentVersion,type DocumentChunk,type PreparedOutcome,type StoredDocumentBundle } from '@tangleai/documents/contracts';
import { buildContribution,createCandidateResolver,validateGraphContribution,validateGraphProjection,projectionForContribution,projectionIdOf,sourceGraphHead,
    planProjectionWrites,planRetraction,prepareGraphRetraction,rebaseRetainedContribution,checkLightRagWritePlanWithin,contributionResultMatchesWithin,
    readGraphSnapshotWithin,lightragRevisionOf,emptyGraphSpend,graphStageFailure,immutableLightRagJson,lightragMust,lightragReject,lightragFailure,
    type LightRagStore,type LightRagOutcome,type LightRagApplyReceipt,type LightRagSpend,type GraphContribution,type GraphProjection,type GraphDocumentBinding,
    type GraphPreparationFailure,type BuildContributionOptions,type CoreferenceJudge,type GraphContributionPlan } from '@tangleai/lightrag';
import type { TangleDb } from './db.ts';
import { lightRagViewWithin,applyLightRagPlanWithin } from './lightrag-store.ts';
import { applyDocumentBundle,documentBundleIsActiveWithin,serialDocumentSource } from './document-state.ts';
export interface CorpusGraphPreparationOptions extends Omit<BuildContributionOptions,'chunks'|'sourceId'|'versionId'|'resolver'|'retiredClaimIds'> {
    judge:CoreferenceJudge;maxDecisions?:number;
}
export type CorpusPreparation = {status:'unchanged';source:DocumentSource;version:DocumentVersion;projection:GraphProjection;spend:LightRagSpend}
    |{status:'prepared';document:StoredDocumentBundle;contribution:GraphContribution;expectedHead:Head;profilePolicy:'prepared'|'retained-evidence';reused:boolean};
export type CorpusPreparationOutcome = {valid:true;value:CorpusPreparation}|({valid:false}&GraphPreparationFailure);
export interface CorpusPromotionRequest {document:StoredDocumentBundle;contribution:GraphContribution;expectedHead:Head;allowPartial?:boolean;profilePolicy?:'prepared'|'retained-evidence';}
export interface CorpusPromotionReceipt {sourceId:string;versionId:string;documentWrites:number;graph:LightRagApplyReceipt;spend:LightRagSpend;}
export interface CorpusRetractionReceipt {sourceId:string;versionId:string|null;documentWrites:number;graph:LightRagApplyReceipt|null;spend:LightRagSpend;}
export interface CorpusPromotionOptions {db:TangleDb;documents:DocumentCorpusStore;lightrag:LightRagStore;applyProbe?:(step:string)=>void|Promise<void>;}
const sorted=(values:readonly string[])=>[...new Set(values)].sort();
const members=(projection:GraphProjection|undefined)=>projection?[...projection.entityClaimIds,...projection.relationClaimIds]:[];
const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function assertPreparationIdentity(version:DocumentVersion,identities:CorpusGraphPreparationOptions['identities']):void{
    if(!equalsJson({version:version.chunkerVersion,config:version.chunkerConfig},identities.chunker)||!equalsJson(version.embeddedBy,identities.embedder))
        lightragReject('TLRAG1006','/document/identity','Graph preparation must use the document chunker and embedding identity.');
}
function assertDocumentIdentity(document:StoredDocumentBundle,contribution:GraphContribution):void{
    try{assertStoredDocumentBundle(document);}catch(cause){lightragReject('TLRAG1003','/document','The prepared document bundle is invalid.',cause);}
    if(document.source.id!==contribution.sourceId||document.version.id!==contribution.versionId
        ||!equalsJson({version:document.version.chunkerVersion,config:document.version.chunkerConfig},contribution.identities.chunker)
        ||!equalsJson(document.version.embeddedBy,contribution.identities.embedder))
        lightragReject('TLRAG1006','/document/identity','Graph preparation and document source, version, chunker and embedder must agree.');
    const completed=contribution.completedChunkIds,failed=contribution.failures.map(row=>row.chunkId),partition=[...completed,...failed];
    if(new Set(partition).size!==partition.length||!equalsJson(sorted(partition),sorted(document.chunks.map(row=>row.id))))
        lightragReject('TLRAG1003','/document/chunks','Every document chunk must occur exactly once as completed or explicitly failed graph extraction.');
}
async function documentBinding(document:StoredDocumentBundle):Promise<GraphDocumentBinding>{
    return {sourceId:document.source.id,versionId:document.version.id,revision:await lightragRevisionOf(json(document))};
}
async function projectionsWithin(scope:TransactionStore,sourceId:string):Promise<GraphProjection[]>{
    const rows=await lightRagViewWithin(scope).query('projections',{sourceId});
    return Promise.all(rows.map(async row=>lightragMust(await validateGraphProjection(row.payload))));
}
function assertExpected(actual:Head,expected:Head,target:string):void{
    try{planHeadTransition(actual,expected,target);}catch(cause){lightragReject('TLRAG1006','/expectedHead','The corpus source head changed before promotion.',cause);}
}
async function assertRealEvidence(scope:TransactionStore,plan:GraphContributionPlan,incoming?:StoredDocumentBundle):Promise<void>{
    const chunks=new Map(incoming?.chunks.map(row=>[row.id,row])??[]),versions=new Map<string,DocumentVersion>(),sources=new Map<string,DocumentSource>();
    for(const address of plan.input.chunks){
        let chunk=chunks.get(address.id);if(!chunk){chunk=await scope.collection<DocumentChunk>('document_chunks').get(address.id);if(chunk)chunks.set(chunk.id,chunk);}
        if(!chunk||chunk.sourceId!==address.sourceId||chunk.versionId!==address.versionId)lightragReject('TLRAG1003','/chunks','Every prepared graph address must resolve to actual retained document evidence.');
    }
    const claims=new Map([...plan.input.existing.claims.entities,...plan.input.existing.claims.relations,...plan.input.claims.entities,...plan.input.claims.relations].map(row=>[row.id,row]));
    for(const row of [...plan.canonicals.entities,...plan.canonicals.relations])if(row.status==='active')for(const id of row.supportClaimIds){
        const claim=claims.get(id)!;
        if(incoming&&claim.sourceId===incoming.source.id){if(claim.versionId!==incoming.version.id||!incoming.chunks.some(chunk=>chunk.id===claim.chunkId))lightragReject('TLRAG1003','/support','Incoming support must belong to the promoted document.');continue;}
        let version=versions.get(claim.versionId);if(!version){version=await scope.collection<DocumentVersion>('document_versions').get(claim.versionId);if(version)versions.set(version.id,version);}
        let source=sources.get(claim.sourceId);if(!source){source=await scope.collection<DocumentSource>('sources').get(claim.sourceId);if(source)sources.set(source.id,source);}
        if(!version||version.status!=='active'||version.sourceId!==claim.sourceId||source?.status!=='ready'||source.activeVersionId!==version.id)
            lightragReject('TLRAG1003','/support','Active graph support must resolve through the active document version of every source.');
    }
}
function preparationFailure(cause:unknown,spend:LightRagSpend=emptyGraphSpend(),completedChunkIds:string[]=[]):CorpusPreparationOutcome{
    const result=graphStageFailure(cause,spend,spend.calls);if(result.valid)throw Error('Expected preparation failure.');
    return {valid:false,issues:result.issues,spend:result.spend,completedChunkIds,stopReason:result.stopReason};
}
export function createCorpusPromotion(options:CorpusPromotionOptions){
    const {db,documents,lightrag}=options,probe=options.applyProbe;
    if(probe!==undefined&&typeof probe!=='function')throw new TypeError('The corpus write probe must be a function.');
    return {
        async prepare(input:{document:PreparedOutcome;graph:CorpusGraphPreparationOptions}):Promise<CorpusPreparationOutcome>{
            let spend=emptyGraphSpend(),completedChunkIds:string[]=[];
            try{
                if(input.document.status==='failed')lightragReject('TLRAG1010','/document','Document preparation did not complete.',input.document.error);
                const document=input.document,source=document.status==='prepared'?document.bundle.source:document.source,version=document.status==='prepared'?document.bundle.version:document.version;
                assertPreparationIdentity(version,input.graph.identities);
                const projections=await Promise.all((await lightrag.listProjections({sourceId:source.id})).map(async row=>lightragMust(await validateGraphProjection(row)))),expectedHead=lightragMust(sourceGraphHead(projections,source.id)),active=projections.find(row=>row.status==='active');
                if(document.status==='unchanged'&&(await documents.getSource(source.id))?.activeVersionId!==version.id)lightragReject('TLRAG1006','/document','An unchanged document result became stale before graph preparation.');
                if(active?.versionId===version.id&&equalsJson(active.identities,input.graph.identities))
                    return {valid:true,value:{status:'unchanged',source,version,projection:active,spend:emptyGraphSpend()}};
                const bundle=document.status==='prepared'?document.bundle:{source,version,elements:await documents.listElements(version.id),chunks:await documents.listChunks(version.id),
                    ...(version.metrics.parents===undefined?{}:{parents:await documents.listParents(version.id)})};
                const retained=projections.find(row=>row.versionId===version.id&&row.status==='superseded'&&row.prepared&&equalsJson(row.identities,input.graph.identities));
                let contribution:GraphContribution;
                if(retained){
                    const checked=lightragMust(await validateGraphProjection(retained)),cached=checked.prepared!,names=cached.plan.input.claims.entities.map(row=>row.normalizedName);
                    const existing=await lightrag.readContributionSnapshot({normalizedNames:names,retiredClaimIds:members(active)});
                    contribution=lightragMust(await rebaseRetainedContribution({retained:cached,existing,retiredClaimIds:members(active)}));
                }else{
                    const resolver=createCandidateResolver({lookup:request=>lightrag.readContributionSnapshot(request),judge:input.graph.judge,maxDecisions:input.graph.maxDecisions});
                    const prepared=await buildContribution({...input.graph,chunks:bundle.chunks,sourceId:source.id,versionId:version.id,resolver,retiredClaimIds:members(active)});
                    if(!prepared.valid)return prepared;contribution=prepared.value;
                }
                spend=contribution.spend;completedChunkIds=contribution.completedChunkIds;
                assertDocumentIdentity(bundle,contribution);
                return {valid:true,value:immutableLightRagJson({status:'prepared',document:json(bundle),contribution,expectedHead,profilePolicy:retained?'retained-evidence':'prepared',reused:!!retained})};
            }catch(cause){return preparationFailure(cause,spend,completedChunkIds);}
        },
        async promote(input:CorpusPromotionRequest):Promise<LightRagOutcome<CorpusPromotionReceipt>>{
            try{
                const contribution=lightragMust(await validateGraphContribution(input.contribution)),document=json(input.document);assertDocumentIdentity(document,contribution);
                if((contribution.partial||document.version.metrics.partial)&&input.allowPartial!==true)lightragReject('TLRAG1006','/partial','Partial document or graph preparation requires explicit allowPartial.');
                const binding=await documentBinding(document),id=await projectionIdOf(contribution.sourceId,contribution.versionId,contribution.contributionRevision);
                return {valid:true,value:await serialDocumentSource(db,document.source.id,()=>db.transaction(async scope=>{
                    const view=lightRagViewWithin(scope),projections=await projectionsWithin(scope,document.source.id),actualHead=lightragMust(sourceGraphHead(projections,document.source.id)),retained=projections.find(row=>row.id===id);
                    const audit=retained?.audit?.at(-1);
                    if(retained?.status==='active'&&audit?.operation==='activate'&&equalsJson(audit.previousHead,input.expectedHead)&&audit.contributionPlanRevision===contribution.plan.revision&&equalsJson(audit.document,binding)){
                        if(!await documentBundleIsActiveWithin(scope,document)||!await contributionResultMatchesWithin(view,id,contribution.plan))lightragReject('TLRAG1006','/replay','A promotion replay no longer has its exact resulting document and graph bytes.');
                        return immutableLightRagJson({sourceId:document.source.id,versionId:document.version.id,documentWrites:0,graph:{projectionId:id,head:actualHead,writes:0,newClaims:0,reactivation:retained.audit!.slice(0,-1).some(entry=>entry.operation==='activate'),replayed:true},spend:emptyGraphSpend()});
                    }
                    assertExpected(actualHead,input.expectedHead,id);await assertRealEvidence(scope,contribution.plan,document);
                    const projection=lightragMust(await projectionForContribution(contribution,retained)),plan=lightragMust(await planProjectionWrites({projection,contribution:contribution.plan,projections,actualHead,expectedHead:input.expectedHead,
                        at:document.source.fetchedAt,document:binding,profilePolicy:input.profilePolicy??'prepared'}));
                    await checkLightRagWritePlanWithin(view,plan);await probe?.('validated');
                    const documentWrites=await applyDocumentBundle(scope,document,probe,binding);await probe?.('document');
                    const graph=await applyLightRagPlanWithin(scope,plan,{applyProbe:step=>probe?.('graph:'+step)});await probe?.('graph');
                    await probe?.('fence');await probe?.('commit');
                    return immutableLightRagJson({sourceId:document.source.id,versionId:document.version.id,documentWrites,graph,spend:contribution.spend});
                },{mode:'immediate'}))};
            }catch(cause){return lightragFailure(cause);}
        },
        async retract(sourceId:string,input:{expectedHead?:Head;at?:string|null}={}):Promise<LightRagOutcome<CorpusRetractionReceipt>>{
            try{
                // Read/prepare first; the immediate transaction subsequently checks this exact fence and evidence.
                const projections=await Promise.all((await lightrag.listProjections({sourceId})).map(async row=>lightragMust(await validateGraphProjection(row)))),active=projections.find(row=>row.status==='active'),expectedHead=input.expectedHead??lightragMust(sourceGraphHead(projections,sourceId));
                const existing=active?await lightrag.readContributionSnapshot({normalizedNames:[],retiredClaimIds:members(active)}):undefined;
                const contribution=active?lightragMust(await prepareGraphRetraction({existing:existing!,retiredClaimIds:members(active),embeddedBy:active.identities.embedder})):undefined;
                return {valid:true,value:await serialDocumentSource(db,sourceId,()=>db.transaction(async scope=>{
                    const current=await projectionsWithin(scope,sourceId),actualHead=lightragMust(sourceGraphHead(current,sourceId));assertExpected(actualHead,expectedHead,active?.id??sourceId);
                    const source=await scope.collection<DocumentSource>('sources').get(sourceId);
                    if(!active){if(source?.activeVersionId)lightragReject('TLRAG1006','/source','A source without an active graph projection cannot use graph retraction to change its document.');return {sourceId,versionId:null,documentWrites:0,graph:null,spend:emptyGraphSpend()};}
                    if(!source||source.activeVersionId!==active.versionId)lightragReject('TLRAG1006','/source','Document and graph heads must agree before joint retraction.');
                    const version=await scope.collection<DocumentVersion>('document_versions').get(active.versionId);if(!version||version.status!=='active')lightragReject('TLRAG1003','/version','The active document version is missing.');
                    await assertRealEvidence(scope,contribution!);
                    const document={sourceId,versionId:active.versionId,revision:await lightragRevisionOf({source,version})},at=input.at??source.fetchedAt;
                    const plan=lightragMust(await planRetraction({projection:active,contribution:contribution!,projections:current,actualHead,expectedHead,at,document,profilePolicy:'retained-evidence'}));
                    await checkLightRagWritePlanWithin(lightRagViewWithin(scope),plan);await probe?.('validated');
                    const {activeVersionId:_active,error:_error,...retiredSource}=source;
                    await scope.collection('document_versions').put({...version,status:'superseded',supersededAt:at??source.fetchedAt});await probe?.('put:document_versions');
                    await scope.collection('sources').put(retiredSource);await probe?.('document');
                    const graph=await applyLightRagPlanWithin(scope,plan,{applyProbe:step=>probe?.('graph:'+step)});await probe?.('graph');await probe?.('fence');await probe?.('commit');
                    return immutableLightRagJson({sourceId,versionId:active.versionId,documentWrites:2,graph,spend:emptyGraphSpend()});
                },{mode:'immediate'}))};
            }catch(cause){return lightragFailure(cause);}
        },
    };
}
