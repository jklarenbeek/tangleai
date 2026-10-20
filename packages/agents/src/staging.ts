/**
 * Staged tool calls: a tool whose typical input is larger than a model's
 * tool budget is offered as a DRAFT that the model builds in small calls
 * and commits once — for any `ToolDef`, not only contract operations.
 *
 * A tool call's arguments are generated text. A model that cannot emit a
 * 2,000-character argument in one piece — the reply stops at its length
 * limit, or the JSON breaks part-way — never reaches the validator at
 * all, so no repair round can help it. Reading the schema is not the
 * problem; emitting the value at once is. Staging keeps the schema and
 * shrinks the unit the model emits:
 *
 *   draft_open    { tool, value? }        → { draft, tool, missing, budget, hint }
 *   draft_set     { draft, path, value }  → { ok, path, missing, size }
 *   draft_append  { draft, path, items }  → { ok, path, length, missing, size }
 *   draft_view    { draft, path? }        → { value, truncated, size, next? }
 *   draft_commit  { draft }               → the tool's own answer, or the errors (the draft is kept)
 *   draft_discard { draft }               → { ok, discarded }
 *
 * A `path` is a JSON Pointer into the tool's input. Every call is held to
 * the budget — `maxArgumentChars` per value, `maxItems` per append — and a
 * value over it is refused with the paths to set instead. A value is
 * checked against the sub-schema at its path whenever that sub-schema can
 * be found without choosing a branch (properties, patternProperties,
 * additionalProperties, items, prefixItems, `$ref`s into `$defs`); past a
 * `oneOf`, `anyOf` or `allOf` the check waits for the commit, which
 * validates the whole input against the tool's own `inputSchema` with the
 * validator the toolbox uses, and runs the tool only if it passes.
 *
 * With `budget.catalog` the direct tools are not listed one by one either:
 * `tool_list`, `tool_describe` and `tool_call` stand in for them, so a
 * small model's prompt carries three short definitions instead of every
 * schema. Without it, the staged tools' schemas travel in full in
 * `draft_open`'s description — what `catalog: false` means: every tool's
 * full schema up front.
 *
 * Every `execute` resolves to plain JSON and never throws; a refusal is
 * `{ error, … }` naming the path and what to do next. Misuse of
 * `stageTools` itself — a malformed budget, an invalid or duplicate tool
 * name — throws `AI0001`.
 */

import { JarenValidator } from '@jarenjs/validate';
import { collectSameDocumentAnchors, resolveSameDocumentRef } from '@jarenjs/validate/normalize';
import { checkOutcome } from '@jarenjs/core/check';
import { excerpt } from '@jarenjs/core/chunk';
import { cloneJson, isJsonValue, setObjectMember } from '@jarenjs/core/object';
import { AiError } from '@tangleai/models/errors';
import { invalidInput } from '@tangleai/models/check';
import type { ToolBudget } from '@tangleai/models/profile';
import { createToolbox } from './toolbox.ts';
import type { ToolDef } from './toolbox.ts';

/** A schema compiler of the kind `createToolbox` takes: a `JarenValidator`, or anything with its `compile`. */
export type SchemaCompiler = { compile(schema: any): (value: any) => any };

export interface StageOptions {
  /** The model's tool budget: `modelProfile(model).tools` or `resolveToolBudget(setting, model)`. */
  budget: ToolBudget;
  /** Prepended to every draft and catalog tool name (default ''). */
  prefix?: string;
  /** Most drafts open at once (default 8). */
  maxDrafts?: number;
  /** A shared validator, as `createToolbox` takes it. */
  validator?: SchemaCompiler;
}

/** One open draft, as `drafts()` reports it. */
export interface DraftSummary {
  readonly draft: string;
  readonly tool: string;
  /** Characters of the draft's input so far. */
  readonly size: number;
  /** JSON Pointers of required members still unset (at most twelve). */
  readonly missing: string[];
}

export interface StagedTools {
  /** The tools to register: direct tools (or the catalog), then the draft protocol when anything is staged. */
  readonly tools: ToolDef[];
  /** The input tools offered whole, in order. */
  readonly direct: readonly string[];
  /** The input tools built as drafts, in order. */
  readonly staged: readonly string[];
  drafts(): ReadonlyArray<DraftSummary>;
}

/** OpenAI's function-name constraint, which WebMCP tool names satisfy too. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Open drafts kept at once unless the host says otherwise. */
const DEFAULT_MAX_DRAFTS = 8;

/** Required-but-unset pointers one answer lists; later answers list the rest as these are set. */
const MAX_MISSING = 12;

/** Child paths an oversize refusal names to set one by one. */
const MAX_SPLIT_PATHS = 6;

/** Child paths a view or describe answer lists to page or drill into. */
const MAX_NEXT_PATHS = 24;

/** Characters of a tool description `tool_list` keeps. */
const LIST_DESCRIPTION_CHARS = 160;

/** `$ref` hops followed before a reference chain counts as unresolvable. */
const MAX_REF_HOPS = 16;

/** Keywords past which the sub-schema of a child depends on a branch. */
const BRANCHING: readonly string[] = Object.freeze(['oneOf', 'anyOf', 'allOf']);

/** The sizes `estimateArgumentChars` assumes when a schema says nothing narrower. */
const STRING_CHARS = 12;
const NUMBER_CHARS = 4;
const ARRAY_ITEMS = 3;
const KEY_CHARS = 8;

/** Nesting levels estimated before a subtree counts as an empty container — what cuts a recursive schema. */
const ESTIMATE_DEPTH = 8;

/** Typical lengths of the common string formats. */
const FORMAT_CHARS: Readonly<Record<string, number>> = Object.freeze({
  'date-time': 24, date: 10, time: 8, duration: 8, uuid: 36, email: 20, hostname: 16,
  ipv4: 15, ipv6: 39, uri: 32, 'uri-reference': 32, iri: 32, url: 32,
});

type SchemaNode = any;
type Refusal = { error: string; [member: string]: unknown };
type Check = (value: unknown) => unknown;

