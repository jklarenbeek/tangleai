/**
 * The effective toolbox — suite validation, host handlers, honored keys.
 *
 * Tools are built through `createToolbox` (the one schema-checking
 * dispatcher; no second parser exists here): the model sees only the
 * node's requested, host-intersected declarations, input refusals and
 * thrown handlers stay the toolbox's readable result shape and appear
 * in the agent's step record, and the wrapped host handler receives the
 * current node's abort signal plus — for an effectful tool — the
 * semantic idempotency key OUT OF BAND from a closure, never from
 * model-authored arguments. A tool registered effectful whose binding
 * cannot honor a key is refused at bind time, and a success whose
 * durable outcome is unknown raises the uncertainty value, never a
 * silent retry.
 */

import { createToolbox } from '@jarenjs/ai';

import { masIssue, type MasIssue, type MasValidated } from './errors.ts';
import type { MasRegistry, ToolStep } from './contracts.gen.ts';

export interface MasToolBinding {
  /** The host handler; result must be JSON-shaped. */
  handler: (input: unknown, context: { signal: AbortSignal, idempotencyKey: string | null }) => unknown | Promise<unknown>;
  /** Required for an effectful tool: the handler honors the out-of-band key. */
  idempotency?: 'honored';
}

/** An external success whose local commit is unknown — never auto-repeated. */
export class MasUncertainEffect extends Error {
  toolName: string;
  constructor(toolName: string, message: string) {
    super(message);
    this.toolName = toolName;
  }
}

export interface EffectiveToolbox {
  toolbox: {
    toFunctionTools: () => unknown[],
    execute: (name: string, args: unknown) => unknown,
    list: () => Array<{ name: string, description: string, inputSchema: unknown }>,
  } | null;
  /**
   * The out-of-band uncertainty box: the suite toolbox deliberately turns
   * handler rejections into readable result values, so an uncertain
   * external success is recorded here and the node lifecycle stops on it
   * after the loop — the model sees a readable error, the node still
   * refuses to complete.
   */
  uncertainty: { value: MasUncertainEffect | null };
}

export interface BuildToolboxOptions {
  registry: MasRegistry;
  requested: readonly string[];
  bindings: Record<string, MasToolBinding>;
  signal: AbortSignal;
  /** The node's semantic idempotency key, suffixed per call for effectful tools. */
  idempotencyKeyFor: (tool: string, callIndex: number) => string;
}

/** Validate bindings against the pinned snapshot; a mismatch refuses at bind time. */
export function validateToolBindings(
  registry: MasRegistry,
  requested: readonly string[],
  bindings: Record<string, MasToolBinding>,
): MasValidated<true> {
  const declared = new Map(registry.tools.map((tool) => [tool.id, tool]));
  const issues: MasIssue[] = [];
  for (const [index, id] of requested.entries()) {
    const tool = declared.get(id);
    if (tool === undefined) {
      issues.push(masIssue('TMAS1009', `/tools/${index}`, `'${id}' names no registry tool`));
      continue;
    }
    const binding = bindings[id];
    if (binding === undefined) {
      issues.push(masIssue('TMAS1009', `/tools/${index}`, `'${id}' has no host binding`));
      continue;
    }
    if (tool.effect === 'effectful' && binding.idempotency !== 'honored') {
      issues.push(masIssue('TMAS1009', `/tools/${index}`, `'${id}' is effectful but its host binding does not honor an idempotency key; it cannot bind`));
    }
  }
  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, value: true };
}

export function buildEffectiveToolbox(options: BuildToolboxOptions): MasValidated<EffectiveToolbox> {
  const bound = validateToolBindings(options.registry, options.requested, options.bindings);
  if (!bound.valid) return bound;
  const uncertainty: EffectiveToolbox['uncertainty'] = { value: null };
  if (options.requested.length === 0) {
    return { valid: true, value: { toolbox: null, uncertainty } };
  }
  const declared = new Map(options.registry.tools.map((tool) => [tool.id, tool]));
  const toolbox = createToolbox();
  let dispatched = 0;
  for (const id of options.requested) {
    const tool = declared.get(id) as MasRegistry['tools'][number];
    const binding = options.bindings[id];
    toolbox.add({
      name: tool.id,
      description: tool.title,
      inputSchema: tool.input as Record<string, unknown>,
      execute: async (input: unknown) => {
        dispatched += 1;
        if (options.signal.aborted) {
          return { error: 'the shared abort signal was raised before the tool ran' };
        }
        const key = tool.effect === 'effectful' ? options.idempotencyKeyFor(tool.id, dispatched) : null;
        try {
          return await binding.handler(input, { signal: options.signal, idempotencyKey: key });
        } catch (error) {
          if (error instanceof MasUncertainEffect) {
            uncertainty.value = error;
            return { error: `uncertain: ${error.message}` };
          }
          return { error: (error as Error).message ?? String(error) };
        }
      },
    });
  }
  return { valid: true, value: { toolbox, uncertainty } };
}

/**
 * Classify the agent's own step records into bounded attempt tool
 * steps: the toolbox's readable refusal shapes stay visible, exactly as
 * the model saw them.
 */
export function classifyToolSteps(
  steps: ReadonlyArray<{ name: string, arguments: string, result: unknown }>,
  maxChars = 2000,
): ToolStep[] {
  return steps.map((step) => {
    const result = step.result as { error?: string, errors?: unknown[] } | null;
    let state: ToolStep['state'] = 'ok';
    if (result !== null && typeof result === 'object' && typeof result.error === 'string') {
      state = Array.isArray(result.errors) ? 'invalid-input' : 'handler-error';
      if (result.error.includes('abort signal')) state = 'aborted';
    }
    const bounded = (value: string): ToolStep['arguments'] => ({
      state: value.length > maxChars ? 'truncated' : 'retained',
      text: value.slice(0, maxChars),
      size: value.length,
      artifact: null,
    });
    return {
      name: step.name,
      arguments: bounded(step.arguments),
      result: bounded(JSON.stringify(step.result ?? null)),
      state,
    };
  });
}
