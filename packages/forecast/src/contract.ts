/** Portable validated read operations; authenticated authority is supplied by the host. */
import { compileContract, type Contract } from '@jarenjs/contract';
import document from '../schemas/forecast.contract.json' with { type: 'json' };
export const forecastContractDocument = document;
export function createForecastContract(): Contract { return compileContract(document); }
export { createForecastReadHandlers } from './read-handlers.ts';
export type { ForecastReadHandlerBinding, ForecastReadHandlerOptions } from './read-handlers.ts';
