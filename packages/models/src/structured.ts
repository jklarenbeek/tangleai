/**
 * Structured output: schema in, validated JSON value out — on every
 * provider tier.
 *
 * The helper sends one (non-streaming) chat request constrained by a
 * JSON Schema, using the strongest mechanism the provider speaks
 * (`response_format: json_schema` → JSON mode → schema embedded in a
 * system instruction), parses the reply, and validates it locally with
 * `@jarenjs/validate` — the same validator that guards the toolbox.
 * Local validation is never optional: provider structured-output
 * implementations enforce varying schema subsets, so the server is an
 * accelerator, not an authority. On failure the instancePath'd errors
 * go back to the model for a bounded number of repair rounds.
 */

import { JarenValidator } from '@jarenjs/validate';
import { checkOutcome } from '@jarenjs/core/check';
import { bundleSchema } from './bundle.ts';
import { AiError } from './errors.ts';
import { PROVIDERS } from './providers.ts';

export { bundleSchema };

/** Validation errors reported per failed generation: enough to repair. */
const MAX_ERRORS = 8;

/**
 * Normalize an injected check's errors into the compact records a
 * repair prompt carries. The default `JarenValidator` check reports
 * `{ instancePath, keyword, message }`; a compiler check (a Jaren
 * engine caught into an outcome) reports `{ code, docPath, reason }`.
 * Both are the same idea — a location and a reason — so a compile error
 * keeps its `code` and its `docPath` here rather than being flattened
 * into a location-less message. `docPath` (the engine's pointer into
 * the offending document) wins over `instancePath` when both appear;
 * `''` is a real docPath (the document root) and only `undefined`
 * falls through. `reason` (the bare text of a coded error) wins over
 * `message` so the record never carries the code and the path twice —
 * the composed `message` already contains both, and the fields beside
 * it are the structured copies.
 */
function normalizeErrors(raw: any[]) {
  return raw.slice(0, MAX_ERRORS).map((e: any) => {

    const out: any = {
      instancePath: e.docPath ?? e.instancePath ?? '',
      keyword: e.code ?? e.keyword ?? '',
      message: e.reason ?? e.message ?? 'invalid',
    };
    if (e.code !== undefined) out.code = e.code;
    if (e.docPath !== undefined) out.docPath = e.docPath;
    return out;
  });
}

/**
 * The system instruction for providers that cannot (fully) constrain
 * decoding: the schema travels in the prompt and the reply must be the
 * bare JSON value.
 */
function schemaInstruction(schema: any) {
  return [
    'Reply with a single JSON value that validates against this JSON Schema.',
    'Output ONLY the JSON — no prose, no code fences.',
    '',
    JSON.stringify(schema),
  ].join('\n');
}

/**
 * Strip an accidental markdown fence from a reply ("```json … ```") —
 * the classic prompt-embedded-schema failure mode.
 *
 * Exported because every place this package parses a model's JSON has to
 * make the same allowance, and two copies of "how forgiving are we about
 * fences" is two answers to one question: `program.ts`'s sub-calls parse
 * replies the same way structured generation does.
 */
export function unfence(text: string) {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return match === null ? trimmed : match[1];
}

/**
 * Compile a schema that may reference others by `$id`, registering the
 * referenced schemas first. Every Jaren engine-document grammar
 * (fsm/dag/app/JSLT) composes the query grammar by `$ref`, so a plain
 * `.compile(schema)` on one of them throws "Can not resolve schema".
 * @param [refs]
 */
function compileWithRefs(schema: any, refs?: any[]): (value: any) => any {
  const v = new JarenValidator({ skipErrors: false, collectErrors: true });
  for (const ref of refs ?? []) v.addSchema(ref);
  return v.compile(schema);
}

/**
 * The first JSON object or array embedded in prose, or `undefined`: the
 * lenient parse. Strings are tracked, so a brace inside one does not
 * count, and a candidate that does not parse is skipped for the next.
 */
export function extractJson(text: string): unknown {
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (char === '\\') i++;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); }
          catch { break; }
        }
      }
    }
  }
  return undefined;
}

/** The stage at which a generation failed. */
export type StructuredStage = 'parse' | 'schema' | 'gate' | 'truncated';

/**
 * One failure, the same shape at every stage. `code` is always present —
 * `parse`, `truncated`, the validator's keyword or the gate's own code —
 * and so is `path`, `''` for the whole value. `instancePath`, `keyword`
 * and `docPath` are the names the repair prompt carries, kept for readers
 * of the earlier records.
 */
