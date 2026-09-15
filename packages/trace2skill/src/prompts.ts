/**
 * Role prompts as versioned artifacts.
 *
 * A pack is authored as TOML — static system instructions and one user
 * template — and compiled once into an immutable artifact whose revision IS
 * the prompt version a run records. That is the whole point of compiling
 * them: a run's idempotency keys name the revision, so moving a single byte
 * of a pack moves every key that named it and a resumed run cannot replay a
 * unit that answered a different question.
 *
 * TOML is JOSL's and rendering is JTLT's. The only thing owned here is the
 * translation between them: a scanner over the two placeholder forms the user
 * half may use. Everything a run substitutes is data — it is rendered into
 * the text and never scanned again, so a trajectory that happens to contain
 * a placeholder is quoted, not obeyed. The system half may carry no
 * placeholder at all, so nothing substituted can reach the instructions.
 */
import { parseToml } from '@jarenjs/josl';
import { compileJtltStylesheet } from '@jarenjs/json/jtlt';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { trace2SkillRefuse, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { compileTrace2SkillSchema, validateTrace2SkillShape } from './schema.ts';
import { immutableJson, skillFileDigest, skillRevisionOf } from './identity.ts';
import { DRAFT_SKILL_SCHEMA } from './schemas/draft.ts';
import { ERROR_PROPOSAL_SCHEMA, SUCCESS_ANALYSIS_SCHEMA } from './schemas/analysis.ts';
import { MERGE_OUTPUT_SCHEMA } from './schemas/merge.ts';
import type {
  Trace2SkillPromptArtifact, Trace2SkillPromptCatalog, Trace2SkillPromptPack,
  Trace2SkillPromptRole, Trace2SkillPromptVariable, Trace2SkillPromptVariables,
} from './contracts.gen.ts';

/** The compilation contract every artifact records; a stored artifact of another policy is not rendered. */
export const TRACE2SKILL_PROMPT_POLICY = 'trace2skill-jtlt-v1';

/** The roles a run addresses, in the order a pack set is published. */
export const TRACE2SKILL_PROMPT_ROLES: readonly Trace2SkillPromptRole[] =
  Object.freeze(['draft', 'executor', 'success-analyst', 'error-analyst', 'merge']);

type JsonSchema = Record<string, unknown> | boolean;

const textSlot = (minLength: number): Trace2SkillPromptVariable => ({ schema: { type: 'string', minLength }, render: 'text' });

/**
 * What each role's request may carry and what its answer must satisfy.
 *
 * The names here are the contract a pack's template is compiled against: a
 * template that uses a name this table does not declare is refused at build
 * time, and a value that does not match its schema is refused at render time.
 * `true` is the honest output schema for a role that answers as an agent
 * rather than as one structured call.
 */
export const TRACE2SKILL_PROMPT_CONTRACTS: Readonly<Record<Trace2SkillPromptRole, {
  variables: Trace2SkillPromptVariables, outputSchema: JsonSchema,
}>> = Object.freeze({
  'draft': { variables: { scope: textSlot(1) }, outputSchema: DRAFT_SKILL_SCHEMA as JsonSchema },
  // `inputs` is optional and may be empty: a task that names no file renders
  // the question alone rather than an empty heading.
  'executor': { variables: { task: textSlot(1), inputs: textSlot(0) }, outputSchema: true },
  'success-analyst': { variables: { evidence: textSlot(1) }, outputSchema: SUCCESS_ANALYSIS_SCHEMA as JsonSchema },
  'error-analyst': { variables: { evidence: textSlot(1) }, outputSchema: ERROR_PROPOSAL_SCHEMA as JsonSchema },
  'merge': { variables: { evidence: textSlot(1) }, outputSchema: MERGE_OUTPUT_SCHEMA as JsonSchema },
});

export interface CompileTrace2SkillPackOptions {
  variables: Trace2SkillPromptVariables;
  /** What the role's answer must satisfy; `true` where the role answers as an agent. */
  outputSchema: JsonSchema;
  /** Refuse a pack that does not declare this role, so a file name cannot disagree with its content. */
  role?: Trace2SkillPromptRole;
}

interface Rule { match?: unknown, mode?: string, priority?: number, body: unknown[] }

/** A scan refusal carries the pointer it happened at, so the pack's author is told where. */
class ScanRefusal extends Error {
  pointer: string;
  constructor(pointer: string, message: string) { super(message); this.pointer = pointer; }
}

/**
 * The one placeholder scanner of this package: `{{name}}` and balanced
 * `{{#if name}}…{{/if}}`, nothing else. A literal `$` is escaped so JTLT reads
 * it as text, and every name must be declared, so a template cannot reach a
 * value the artifact's closed variable schema does not describe.
 */
function textTemplate(text: string, variables: Trace2SkillPromptVariables): { required: string[], stylesheet: Record<string, unknown> } {
  const required = new Set<string>();
  const used = new Set<string>();
  const rules: Rule[] = [];
  let offset = 0;
  let serial = 0;
  const name = (token: string): string => {
    if (!/^[a-z][a-z0-9_]*$/.test(token) || ['constructor', 'prototype', '__proto__'].includes(token) || !Object.hasOwn(variables, token))
      throw new ScanRefusal('/user/content', `the template uses an undeclared or prohibited variable '${token}'`);
    used.add(token);
    return token;
  };
  const scan = (conditional: boolean): unknown[] => {
    const body: unknown[] = [];
    while (offset < text.length) {
      const start = text.indexOf('{{', offset);
      const literal = text.slice(offset, start < 0 ? text.length : start);
      if (literal.includes('}}')) throw new ScanRefusal('/user/content', 'the template closes a placeholder it never opened');
      if (literal !== '') body.push(literal.startsWith('$') ? '$' + literal : literal);
      if (start < 0) { offset = text.length; break; }
      const end = text.indexOf('}}', start + 2);
      if (end < 0) throw new ScanRefusal('/user/content', 'the template leaves a placeholder unclosed');
      const token = text.slice(start + 2, end).trim();
      offset = end + 2;
      if (token === '/if') {
        if (!conditional) throw new ScanRefusal('/user/content', 'the template ends a conditional block it never began');
        return body;
      }
      if (token.startsWith('#if ')) {
        const key = name(token.slice(4).trim());
        const mode = `condition-${++serial}`;
        const nested = scan(true);
        rules.push(
          {
            mode, priority: 1,
            match: { schema: { type: 'object', required: ['present'], properties: { present: { type: 'object', required: [key], properties: { [key]: { const: true } } } } } },
            body: nested,
          },
          { mode, body: [] },
        );
        body.push({ $apply: ['$', mode] });
        continue;
      }
      const key = name(token);
      if (!conditional) required.add(key);
      body.push(variables[key].render === 'json' ? { $json: `$.variables.${key}` } : `$.variables.${key}`);
    }
    if (conditional) throw new ScanRefusal('/user/content', 'the template leaves a conditional block unclosed');
    return body;
  };
  const body = scan(false);
  for (const key of Object.keys(variables)) {
    if (!used.has(key)) throw new ScanRefusal(`/variables/${key}`, `the pack declares '${key}' and the template never uses it`);
  }
  return { required: [...required].sort(), stylesheet: { $jtlt: '0.1', output: 'text', rules: [{ match: '$', body }, ...rules] } };
}

type TextRenderer = (value: unknown) => string;

function compileText(stylesheet: unknown): TextRenderer {
  return compileJtltStylesheet(stylesheet, {
    compileTypeTest: (schema: JsonSchema) => { const check = compileTrace2SkillSchema(schema); return (value: unknown) => check(value).valid; },
  }) as TextRenderer;
}

const variableSchemaOf = (variables: Trace2SkillPromptVariables, required: readonly string[]): Record<string, unknown> => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, value.schema])),
  required: [...required],
  additionalProperties: false,
});

