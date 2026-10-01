import schema from '../../schemas/grounding.schema.json' with { type: 'json' };
import { immutableGroundingJson } from '../identity.ts';
export const RECONCILE_SCHEMA = immutableGroundingJson(schema.$defs.reconcileReply);
export const PRIHA_ANSWER_SCHEMA = immutableGroundingJson(schema.$defs.prihaAnswer);
export const REPAIR_SCHEMA = immutableGroundingJson(schema.$defs.repairProposal);
