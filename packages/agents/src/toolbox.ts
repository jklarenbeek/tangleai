/**
 * The toolbox: a registry of tools an AI may call, each declared with
 * a JSON Schema `inputSchema` that Jaren itself compiles and enforces
 * before the tool runs — the suite guarding its own tools. One
 * registry serves every surface that wants to drive the host app:
 *
 *  - an embedded agent loop (`toFunctionTools()` produces the OpenAI
 *    function-calling definitions, `execute()` dispatches a call);
 *  - a browser-hosted agent over WebMCP (`registerModelContext()`
 *    publishes the same tools on either browser model-context root).
 *
 * `execute` never throws for content-level problems: an unknown tool
 * or a throwing tool comes back as `{ error }`, invalid input as
 * `{ error, errors, inputSchema }` plus a `hint` where the model sent
 * JSON-encoded text for a structured property — results the calling
 * model can read and recover from. Those words come from `messages`,
 * English by default, so a host whose model works in another language
 * gives them in that language.
 *
 * A tool runs as `execute(input, context)`: `context.signal` is the
 * caller's abort signal (an agent passes its send's), and
 * `context.context` whatever the host attached to the call. Jaren's
 * contract tools read the same `signal`, so a stopped run stops them too.
 */

import { JarenValidator } from '@jarenjs/validate';
import { registerWebMcp } from '@jarenjs/contract/webmcp';
import { contractTools, type ContractToolsOptions } from '@jarenjs/contract/project';

import { checkOutcome } from '@jarenjs/core/check';
import { invalidInput } from '@tangleai/models/check';
import { AiError } from '@tangleai/models/errors';

/** The words a toolbox answers a model with, when a call cannot run. */
export type ToolboxMessages = {
  unknownTool: (name: string) => string;
  invalidInput: (name: string) => string;
  /** For the properties that arrived as JSON text that does not parse. */
  hint: (properties: string[]) => string;
};

export const TOOLBOX_MESSAGES: ToolboxMessages = Object.freeze({
  unknownTool: (name: string) => `unknown tool '${name}'`,
  invalidInput: (name: string) => `invalid input for ${name}`,
  hint: (properties: string[]) => `${properties.map((k) => `'${k}'`).join(', ')} arrived as a JSON-encoded string that does not parse — pass a real JSON value, not quoted JSON text`,
});

/** What a tool's `execute` receives beside its input. */
export type ToolContext = {
  signal?: AbortSignal;
  context?: unknown;
};

/** Whether a property schema asks for structure (object or array). */
function wantsStructure(schema: any) {
  const type = schema?.type;
  return type === 'object' || type === 'array'
    || (Array.isArray(type) && (type.includes('object') || type.includes('array')));
}

/**
 * The top-level properties that wanted structure but arrived as
 * strings — after coercion failed, these are what went wrong.
 */
function stringStructureKeys(inputSchema: any, input: any): string[] {
  const properties = inputSchema?.properties;
  if (properties == null || input === null || typeof input !== 'object') return [];
  return Object.entries(properties)
    .filter(([key, schema]) => wantsStructure(schema) && typeof input[key] === 'string')
    .map(([key]) => key);
}

/**
 * A copy of `input` with string-valued top-level properties parsed as
 * JSON wherever the schema wants an object or array — or `null` when
 * nothing was coercible.
 */
function coerceStringArguments(inputSchema: any, input: any): any | null {
  const properties = inputSchema?.properties;
  if (properties == null || input === null || typeof input !== 'object') return null;
  let coerced: any = null;
  for (const [key, schema] of Object.entries(properties)) {
    if (!wantsStructure(schema) || typeof input[key] !== 'string') continue;
    try {
      const parsed = JSON.parse(input[key]);
      if (parsed !== null && typeof parsed === 'object') {
        if (coerced === null) coerced = { ...input };
        coerced[key] = parsed;
      }
    }
    catch {
      // not JSON text: keep the original so validation reports it
    }
  }
  return coerced;
}

/**
 * @param [options] - a shared JarenValidator, if
 *   the host already has one
 */
