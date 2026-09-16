/**
 * The durable lifecycle: one immutable workflow version and the registry
 * it validates against.
 *
 * Zero-I/O like the package root — authoring a version reads no file,
 * spawns nothing and takes no clock, which is what makes the version id a
 * function of the authored bytes alone.
 */

export {
  buildEvolveLifecycle, EVOLVE_WORKFLOW_ID,
  EVOLVE_ENVELOPE_SCHEMA, EVOLVE_SETTLEMENT_SCHEMA,
} from './workflow.ts';
export type { EvolveLifecycleOptions } from './workflow.ts';

export { evolveRegistryDocument, EVOLVE_HANDLERS, EVOLVE_EFFECT_STAGES } from './registry.ts';
export type { EvolveHandlerDeclaration, EvolveEffectStage } from './registry.ts';

export {
  emptyEnvelope, decided, decide, counted, settled, uncertain,
  measures, reruns, readSettlement,
} from './state.ts';
export type { EvolveEnvelope, EnvelopeDecision, EvolveSettlement } from './state.ts';