export type StructuredError = {
  stage: StructuredStage;
  code: string;
  path: string;
  message: string;
  instancePath: string;
  keyword: string;
  docPath?: string;
};

/** Token counts summed over the attempts that reported usage. */
export type StructuredUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

/** One model call of a generation. `usage` is `null` where the provider reported none. */
export type StructuredCall = {
  attempt: number;
  outcome: 'valid' | StructuredStage;
  finishReason: string | null;
  usage: any;
};

type StructuredCommon = {
  raw: string;
  attempts: number;
  finishReason: string | null;
  usage: StructuredUsage | null;
  calls: StructuredCall[];
};

/** What `generate` answers: a value, or the errors of the last attempt. */
export type StructuredResult<T = any> =
  | (StructuredCommon & { ok: true; value: T; errors?: undefined; gateData?: unknown })
  | (StructuredCommon & { ok: false; errors: StructuredError[]; value?: undefined; gateData?: undefined });

/** What a gate may answer: a boolean, a check outcome, or a passing outcome carrying `data`. */
export type StructuredGate = (value: any) => any;

const USAGE_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const;

function addUsage(total: StructuredUsage | null, usage: any): StructuredUsage | null {
  if (usage === null || typeof usage !== 'object') return total;
  const sum = total ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  for (const key of USAGE_KEYS) if (Number.isFinite(usage[key])) sum[key] += usage[key];
  return sum;
}

/** The repair prompt's record, given its stage: nothing removed, the uniform fields added. */
function recordOf(stage: StructuredStage, legacy: any): StructuredError {
  return { ...legacy, stage, code: legacy.code ?? legacy.keyword, path: legacy.docPath ?? legacy.instancePath };
}

/**
 * Create a structured-output generator over a chat client.
 *
 *   - `validator` overrides the internally compiled check (any
 *     function returning a boolean or `{ valid, errors }`).
 *   - `refs` are other JSON Schemas the `schema` references by `$id`,
 *     registered before it is compiled — every Jaren engine-document
 *     schema composes the published query/JSLT grammars by `$ref`, so
 *     authoring an fsm/dag/app document needs them here (e.g. `refs:
 *     [querySchema]`). Ignored when `validator` is given. They are used
 *     for local validation only: the provider receives `schema` as given,
 *     so a `$ref` it cannot resolve reaches the wire unresolved — unless
 *     `bundle` is set.
 *   - `bundle` sends `bundleSchema(schema, refs)` instead: one
 *     self-contained schema whose every `$ref` points into its own
 *     `$defs`. Local validation is unchanged. Off by default, because it
 *     changes the request.
 *   - `gate` is one or more extra checks run AFTER schema validation
 *     (the schema still drives constrained decoding): the reliable way
 *     to author an engine document — the schema keeps the *shape*, a
 *     `compile` gate keeps the *semantics*. `checkCompile(compile,
 *     { fallbackCode })` from `@jarenjs/core/check` makes one from any
 *     compile that refuses by throwing; its coded, docPath'd errors go
 *     back to the model for repair (compile errors repair well — they are
 *     precise). Composes with `validator` when both are given (validator
 *     first). A passing gate may answer `{ valid: true, data }`: what it
 *     computed while checking comes back as `gateData` — the one gate's
 *     data, or one entry per gate when `gate` is an array. NOTE: a
 *     *quality/adequacy* gate — "needs ≥N of something" — repairs poorly
 *     on weaker models (they patch narrowly); enforce breadth in the
 *     prompt and reserve gates for schema/compile correctness.
 *   - `stream` sends the request streamed (default `false`). The parsed
 *     value is identical either way — the accumulator reassembles the
 *     reply before it is parsed — so this buys observability (a client's
 *     `onDelta`/`onReasoning` fire) and nothing else. It is opt-in
 *     because turning it on for every caller is a behaviour change for
 *     callers who never asked for one.
 *   - `maxRepairs` is how many failed rounds may go back to the model
 *     with the validation errors (default 1).
 *   - `tier` overrides the structured-output tier for this generator:
 *     `'json_schema'`, `'json'` or `null`. Without it the tier is the
 *     client's `endpoint.structured` when the client states one, else the
 *     provider preset's. A model whose provider refuses part of a schema
 *     (Anthropic models accept no `oneOf`) takes `null`: the schema travels
 *     in the prompt and is still enforced locally.
 *   - `parse: 'lenient'` reads the first JSON object or array inside a
 *     reply that wraps it in prose; the default `'strict'` accepts only a
 *     reply that is JSON, a fence around it allowed.
 *   - `deadlineMs` bounds a whole generation, repairs included (a
 *     per-call `deadlineMs` overrides it): past it, `generate` rejects
 *     with `AI0004` (`outcome: 'timeout'`). A client's own deadline bounds
 *     each call; this one bounds their sum.
 *
 * A reply cut off at the token limit (`finishReason: 'length'`), or one
 * that carries reasoning and no content, is reported as `truncated` and
 * never sent for repair: a repair goes out with the same budget and a
 * longer context, and would be cut off again. Every attempt's finish
 * reason and usage reach `onAttempt` and the result's `calls`; `usage`
 * is their sum.
 */
