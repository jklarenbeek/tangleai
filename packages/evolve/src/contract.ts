/**
 * The portable read contract; host authentication is supplied by handlers.
 *
 * Three operations, every one a `read`. The authority to land a change is
 * absent from this surface rather than guarded inside it, and the frozen
 * baseline beside it is what turns "we did not add a write operation"
 * from a claim into a check.
 */
import { compileContract, type Contract } from '@jarenjs/contract';
import document from '../schemas/evolve.contract.json' with { type: 'json' };

export const evolveContractDocument = document;
export function createEvolveContract(): Contract { return compileContract(document); }

export {
  createEvolveHandlers, createEvolveReader, EVOLVE_OPERATIONS, EVOLVE_LIST_LIMIT,
} from './handlers.ts';
export type {
  EvolveHandlerOptions, EvolveHandlerBinding, EvolveReader,
} from './handlers.ts';
