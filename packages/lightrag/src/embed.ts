/** Graph text is embedded in explicit batches without mixing the name and theme corpora. */
import { isVector } from '@jarenjs/core/vector';
import type { Embedder } from '@tangleai/models/embed';
import type { LightRagEmbeddedBy } from './contracts.gen.ts';
import { lightragReject } from './errors.ts';
import { immutableLightRagJson } from './identity.ts';
import { createLightRagMeter,graphStageFailure,type LightRagBudget,type LightRagClock,type LightRagStageOutcome } from './meter.ts';
export interface GraphEmbeddingValue {vectors:number[][];embeddedBy:LightRagEmbeddedBy;}
export async function embedGraphText(options:{embedder:Embedder;texts:readonly string[];batchSize?:number;budget:LightRagBudget;clock:LightRagClock;expectedEmbeddedBy?:LightRagEmbeddedBy}):Promise<LightRagStageOutcome<GraphEmbeddingValue>>{
    const batchSize=options.batchSize??32;
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>256)throw new TypeError('Graph embedding batch size must be between one and 256.');
    const meter=createLightRagMeter(options.budget,options.clock),model=options.embedder.model;let dims=options.expectedEmbeddedBy?.dims??options.embedder.dims;
    try{
        if(!model||options.texts.some(text=>typeof text!=='string'||!text.trim()))lightragReject('TLRAG1001','/texts','Graph vector keys must be nonblank text from a named embedder.');
        if(options.expectedEmbeddedBy&&(options.expectedEmbeddedBy.model!==model||options.embedder.dims!==undefined&&options.embedder.dims!==options.expectedEmbeddedBy.dims))
            lightragReject('TLRAG1002','/embeddedBy','The graph embedder differs from the registered identity.');
        const vectors:number[][]=[];
        for(let offset=0;offset<options.texts.length;offset+=batchSize){
            const batch=options.texts.slice(offset,offset+batchSize),reply=await meter.run(()=>options.embedder.embed(batch),JSON.stringify(batch));
            if(!Array.isArray(reply)||reply.length!==batch.length)lightragReject('TLRAG1002','/vectors','The embedder did not return exactly one graph vector per text.');
            dims??=reply[0]?.length;
            if(dims===undefined||!Number.isInteger(dims)||dims<1||options.embedder.model!==model||options.embedder.dims!==undefined&&options.embedder.dims!==dims||reply.some(vector=>!isVector(vector,dims)))
                lightragReject('TLRAG1002','/embeddedBy','The graph vector width, finite components or embedder identity changed.');
            vectors.push(...reply.map(vector=>Array.from(vector)));
        }
        if(dims===undefined||!Number.isInteger(dims)||dims<1)lightragReject('TLRAG1002','/embeddedBy','An empty vector set still needs a known embedding identity.');
        return {valid:true,value:immutableLightRagJson({vectors,embeddedBy:{model,dims}}),spend:meter.spent(),attempts:meter.spent().calls};
    }catch(cause){return graphStageFailure(cause,meter.spent(),meter.spent().calls);}
}
