/** Two experimental reads reuse the package's closed schemas and the existing citation target. */
import {lightRagSchema} from '@tangleai/lightrag';
import {contractSchemaResource} from './schema-resources.ts';
export const LIGHTRAG_DEFINITIONS={lightrag:contractSchemaResource(lightRagSchema,'#/$defs/lightrag')};
const ref=(name:string)=>({$ref:'#/$defs/lightrag/$defs/'+name});
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,required,properties});
const count={type:'integer',minimum:0},issues={type:'array',minItems:1,items:{oneOf:[ref('lightRagIssue'),{$ref:'#/$defs/config/$defs/issue'}]}};
export function lightRagReadOperations(citationTarget:object){
    const refusal=object({experimental:{const:true},status:{const:'refused'},issues});
    const request=object({q:{type:'string',minLength:1,maxLength:8000},mode:ref('lightRagMode'),limit:{type:'integer',minimum:1,maximum:50}},['q','mode']);
    return {
        'lightrag.status':{kind:'read',policy:{idempotency:'none'},input:object({}),output:{oneOf:[refusal,object({experimental:{const:true},status:{const:'ok'},graphRevision:ref('lightRagRevision'),
            projections:{type:'array',items:object({sourceId:ref('lightRagId'),versionId:ref('lightRagId'),graphRevision:ref('lightRagRevision'),status:{enum:['staged','active','superseded']},counts:ref('graphProjectionCounts')})},
            graph:object({entities:count,relations:count,claims:count}),embeddedBy:{type:'array',items:ref('lightRagEmbeddedBy')},promptRevisions:{type:'object',additionalProperties:{type:'array',items:ref('lightRagRevision'),uniqueItems:true}}})]},http:{method:'GET',path:'/api/lightrag/status'}},
        'lightrag.retrieve':{kind:'read',policy:{idempotency:'none'},input:request,output:{oneOf:[object({...refusal.properties,mode:ref('lightRagMode'),graphRevision:ref('lightRagRevision'),spend:ref('lightRagSpend')}),
            object({experimental:{const:true},status:{const:'ok'},mode:ref('lightRagMode'),graphRevision:ref('lightRagRevision'),plan:ref('lightRagQueryPlan'),sections:ref('lightRagContextBundle/properties/sections'),
                citations:{type:'array',items:citationTarget},skipped:ref('lightRagRetrieval/properties/skipped'),prune:count,spend:ref('lightRagSpend')})]},http:{method:'GET',path:'/api/lightrag/retrieve'}},
    }as const;
}
