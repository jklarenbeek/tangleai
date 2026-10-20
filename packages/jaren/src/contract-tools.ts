/**
 * The contract toolbox: a Jaren contract's public operations as agent
 * tools, sized to the model that calls them.
 *
 * `contractTools` (`@jarenjs/contract/project`) projects every public,
 * invokable operation — never a `server`-audience one, never an opaque or
 * subscribe one — into a validated `{ name, description, inputSchema,
 * execute }`. Composing those into an agent by hand leaves three jobs to
 * every host, and this module does them once:
 *
 *  - **Pins.** Input members the HOST fixes — the seat an agent speaks
 *    for, a run id — leave the schema the model is asked to fill and are
 *    applied on every call over whatever the model sent, so a model can
 *    neither see nor forge them.
 *  - **Outcomes for a reader.** `{ ok, value }` or `{ ok: false, error:
 *    { code, message, details } }`, with `meta` reduced to the operation
 *    id: a trace, an attempt id and an entity tag are noise to a model.
 *  - **A budget per model.** `stageTools` (`@tangleai/agents/staging`)
 *    with the model's tool budget (`modelProfile`,
 *    `@tangleai/models/profile`): an operation whose input is larger than
 *    the model emits reliably in one call is built as a draft, and under a
 *    catalog budget the rest sit behind `tool_list` / `tool_describe` /
 *    `tool_call`.
 *
 * With `budget: 'unlimited'`, or with neither a model nor a budget,
 * nothing is staged: the tools are `contractTools`' own, pinned and with
 * shaped outcomes. The contract client validates every input against the
 * contract once more before anything runs, so a draft that commits
 * reaches the handler exactly as the contract states it.
 */

import { contractTools } from '@jarenjs/contract/project';
import { isOutcome } from '@jarenjs/contract/client';
import type { Contract } from '@jarenjs/contract';
import { cloneJson, isJsonValue } from '@jarenjs/core/object';
import { resolveSameDocumentRef } from '@jarenjs/validate/normalize';
import { AiError } from '@tangleai/models/errors';
import { modelProfile, resolveToolBudget, TOOL_BUDGETS } from '@tangleai/models/profile';
import type { ModelProfile, ToolBudget, ToolTier } from '@tangleai/models/profile';
import { stageTools } from '@tangleai/agents/staging';
import type { StagedTools } from '@tangleai/agents/staging';
import { createToolbox } from '@tangleai/agents/toolbox';
import type { ToolDef } from '@tangleai/agents/toolbox';

/** A compiled `$contract` document (`compileContract` from `@jarenjs/contract`). */
export type CompiledContract = Contract;

/**
 * A client opened on the same contract: `openLocalClient`,
 * `openHttpClient`, or any binding's. `invoke` is a method so that a
 * client narrowing its operation ids still assigns.
 */
export type ContractClient = { invoke(op: string, input: unknown, ctx?: unknown): unknown };

export interface ContractToolboxOptions {
  /** The model that will call the tools; resolves the budget through `modelProfile` when `budget` is 'auto' or omitted. */
  model?: string;
  /** 'auto' (the default): the model's own budget, or none without a model; a tier; or a partial budget over the model's (or over the tier it names). */
  budget?: 'auto' | ToolTier | Partial<ToolBudget>;
  /** The tool name of an operation id (default: the id with '.' → '_'). */
  name?: (id: string) => string;
  /** The operations to offer (default: every public, invokable one). */
  ops?: readonly string[];
  /** Prefix of the draft and catalog tool names. */
  prefix?: string;
  /**
   * Input members the HOST fixes (e.g. `{ by: 'oracle' }`): applied to
   * every operation whose input declares that member, over whatever the
   * model sent, and removed from the schema the model is asked to fill.
   */
  pin?: Readonly<Record<string, unknown>>;
  /** Most drafts open at once (default 8). */
  maxDrafts?: number;
}

export interface ContractToolbox extends StagedTools {
  /** The budget the tools were staged under. */
  readonly budget: ToolBudget;
  /** The model's profile, or null when no model was given. */
  readonly profile: ModelProfile | null;
  /** Call one of `tools` by name, validated as a toolbox validates it. */
  execute(name: string, args: unknown): Promise<unknown>;
}

const OPTIONS: readonly string[] = Object.freeze(['model', 'budget', 'name', 'ops', 'prefix', 'pin', 'maxDrafts']);

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `contractTools`' own default name: the id with `.` → `_`. */
const defaultName = (id: string) => id.replaceAll('.', '_');

/** The pins, checked: an object of JSON values. */
function pinsOf(pin: unknown): Readonly<Record<string, unknown>> {
  if (pin === undefined) return {};
  if (!isObject(pin)) throw new AiError('AI0001', 'createContractToolbox: pin must be an object of input members and their values');
  for (const [key, value] of Object.entries(pin)) {
    if (value === undefined || !isJsonValue(value)) throw new AiError('AI0001', `createContractToolbox: pin '${key}' must be a JSON value`);
  }
  return pin;
}

