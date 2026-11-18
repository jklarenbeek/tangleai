/**
 * Capabilities: what an application's domain offers the assistant and the
 * inbox, declared as data instead of hand-kept lists. A capability names its
 * contract documents (the assistant's tools come from them), the reads that
 * give the assistant its context (read operations of those contracts), the
 * kinds of proposal the domain files with each kind's review policy, and a
 * prompt pack in the person's languages. One capability serves every module of
 * its domain: a module's manifest names the capabilities it files for, and
 * the kernel takes the kinds and their policies from there.
 *
 * A review policy says which origins may file a kind (`human`, `rule`,
 * `import`, `ai`), which the kernel enforces, and which roles may decide it,
 * which the desktop shows and hands to the module with the decision: the
 * owner knows who the person is and re-checks before it applies.
 */
import { localized, type LocalizedText } from './manifest.ts';

export type CapabilityOrigin = 'human' | 'rule' | 'import' | 'ai';
export type CapabilityDocument = {
  $capability: '0.1',
  id: string,
  title: LocalizedText,
  contracts: { $contract: string, id: string, operations: Record<string, any>, [member: string]: unknown }[],
  context?: { id: string, contract: string, op: string, input?: Record<string, unknown>, title?: LocalizedText }[],
  proposals?: { kind: string, title: LocalizedText, review?: { origins?: CapabilityOrigin[], roles?: string[] } }[],
  prompts: { en: CapabilityPrompt } & Partial<Record<string, CapabilityPrompt>>,
};
/** One language of a prompt pack: what the assistant is told about the domain, and about each kind it may propose. */
export type CapabilityPrompt = { system: string, kinds?: Record<string, string> };

const ID = '^[a-z][a-z0-9-]{0,63}$';
const KIND = '^[a-z][a-z0-9.-]{0,63}$';
const TEXT = { type: 'object', required: ['en'], additionalProperties: { type: 'string', maxLength: 200 }, properties: { en: { type: 'string', minLength: 1, maxLength: 200 } } };
const PROMPT = {
  type: 'object', additionalProperties: false, required: ['system'],
  properties: { system: { type: 'string', minLength: 1, maxLength: 8000 }, kinds: { type: 'object', maxProperties: 32, propertyNames: { pattern: KIND }, additionalProperties: { type: 'string', maxLength: 2000 } } },
};
/** The capability document: bounded, closed JSON. */
export const CAPABILITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['$capability', 'id', 'title', 'contracts', 'prompts'],
  properties: {
    $capability: { const: '0.1' },
    id: { type: 'string', pattern: ID },
    title: TEXT,
    contracts: { type: 'array', maxItems: 16, items: { type: 'object', required: ['$contract', 'id', 'operations'], properties: { $contract: { type: 'string' }, id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' }, operations: { type: 'object' } } } },
    context: {
      type: 'array', maxItems: 16,
      items: { type: 'object', additionalProperties: false, required: ['id', 'contract', 'op'], properties: { id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' }, contract: { type: 'string' }, op: { type: 'string', maxLength: 128 }, input: { type: 'object' }, title: TEXT } },
    },
    proposals: {
      type: 'array', maxItems: 32,
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'title'],
        properties: {
          kind: { type: 'string', pattern: KIND }, title: TEXT,
          review: { type: 'object', additionalProperties: false, properties: {
            origins: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['human', 'rule', 'import', 'ai'] } },
            roles: { type: 'array', maxItems: 16, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,64}$' } },
          } },
        },
      },
    },
    prompts: { type: 'object', required: ['en'], maxProperties: 12, propertyNames: { pattern: '^[a-z]{2}(-[A-Z]{2})?$' }, additionalProperties: PROMPT, properties: { en: PROMPT } },
  },
} as const;

export type CapabilityIssue = { code: string, path: string, message: string };

/**
 * What the schema cannot say: every context read is a read operation of one
 * of the capability's own contracts, every kind is named once, and a prompt
 * for a kind names a kind the capability files.
 */
export function capabilityIssues(doc: CapabilityDocument): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const contracts = new Map(doc.contracts.map(c => [c.id, c]));
  if (contracts.size !== doc.contracts.length) issues.push({ code: 'OS0131', path: '/contracts', message: 'a contract is listed twice' });
  for (const [i, read] of (doc.context ?? []).entries()) {
    const op = contracts.get(read.contract)?.operations?.[read.op];
    if (!op) issues.push({ code: 'OS0131', path: `/context/${i}`, message: `'${read.contract}.${read.op}' is not an operation of this capability's contracts` });
    else if ((op.kind ?? 'read') !== 'read') issues.push({ code: 'OS0131', path: `/context/${i}`, message: `'${read.contract}.${read.op}' is a ${op.kind}, and context only reads` });
  }
  const kinds = new Set<string>();
  for (const [i, p] of (doc.proposals ?? []).entries()) {
    if (kinds.has(p.kind)) issues.push({ code: 'OS0131', path: `/proposals/${i}/kind`, message: `the kind '${p.kind}' is declared twice` });
    kinds.add(p.kind);
  }
  for (const [lang, prompt] of Object.entries(doc.prompts)) for (const kind of Object.keys(prompt?.kinds ?? {}))
    if (!kinds.has(kind)) issues.push({ code: 'OS0131', path: `/prompts/${lang}/kinds/${kind}`, message: `the prompt names '${kind}', which this capability does not file` });
  return issues;
}

