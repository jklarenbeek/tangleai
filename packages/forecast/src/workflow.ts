import { defineMasWorkflow, taskInvocation, switchInvocation, masMessage, type JsonSchema } from '@tangleai/mas';
const object = (properties: Record<string,JsonSchema>): JsonSchema => ({ type: 'object',properties,required: Object.keys(properties),additionalProperties: false });
import { forecastSchema } from './schema.ts';
const hash = { type: 'string',pattern: '^[a-f0-9]{64}$' };
export const FORECAST_WORKFLOW_REQUEST: JsonSchema = { ...forecastSchema.$defs.forecastWorkflowRequest,properties: { ...forecastSchema.$defs.forecastWorkflowRequest.properties,budget: forecastSchema.$defs.checkpointBudget } };
const revision = object({ checkpointId: hash,status: { enum: ['skipped','staged','deferred','refused'] },reason: { type: ['string','null'] },revisionId: { anyOf: [hash,{ type: 'null' }] } });
const completed = object({ checkpointId: hash,status: { enum: ['finalized','failed'] },traceId: { type: ['string','null'] },noteId: { type: ['string','null'] },predictionId: { type: ['string','null'] },revision });
export const FORECAST_HANDLER_POLICY = [
  { id: 'checkpoint-plan',effect: 'read' },{ id: 'checkpoint-run',effect: 'effectful' },{ id: 'note-create',effect: 'effectful' },
  { id: 'revision-run',effect: 'effectful' },{ id: 'revision-skip',effect: 'pure' },{ id: 'checkpoint-complete',effect: 'effectful' },{ id: 'decision-record',effect: 'effectful' },
] as const;
export function defineForecastWorkflow(options: { registryRevision: string;configRegistryRevision: string;profile: string }) {
  const request = FORECAST_WORKFLOW_REQUEST;
  const task = (id: string,effect: 'pure'|'read'|'effectful',input: Record<string,JsonSchema>,output: Record<string,JsonSchema>) => taskInvocation({ id,handler:id,effect,input,output });
  return defineMasWorkflow({ workflowId: 'forecast-checkpoint-v1',title: 'Forecast checkpoint',description: 'One cutoff-pinned execution, note and gated revision with durable stage artifacts.',...options,
    input: object({ request }),output: object({ completed }),entry: [{ port: 'request',to: { node: 'checkpoint-plan',port: 'request' } }],exit: [{ port: 'completed',from: { node: 'decision-record',port: 'completed' } }],
    nodes: [task('checkpoint-plan','read',{request},{request}),task('checkpoint-run','effectful',{request},{request}),task('note-create','effectful',{request},{request}),
      switchInvocation({ id: 'revision-gate',input: {request},output: {revision},mode: 'one-of',default: 'skip',branches: [
        { id: 'revise',when: { $and: [{ $ge: ['$.request.ordinal',2] },{ $eq: ['$.request.revise',true] }] },nodes: ['revision-run'],result: { node: 'revision-run',port: 'revision' } },
        { id: 'skip',when: { $or: [{ $lt: ['$.request.ordinal',2] },{ $eq: ['$.request.revise',false] }] },nodes: ['revision-skip'],result: { node: 'revision-skip',port: 'revision' } },
      ] }),task('revision-run','effectful',{request},{revision}),task('revision-skip','pure',{request},{revision}),task('checkpoint-complete','effectful',{request,revision},{completed}),task('decision-record','effectful',{request,completed},{completed})],
    messages: [masMessage(['checkpoint-complete','completed'],['decision-record','completed']),masMessage(['checkpoint-plan','request'],['decision-record','request']),masMessage(['checkpoint-plan','request'],['checkpoint-run','request']),masMessage(['checkpoint-run','request'],['note-create','request']),masMessage(['note-create','request'],['revision-gate','request']),masMessage(['note-create','request'],['checkpoint-complete','request']),masMessage(['revision-gate','request'],['revision-run','request']),masMessage(['revision-gate','request'],['revision-skip','request']),masMessage(['revision-gate','revision'],['checkpoint-complete','revision'])],
    limits: { calls: 32,tokens: 200000,ms: 600000,toolRounds: 25,fanOut: 3,concurrency: 1,iterations: 1,contextChars: 40000,traceBytes: 1000000 },
  });
}
const resolutionProperties = forecastSchema.$defs.forecastResolution.properties;
export const FORECAST_LIFECYCLE_REQUEST: JsonSchema = object({
  resolution: object({ questionId: hash,observedAt: resolutionProperties.observedAt,receivedAt: resolutionProperties.receivedAt,outcome: resolutionProperties.outcome,
    evidence: { ...resolutionProperties.evidence,items: { ...resolutionProperties.evidence.items,properties: { ...resolutionProperties.evidence.items.properties,address: forecastSchema.$defs.evidenceAddress } } } }),
  budget: forecastSchema.$defs.checkpointBudget,
});
export const FORECAST_LIFECYCLE_HANDLERS = ['resolution-record','predictions-score','retrospective-run','harness-promote-or-retain'] as const;
export function defineForecastLifecycleWorkflow(options: { registryRevision: string;configRegistryRevision: string;profile: string }) {
  const request = FORECAST_LIFECYCLE_REQUEST, resolutionId = hash, retrospectiveId = hash;
  const completed = object({ resolutionId,retrospectiveId,outcome: { enum: ['promoted','retained','rejected','ineligible'] } });
  const task = (id: string,input: Record<string,JsonSchema>,output: Record<string,JsonSchema>) => taskInvocation({ id,handler: id,effect: 'effectful',input,output });
  return defineMasWorkflow({ workflowId: 'forecast-resolution-v1',title: 'Forecast outcome lifecycle',description: 'Retain independent evidence, score checkpoints and evaluate a bounded retrospective before checked promotion.',...options,
    input: object({ request }),output: object({ completed }),entry: [{ port: 'request',to: { node: 'resolution-record',port: 'request' } }],exit: [{ port: 'completed',from: { node: 'harness-promote-or-retain',port: 'completed' } }],
    nodes: [task('resolution-record',{request},{request,resolution: resolutionId}),task('predictions-score',{request,resolution: resolutionId},{request,resolution: resolutionId}),task('retrospective-run',{request,resolution: resolutionId},{request,retrospective: retrospectiveId}),task('harness-promote-or-retain',{request,retrospective: retrospectiveId},{completed})],
    messages: [masMessage(['resolution-record','request'],['predictions-score','request']),masMessage(['resolution-record','resolution'],['predictions-score','resolution']),masMessage(['predictions-score','request'],['retrospective-run','request']),masMessage(['predictions-score','resolution'],['retrospective-run','resolution']),masMessage(['retrospective-run','request'],['harness-promote-or-retain','request']),masMessage(['retrospective-run','retrospective'],['harness-promote-or-retain','retrospective'])].map((edge,index) => ({ ...edge,id: 'lifecycle-message-' + (index + 1) })),
    limits: { calls: 32,tokens: 200000,ms: 600000,toolRounds: 25,fanOut: 2,concurrency: 1,iterations: 1,contextChars: 40000,traceBytes: 1000000 },
  });
}