export function createStructuredOutput<T = any>(options: {
  client: {
    endpoint: {
      provider: string;
      structured?: 'json_schema' | 'json' | null;
    };
    complete: (request: any) => Promise<any>;
  };
  schema: any;
  name?: string;
  strict?: boolean;
  validator?: (value: any) => any;
  refs?: any[];
  bundle?: boolean;
  gate?: StructuredGate | StructuredGate[];
  stream?: boolean;
  onAttempt?: (event: {
    attempt: number;
    outcome: 'valid' | StructuredStage;
    errors: StructuredError[];
    finishReason: string | null;
    usage: any;
  }) => void;
  maxRepairs?: number;
  tier?: 'json_schema' | 'json' | null;
  parse?: 'strict' | 'lenient';
  deadlineMs?: number;
}): {
  generate: (messages: any[], hooks?: {
    signal?: AbortSignal;
    deadlineMs?: number;
  }) => Promise<StructuredResult<T>>;
} {
  const { client, schema } = options;
  if (schema === null || typeof schema !== 'object')
    throw new TypeError('createStructuredOutput needs a JSON Schema object');
  if (options.parse !== undefined && options.parse !== 'strict' && options.parse !== 'lenient')
    throw new TypeError("parse must be 'strict' or 'lenient'");
  const name = options.name ?? 'result';
  const maxRepairs = options.maxRepairs ?? 1;
  // Non-streaming stays the DEFAULT, and the reason is a behaviour change
  // rather than a preference: a caller reading `raw` or counting attempts
  // gets the same answer either way, but a caller that passed a client
  // with `onDelta` wired sees deltas start arriving where none did
  // before. The measurement that made this an option: the campaign's
  // authoring timeouts were on STREAMED calls, so streaming is not the
  // cure for a slow authoring turn — but it is how a long turn stays
  // observable, and a caller who wants that should not have to wrap the
  // client to get it.
  const stream = options.stream ?? false;
  const base = options.validator ?? compileWithRefs(schema, options.refs);
  const gates = options.gate === undefined ? [] : ([] as StructuredGate[]).concat(options.gate);
  const tier = options.tier !== undefined ? options.tier
    : client.endpoint.structured !== undefined ? client.endpoint.structured
      : PROVIDERS[client.endpoint.provider]?.structured ?? null;
  const wireSchema = options.bundle === true ? bundleSchema(schema, options.refs ?? []) : schema;

  /** Each gate in order, stopping at the first refusal; the passing gates' data. */
  function runGates(value: any): { outcome: { valid: boolean, errors: any[] }, data: unknown[] } {
    const data: unknown[] = [];
    for (const gate of gates) {
      const answer = gate(value);
      const outcome = checkOutcome(answer);
      if (!outcome.valid) return { outcome, data };
      data.push(answer !== null && typeof answer === 'object' ? (answer as { data?: unknown }).data : undefined);
    }
    return { outcome: { valid: true, errors: [] }, data };
  }

  /** The value a reply carries, or `undefined` when it carries none. */
  function parseReply(raw: string): { value: unknown } | { error: string } {
    try {
      return { value: JSON.parse(unfence(raw)) };
    }
    catch (err: any) {
      if (options.parse === 'lenient') {
        const value = extractJson(raw);
        if (value !== undefined) return { value };
      }
      return { error: (err as Error).message };
    }
  }

  /**
   * @param messages - wire-shape conversation to answer
   * @param [hooks]
   */
  async function generate(messages: any[], hooks: {
    signal?: AbortSignal;
    deadlineMs?: number;
  } = {}): Promise<StructuredResult<T>> {
    const deadlineMs = hooks.deadlineMs ?? options.deadlineMs;
    if (deadlineMs !== undefined && !(Number.isFinite(deadlineMs) && deadlineMs > 0))
      throw new AiError('AI0001', `deadlineMs must be a positive number, got ${String(deadlineMs)}`);
    let timer: any;
    let signal = hooks.signal;
    if (deadlineMs !== undefined) {
      const deadline = new AbortController();
      timer = setTimeout(() => deadline.abort(new AiError('AI0004',
        `the generation deadline of ${deadlineMs} ms passed`, { outcome: 'timeout', deadlineMs })), deadlineMs);
      signal = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]);
    }

    const request: any = { stream, signal };
    let turn = [...messages];
    if (tier === 'json_schema') {
      request.responseFormat = { name, schema: wireSchema, strict: options.strict ?? true };
    }
    else {
      // JSON mode (or nothing): the schema travels in the prompt;
      // local validation makes the weaker tiers safe
      if (tier === 'json') request.responseFormat = { type: 'json' };
      turn = [{ role: 'system', content: schemaInstruction(wireSchema) }, ...turn];
    }

    let raw = '';
    let errors: StructuredError[] = [];
    let finishReason: string | null = null;
    let usage: StructuredUsage | null = null;
    const calls: StructuredCall[] = [];
    const settle = (attempt: number, outcome: 'valid' | StructuredStage, reply: any) => {
      calls.push({ attempt, outcome, finishReason, usage: reply.usage ?? null });
      options.onAttempt?.({ attempt, outcome, errors, finishReason, usage: reply.usage ?? null });
    };
    try {
      for (let attempt = 1; attempt <= 1 + maxRepairs; attempt++) {
        const pending = client.complete({ ...request, messages: turn });
        const result = deadlineMs === undefined ? await pending : await settleBefore(pending, signal!);
        raw = result.message.content;
        finishReason = result.finishReason ?? null;
        usage = addUsage(usage, result.usage);

        const reasoningOnly = (typeof raw !== 'string' || raw.trim() === '')
          && typeof result.message.reasoning === 'string' && result.message.reasoning !== '';
        if (finishReason === 'length' || reasoningOnly) {
          const message = finishReason === 'length'
            ? 'the reply stopped at the token limit before it was complete; raise the output budget, a repair would be cut off again'
            : 'the reply carried reasoning and no content: the model spent its output budget thinking';
          errors = [recordOf('truncated', { instancePath: '', keyword: 'truncated', message })];
          settle(attempt, 'truncated', result);
          return { ok: false, errors, raw, attempts: attempt, finishReason, usage, calls };
        }

        const parsed = parseReply(raw);
        if ('error' in parsed) {
          errors = [recordOf('parse', { instancePath: '', keyword: 'parse', message: `the reply is not JSON: ${parsed.error}` })];
          settle(attempt, 'parse', result);
          turn = [...turn,
          { role: 'assistant', content: raw },
          { role: 'user', content: 'That reply was not parseable JSON. Reply again with ONLY the JSON value.' }];
          continue;
        }
        const value = parsed.value;
        const shape = checkOutcome(base(value));
        const gated = shape.valid ? runGates(value) : null;
        const outcome = gated === null ? shape : gated.outcome;
        if (outcome.valid) {
          errors = [];
          settle(attempt, 'valid', result);
          return {
            ok: true, value: value as T, raw, attempts: attempt, finishReason, usage, calls,
            ...(options.gate === undefined ? {} : { gateData: typeof options.gate === 'function' ? gated!.data[0] : gated!.data }),
          };
        }
        // the repair prompt carries the records it always carried, byte
        // for byte; the result's records add the uniform fields
        const legacy = normalizeErrors(outcome.errors);
        const stage = shape.valid ? 'gate' : 'schema';
        errors = legacy.map((record) => recordOf(stage, record));
        settle(attempt, stage, result);
        turn = [...turn,
        { role: 'assistant', content: raw },
        { role: 'user', content: `That JSON does not validate against the schema. Fix exactly these and reply with ONLY the corrected JSON value:\n${JSON.stringify(legacy)}` }];
      }
    }
    finally {
      clearTimeout(timer);
    }
    return { ok: false, errors, raw, attempts: 1 + maxRepairs, finishReason, usage, calls };
  }

  return { generate };
}

/**
 * `pending`, or the abort reason the moment `signal` aborts — so a
 * generation's deadline holds even over a client that ignores signals.
 */
function settleBefore<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      pending.catch(() => { /* superseded by the abort */ });
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