export function createToolbox(options: {
  validator?: any;
  messages?: Partial<ToolboxMessages>;
} = {}): {
  /** Register a tool; a name already registered throws unless `replace` says so. */
  add: (def: ToolDef, options?: { replace?: boolean }) => void;
  list: () => {
    name: string;
    description: string;
    inputSchema: any;
  }[];
  toFunctionTools: () => any[];
  execute: (name: string, args: any, context?: ToolContext) => any;
} {
  const jaren = options.validator ?? new JarenValidator({ skipErrors: false, collectErrors: true });
  const words = { ...TOOLBOX_MESSAGES, ...options.messages };
  const localized = options.messages !== undefined;

  const tools: Map<string, ToolDef & {
    check: (input: any) => any;
  }> = new Map();

  /**
   * @param def
   * @param [how] - `replace: true` replaces a tool of the same name; without it
   *   a second registration is a mistake that would silently swap behaviour
   */
  function add(def: ToolDef, how: { replace?: boolean } = {}) {
    if (tools.has(def.name) && how.replace !== true)
      throw new AiError('AI0001', `a tool named '${def.name}' is already registered; pass { replace: true } to replace it`);
    tools.set(def.name, { ...def, check: jaren.compile(def.inputSchema) });
  }

  function list() {
    return [...tools.values()].map(({ name, description, inputSchema }) =>
      ({ name, description, inputSchema }));
  }

  function toFunctionTools() {
    return [...tools.values()].map(({ name, description, inputSchema }) => ({
      type: 'function',
      function: { name, description, parameters: inputSchema },
    }));
  }

  /**
   * Dispatch one call. Synchronous tools answer synchronously (WebMCP
   * hosts call `execute` directly); a promise-returning tool resolves
   * to its value with rejections folded into `{ error }`. A rejected
   * call answers `{ error, errors, inputSchema }` — the first
   * `MAX_INPUT_ERRORS` validation errors plus the schema to re-read —
   * with a `hint` added when a property wanting structure arrived as
   * unparseable JSON text.
   */
  function execute(name: string, args: any, context: ToolContext = {}) {
    const tool = tools.get(name);
    if (tool === undefined) return { error: words.unknownTool(name) };
    let input = args ?? {};
    let outcome = checkOutcome(tool.check(input));
    if (!outcome.valid) {
      // models routinely JSON-encode nested arguments; when a property
      // wanted structure but arrived as parseable JSON text, validate
      // the parsed value instead — valid or not, its errors point into
      // the structure the model meant to send
      const coerced = coerceStringArguments(tool.inputSchema, input);
      if (coerced !== null) {
        input = coerced;
        outcome = checkOutcome(tool.check(coerced));
      }
    }
    if (!outcome.valid) {
      const stringly = stringStructureKeys(tool.inputSchema, input);
      const rejected = invalidInput(name, outcome, tool.inputSchema,
        stringly.length === 0 ? {} : { hint: words.hint(stringly) });
      return localized ? { ...rejected, error: words.invalidInput(name) } : rejected;
    }
    try {
      const value = tool.execute(input, context);
      return typeof value?.then === 'function'
        ? value.then((resolved: any) => resolved, (err: any) =>
          ({ error: err?.message ?? String(err) }))
        : value;
    }
    catch (err: any) {
      return { error: (err as any)?.message ?? String(err) };
    }
  }

  return { add, list, toFunctionTools, execute };
}

/**
 * Publish validated tools through the shared browser adapter. Await `ready`
 * for completion and call `dispose` when the host leaves. The optional context
 * remains the second argument; undefined requests automatic discovery.
 * @param [modelContext]
 * @param [onError]
 * @param [options]
 */
export function registerModelContext(toolbox: ReturnType<typeof createToolbox>, modelContext?: unknown, onError?: (error: unknown) => void, options: Omit<import('@jarenjs/contract/webmcp').WebMcpOptions, 'context' | 'onError'> = {}) {
  return registerWebMcp(toolbox.list().map(def => ({
    ...def,
    execute: (args: any) => toolbox.execute(def.name, args),
  })), { ...options, ...(modelContext === undefined ? {} : { context: modelContext }), onError });
}

/**
 * A toolbox of a contract's operations for a model, with the members the
 * host owns kept out of the model's reach. `bind` names input members the
 * host supplies — a value, or a function of the call's `context.context` —
 * which are removed from every tool's `inputSchema` (so the model neither
 * sees nor can send them) and injected on `execute`; `mapOutcome` turns an
 * operation's outcome into what the model reads. `ops`, `audiences` and
 * `name` are Jaren's `contractTools` options, which refuse two operations
 * under one tool name; `toolbox` adds into an existing toolbox, where a name
 * it already holds throws.
 */
export function toolboxFromContract(contract: any, client: any, options: Omit<ContractToolsOptions, never> & {
  bind?: Record<string, unknown>;
  mapOutcome?: (outcome: any, call: { name: string; input: any }) => any;
  toolbox?: ReturnType<typeof createToolbox>;
  messages?: Partial<ToolboxMessages>;
} = {}): ReturnType<typeof createToolbox> {
  const { bind = {}, mapOutcome, toolbox, messages, ...selection } = options;
  const bound = Object.keys(bind);
  const target = toolbox ?? createToolbox(messages === undefined ? {} : { messages });
  for (const tool of contractTools(contract, client, selection)) {
    const inputSchema = structuredClone(tool.inputSchema);
    if (bound.length > 0 && inputSchema?.properties !== undefined) {
      for (const member of bound) delete inputSchema.properties[member];
      if (Array.isArray(inputSchema.required)) inputSchema.required = inputSchema.required.filter((member: string) => !bound.includes(member));
    }
    target.add({
      name: tool.name,
      description: tool.description,
      inputSchema,
      execute: async (input: any, context: ToolContext = {}) => {
        const injected = Object.fromEntries(bound.map((member) => {
          const value = bind[member];
          return [member, typeof value === 'function' ? value(context.context) : value];
        }));
        const outcome = await tool.execute({ ...input, ...injected }, context);
        return mapOutcome === undefined ? outcome : mapOutcome(outcome, { name: tool.name, input });
      },
    });
  }
  return target;
}

export type ToolDef = {
  name: string; description: string; /**
 * - JSON Schema for the arguments object
 */
  inputSchema: any; /**
 * - may return a value or a promise; `context` carries the caller's signal
 * and the host's call context
 */
  execute: (input: any, context?: ToolContext) => any;
};
