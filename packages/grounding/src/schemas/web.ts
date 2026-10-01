import schema from '../../schemas/grounding.schema.json' with { type: 'json' };
import { immutableGroundingJson } from '../identity.ts';
export const WEB_SUFFICIENCY_SCHEMA = immutableGroundingJson(schema.$defs.webSufficiency);
export const WEB_RERANK_SCHEMA = immutableGroundingJson(schema.$defs.webRerank);
export const WEB_AGENT_SCHEMA = immutableGroundingJson(schema.$defs.webAgentResult);