/** A schema document with its `$anchor` map, the scope a same-document `$ref` resolves in. */
interface Scope {
  readonly root: SchemaNode;
  readonly anchors: Map<string, object>;
}

/** One input tool, as staging sees it. */
interface Entry {
  readonly def: ToolDef;
  readonly staged: boolean;
  readonly size: 'none' | 'small' | 'large';
  readonly scope: Scope;
}

/** A staged tool, with the checks its drafts run. */
interface StagedEntry extends Entry {
  /** The tool's whole input schema, compiled once: what a commit runs. */
  readonly check: Check;
  /** The check of a sub-schema, or null when there is nothing to check before the commit. */
  readonly leafCheck: (leaf: SchemaNode) => Check | null;
}

interface Draft {
  readonly id: string;
  readonly entry: StagedEntry;
  value: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Characters a value costs as a tool-call argument: its JSON text, quotes and escapes included. */
const jsonChars = (value: unknown): number => JSON.stringify(value ?? null)?.length ?? 4;

/** A value reduced to JSON, as it would arrive in a parsed tool call. */
const toJson = (value: unknown): any => JSON.parse(JSON.stringify(value ?? null) ?? 'null');

const isIndex = (token: string | undefined) => token !== undefined && /^(?:0|[1-9]\d*)$/.test(token);

/** A JSON Pointer from reference tokens (RFC 6901 escaping). */
const pointerOf = (tokens: readonly string[]) =>
  tokens.map((token) => `/${token.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');

/** A value's kind, for a refusal that says what is there. */
const kindOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'an array' : isObject(value) ? 'an object' : `a ${typeof value}`);

/** A budget limit as JSON: an unlimited one is `null`. */
const finite = (limit: number) => (Number.isFinite(limit) ? limit : null);

/** The first sentence of a description, cut to a list line. */
const firstSentence = (text: unknown) => excerpt(String(text ?? '').split(/(?<=[.!?])\s/, 1)[0], LIST_DESCRIPTION_CHARS);

const scopeOf = (root: SchemaNode): Scope => ({
  root,
  anchors: isObject(root) ? collectSameDocumentAnchors(root) : new Map(),
});

/**
 * The reference tokens of a JSON Pointer path, or the refusal a model can
 * act on. The empty pointer is the whole input, which only a read may name.
 */
function pathTokens(path: unknown, allowRoot: boolean): string[] | Refusal {
  if (typeof path !== 'string') return { error: 'path must be a JSON Pointer string, e.g. "/notes/0/title"' };
  if (path === '') {
    return allowRoot ? [] : { error: 'path "" is the whole input: set its members one by one, e.g. "/title"' };
  }
  if (!path.startsWith('/')) return { error: `path '${path}' is not a JSON Pointer: start it with '/', e.g. '/${path}'` };
  const raw = path.slice(1).split('/');
  if (raw.some((token) => /~(?![01])/.test(token))) return { error: `path '${path}' has a '~' that is neither ~0 nor ~1` };
  return raw.map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

//#region schemas: estimate and navigate

/** Follow a `$ref` chain within the scope; undefined when it leaves the document or does not end. */
function deref(node: SchemaNode, scope: Scope): SchemaNode | undefined {
  let current = node;
  for (let hops = 0; isObject(current) && typeof current.$ref === 'string'; hops++) {
    if (hops >= MAX_REF_HOPS) return undefined;
    current = resolveSameDocumentRef(current.$ref, scope.root, scope.anchors);
  }
  return current;
}

const isArraySchema = (node: Record<string, any>) => node.type === 'array'
  || (Array.isArray(node.type) && node.type.includes('array'))
  || 'items' in node || 'prefixItems' in node;

/**
 * The schema a child of an instance of `node` answers to: `true` when
 * anything goes, `false` when nothing may be there, and undefined when
 * finding it would mean choosing a branch or following a reference out of
 * the document. Descending through `properties`, a single matching
 * `patternProperties` entry or `additionalProperties` never checks a
 * value more strictly than the whole schema does, so a refusal it causes
 * is one the commit would make too.
 */
function childSchema(node: SchemaNode, token: string, scope: Scope): SchemaNode | undefined {
  const schema = deref(node, scope);
  if (schema === undefined || typeof schema === 'boolean') return schema;
  if (!isObject(schema) || BRANCHING.some((keyword) => keyword in schema)) return undefined;
  if (isIndex(token) && isArraySchema(schema)) {
    const index = Number(token);
    const tuple = Array.isArray(schema.prefixItems) ? schema.prefixItems : Array.isArray(schema.items) ? schema.items : null;
    if (tuple === null) return schema.items ?? true;
    if (index < tuple.length) return tuple[index];
    return Array.isArray(schema.items) ? schema.additionalItems ?? true : schema.items ?? true;
  }
  if (isObject(schema.properties) && Object.hasOwn(schema.properties, token)) return schema.properties[token];
  if (isObject(schema.patternProperties)) {
    const matching: SchemaNode[] = [];
    for (const [pattern, child] of Object.entries(schema.patternProperties)) {
      let expression: RegExp;
      try {
        expression = new RegExp(pattern, 'u');
      }
      catch {
        return undefined;
      }
      if (expression.test(token)) matching.push(child);
    }
    if (matching.length > 1) return undefined;
    if (matching.length === 1) return matching[0];
  }
  if ('additionalProperties' in schema) return schema.additionalProperties;
  if ('unevaluatedProperties' in schema) return schema.unevaluatedProperties;
  return true;
}

/** The sub-schema at concrete reference tokens, or undefined when it cannot be found without choosing. */
function schemaAt(scope: Scope, tokens: readonly string[]): SchemaNode | undefined {
  let node: SchemaNode | undefined = scope.root;
  for (const token of tokens) {
    node = childSchema(node, token, scope);
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * The paths a describe answer offers to drill into: each declared member
 * of an object schema, the first item of an array schema.
 */
function schemaChildren(node: SchemaNode, tokens: readonly string[]): string[] {
  if (!isObject(node) || BRANCHING.some((keyword) => keyword in node)) return [];
  if (isArraySchema(node)) {
    const tuple = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : [];
    const count = Math.max(1, tuple.length);
    return Array.from({ length: count }, (_, index) => pointerOf([...tokens, String(index)]));
  }
  return isObject(node.properties) ? Object.keys(node.properties).map((key) => pointerOf([...tokens, key])) : [];
}

/** Whether every reference in a schema points into its own `$defs` (or `definitions`): the sub-schemas can then be checked on their own. */
function referencesStayInDefs(schema: SchemaNode): boolean {
  const pending: unknown[] = [schema];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) pending.push(...node);
    else if (isObject(node)) {
      if (typeof node.$id === 'string' && node !== schema) return false;
      if (typeof node.$ref === 'string' && !/^#\/(?:\$defs|definitions)\//.test(node.$ref)) return false;
      if (typeof node.$dynamicRef === 'string' || typeof node.$recursiveRef === 'string') return false;
      pending.push(...Object.values(node));
    }
  }
  return true;
}

/** A sub-schema made checkable on its own: the document's `$defs` travel beside it. */
function withDefs(leaf: Record<string, any>, root: SchemaNode): Record<string, any> {
  if (!isObject(root)) return leaf;
  return {
    ...leaf,
    ...(isObject(root.$defs) ? { $defs: { ...root.$defs, ...leaf.$defs } } : {}),
    ...(isObject(root.definitions) ? { definitions: { ...root.definitions, ...leaf.definitions } } : {}),
  };
}

/** The declared types of a schema, or the type its keywords imply. */
function typesOf(node: Record<string, any>): string[] {
  if (typeof node.type === 'string') return [node.type];
  if (Array.isArray(node.type)) {
    const types = node.type.filter((type: unknown) => typeof type === 'string' && type !== 'null');
    return types.length > 0 ? types : node.type.filter((type: unknown) => typeof type === 'string');
  }
  if (['properties', 'additionalProperties', 'patternProperties', 'required', 'minProperties'].some((k) => k in node)) return ['object'];
  if (['items', 'prefixItems', 'minItems', 'maxItems'].some((k) => k in node)) return ['array'];
  if (['minLength', 'maxLength', 'pattern', 'format'].some((k) => k in node)) return ['string'];
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].some((k) => k in node)) return ['number'];
  return [];
}

/**
 * A conservative size, in characters, of a typical valid instance of a
 * schema — what a model would have to emit to call a tool with it. Every
 * declared member counts, required or not; a string is twelve characters
 * (or its `minLength`, its format's usual length, the longest `enum`
 * member), a number four, an array three items (or `minItems`); `$ref`s
 * resolve within the schema's own document, the largest `oneOf`/`anyOf`
 * branch counts, `allOf` parts add up, and a recursive reference or a
 * subtree deeper than eight levels counts as an empty container.
 * @example
 * estimateArgumentChars({ type: 'object', properties: { id: { type: 'integer' } } }); // 11 — {"id":1234}
 */
export function estimateArgumentChars(schema: unknown): number {
  return estimateNode(schema, scopeOf(schema), 0, []);
}

function estimateNode(node: SchemaNode, scope: Scope, depth: number, refs: readonly string[]): number {
  if (node === false) return 0;
  if (!isObject(node)) return STRING_CHARS;
  if (depth > ESTIMATE_DEPTH) return 2;
  if (typeof node.$ref === 'string') {
    if (refs.includes(node.$ref)) return 2;
    const target = resolveSameDocumentRef(node.$ref, scope.root, scope.anchors);
    return target === undefined ? STRING_CHARS : estimateNode(target, scope, depth + 1, [...refs, node.$ref]);
  }
  if (Object.hasOwn(node, 'const')) return jsonChars(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) return Math.max(...node.enum.map(jsonChars));
  const types = typesOf(node);
  const own = types.length === 0 ? null : Math.max(...types.map((type) => typeChars(type, node, scope, depth, refs)));
  let branch: number | null = null;
  for (const keyword of ['oneOf', 'anyOf']) {
    if (!Array.isArray(node[keyword])) continue;
    for (const option of node[keyword]) branch = Math.max(branch ?? 0, estimateNode(option, scope, depth + 1, refs));
  }
  if (!Array.isArray(node.allOf) || node.allOf.length === 0) {
    return own === null && branch === null ? STRING_CHARS : Math.max(own ?? 0, branch ?? 0);
  }
  const parts: number[] = node.allOf.map((part: SchemaNode) => estimateNode(part, scope, depth + 1, refs));
  // object parts merge into one instance, so their members add up; any
  // other parts constrain one value, so the largest reading counts
  const merges = types.includes('object')
    || node.allOf.some((part: SchemaNode) => { const s = deref(part, scope); return isObject(s) && typesOf(s).includes('object'); });
  if (!merges) return Math.max(own ?? 0, branch ?? 0, ...parts);
  return Math.max(own ?? 2, branch ?? 0) + parts.reduce((total, part) => total + Math.max(0, part - 2) + 1, 0);
}

function typeChars(type: string, node: Record<string, any>, scope: Scope, depth: number, refs: readonly string[]): number {
  switch (type) {
    case 'string': {
      let chars = FORMAT_CHARS[node.format] ?? STRING_CHARS;
      if (typeof node.minLength === 'number') chars = Math.max(chars, node.minLength);
      if (typeof node.maxLength === 'number') chars = Math.min(chars, node.maxLength);
      return chars + 2;
    }
    case 'integer':
    case 'number':
      return NUMBER_CHARS;
    case 'boolean':
      return 5;
    case 'null':
      return 4;
    case 'object':
      return objectChars(node, scope, depth, refs);
    case 'array':
      return arrayChars(node, scope, depth, refs);
    default:
      return STRING_CHARS;
  }
}

function objectChars(node: Record<string, any>, scope: Scope, depth: number, refs: readonly string[]): number {
  let total = 2;
  let members = 0;
  if (isObject(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      if (child === false) continue;
      total += jsonChars(key) + 1 + estimateNode(child, scope, depth + 1, refs);
      members++;
    }
  }
  if (members === 0) {
    // a map-shaped object: as many entries as it must have, at least one
    const pattern = isObject(node.patternProperties) ? Object.values(node.patternProperties)[0] : undefined;
    const value = isObject(node.additionalProperties) ? node.additionalProperties : pattern;
    if (value !== undefined && value !== false) {
      const entries = Math.max(1, typeof node.minProperties === 'number' ? node.minProperties : 0);
      total += entries * (KEY_CHARS + 3 + estimateNode(value, scope, depth + 1, refs));
      members = entries;
    }
  }
  return total + Math.max(0, members - 1);
}

function arrayChars(node: Record<string, any>, scope: Scope, depth: number, refs: readonly string[]): number {
  const tuple: SchemaNode[] = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : [];
  const rest = Array.isArray(node.prefixItems) ? node.items : Array.isArray(node.items) ? node.additionalItems : node.items;
  const min = typeof node.minItems === 'number' ? node.minItems : 0;
  const max = typeof node.maxItems === 'number' ? node.maxItems : Infinity;
  let count = Math.max(min, Math.min(ARRAY_ITEMS, max));
  if (rest === false) count = Math.min(count, tuple.length);
  let total = 2;
  for (let index = 0; index < Math.min(count, tuple.length); index++) total += estimateNode(tuple[index], scope, depth + 1, refs);
  if (count > tuple.length) total += (count - tuple.length) * estimateNode(rest ?? true, scope, depth + 1, refs);
  return total + Math.max(0, count - 1);
}

//#endregion

//#region values: read, write, report

/** The value at concrete tokens, or the index of the first token that misses. */
function valueAt(root: unknown, tokens: readonly string[]): { found: true; value: unknown } | { found: false; at: number } {
  let node: unknown = root;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (Array.isArray(node) && isIndex(token) && Number(token) < node.length) node = node[Number(token)];
    else if (isObject(node) && Object.hasOwn(node, token)) node = node[token];
    else return { found: false, at: index };
  }
  return { found: true, value: node };
}

/**
 * Write a value at a path, creating missing parents — an array when the
 * next token is an index or `-`, an object otherwise. Answers the concrete
 * tokens written (a `-` becomes the index it appended at) or the refusal.
 * Callers write into a copy, so a refusal half-way leaves the draft as it
 * was.
 */
function writeAt(root: Record<string, unknown>, tokens: readonly string[], value: unknown): { tokens: string[] } | Refusal {
  let node: any = root;
  const written: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    let token = tokens[index];
    if (Array.isArray(node)) {
      if (token === '-') token = String(node.length);
      if (!isIndex(token)) return { error: `${pointerOf(written)} is an array: '${token}' is not an index (use 0, 1, … or - to append)` };
      if (Number(token) > node.length) {
        return { error: `index ${token} is past the end of ${pointerOf(written)} (length ${node.length}); use ${pointerOf([...written, '-'])} to append` };
      }
    }
    else if (!isObject(node)) {
      return { error: `${pointerOf(written)} holds ${kindOf(node)}, not an object or an array; set it to {} or [] first` };
    }
    written.push(token);
    const last = index === tokens.length - 1;
    const present = Array.isArray(node) ? node[Number(token)] : Object.hasOwn(node, token) ? node[token] : undefined;
    if (last || present === undefined) {
      const next = tokens[index + 1];
      const child = last ? value : next === '-' || isIndex(next) ? [] : {};
      if (Array.isArray(node)) node[Number(token)] = child;
      else setObjectMember(node, token, child);
      if (last) break;
      node = child;
    }
    else node = present;
  }
  return { tokens: written };
}

/** The paths of a value's children, for paging through a view. */
function valueChildren(value: unknown, tokens: readonly string[]): string[] {
  if (Array.isArray(value)) return value.map((_, index) => pointerOf([...tokens, String(index)]));
  if (isObject(value)) return Object.keys(value).map((key) => pointerOf([...tokens, key]));
  return [];
}

/**
 * The JSON Pointers of required members not yet set, walking the value
 * along its schema. A branch (`oneOf`, `anyOf`, `allOf`) decides its own
 * required members, so the walk stops there and the commit reports them.
 */
function missingPaths(scope: Scope, value: unknown): string[] {
  const missing: string[] = [];
  const walk = (node: SchemaNode, current: unknown, tokens: string[], depth: number) => {
    if (missing.length >= MAX_MISSING || depth > ESTIMATE_DEPTH) return;
    const schema = deref(node, scope);
    if (!isObject(schema) || BRANCHING.some((keyword) => keyword in schema)) return;
    if (isObject(current)) {
      for (const key of Array.isArray(schema.required) ? schema.required : []) {
        if (typeof key === 'string' && !Object.hasOwn(current, key)) {
          missing.push(pointerOf([...tokens, key]));
          if (missing.length >= MAX_MISSING) return;
        }
      }
      for (const [key, child] of Object.entries(current)) {
        const sub = childSchema(schema, key, scope);
        if (sub !== undefined) walk(sub, child, [...tokens, key], depth + 1);
      }
    }
    else if (Array.isArray(current)) {
      current.forEach((item, index) => {
        const sub = childSchema(schema, String(index), scope);
        if (sub !== undefined) walk(sub, item, [...tokens, String(index)], depth + 1);
      });
    }
  };
  walk(scope.root, value, [], 0);
  return missing;
}

/**
 * An `invalidInput` rejection that carries the schema only when the caller
 * passes one: a staged tool's whole schema is the thing too large to send
 * back, while a small sub-schema is worth re-reading.
 */
function rejection(what: string, outcome: { errors: any[] }, schema: unknown, extra: Record<string, unknown> = {}): Refusal {
  const { inputSchema, ...answer } = invalidInput(what, outcome, schema, extra);
  return schema === undefined ? answer : { ...answer, inputSchema };
}

//#endregion

/**
 * Stage every tool whose input a model with this budget cannot emit in
 * one call. A tool is staged when `estimateArgumentChars(inputSchema)`
 * exceeds `budget.maxArgumentChars` (never under an unlimited budget);
 * the rest pass through unchanged — or, with `budget.catalog`, behind
 * `tool_list` / `tool_describe` / `tool_call`. Tool names, given and
 * generated, must match `^[a-zA-Z0-9_-]{1,64}$` and be unique: a
 * duplicate is refused rather than silently replacing a tool.
 * @example
 * const staged = stageTools(tools, { budget: modelProfile('qwen/qwen3.6-35b-a3b').tools });
 * const toolbox = createToolbox();
 * for (const tool of staged.tools) toolbox.add(tool);
 * staged.staged;   // the tools a model builds with draft_open … draft_commit
 */
export function stageTools(tools: readonly ToolDef[], options: StageOptions): StagedTools {
  if (!Array.isArray(tools)) throw new AiError('AI0001', 'stageTools: tools must be an array of tool definitions');
  if (!isObject(options)) throw new AiError('AI0001', 'stageTools: options must be an object with a budget');
  const budget = checkBudget(options.budget);
  const prefix = options.prefix ?? '';
  if (typeof prefix !== 'string') throw new AiError('AI0001', 'stageTools: prefix must be a string');
  const maxDrafts = options.maxDrafts ?? DEFAULT_MAX_DRAFTS;
  if (!Number.isSafeInteger(maxDrafts) || maxDrafts < 1) throw new AiError('AI0001', 'stageTools: maxDrafts must be a positive integer');
  const validator: SchemaCompiler = options.validator ?? new JarenValidator({ skipErrors: false, collectErrors: true });

  const names = new Map<string, string>();
  const claim = (name: unknown, owner: string) => {
    if (typeof name !== 'string' || !TOOL_NAME.test(name)) {
      throw new AiError('AI0001', `stageTools: the name of ${owner} must match ^[a-zA-Z0-9_-]{1,64}$ (got ${typeof name === 'string' ? `'${name}'` : typeof name})`);
    }
    const other = names.get(name);
    if (other !== undefined) {
      throw new AiError('AI0001', `stageTools: the tool name '${name}' is used twice, by ${other} and by ${owner}${owner.startsWith('the ') ? ' — pass a prefix' : ''}`);
    }
    names.set(name, owner);
  };

  const max = budget.maxArgumentChars;
  const entries = tools.map((def, index): Entry => {
    if (!isObject(def as unknown) || typeof def.description !== 'string' || typeof def.execute !== 'function'
      || !(isObject(def.inputSchema) || typeof def.inputSchema === 'boolean')) {
      throw new AiError('AI0001', `stageTools: tools[${index}] must be { name, description, inputSchema, execute }`);
    }
    claim(def.name, `tool '${def.name}'`);
    const estimate = estimateArgumentChars(def.inputSchema);
    const staged = Number.isFinite(max) && estimate > max;
    return { def, staged, size: staged ? 'large' : estimate <= 2 ? 'none' : 'small', scope: scopeOf(def.inputSchema) };
  });
  const stagedEntries: StagedEntry[] = entries.filter((entry) => entry.staged).map((entry) => {
    const leafChecks = referencesStayInDefs(entry.def.inputSchema);
    const leaves = new WeakMap<object, Check | null>();
    return {
      ...entry,
      check: validator.compile(entry.def.inputSchema),
      leafCheck: (leaf: SchemaNode) => {
        if (!leafChecks || !isObject(leaf)) return null;
        if (!leaves.has(leaf)) {
          let check: Check | null;
          try {
            check = validator.compile(withDefs(leaf, entry.scope.root));
          }
          catch {
            check = null;
          }
          leaves.set(leaf, check);
        }
        return leaves.get(leaf) ?? null;
      },
    };
  });
  const directEntries = entries.filter((entry) => !entry.staged);
  const byName = new Map(entries.map((entry) => [entry.def.name, entry]));
  const stagedByName = new Map(stagedEntries.map((entry) => [entry.def.name, entry]));
  const catalog = budget.catalog && entries.length > 0;
  const n = (base: string) => `${prefix}${base}`;
  const perCall = `at most ${max} characters${Number.isFinite(budget.maxItems) ? ` and ${budget.maxItems} items` : ''} per call`;

  const open = new Map<string, Draft>();
  let opened = 0;

  const summary = (draft: Draft): DraftSummary => ({
    draft: draft.id,
    tool: draft.entry.def.name,
    size: jsonChars(draft.value),
    missing: missingPaths(draft.entry.scope, draft.value),
  });

  function lookup(id: unknown): Draft | Refusal {
    const draft = typeof id === 'string' ? open.get(id) : undefined;
    if (draft !== undefined) return draft;
    return {
      error: typeof id === 'string' ? `no open draft '${id}'` : `draft must be the id ${n('draft_open')} answered, e.g. "d1"`,
      open: [...open.keys()],
      hint: `${n('draft_open')} starts a draft`,
    };
  }

  /**
   * The refusal of a value over the budget, naming how to send it in
   * parts: an object's members one by one, an array's items in appends, a
   * text in pieces.
   */
  function oversize(tokens: readonly string[], value: unknown, size: number): Refusal {
    const where = tokens.length === 0 ? 'the starting value' : `the value for ${pointerOf(tokens)}`;
    const error = `${where} is ${size} characters; one call carries at most ${max}`;
    if (isObject(value)) {
      const paths = Object.keys(value).slice(0, MAX_SPLIT_PATHS).map((key) => pointerOf([...tokens, key]));
      const rest = Object.keys(value).length - paths.length;
      return {
        error,
        paths,
        hint: tokens.length === 0
          ? `open the draft with fewer members (or none), then set them one by one with ${n('draft_set')}: ${paths.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
          : `set its members one by one with ${n('draft_set')}: ${paths.join(', ')}${rest > 0 ? ` and ${rest} more` : ''} — a member that is still too large is refused with its own parts`,
      };
    }
    if (Array.isArray(value)) {
      const paths = value.slice(0, MAX_SPLIT_PATHS).map((_, index) => pointerOf([...tokens, String(index)]));
      return {
        error,
        paths,
        hint: `add the ${value.length} items with ${n('draft_append')} { path: "${pointerOf(tokens)}", items } — ${perCall} — or set them one by one at ${paths.join(', ')}`,
      };
    }
    if (typeof value === 'string') {
      return {
        error,
        hint: `set the first part of the text with ${n('draft_set')}, then add the rest with ${n('draft_append')} { path: "${pointerOf(tokens)}", items: ["…the next part"] }, under ${max} characters a call`,
      };
    }
    return { error };
  }

  /**
   * Check a value against the sub-schema at its concrete path. Null when
   * it passes, or when the sub-schema cannot be found without choosing a
   * branch — the commit checks those.
   */
  function checkLeaf(entry: StagedEntry, tokens: readonly string[], value: unknown): Refusal | null {
    const leaf = schemaAt(entry.scope, tokens);
    const at = pointerOf(tokens);
    if (leaf === false) {
      // name the first member the schema forbids, and what its parent does declare
      let depth = 1;
      while (depth < tokens.length && schemaAt(entry.scope, tokens.slice(0, depth)) !== false) depth++;
      const parentTokens = tokens.slice(0, depth - 1);
      const parent = deref(schemaAt(entry.scope, parentTokens), entry.scope);
      const members = isObject(parent) && isObject(parent.properties) ? Object.keys(parent.properties) : [];
      return {
        error: `${pointerOf(tokens.slice(0, depth))} is not part of ${entry.def.name}'s input`,
        ...(members.length > 0 ? { members: members.map((key) => pointerOf([...parentTokens, key])) } : {}),
      };
    }
    const check = leaf === undefined ? null : entry.leafCheck(leaf);
    if (check === null) return null;
    const outcome = checkOutcome(check(value));
    if (outcome.valid) return null;
    const located = {
      errors: outcome.errors.map((e: any) => ({ ...e, instancePath: `${at}${e?.instancePath ?? ''}` })),
    };
    const resolved = deref(leaf, entry.scope);
    const small = resolved !== undefined && jsonChars(resolved) <= budget.maxSchemaChars;
    return rejection(`${entry.def.name} at ${at}`, located, small ? resolved : undefined);
  }

  const answered = (draft: Draft, tokens: readonly string[], extra: Record<string, unknown> = {}) => ({
    ok: true as const,
    path: pointerOf(tokens),
    ...extra,
    missing: missingPaths(draft.entry.scope, draft.value),
    size: jsonChars(draft.value),
  });

  function draftOpen(input: any) {
    const name = input?.tool;
    const entry = typeof name === 'string' ? stagedByName.get(name) : undefined;
    if (entry === undefined) {
      return byName.has(name)
        ? { error: `'${name}' takes a small input: call it ${catalog ? `with ${n('tool_call')}` : 'directly'}` }
        : { error: `no staged tool '${String(name)}'`, staged: stagedEntries.map((e) => e.def.name) };
    }
    if (open.size >= maxDrafts) {
      return {
        error: `${open.size} drafts are open, the most this toolbox keeps`,
        open: [...open.values()].map(summary),
        hint: `${n('draft_commit')} or ${n('draft_discard')} one first`,
      };
    }
    if (input.value !== undefined && (!isObject(input.value) || !isJsonValue(input.value))) {
      return { error: 'value must be a JSON object: the members to start the draft with' };
    }
    const start: Record<string, unknown> = input.value === undefined ? {} : toJson(input.value);
    const size = jsonChars(start);
    if (size > max) return oversize([], start, size);
    for (const [key, member] of Object.entries(start)) {
      const invalid = checkLeaf(entry, [key], member);
      if (invalid !== null) return invalid;
    }
    const draft: Draft = { id: `d${++opened}`, entry, value: start };
    open.set(draft.id, draft);
    return {
      draft: draft.id,
      tool: entry.def.name,
      missing: missingPaths(entry.scope, draft.value),
      budget: { maxArgumentChars: finite(max), maxItems: finite(budget.maxItems) },
      hint: `Build the input with ${n('draft_set')} { draft: "${draft.id}", path, value } and ${n('draft_append')}`
        + ` { draft: "${draft.id}", path, items } — ${perCall}; missing lists required members still unset.`
        + ` ${n('draft_commit')} { draft: "${draft.id}" } runs ${entry.def.name}.`,
    };
  }

  function draftSet(input: any) {
    const draft = lookup(input?.draft);
    if ('error' in draft) return draft;
    const tokens = pathTokens(input.path, false);
    if (!Array.isArray(tokens)) return tokens;
    if (input.value === undefined || !isJsonValue(input.value)) return { error: 'value is required: the JSON value to place at the path' };
    const size = jsonChars(input.value);
    if (size > max) return oversize(tokens, input.value, size);
    const value = toJson(input.value);
    const next = cloneJson(draft.value);
    const written = writeAt(next, tokens, value);
    if ('error' in written) return written;
    const invalid = checkLeaf(draft.entry, written.tokens, value);
    if (invalid !== null) return invalid;
    draft.value = next;
    return answered(draft, written.tokens);
  }

  function draftAppend(input: any) {
    const draft = lookup(input?.draft);
    if ('error' in draft) return draft;
    const tokens = pathTokens(input.path, false);
    if (!Array.isArray(tokens)) return tokens;
    const items = input.items;
    if (!Array.isArray(items) || items.length === 0 || !isJsonValue(items)) return { error: 'items must be a non-empty array of the JSON values to append' };
    if (items.length > budget.maxItems) {
      return {
        error: `one append carries at most ${budget.maxItems} items; this one carried ${items.length}`,
        hint: `append the first ${budget.maxItems} now and the other ${items.length - budget.maxItems} in further calls`,
      };
    }
    const size = jsonChars(items);
    if (size > max) {
      const largest = items.reduce((index: number, item: unknown, at: number) => (jsonChars(item) > jsonChars(items[index]) ? at : index), 0);
      const itemSize = jsonChars(items[largest]);
      if (itemSize <= max) {
        return {
          error: `these ${items.length} items are ${size} characters together; one call carries at most ${max}`,
          hint: `append them in smaller groups, about ${Math.max(1, Math.floor(max / Math.ceil(size / items.length)))} at a time`,
        };
      }
      const members = isObject(items[largest]) ? Object.keys(items[largest]).slice(0, MAX_SPLIT_PATHS) : [];
      return {
        error: `item ${largest} is ${itemSize} characters; one call carries at most ${max}`,
        hint: members.length > 0
          ? `append it with only its smaller members, then set the others with ${n('draft_set')} at ${pointerOf(tokens)}/<its index>/<member> (its members: ${members.join(', ')})`
          : `append it in parts: a text item is continued by ${n('draft_append')} on its own path`,
      };
    }
    const values = items.map(toJson);
    const next = cloneJson(draft.value);
    let target = valueAt(next, tokens);
    let concrete = [...tokens];
    if (!target.found) {
      const created = writeAt(next, tokens, []);
      if ('error' in created) return created;
      concrete = created.tokens;
      target = valueAt(next, concrete);
    }
    const current = target.found ? target.value : undefined;
    if (typeof current === 'string') {
      if (!values.every((value) => typeof value === 'string')) return { error: `${pointerOf(concrete)} holds text: append strings to continue it` };
      const text = current + values.join('');
      writeAt(next, concrete, text);
      draft.value = next;
      return answered(draft, concrete, { length: text.length });
    }
    if (!Array.isArray(current)) {
      return { error: `${pointerOf(concrete)} holds ${kindOf(current)}, not an array or text`, hint: `${n('draft_set')} replaces a value` };
    }
    for (let offset = 0; offset < values.length; offset++) {
      const invalid = checkLeaf(draft.entry, [...concrete, String(current.length + offset)], values[offset]);
      if (invalid !== null) return invalid;
    }
    current.push(...values);
    draft.value = next;
    return answered(draft, concrete, { length: current.length });
  }

  function draftView(input: any) {
    const draft = lookup(input?.draft);
    if ('error' in draft) return draft;
    const tokens = pathTokens(input.path ?? '', true);
    if (!Array.isArray(tokens)) return tokens;
    const found = valueAt(draft.value, tokens);
    if (!found.found) {
      const parent = tokens.slice(0, found.at);
      const known = valueAt(draft.value, parent);
      return {
        error: `nothing is set at ${pointerOf(tokens.slice(0, found.at + 1))}`,
        next: known.found ? valueChildren(known.value, parent).slice(0, MAX_NEXT_PATHS) : [],
      };
    }
    const text = JSON.stringify(found.value) ?? 'null';
    const truncated = text.length > max;
    const children = truncated ? valueChildren(found.value, tokens) : [];
    return {
      draft: draft.id,
      path: pointerOf(tokens),
      value: truncated ? text.slice(0, max) : found.value,
      truncated,
      size: text.length,
      ...(children.length > 0 ? { next: children.slice(0, MAX_NEXT_PATHS) } : {}),
      ...(children.length > MAX_NEXT_PATHS ? { more: children.length - MAX_NEXT_PATHS } : {}),
    };
  }

  async function draftCommit(input: any) {
    const draft = lookup(input?.draft);
    if ('error' in draft) return draft;
    const { entry } = draft;
    const outcome = checkOutcome(entry.check(draft.value));
    if (!outcome.valid) {
      return rejection(entry.def.name, outcome, undefined, {
        draft: draft.id,
        missing: missingPaths(entry.scope, draft.value),
        hint: `the draft is kept: fix these paths with ${n('draft_set')} or ${n('draft_append')}, then ${n('draft_commit')} again`,
      });
    }
    try {
      const result = await entry.def.execute(cloneJson(draft.value));
      open.delete(draft.id);
      return result;
    }
    catch (err: any) {
      // the tool did not answer: keep the draft so the commit can be retried
      return {
        error: err?.message ?? String(err),
        draft: draft.id,
        hint: `the draft is kept: ${n('draft_commit')} again to retry, or ${n('draft_discard')} it`,
      };
    }
  }

  function draftDiscard(input: any) {
    const draft = lookup(input?.draft);
    if ('error' in draft) return draft;
    open.delete(draft.id);
    return { ok: true, discarded: draft.id };
  }

  const directBox = createToolbox({ validator });
  if (catalog) for (const entry of directEntries) directBox.add(entry.def);

  function toolList() {
    return entries.map((entry) => ({
      name: entry.def.name,
      description: firstSentence(entry.def.description),
      staged: entry.staged,
      size: entry.size,
    }));
  }

  function toolDescribe(input: any) {
    const entry = typeof input?.name === 'string' ? byName.get(input.name) : undefined;
    if (entry === undefined) return { error: `unknown tool '${String(input?.name)}'`, hint: `${n('tool_list')} names the tools` };
    const tokens = pathTokens(input.path ?? '', true);
    if (!Array.isArray(tokens)) return tokens;
    const concrete = tokens.map((token) => (token === '-' ? '0' : token));
    const found = schemaAt(entry.scope, concrete);
    const node = found === undefined ? undefined : deref(found, entry.scope);
    if (node === undefined) {
      return {
        error: `${pointerOf(concrete)} runs through a oneOf, anyOf or allOf (or a reference outside the schema); describe a shorter path`,
        name: entry.def.name,
      };
    }
    // the definitions are reached by drilling into a path, not read wholesale
    const schema = isObject(node)
      ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs' && key !== 'definitions'))
      : node;
    const text = JSON.stringify(schema);
    const truncated = text.length > budget.maxSchemaChars;
    const next = schemaChildren(node, concrete);
    return {
      name: entry.def.name,
      path: pointerOf(concrete),
      staged: entry.staged,
      schema: truncated ? text.slice(0, budget.maxSchemaChars) : schema,
      truncated,
      ...(next.length > 0 ? { next: next.slice(0, MAX_NEXT_PATHS) } : {}),
    };
  }

  function toolCall(input: any) {
    const name = input?.name;
    if (typeof name === 'string' && stagedByName.has(name)) {
      return {
        error: `'${name}' takes a large input and is built as a draft`,
        hint: `${n('draft_open')} { tool: "${name}" }, then ${n('draft_set')} / ${n('draft_append')}, then ${n('draft_commit')}`,
      };
    }
    if (typeof name !== 'string' || !byName.has(name)) return { error: `unknown tool '${String(name)}'`, hint: `${n('tool_list')} names the tools` };
    return directBox.execute(name, input.input ?? {});
  }

  const draftId = { type: 'string', description: `the draft id ${n('draft_open')} answered, e.g. "d1"` };
  const pointer = (description: string) => ({ type: 'string', description });
  const catalogTools: ToolDef[] = [];
  const draftTools: ToolDef[] = [];
  if (catalog) {
    catalogTools.push({
      name: n('tool_list'),
      description: `List the tools you can call, one line each, with whether they take no, a small or a large input. A small input goes through ${n('tool_call')}; a large one is built as a draft with ${n('draft_open')}.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: toolList,
    }, {
      name: n('tool_describe'),
      description: `Read the input schema of a tool, or of the member at a JSON Pointer path in its input (e.g. /notes/0). A schema longer than ${budget.maxSchemaChars} characters is cut, and next lists the paths to read instead.`,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: `a tool name from ${n('tool_list')}` }, path: pointer('a JSON Pointer into the tool\'s input; omit for the whole input') },
        required: ['name'],
        additionalProperties: false,
      },
      execute: toolDescribe,
    });
    if (directEntries.length > 0) {
      catalogTools.push({
        name: n('tool_call'),
        description: `Call a tool by name with its input. ${n('tool_list')} names the tools and ${n('tool_describe')} shows an input schema.`,
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string', description: `a tool name from ${n('tool_list')}` }, input: { type: 'object', description: 'the tool\'s input' } },
          required: ['name'],
          additionalProperties: false,
        },
        execute: toolCall,
      });
    }
  }
  if (stagedEntries.length > 0) {
    const schemas = catalog
      ? ` Read an input schema with ${n('tool_describe')} { name, path }.`
      : stagedEntries.map((entry) => `\n\n${entry.def.name}: ${entry.def.description}\nInput schema: ${JSON.stringify(entry.def.inputSchema)}`).join('');
    draftTools.push({
      name: n('draft_open'),
      description: `Start a draft of a tool whose input is too large for one call (${stagedEntries.map((e) => e.def.name).join(', ')}). Build it with ${n('draft_set')} and ${n('draft_append')} — ${perCall} — check it with ${n('draft_view')}, then ${n('draft_commit')} runs the tool.${schemas}`,
      inputSchema: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: stagedEntries.map((entry) => entry.def.name), description: 'the tool whose input to build' },
          value: { type: 'object', description: `members to start with, at most ${max} characters` },
        },
        required: ['tool'],
        additionalProperties: false,
      },
      execute: draftOpen,
    }, {
      name: n('draft_set'),
      description: `Set one value in a draft at a JSON Pointer path (e.g. /title, /meta/owner, /notes/0/tags); missing parents are created. At most ${max} characters; a larger value is refused with the paths to set instead.`,
      inputSchema: {
        type: 'object',
        properties: { draft: draftId, path: pointer('a JSON Pointer into the input, e.g. "/title"'), value: { description: 'the JSON value to place there' } },
        required: ['draft', 'path', 'value'],
        additionalProperties: false,
      },
      execute: draftSet,
    }, {
      name: n('draft_append'),
      description: `Append items to the array at a draft path, creating it when absent — ${perCall}. On a path that holds text, the items continue the text.`,
      inputSchema: {
        type: 'object',
        properties: { draft: draftId, path: pointer('a JSON Pointer to the array, e.g. "/notes"'), items: { type: 'array', minItems: 1, description: 'the values to append' } },
        required: ['draft', 'path', 'items'],
        additionalProperties: false,
      },
      execute: draftAppend,
    }, {
      name: n('draft_view'),
      description: `Read back a draft, or the part at a path. A part over ${max} characters is cut, and next lists its child paths to read one by one.`,
      inputSchema: {
        type: 'object',
        properties: { draft: draftId, path: pointer('a JSON Pointer into the input; omit for all of it') },
        required: ['draft'],
        additionalProperties: false,
      },
      execute: draftView,
    }, {
      name: n('draft_commit'),
      description: 'Check the whole draft against the tool\'s input schema and run the tool. On success the draft closes and the tool\'s answer comes back; otherwise the draft is kept and the errors name the paths to fix.',
      inputSchema: { type: 'object', properties: { draft: draftId }, required: ['draft'], additionalProperties: false },
      execute: draftCommit,
    }, {
      name: n('draft_discard'),
      description: 'Close a draft without running its tool.',
      inputSchema: { type: 'object', properties: { draft: draftId }, required: ['draft'], additionalProperties: false },
      execute: draftDiscard,
    });
  }
  for (const def of catalogTools) claim(def.name, 'the tool catalog');
  for (const def of draftTools) claim(def.name, 'the draft protocol');

  return {
    tools: [...(catalog ? catalogTools : directEntries.map((entry) => entry.def)), ...draftTools],
    direct: Object.freeze(directEntries.map((entry) => entry.def.name)),
    staged: Object.freeze(stagedEntries.map((entry) => entry.def.name)),
    drafts: () => [...open.values()].map(summary),
  };
}

/** The budget, or `AI0001` when it is not one. */
function checkBudget(budget: unknown): ToolBudget {
  const limit = (value: unknown) => value === Infinity || (typeof value === 'number' && Number.isInteger(value) && value > 0);
  const candidate = budget as ToolBudget;
  if (!isObject(budget) || typeof candidate.tier !== 'string' || typeof candidate.catalog !== 'boolean'
    || !limit(candidate.maxArgumentChars) || !limit(candidate.maxItems) || !limit(candidate.maxSchemaChars)) {
    throw new AiError('AI0001', 'stageTools: budget must be a tool budget — modelProfile(model).tools or resolveToolBudget(setting, model) from @tangleai/models/profile');
  }
  return candidate;
}