/**
 * Compile one authored pack. Every refusal is a value carrying the pointer it
 * happened at; a TOML syntax failure carries the parser's own error as cause.
 */
export async function compileTrace2SkillPack(
  sourceText: string,
  options: CompileTrace2SkillPackOptions,
): Promise<Trace2SkillOutcome<Trace2SkillPromptArtifact>> {
  if (typeof sourceText !== 'string')
    return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1001', '', 'a prompt pack is authored as text');
  let parsed: unknown;
  try { parsed = parseToml(sourceText); }
  catch (cause) { return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1001', '', 'the prompt pack is not valid TOML', cause); }

  const shape = validateTrace2SkillShape<Trace2SkillPromptPack>('trace2SkillPromptPack', parsed);
  if (!shape.valid) return trace2SkillRefusal<Trace2SkillPromptArtifact>(shape.issues);
  const pack = shape.value;
  if (options.role !== undefined && pack.meta.role !== options.role)
    return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1001', '/meta/role', `the pack declares ${pack.meta.role} where ${options.role} was expected`);
  if (pack.system.content.includes('{{') || pack.system.content.includes('}}'))
    return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1001', '/system/content', 'system instructions are static and carry no placeholder');

  const declared = validateTrace2SkillShape<Trace2SkillPromptVariables>('trace2SkillPromptVariables', options.variables);
  if (!declared.valid) return trace2SkillRefusal<Trace2SkillPromptArtifact>(declared.issues);
  const variables = declared.value;

  try {
    for (const [key, variable] of Object.entries(variables)) {
      compileTrace2SkillSchema(variable.schema);
      const type = typeof variable.schema === 'object' ? String((variable.schema as Record<string, unknown>).type) : '';
      if (variable.render === 'text' && !['string', 'number', 'integer', 'boolean'].includes(type))
        throw new ScanRefusal(`/variables/${key}`, `'${key}' is substituted as text and needs a scalar schema`);
    }
    compileTrace2SkillSchema(options.outputSchema);
    const compiled = textTemplate(pack.user.content, variables);
    const variableSchema = variableSchemaOf(variables, compiled.required);
    compileTrace2SkillSchema(variableSchema);
    compileText(compiled.stylesheet);
    const payload = {
      id: pack.meta.id,
      role: pack.meta.role,
      policyVersion: TRACE2SKILL_PROMPT_POLICY as Trace2SkillPromptArtifact['policyVersion'],
      sourceDigest: await skillFileDigest(sourceText),
      pack,
      variables,
      variableSchema,
      outputSchema: options.outputSchema,
      userStylesheet: compiled.stylesheet,
    };
    return { valid: true, value: immutableJson({ ...payload, revision: await skillRevisionOf(payload) }) as Trace2SkillPromptArtifact };
  }
  catch (cause) {
    const pointer = cause instanceof ScanRefusal ? cause.pointer : '/user/content';
    return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1001', pointer,
      cause instanceof Error ? cause.message : 'the prompt pack does not compile', cause);
  }
}

