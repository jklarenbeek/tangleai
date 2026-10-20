/**
 * Per-model tool profiles: how large a tool call one model emits
 * reliably, stated as a budget the tool layer adapts to.
 *
 * `providers.ts` profiles the WIRE; this module profiles the MODEL,
 * because one provider serves models whose tool calls differ by an order
 * of magnitude. A tool call's arguments are generated text, and a weaker
 * model loses large ones — the reply stops at its length limit or the
 * JSON breaks. The motivating evidence is one measured task, recorded in
 * `@tangleai/jaren`'s `docs/AUTHORING.md`: authoring a compile-checked
 * stylesheet in the remeasured run, the dense `qwen3.6-27b` was correct 6
 * of 6 times and the mixture-of-experts `qwen3.6-35b-a3b` 3 of 6, and a
 * large `response_format` schema made the 35b-a3b answer EMPTY three times
 * out of three. That evidence does not rank model families, so the answer
 * here is a budget rather than a list of good and bad models: the agents
 * package's staging (`@tangleai/agents/staging`) turns any tool whose
 * typical input exceeds `maxArgumentChars` into small incremental calls.
 *
 * The tier a model gets is a HEURISTIC read off its id. It is overridable
 * wherever it is used, and the number that matters is the one a host
 * measured on its own task — these defaults are starting points, not
 * measurements:
 *
 *  1. A provider prefix is stripped (`qwen/qwen3.6-35b-a3b` →
 *     `qwen3.6-35b-a3b`) and the id lowercased.
 *  2. A mixture-of-experts id carries an active-parameter tag (`-a3b`,
 *     `-a22b`) and is classified by its ACTIVE parameters: ≤ 4B small,
 *     ≤ 12B medium, larger large. That is the case that motivates this
 *     module — a 35B model with 3B active parameters writes like a small
 *     one.
 *  3. Otherwise a size tag (`-27b`, `:4b`) gives the total parameters:
 *     under 8B tiny, under 20B small, under 40B medium, larger large.
 *  4. A hosted frontier family without a size tag (`claude…`, `gpt-4…`,
 *     `gpt-5…`, `gemini…`) is large.
 *  5. Anything else is unknown, and unknown is medium.
 *
 * So `qwen/qwen3.6-35b-a3b` is small, `qwen/qwen3.8-27b` medium and
 * `qwen3:4b` tiny. Misuse — a model id that is not a non-empty string, an
 * unknown tier, a limit that is not a positive integer — throws `AI0001`.
 */

import { AiError } from './errors.ts';

/** The tool budget tiers, smallest first. */
export type ToolTier = 'tiny' | 'small' | 'medium' | 'large' | 'unlimited';

/** How large a tool call one model is asked to emit. */
export interface ToolBudget {
  readonly tier: ToolTier;
  /** Largest JSON tool-call argument, in characters, the model emits reliably in one call (Infinity: no limit). */
  readonly maxArgumentChars: number;
  /** Most array items one append call may carry. */
  readonly maxItems: number;
  /** Offer a small catalog (list / describe / call) instead of every tool's full schema up front. */
  readonly catalog: boolean;
  /** Characters of schema one describe answer may carry. */
  readonly maxSchemaChars: number;
}

/** What a model id says about the model, and the tool budget that follows. */
export interface ModelProfile {
  /** The id as given, provider prefix included. */
  readonly model: string;
  /** The id's first segment after the provider prefix (`qwen3.6`, `claude`, `gpt`). */
  readonly family: string;
  /** Total parameters in billions, from a size tag; null when the id carries none. */
  readonly params: number | null;
  /** Parameters active per token in billions: the active tag of a mixture of experts, all of a dense model's; null when unknown. */
  readonly activeParams: number | null;
  /** Whether the id names a mixture of experts (an active-parameter tag). */
  readonly moe: boolean;
  readonly tools: ToolBudget;
}

/** Overrides for {@link modelProfile}: a tier replaces the heuristic's, and `tools` members replace the tier's. */
export interface ModelProfileOverrides {
  tier?: ToolTier;
  tools?: Partial<ToolBudget>;
}

