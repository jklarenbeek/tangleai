/** Registered retrieval bounds are copied into every plan and result. */
import type {LightRagLimits} from './contracts.gen.ts';
import {validateLightRagShape} from './schema.ts';
import {lightragMust,lightragReject} from './errors.ts';
export const LIGHTRAG_LIMITS:Readonly<LightRagLimits>=Object.freeze({keywordsPerLevel:8,candidatesPerKeyword:10,expansionEntities:20,expansionRelations:40,chunksPerSource:3,contextTokens:4000});
export function lightRagLimits(overrides:Partial<LightRagLimits>={}):LightRagLimits{
    const limits=lightragMust(validateLightRagShape('lightRagLimits',{...LIGHTRAG_LIMITS,...overrides}));
    if(Object.values(limits).some(value=>!Number.isSafeInteger(value))||limits.keywordsPerLevel>32)
        lightragReject('TLRAG1001','/limits','Retrieval limits must be safe integers; the keyword artifact supports at most 32 keywords per level.');
    return limits;
}
