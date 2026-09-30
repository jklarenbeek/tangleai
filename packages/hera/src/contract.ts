/** Portable reads over a scoped store; transport mounting belongs to the host. */
import {compileContract,type Contract} from '@jarenjs/contract';
import document from '../schemas/hera.contract.json' with {type:'json'};
export const heraContractDocument=document;
export function createHeraContract():Contract{return compileContract(document);}
export {createHeraHandlers} from './handlers.ts';
export type {HeraHandlerOptions,HeraReadStore} from './handlers.ts';
