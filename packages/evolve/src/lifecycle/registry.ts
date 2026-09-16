/**
 * The registry the lifecycle version is validated against.
 *
 * Every task node names a handler, and a handler may only bind if the
 * registry declares it with a matching effect. Declaring them here — as
 * data, in one place — is what makes "no node runs a spawn" checkable
 * rather than asserted: a stage that reaches a process is `effectful` and
 * must be a dispatch paired with a wait, and every `pure`/`read` handler
 * in this table is one a reviewer can confirm touches no process.
 *
 * `idempotency: 'honored'` is required before an effectful handler may
 * bind at all. It is honest here: a dispatch writes an effect intent
 * under a SEMANTIC plan id, so preparing it twice is a read, and `record`
 * goes through the outcome service, which reserves and replays every
 * command by key.
 */

import { EVOLVE_WORKFLOW_ID } from './workflow.ts';

export interface EvolveHandlerDeclaration {
  id: string;
  title: string;
  effect: 'pure' | 'read' | 'effectful';
  idempotency: 'not-required' | 'honored';
}

/**
 * The stages whose work is one fenced effect operation.
 *
 * Settling is absent on purpose. It spawns git — a worktree removal and a
 * branch delete — so it may not be a task; and it is already idempotent
 * through the experiment's own compare-and-swap transition, so wrapping it
 * in the effect fence would give one operation two idempotency mechanisms
 * that could disagree. It is a reconciler over runs that have stopped.
 */
export const EVOLVE_EFFECT_STAGES = [
  'isolate', 'apply', 'gate', 'gate-rerun', 'measure-base', 'measure-candidate',
] as const;

export type EvolveEffectStage = (typeof EVOLVE_EFFECT_STAGES)[number];

const dispatchHandler = (stage: string): EvolveHandlerDeclaration => ({
  id: 'evolve-dispatch-' + stage,
  title: 'Write the ' + stage + ' effect intent and enqueue its job',
  effect: 'effectful',
  idempotency: 'honored',
});

const readHandler = (stage: string): EvolveHandlerDeclaration => ({
  id: 'evolve-read-' + stage,
  title: 'Read what the ' + stage + ' operation settled',
  effect: 'read',
  idempotency: 'not-required',
});

const DECLARED: EvolveHandlerDeclaration[] = [
  { id: 'evolve-propose', title: 'Load and validate the registered proposal', effect: 'read', idempotency: 'not-required' },
  ...EVOLVE_EFFECT_STAGES.flatMap(stage => [dispatchHandler(stage), readHandler(stage)]),
  { id: 'evolve-no-rerun', title: 'Carry the envelope past the flake branch unchanged', effect: 'pure', idempotency: 'not-required' },
  { id: 'evolve-read-fitness', title: 'Read both sample batches as one measurement', effect: 'read', idempotency: 'not-required' },
  { id: 'evolve-decide', title: 'Plan the experiment decision over the collected records', effect: 'pure', idempotency: 'not-required' },
  { id: 'evolve-record', title: 'Record the outcome through the outcome service', effect: 'effectful', idempotency: 'honored' },
];

/** Sorted, so the registry document's bytes are a function of the set alone. */
export const EVOLVE_HANDLERS: readonly EvolveHandlerDeclaration[] =
  Object.freeze([...DECLARED].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

/** The registry document the lifecycle validates against. */
export function evolveRegistryDocument(): Record<string, unknown> {
  return {
    $masRegistry: '0.1',
    registryId: EVOLVE_WORKFLOW_ID,
    roles: [],
    handlers: EVOLVE_HANDLERS.map(one => ({ ...one })),
    tools: [],
    // Every edge carries a plain typed value; `json-schema` is the
    // builder's default adapter and the only one this workflow needs.
    // The version is the BUILT-IN adapter's own: a registry may only
    // declare what a host can actually bind, and `compileMasRuntime`
    // refuses a declared version no bound renderer answers to.
    messageAdapters: [{ id: 'json-schema', version: '0.1' }],
    contextAdapters: [],
    templates: [],
    subgraphs: [],
  };
}