/** One frozen budget. */
const budget = (tier: ToolTier, maxArgumentChars: number, maxItems: number, catalog: boolean, maxSchemaChars: number): ToolBudget =>
  Object.freeze({ tier, maxArgumentChars, maxItems, catalog, maxSchemaChars });

/**
 * The budget of each tier. The two small tiers are offered a catalog:
 * three small tools in place of every full schema, because a prompt that
 * carries every schema is itself a large input to a small model.
 */
export const TOOL_BUDGETS: Readonly<Record<ToolTier, ToolBudget>> = Object.freeze({
  tiny: budget('tiny', 300, 2, true, 800),
  small: budget('small', 600, 4, true, 1500),
  medium: budget('medium', 2400, 12, false, 4000),
  large: budget('large', 12000, 48, false, 16000),
  unlimited: budget('unlimited', Infinity, Infinity, false, Infinity),
});

/** The members a budget has, in declaration order — a partial naming anything else is refused. */
const BUDGET_MEMBERS: readonly string[] = Object.freeze(['tier', 'maxArgumentChars', 'maxItems', 'catalog', 'maxSchemaChars']);

/** A mixture-of-experts active-parameter tag: `-a3b`, `-a22b`, `_a3.5b`. */
const ACTIVE_TAG = /(?:^|[-_:])a(\d+(?:\.\d+)?)b(?=$|[-_:.@])/;

/** A size tag: `-27b`, `:4b`, `-1.5b-`. */
const SIZE_TAG = /(?:^|[-_:])(\d+(?:\.\d+)?)b(?=$|[-_:.@])/;

/** Hosted frontier families whose ids carry no size tag. */
const FRONTIER_FAMILIES: readonly string[] = Object.freeze(['claude', 'gpt-4', 'gpt-5', 'gemini']);

/** A value's kind, for a refusal that says what arrived. */
const kindOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/** The budget of a named tier, or `AI0001`. */
function tierBudget(tier: unknown, label: string): ToolBudget {
  if (typeof tier === 'string' && Object.hasOwn(TOOL_BUDGETS, tier)) return TOOL_BUDGETS[tier as ToolTier];
  throw new AiError('AI0001', `${label}: unknown tool tier ${typeof tier === 'string' ? `'${tier}'` : kindOf(tier)} (${Object.keys(TOOL_BUDGETS).join(', ')})`);
}

/** A limit: a positive integer, or Infinity for none. */
function limit(value: unknown, label: string): number {
  if (value === Infinity || (typeof value === 'number' && Number.isInteger(value) && value > 0)) return value;
  throw new AiError('AI0001', `${label} must be a positive integer or Infinity (got ${typeof value === 'number' ? value : kindOf(value)})`);
}

/**
 * A budget with a partial's members over a base. A `tier` in the partial
 * replaces the base with that tier's budget first, so `{ tier: 'small',
 * maxItems: 2 }` is the small tier with two items per append.
 */
function mergeBudget(base: ToolBudget, partial: unknown, label: string): ToolBudget {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial))
    throw new AiError('AI0001', `${label} must be an object of tool budget members (got ${kindOf(partial)})`);
  for (const key of Object.keys(partial)) {
    if (!BUDGET_MEMBERS.includes(key))
      throw new AiError('AI0001', `${label}: unknown tool budget member '${key}' (${BUDGET_MEMBERS.join(', ')})`);
  }
  const given = partial as Partial<Record<keyof ToolBudget, unknown>>;
  const from = given.tier === undefined ? base : tierBudget(given.tier, `${label}.tier`);
  if (given.catalog !== undefined && typeof given.catalog !== 'boolean')
    throw new AiError('AI0001', `${label}.catalog must be a boolean (got ${kindOf(given.catalog)})`);
  return budget(
    from.tier,
    given.maxArgumentChars === undefined ? from.maxArgumentChars : limit(given.maxArgumentChars, `${label}.maxArgumentChars`),
    given.maxItems === undefined ? from.maxItems : limit(given.maxItems, `${label}.maxItems`),
    given.catalog === undefined ? from.catalog : given.catalog as boolean,
    given.maxSchemaChars === undefined ? from.maxSchemaChars : limit(given.maxSchemaChars, `${label}.maxSchemaChars`),
  );
}

