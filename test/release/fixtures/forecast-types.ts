import { createForecastContract, createForecastReadHandlers, createMemoryForecastStore, createForecastHost, createForecastOutcomeHost, createHarnessRefiner, forecastPromptRevisions, type ForecastHostOptions, type ForecastOutcomeHostOptions, type ForecastQuestion, type HarnessDocument, type ForecastReadHandlerBinding } from '@tangleai/forecast';
import contract from '@tangleai/forecast/schemas/contract' with { type: 'json' };
const binding: ForecastReadHandlerBinding={store:createMemoryForecastStore(),scopeKey:'typed',allowScope:()=>true};
createForecastReadHandlers({resolveHost:()=>binding});createForecastContract();forecastPromptRevisions('scaffold-no-harness');
// @ts-expect-error unknown treatments cannot alter prompt identity
forecastPromptRevisions('invented');
declare const host:ForecastHostOptions;declare const outcomes:ForecastOutcomeHostOptions;
createForecastHost(host);createForecastOutcomeHost(outcomes);
declare const question:ForecastQuestion;declare const harness:HarnessDocument;
const scope:string=question.scopeKey;const procedure:string=harness.evidenceHandling;
void [scope,procedure,contract,createHarnessRefiner];