/**
 * Whether a set of capabilities and the manifests that name them agree: each
 * named capability is installed, and each proposal kind is declared once
 * across the capabilities and the modules' own `proposals`.
 */
export function checkCapabilities(capabilities: readonly CapabilityDocument[], manifests: readonly { id: string, capabilities?: string[], proposals?: { kind: string }[] }[]): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const byId = new Map(capabilities.map(c => [c.id, c]));
  const owner = new Map<string, string>();
  for (const c of capabilities) for (const p of c.proposals ?? []) {
    if (owner.has(p.kind)) issues.push({ code: 'OS0132', path: `/capabilities/${c.id}`, message: `the kind '${p.kind}' is declared by both '${owner.get(p.kind)}' and '${c.id}'` });
    else owner.set(p.kind, `capability ${c.id}`);
  }
  for (const m of manifests) {
    for (const id of m.capabilities ?? []) if (!byId.has(id)) issues.push({ code: 'OS0132', path: `/modules/${m.id}/capabilities`, message: `'${m.id}' files for '${id}', which is not installed` });
    for (const p of m.proposals ?? []) {
      const by = owner.get(p.kind);
      if (by && by !== `module ${m.id}`) issues.push({ code: 'OS0132', path: `/modules/${m.id}/proposals`, message: `the kind '${p.kind}' of '${m.id}' is already declared by ${by}` });
      else owner.set(p.kind, `module ${m.id}`);
    }
  }
  return issues;
}

/** A capability's prompt in a language: that language's, else English. */
export function capabilityPrompt(doc: CapabilityDocument, locale: string): CapabilityPrompt {
  return doc.prompts[locale] ?? doc.prompts[locale.split('-')[0]] ?? doc.prompts.en;
}

/**
 * The assistant's system text for a set of capabilities, in the person's
 * language: each capability's title and prompt, then what it may propose,
 * in the order given. Deterministic, so a prompt pack's change is visible as
 * a text change; it reads nothing and runs nothing.
 */
export function capabilitiesPrompt(capabilities: readonly CapabilityDocument[], locale = 'en'): string {
  return capabilities.map((c) => {
    const prompt = capabilityPrompt(c, locale);
    const lines = [`## ${localized(c.title, locale)}`, '', prompt.system.trim()];
    const kinds = (c.proposals ?? []).map(p => {
      const about = prompt.kinds?.[p.kind] ?? c.prompts.en.kinds?.[p.kind];
      const origins = p.review?.origins ? ` (filed by: ${p.review.origins.join(', ')})` : '';
      return `- \`${p.kind}\`: ${localized(p.title, locale)}${origins}${about ? ` — ${about.trim()}` : ''}`;
    });
    if (kinds.length) lines.push('', ...kinds);
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Compose what a set of capabilities gives an assistant: its system text, a
 * toolbox of every contract's operations (through the host's tool builder and
 * clients, so the kernel's grants or the server's own checks apply), and a
 * reader that runs every declared context read through the host's `call`.
 */
export function composeCapabilities(capabilities: readonly CapabilityDocument[], options: {
  locale?: string,
  tools?: { createToolbox: () => any, toolboxFromContract: (contract: any, client: { invoke: (op: string, input: unknown) => Promise<unknown> }, options: { toolbox: any, ops: string[], name: (op: string) => string }) => unknown },
  compile?: (contract: unknown) => any,
  client?: (contract: string) => { invoke: (op: string, input: unknown) => Promise<unknown> },
  call?: (contract: string, op: string, input: unknown) => Promise<unknown>,
} = {}) {
  const system = capabilitiesPrompt(capabilities, options.locale ?? 'en');
  let toolbox: unknown = null;
  if (options.tools && options.client && options.compile) {
    toolbox = options.tools.createToolbox();
    for (const c of capabilities) for (const contract of c.contracts) {
      const ops = Object.keys(contract.operations);
      options.tools.toolboxFromContract(options.compile(contract), options.client(contract.id), { toolbox, ops, name: (op) => `${contract.id}__${op.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64) });
    }
  }
  const kinds = capabilities.flatMap(c => (c.proposals ?? []).map(p => ({ capability: c.id, kind: p.kind, origins: p.review?.origins ?? null, roles: p.review?.roles ?? [] })));
  async function context(): Promise<Record<string, unknown>> {
    if (!options.call) return {};
    const out: Record<string, unknown> = {};
    for (const c of capabilities) for (const read of c.context ?? []) out[`${c.id}.${read.id}`] = await options.call(read.contract, read.op, read.input ?? {});
    return out;
  }
  return { system, toolbox, kinds, context };
}