/** The tier a reading of an id earns (rules 2–5 of the module doc). */
function heuristicTier(name: string, params: number | null, active: number | null): ToolTier {
  if (active !== null) return active <= 4 ? 'small' : active <= 12 ? 'medium' : 'large';
  if (params !== null) return params < 8 ? 'tiny' : params < 20 ? 'small' : params < 40 ? 'medium' : 'large';
  if (FRONTIER_FAMILIES.some((family) => name.startsWith(family))) return 'large';
  return 'medium';
}

/**
 * Read a model id into a profile and the tool budget it earns. `overrides`
 * win over the heuristic: `tier` replaces the tier it would have chosen,
 * and `tools` members replace that tier's limits.
 * @example
 * modelProfile('qwen/qwen3.6-35b-a3b').tools.tier;            // 'small' — 3B active parameters
 * modelProfile('qwen/qwen3.8-27b').tools.maxArgumentChars;    // 2400 — dense 27B, medium
 * modelProfile('qwen3:4b', { tools: { maxItems: 1 } }).tools; // tiny, one item per append
 */
export function modelProfile(model: string, overrides: ModelProfileOverrides = {}): ModelProfile {
  if (typeof model !== 'string' || model.trim() === '')
    throw new AiError('AI0001', `modelProfile: model must be a non-empty model id (got ${typeof model === 'string' ? 'an empty string' : kindOf(model)})`);
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new AiError('AI0001', `modelProfile: overrides must be an object (got ${kindOf(overrides)})`);
  for (const key of Object.keys(overrides)) {
    if (key !== 'tier' && key !== 'tools') throw new AiError('AI0001', `modelProfile: unknown override '${key}' (tier, tools)`);
  }
  const id = model.trim().toLowerCase();
  const name = id.slice(id.lastIndexOf('/') + 1);
  if (name === '') throw new AiError('AI0001', `modelProfile: '${model}' names a provider but no model`);
  const family = name.split(/[-_:]/, 1)[0] || name;
  const activeTag = ACTIVE_TAG.exec(name);
  const sizeTag = SIZE_TAG.exec(name);
  const params = sizeTag === null ? null : Number(sizeTag[1]);
  const active = activeTag === null ? null : Number(activeTag[1]);
  const base = overrides.tier === undefined
    ? TOOL_BUDGETS[heuristicTier(name, params, active)]
    : tierBudget(overrides.tier, 'modelProfile: tier');
  const tools = overrides.tools === undefined ? base : mergeBudget(base, overrides.tools, 'modelProfile: tools');
  return Object.freeze({
    model,
    family,
    params,
    activeParams: active ?? params,
    moe: active !== null,
    tools,
  });
}

/**
 * The tool budget a setting asks for: `'auto'` (or nothing) is the
 * model's own, a tier name is that tier's, and a partial budget replaces
 * members of the model's own — or of the tier it names, in which case the
 * model is not consulted.
 * @example
 * resolveToolBudget('auto', 'qwen/qwen3.6-35b-a3b').tier;           // 'small'
 * resolveToolBudget('large', 'qwen3:4b').maxArgumentChars;         // 12000 — the setting wins
 * resolveToolBudget({ maxItems: 2 }, 'qwen/qwen3.8-27b').maxItems; // 2, the rest medium
 */
export function resolveToolBudget(setting: 'auto' | ToolTier | Partial<ToolBudget> | undefined, model: string): ToolBudget {
  if (setting === undefined || setting === 'auto') return modelProfile(model).tools;
  if (typeof setting === 'string') return tierBudget(setting, 'budget');
  if (setting === null || typeof setting !== 'object' || Array.isArray(setting))
    throw new AiError('AI0001', `budget must be 'auto', a tool tier or a partial tool budget (got ${kindOf(setting)})`);
  // a partial that names its tier is complete without the model
  const base = setting.tier === undefined ? modelProfile(model).tools : tierBudget(setting.tier, 'budget.tier');
  return mergeBudget(base, setting, 'budget');
}
