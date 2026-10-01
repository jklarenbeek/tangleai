/** Static TOML instructions and one canonical JSON block; the suite owns parsing. */
import { parseToml } from '@jarenjs/josl';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { validateLightRagShape, lightRagSchemaOf, lightRagSchema, type LightRagRecords } from './schema.ts';
import { immutableLightRagJson, lightragRevisionOf } from './identity.ts';
import { lightragMust, lightragReject, lightragRefuse, type LightRagOutcome } from './errors.ts';
import type { LightRagPromptArtifact, LightRagPromptCatalog } from './contracts.gen.ts';
export const LIGHTRAG_PROMPT_POLICY = 'lightrag-static-json-v1' as const;
export const LIGHTRAG_PROMPT_SHAPES = Object.freeze({
    'graph-extractor': ['graphExtractionInput','graphExtractionReply'],
    'graph-profiler': ['graphProfileInput','graphProfileReply'],
    'graph-deduplicator': ['graphCoreferenceInput','graphCoreferenceReply'],
    'graph-planner': ['graphKeywordInput','graphKeywordReply'],
} as const);
const reference = (name: string) => ({ $ref: lightRagSchema.$id + '/' + name });
async function schemaRevision(role: LightRagPromptArtifact['role']): Promise<string> {
    return canonicalSha256(LIGHTRAG_PROMPT_SHAPES[role].map(name=>lightRagSchemaOf(name)));
}
async function textDigest(source: string): Promise<string> {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
    return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function compileLightRagPromptPack(source: string): Promise<LightRagOutcome<LightRagPromptArtifact>> {
    try {
        const pack=lightragMust(validateLightRagShape('lightRagPromptPack',parseToml(source)));
        if(pack.system.content.includes('{{')||pack.user.content.includes('{{'))lightragReject('TLRAG1001','/pack','Graph instructions must be static; interpolation syntax is not accepted.');
        const [input,output]=LIGHTRAG_PROMPT_SHAPES[pack.meta.role];
        const body={...pack.meta,system:pack.system.content,user:pack.user.content,inputSchema:reference(input),outputSchema:reference(output),schemaRevision:await schemaRevision(pack.meta.role),sourceDigest:await textDigest(source)};
        return validateLightRagShape('lightRagPromptArtifact',{...body,revision:await lightragRevisionOf(body)});
    } catch(cause) { return lightragRefuse('TLRAG1001','/pack','Graph prompt compilation failed.',cause); }
}
export async function validateLightRagPromptArtifact(value: unknown): Promise<LightRagOutcome<LightRagPromptArtifact>> {
    const checked=validateLightRagShape('lightRagPromptArtifact',value);if(!checked.valid)return checked;
    const artifact=checked.value,{revision,...body}=artifact,[input,output]=LIGHTRAG_PROMPT_SHAPES[artifact.role];
    if(!equalsJson(artifact.inputSchema,reference(input))||!equalsJson(artifact.outputSchema,reference(output))
        ||artifact.system.includes('{{')||artifact.user.includes('{{')||artifact.schemaRevision!==await schemaRevision(artifact.role)||revision!==await lightragRevisionOf(body))
        return lightragRefuse('TLRAG1002','/artifact','Graph prompt content, role schema or revision differs from its compiled identity.');
    return checked;
}
export async function compileLightRagPrompts(sources: readonly string[]): Promise<LightRagOutcome<LightRagPromptCatalog>> {
    const packs:LightRagPromptArtifact[]=[];
    for(const source of sources){const result=await compileLightRagPromptPack(source);if(!result.valid)return result;packs.push(result.value);}
    if(new Set(packs.map(pack=>pack.id)).size!==4||new Set(packs.map(pack=>pack.role)).size!==4)
        return lightragRefuse('TLRAG1001','/packs','The catalog must contain one unique pack for each of the four graph roles.');
    return validateLightRagShape('lightRagPromptCatalog',{policyVersion:LIGHTRAG_PROMPT_POLICY,packs:packs.sort((a,b)=>a.id<b.id?-1:1)});
}
export async function renderLightRagPrompt(artifact: LightRagPromptArtifact, input: unknown): Promise<LightRagOutcome<{system:string;user:string}>> {
    const checked=await validateLightRagPromptArtifact(artifact);if(!checked.valid)return checked;
    const shape=LIGHTRAG_PROMPT_SHAPES[artifact.role][0] satisfies keyof LightRagRecords;
    const data=validateLightRagShape(shape,input);if(!data.valid)return data;
    return {valid:true,value:immutableLightRagJson({system:artifact.system,user:artifact.user+'\n\nINPUT:\n'+canonicalizeJson(data.value)})};
}
