/**
 * Strict structured output, before and after its profile: does a provider's
 * strict mode accept the suite's real schemas, as they are and as
 * `deriveStrictProfile` (from `@jarenjs/validate/strict-profile`) rewrites
 * them, and does the answer validate against the ORIGINAL schema?
 *
 *   node benchmark/strict-profile.ts            keyless: derive every profile, print the plan
 *   node --env-file-if-exists=.env benchmark/strict-profile.ts --live [--out benchmark/results/strict-profile-live.json]
 *
 * One request per schema and condition, no repairs, on the provider's
 * `json_schema` tier with `strict: true`: a refusal is the provider
 * answering an error for the schema itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { deriveStrictProfile } from '@jarenjs/validate/strict-profile';
import { programSchema } from '../packages/agents/src/schemas/program.ts';
import { CONTRADICTION_VERDICT_SCHEMA } from '../packages/memory/src/index.ts';
import { readAiEnv, chatSettingsOf } from './lib/ai-env.ts';

const root = new URL('..', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const grounding = read('packages/grounding/schemas/grounding.schema.json');
const runIdentity = read('packages/config/schemas/run-identity.schema.json');

/** The schemas, each with what to ask so an answer is meaningful. */
const CASES: { id: string, schema: any, refs: any[], ask: string }[] = [
  { id: 'grounded-answer', schema: { $ref: `${grounding.$id}#/$defs/groundedAnswer` }, refs: [grounding, runIdentity],
    ask: 'Write an example grounded answer to the question "Where is the office?" that refuses for lack of evidence. Fill identifiers with plausible values.' },
  { id: 'program', schema: programSchema(), refs: [],
    ask: 'Write a one-step program that answers "what is 2 + 2" with the answer 4.' },
  { id: 'contradiction-verdict', schema: CONTRADICTION_VERDICT_SCHEMA, refs: [],
    ask: 'Judge: "The office is in Arnhem" (older) and "The office is in Nijmegen" (newer). Do they contradict?' },
  { id: 'answer-oneof', refs: [], ask: 'Answer whether Amsterdam is the capital of the Netherlands.',
    schema: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { oneOf: [{ const: 'answer' }, { const: 'refusal' }] }, text: { type: 'string' }, score: { type: 'number', minimum: 0, maximum: 1 } } } },
];

const { values: args } = parseArgs({ options: { live: { type: 'boolean', default: false }, out: { type: 'string', default: 'benchmark/results/strict-profile-live.json' }, only: { type: 'string' } } });
const chosen = args.only ? CASES.filter(c => args.only!.split(',').includes(c.id)) : CASES;

for (const c of CASES) {
  const profile = deriveStrictProfile(c.schema, { references: c.refs });
  const text = JSON.stringify(profile.schema);
  console.log(`${c.id}: profile ${text.length} bytes, oneOf ${text.includes('"oneOf"') ? 'present' : 'gone'}`);
}
const planned = chosen.length * 2;
if (!args.live) { console.log(`plan: ${planned} requests (each schema as it is and as its profile, no repairs)`); process.exit(0); }

const env = readAiEnv(process.env);
if (!env.live) { console.log(`skipped: ${env.reason}`); process.exit(0); }
if (planned > env.maxCalls) { console.log(`refused: the plan needs ${planned} requests and the ceiling is ${env.maxCalls}`); process.exit(2); }
const { chatClientFor } = await import('../apps/desktop/src/settings.ts');
const { createStructuredOutput } = await import('../packages/models/src/structured.ts');
let calls = 0;
const metered: typeof fetch = async (input, init) => { if (++calls > env.maxCalls) throw new Error('the request ceiling is reached'); return fetch(input, init); };
const client = chatClientFor(chatSettingsOf(env), { fetch: metered, retry: { attempts: 2 }, structured: 'json_schema' as any });

const rows: any[] = [];
for (const c of chosen) for (const condition of ['as-is', 'profile'] as const) {
  const generator = createStructuredOutput({
    client, schema: c.schema, refs: c.refs, name: c.id.replace(/-/g, '_'), maxRepairs: 0, tier: 'json_schema',
    ...(condition === 'profile' ? { profile: 'strict' as const } : { bundle: true, strict: true }),
  });
  let outcome: string, detail: string | null = null;
  try {
    const result: any = await generator.generate([{ role: 'user', content: c.ask }]);
    outcome = result.ok ? 'valid' : 'invalid';
    if (!result.ok) detail = JSON.stringify(result.errors?.[0] ?? null).slice(0, 240);
  } catch (error: any) {
    const message = String(error?.message ?? error);
    outcome = /\b4\d\d\b|schema|not supported|invalid_request/i.test(message) ? 'refused' : 'error';
    detail = message.slice(0, 1200);
  }
  rows.push({ schema: c.id, condition, outcome, detail });
  console.log(JSON.stringify({ schema: c.id, condition, outcome, detail: detail?.slice(0, 120) }));
}
const count = (condition: string, outcome: string) => rows.filter(r => r.condition === condition && r.outcome === outcome).length;
const report = {
  $comment: 'Live strict structured output: each schema as it is and as its strict profile, one request each, no repairs. Validated by tests, never regenerated by them.',
  generated: { at: new Date().toISOString(), model: env.model, provider: env.provider, tier: 'json_schema', strict: true, schemas: chosen.map(c => c.id) },
  summary: Object.fromEntries((['as-is', 'profile'] as const).map(c => [c, { refused: count(c, 'refused'), valid: count(c, 'valid'), invalid: count(c, 'invalid'), error: count(c, 'error') }])),
  calls, rows,
};
writeFileSync(new URL(args.out!, root), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