/** A stored artifact still says what its source pack says, and its revision still names it. */
export async function validateTrace2SkillPromptArtifact(value: unknown): Promise<Trace2SkillOutcome<Trace2SkillPromptArtifact>> {
  const shape = validateTrace2SkillShape<Trace2SkillPromptArtifact>('trace2SkillPromptArtifact', value);
  if (!shape.valid) return shape;
  const artifact = shape.value;
  const { revision, ...payload } = artifact;
  if (await skillRevisionOf(payload) !== revision)
    return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1002', '/revision', 'the artifact revision does not name its own contents');
  try {
    const compiled = textTemplate(artifact.pack.user.content, artifact.variables);
    if (canonicalizeJson(compiled.stylesheet) !== canonicalizeJson(artifact.userStylesheet)
      || canonicalizeJson(variableSchemaOf(artifact.variables, compiled.required)) !== canonicalizeJson(artifact.variableSchema)
      || artifact.id !== artifact.pack.meta.id || artifact.role !== artifact.pack.meta.role)
      return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1002', '/userStylesheet', 'the compiled contract disagrees with its source pack');
    compileText(artifact.userStylesheet);
    compileTrace2SkillSchema(artifact.variableSchema);
    compileTrace2SkillSchema(artifact.outputSchema);
    return { valid: true, value: artifact };
  }
  catch (cause) {
    const pointer = cause instanceof ScanRefusal ? cause.pointer : '/user/content';
    return trace2SkillRefuse<Trace2SkillPromptArtifact>('TT2S1001', pointer, 'the artifact does not recompile from its own pack', cause);
  }
}

/** What `{{#if name}}` asks: is there anything here to talk about. */
function present(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return value === true;
}

/**
 * Render one artifact. The values substituted here are data: they are written
 * into the text as they are, never scanned for placeholders and never parsed.
 */
export function renderTrace2SkillPrompt(
  artifact: Trace2SkillPromptArtifact,
  variables: unknown,
): Trace2SkillOutcome<{ system: string, user: string }> {
  try {
    const stable = immutableJson(variables) as Record<string, unknown>;
    const check = compileTrace2SkillSchema(artifact.variableSchema)(stable);
    if (!check.valid)
      return trace2SkillRefuse<{ system: string, user: string }>('TT2S1001', check.errors?.[0]?.instancePath ?? '/variables',
        check.errors?.[0]?.message ?? 'the variables do not match the artifact\'s closed schema');
    const user = compileText(artifact.userStylesheet)({
      variables: stable,
      present: Object.fromEntries(Object.keys(artifact.variables).map(key => [key, present(stable[key])])),
    });
    return { valid: true, value: { system: artifact.pack.system.content, user } };
  }
  catch (cause) {
    return trace2SkillRefuse<{ system: string, user: string }>('TT2S1001', '/variables', 'the prompt did not render', cause);
  }
}

/** Seal a compiled set as the published catalogue; the revision covers every artifact in role order. */
export async function trace2SkillPromptCatalog(prompts: readonly Trace2SkillPromptArtifact[]): Promise<Trace2SkillOutcome<Trace2SkillPromptCatalog>> {
  const ordered = TRACE2SKILL_PROMPT_ROLES.map(role => prompts.find(prompt => prompt.role === role));
  const missing = TRACE2SKILL_PROMPT_ROLES.filter((_, index) => ordered[index] === undefined);
  if (missing.length > 0)
    return trace2SkillRefuse<Trace2SkillPromptCatalog>('TT2S1001', '/prompts', `the set is missing a pack for ${missing.join(', ')}`);
  if (prompts.length !== TRACE2SKILL_PROMPT_ROLES.length)
    return trace2SkillRefuse<Trace2SkillPromptCatalog>('TT2S1001', '/prompts', `the set holds ${prompts.length} packs where ${TRACE2SKILL_PROMPT_ROLES.length} roles are addressed`);
  const payload = {
    document: 'trace2skill-prompts' as const,
    policyVersion: TRACE2SKILL_PROMPT_POLICY as Trace2SkillPromptCatalog['policyVersion'],
    prompts: ordered as Trace2SkillPromptArtifact[],
  };
  const catalog = { ...payload, revision: await skillRevisionOf(payload) };
  return validateTrace2SkillShape<Trace2SkillPromptCatalog>('trace2SkillPromptCatalog', catalog);
}