/**
 * The input schema without the pinned members — out of `properties` and
 * `required`, so the model is never asked for them. When the members sit
 * behind the root's `$ref`, the object they live in becomes the root,
 * beside the bundled `$defs` the rest of it still reaches.
 */
function withoutMembers(schema: any, keys: readonly string[]): any {
  let target = schema;
  for (let hops = 0; isObject(target) && !isObject(target.properties) && typeof target.$ref === 'string' && hops < 16; hops++) {
    target = resolveSameDocumentRef(target.$ref, schema);
  }
  if (!isObject(target) || !isObject(target.properties)) return schema;
  const { properties, required, ...rest } = target;
  const kept = Array.isArray(required) ? required.filter((key: unknown) => !keys.includes(key as string)) : [];
  const object: Record<string, any> = {
    ...rest,
    properties: Object.fromEntries(Object.entries(properties).filter(([key]) => !keys.includes(key))),
    ...(kept.length > 0 ? { required: kept } : {}),
  };
  if (target === schema) return object;
  return {
    ...object,
    ...(isObject(schema.$defs) ? { $defs: { ...schema.$defs, ...object.$defs } } : {}),
    ...(isObject(schema.definitions) ? { definitions: { ...schema.definitions, ...object.definitions } } : {}),
  };
}

/**
 * An outcome as a model reads it: the value, or the error's code, message
 * and details, and the operation it came from. Anything that is not an
 * outcome passes through unchanged.
 */
function shapeOutcome(result: unknown): unknown {
  if (!isOutcome(result)) return result;
  const meta = { op: result.meta.op };
  return result.ok
    ? { ok: true, value: result.value, meta }
    : { ok: false, error: { code: result.error.code, message: result.error.message, details: result.error.details ?? null }, meta };
}

/**
 * The public operations of a contract as agent tools for one model: the
 * `contractTools` projection, pinned, with outcomes shaped for a model and
 * staged under the model's tool budget.
 * @example
 * const tools = createContractToolbox(contract, client, { model: 'qwen/qwen3.6-35b-a3b', pin: { by: 'oracle' } });
 * const toolbox = createToolbox();
 * for (const tool of tools.tools) toolbox.add(tool);
 * const agent = createAgent({ client: chat, toolbox });
 */
export function createContractToolbox(contract: CompiledContract, client: ContractClient, options: ContractToolboxOptions = {}): ContractToolbox {
  if (!isObject(options)) throw new AiError('AI0001', 'createContractToolbox: options must be an object');
  for (const key of Object.keys(options)) {
    if (!OPTIONS.includes(key)) throw new AiError('AI0001', `createContractToolbox: unknown option '${key}' (${OPTIONS.join(', ')})`);
  }
  if (options.name !== undefined && typeof options.name !== 'function') {
    throw new AiError('AI0001', 'createContractToolbox: name must be a function (id) => string');
  }
  const profile = options.model === undefined ? null : modelProfile(options.model);
  const setting = options.budget ?? 'auto';
  if (profile === null && isObject(setting) && setting.tier === undefined) {
    throw new AiError('AI0001', 'createContractToolbox: a partial budget without a tier completes the model\'s own budget — pass model, or name a tier');
  }
  const budget = setting === 'auto'
    ? profile?.tools ?? TOOL_BUDGETS.unlimited
    : resolveToolBudget(setting, options.model ?? '');
  const pins = pinsOf(options.pin);

  const nameOf = options.name ?? defaultName;
  const ids = new Map<string, string>();
  const projected = contractTools(contract, client, {
    ...(options.ops === undefined ? {} : { ops: options.ops }),
    name: (id: string) => {
      const name = nameOf(id);
      ids.set(name, id);
      return name;
    },
  });

  const pinned = new Set<string>();
  const tools: ToolDef[] = projected.map((tool) => {
    const members = contract.operations[ids.get(tool.name) as string]?.input?.effective?.properties;
    const fixed = Object.keys(pins).filter((key) => isObject(members) && Object.hasOwn(members, key));
    for (const key of fixed) pinned.add(key);
    const values = Object.fromEntries(fixed.map((key) => [key, pins[key]]));
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: fixed.length === 0 ? tool.inputSchema : withoutMembers(tool.inputSchema, fixed),
      execute: (args: any) => Promise.resolve(tool.execute(fixed.length === 0
        ? args
        : { ...(isObject(args) ? args : {}), ...cloneJson(values) })).then(shapeOutcome),
    };
  });
  const unused = Object.keys(pins).filter((key) => !pinned.has(key));
  if (unused.length > 0) {
    throw new AiError('AI0001', `createContractToolbox: no offered operation declares the pinned member${unused.length > 1 ? 's' : ''} ${unused.map((key) => `'${key}'`).join(', ')}`);
  }

  const staged = stageTools(tools, {
    budget,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    ...(options.maxDrafts === undefined ? {} : { maxDrafts: options.maxDrafts }),
  });
  const toolbox = createToolbox();
  for (const tool of staged.tools) toolbox.add(tool);
  return {
    tools: staged.tools,
    direct: staged.direct,
    staged: staged.staged,
    drafts: staged.drafts,
    budget,
    profile,
    execute: async (name: string, args: unknown) => toolbox.execute(name, args),
  };
}
