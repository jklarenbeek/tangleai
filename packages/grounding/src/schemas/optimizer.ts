/** Prompt contracts are views of authored schemas; GMPL owns its resolution envelope. */
import { gmplSchemaOf } from '@tangleai/gmpl';
import groundingSchema from '../../schemas/grounding.schema.json' with { type: 'json' };
import { immutableGroundingJson } from '../identity.ts';
export const TRIAGE_SCHEMA = immutableGroundingJson(groundingSchema.$defs.triageDecision);
export const CLARIFICATION_QUESTION_SCHEMA = immutableGroundingJson(groundingSchema.$defs.clarificationQuestion);
export const QUERY_PLAN_SCHEMA = immutableGroundingJson(groundingSchema.$defs.queryDraft);
export const CLARIFIED_INTENT_SCHEMA = immutableGroundingJson(groundingSchema.$defs.clarifiedIntent);
export const RESOLUTION_SCHEMA = gmplSchemaOf('clarification-resolve');
