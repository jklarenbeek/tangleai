/** Co-reference decisions see claim descriptions and prior groups, never vector proximity. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { GraphEntityClaim,GraphContributionSnapshot,GraphCoreferenceInput,GraphCoreferenceReply,GraphMergeReview,LightRagModelIdentity } from './contracts.gen.ts';
import { validateLightRagShape } from './schema.ts';
import { validateGraphClaim,validateCanonicalEntity } from './integrity.ts';
import { canonicalEntityIdOf,immutableLightRagJson } from './identity.ts';
import { lightragMust,lightragReject } from './errors.ts';
import { emptyGraphSpend,addGraphSpend,graphStageFailure,type LightRagBudget,type LightRagStageOutcome } from './meter.ts';
import { runStructuredGraph,graphClientIdentity,type StructuredGraphOptions } from './structured.ts';
export interface CoreferenceJudge {
    (input:GraphCoreferenceInput):Promise<LightRagStageOutcome<GraphCoreferenceReply>>;
    readonly modelIdentity:LightRagModelIdentity;readonly promptRevision:string;readonly budget:LightRagBudget|null;
}
export function checkCoreferencePartition(input:GraphCoreferenceInput,value:unknown){
    const shape=validateLightRagShape('graphCoreferenceReply',value);
    if(!shape.valid)return {valid:false,errors:[{instancePath:'/groups',message:'The co-reference reply must contain groups and reasons.'}]};
    const reply=shape.value,flat=reply.groups.flat(),ids=input.subjects.map(row=>row.id),owner=new Map<string,number>();
    let invalid=reply.groups.length!==reply.reasons.length||reply.reasons.some(reason=>!reason.trim())||flat.length!==ids.length||new Set(flat).size!==flat.length||flat.some(id=>!ids.includes(id));
    for(const [groupIndex,group]of reply.groups.entries())for(const id of group){
        const subject=input.subjects.find(row=>row.id===id);
        if(subject?.canonicalId){if(owner.has(subject.canonicalId)&&owner.get(subject.canonicalId)!==groupIndex)invalid=true;owner.set(subject.canonicalId,groupIndex);}
    }
    return invalid?{valid:false,errors:[{instancePath:'/groups',message:'Partition each supplied claim ID exactly once, retain existing canonical groups, and give one nonblank reason per group.'}]}:{valid:true};
}
export function createStructuredCoreferenceJudge(options:StructuredGraphOptions):CoreferenceJudge{
    if(options.artifact.role!=='graph-deduplicator')throw new TypeError('A co-reference judge requires the deduplication artifact.');
    const modelIdentity=graphClientIdentity(options.client),promptRevision=options.artifact.revision;
    const judge=async(input:GraphCoreferenceInput):Promise<LightRagStageOutcome<GraphCoreferenceReply>>=>{
        const result=await runStructuredGraph(options,input,value=>checkCoreferencePartition(input,value));
        return result.valid?{...result,value:lightragMust(validateLightRagShape('graphCoreferenceReply',result.value))}:result;
    };
    return Object.assign(judge,{modelIdentity,promptRevision,budget:options.budget});
}
export function createScriptedCoreferenceJudge(reply:(input:GraphCoreferenceInput)=>unknown|Promise<unknown>,options:{modelIdentity:LightRagModelIdentity;promptRevision:string}):CoreferenceJudge{
    const judge=async(input:GraphCoreferenceInput):Promise<LightRagStageOutcome<GraphCoreferenceReply>>=>{
        try{
            const checked=lightragMust(validateLightRagShape('graphCoreferenceInput',input)),value=await reply(checked);
            if(!checkCoreferencePartition(checked,value).valid)lightragReject('TLRAG1004','/groups','The scripted co-reference decision is not an exhaustive compatible partition.');
            return {valid:true,value:lightragMust(validateLightRagShape('graphCoreferenceReply',value)),spend:emptyGraphSpend(),attempts:1};
        }catch(cause){return graphStageFailure(cause,emptyGraphSpend(),1);}
    };
    return Object.assign(judge,{modelIdentity:immutableLightRagJson(options.modelIdentity),promptRevision:options.promptRevision,budget:null});
}
export interface GraphResolvedGroup {
    id:string;name:string;normalizedName:string;type:GraphEntityClaim['type'];identityClaimId?:string;
    claimIds:string[];incomingClaimIds:string[];previousCanonicalIds:string[];
}
export interface GraphResolution {existing:GraphContributionSnapshot;groups:GraphResolvedGroup[];merges:string[][];reviews:GraphMergeReview[];decisions:number;lookupNames:string[];}
export type GraphCandidateLookup=(request:{normalizedNames:string[];retiredClaimIds:string[]})=>Promise<GraphContributionSnapshot>;
export interface CandidateResolver {
    (request:{claims:readonly GraphEntityClaim[];retiredClaimIds?:readonly string[]}):Promise<LightRagStageOutcome<GraphResolution>>;
    readonly modelIdentity:LightRagModelIdentity;readonly promptRevision:string;readonly budget:LightRagBudget|null;
}
const sorted=(values:readonly string[])=>[...new Set(values)].sort();
const groupKey=(row:GraphEntityClaim)=>canonicalizeJson([row.normalizedName,row.type]);
export function createCandidateResolver(options:{lookup:GraphCandidateLookup;judge:CoreferenceJudge;maxDecisions?:number}):CandidateResolver{
    const maxDecisions=options.maxDecisions??16;
    if(!Number.isInteger(maxDecisions)||maxDecisions<0||maxDecisions>128)throw new TypeError('Graph resolution allows zero to 128 decisions per bundle.');
    const resolve=async(request:{claims:readonly GraphEntityClaim[];retiredClaimIds?:readonly string[]}):Promise<LightRagStageOutcome<GraphResolution>>=>{
        let spend=emptyGraphSpend(),attempts=0;
        try{
            const incoming=new Map(request.claims.map(row=>[row.id,row]));if(incoming.size!==request.claims.length)lightragReject('TLRAG1001','/claims','Incoming claim IDs must be distinct.');
            const addresses=[...new Map(request.claims.map(row=>[row.chunkId,{id:row.chunkId,sourceId:row.sourceId,versionId:row.versionId}])).values()];
            for(const claim of request.claims)lightragMust(await validateGraphClaim('entity',claim,addresses));
            const lookupNames=sorted(request.claims.map(row=>row.normalizedName)),retiredClaimIds=sorted(request.retiredClaimIds??[]),retired=new Set(retiredClaimIds);
            if(request.claims.some(row=>retired.has(row.id)))lightragReject('TLRAG1006','/retiredClaimIds','A resolver cannot introduce and withdraw the same claim.');
            const existing=lightragMust(validateLightRagShape('graphContributionSnapshot',await options.lookup({normalizedNames:lookupNames,retiredClaimIds})));
            const existingAddresses=[...new Map(existing.claims.entities.map(row=>[row.chunkId,{id:row.chunkId,sourceId:row.sourceId,versionId:row.versionId}])).values()];
            for(const claim of existing.claims.entities)lightragMust(await validateGraphClaim('entity',claim,existingAddresses));
            const claims=new Map(existing.claims.entities.map(row=>[row.id,row])),owner=new Map<string,string>();
            for(const row of existing.canonicals.entities){
                lightragMust(await validateCanonicalEntity(row,existing.claims.entities,{previous:row}));
                if(row.status==='active')for(const id of row.supportClaimIds){if(owner.has(id))lightragReject('TLRAG1006','/existing','An existing claim has multiple active canonical owners.');owner.set(id,row.id);}
            }
            for(const claim of request.claims)claims.set(claim.id,claim);
            const keys=new Set(request.claims.map(groupKey));
            for(const claim of existing.claims.entities)if(retired.has(claim.id))keys.add(groupKey(claim));
            const groups:GraphResolvedGroup[]=[],merges:string[][]=[],reviews:GraphMergeReview[]=[];let decisions=0;
            // A retained address keeps its historical identity even after withdrawal.
            // Only explicit cached membership may reactivate that identity later.
            const occupied=new Set(existing.canonicals.entities.map(row=>row.id));
            for(const key of [...keys].sort()){
                // Withdrawn claims remain identity context for this replacement. They
                // may preserve an existing group, but never return as active support.
                const members=[...claims.values()].filter(row=>groupKey(row)===key&&(incoming.has(row.id)||owner.has(row.id))).sort((a,b)=>a.id<b.id?-1:1);
                if(!members.length)continue;
                const newMembers=members.filter(row=>incoming.has(row.id)&&!owner.has(row.id)),oldIds=sorted(members.flatMap(row=>owner.has(row.id)?[owner.get(row.id)!]:[]));
                let partitions:string[][],reasons:string[]=[];
                const needsDecision=members.length>1&&newMembers.length>0&&(new Set(members.map(row=>row.description)).size>1||oldIds.length>1);
                if(needsDecision){
                    if(decisions>=maxDecisions)lightragReject('TLRAG1005','/maxDecisions','The registered co-reference decision budget is exhausted.');
                    const input=lightragMust(validateLightRagShape('graphCoreferenceInput',{subjects:members.map(row=>({id:row.id,name:row.name,type:row.type,description:row.description,canonicalId:owner.get(row.id)??null}))}));
                    decisions++;const result=await options.judge(input);spend=addGraphSpend(spend,result.spend);attempts+=result.attempts;if(!result.valid)return {...result,spend,attempts};
                    if(!checkCoreferencePartition(input,result.value).valid)lightragReject('TLRAG1004','/groups','The injected judge returned an invalid claim partition.');
                    partitions=result.value.groups;reasons=result.value.reasons;
                    const partitionOf=new Map(partitions.flatMap((group,index)=>group.map(id=>[id,index]as const)));
                    for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){
                        const a=members[i].id,b=members[j].id,ai=partitionOf.get(a)!,bi=partitionOf.get(b)!;
                        reviews.push({claimIds:[a,b],decision:ai===bi?'merge':'keep-apart',reason:ai===bi?reasons[ai]:reasons[ai]+' / '+reasons[bi]});
                    }
                }else if(oldIds.length>1){
                    partitions=oldIds.map(id=>members.filter(row=>owner.get(row.id)===id).map(row=>row.id));
                }else partitions=[members.map(row=>row.id)];
                for(const partition of [...partitions].map(sorted).sort((a,b)=>a[0]<b[0]?-1:1)){
                    const activeClaims=partition.filter(id=>!retired.has(id));
                    if(!activeClaims.length)continue;
                    const previousCanonicalIds=sorted(partition.flatMap(id=>owner.has(id)?[owner.get(id)!]:[]));
                    const previous=previousCanonicalIds.length?existing.canonicals.entities.find(row=>row.id===previousCanonicalIds[0])!:undefined,first=claims.get(partition[0])!;
                    const base=await canonicalEntityIdOf(first.name,first.type);let identityClaimId=previous?.identityClaimId,id=previous?.id;
                    if(id===undefined){if(occupied.has(base)){identityClaimId=first.id;id=await canonicalEntityIdOf(first.name,first.type,identityClaimId);}else id=base;}
                    occupied.add(id);
                    if(previousCanonicalIds.length>1)merges.push(previousCanonicalIds);
                    groups.push({id,name:previous?.name??first.name,normalizedName:first.normalizedName,type:first.type,...(identityClaimId?{identityClaimId}:{}),claimIds:activeClaims,incomingClaimIds:activeClaims.filter(id=>incoming.has(id)),previousCanonicalIds});
                }
            }
            return {valid:true,value:immutableLightRagJson({existing,groups:groups.sort((a,b)=>a.id<b.id?-1:1),merges,reviews,decisions,lookupNames}),spend,attempts};
        }catch(cause){return graphStageFailure(cause,spend,attempts);}
    };
    return Object.assign(resolve,{modelIdentity:options.judge.modelIdentity,promptRevision:options.judge.promptRevision,budget:options.judge.budget});
}
