/** The portable operation contract; host authentication is supplied by handlers. */
import { compileContract, type Contract } from '@jarenjs/contract';
import document from '../schemas/outcomes.contract.json' with { type: 'json' };
export const outcomeContractDocument = document;
export function createOutcomeContract(): Contract { return compileContract(document); }
export { createOutcomeHandlers, OUTCOME_MODEL_OPERATIONS } from './handlers.ts';
export type { OutcomeHandlerOptions, OutcomeHandlerBinding } from './handlers.ts';
