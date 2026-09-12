/** Exact labels and a bounded, deterministic prefix interpreter. */
import schema from '../../schemas/exact-match.schema.json' with { type: 'json' };
import { adapterIdentity, domainValidator } from '../domain.ts';
import { issue, reject } from '../errors.ts';
import type { OutcomeAdapter } from '../adapters.ts';
import type { Input, Output, Resolution, Artifact } from './exact-match.gen.ts';

function codePointOrder(a: string, b: string): number {
  const x = Array.from(a, c => c.codePointAt(0)!), y = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
export async function createExactMatchAdapter(): Promise<OutcomeAdapter> {
  const schemas = schema.$defs;
  const input = domainValidator(schemas.input), output = domainValidator(schemas.output);
  const resolution = domainValidator(schemas.resolution), artifact = domainValidator(schemas.artifact);
  const normalize = (raw: unknown) => {
    const payload = artifact(raw) as unknown as Artifact;
    return { ...payload, rules: [...payload.rules].sort((a, b) => Array.from(b.prefix).length - Array.from(a.prefix).length || codePointOrder(a.prefix, b.prefix)) };
  };
  return Object.freeze({
    identity: await adapterIdentity('exact-match/v1', schemas, { scorer: 'case-sensitive equality', interpreter: 'longest Unicode code-point prefix; code-point tie order', normalization: 'none' }),
    schemas, staticPayload: { fallbackLabel: 'unknown', rules: [] },
    normalizePayload: raw => artifact(normalize(raw)),
    validatePayload(raw) {
      const payload = artifact(raw) as unknown as Artifact;
      return new Set(payload.rules.map(r => r.prefix)).size === payload.rules.length ? [] : [issue('OUTC1010', 'Prefixes must be unique.')];
    },
    interpret(raw, payload) {
      const { token } = input(raw) as unknown as Input, p = normalize(payload);
      if (new Set(p.rules.map(r => r.prefix)).size !== p.rules.length) reject('OUTC1010', 'Prefixes must be unique.');
      return { label: p.rules.find(r => token.startsWith(r.prefix))?.label ?? p.fallbackLabel };
    },
    score(raw, evidence) {
      const a = output(raw) as unknown as Output, b = resolution(evidence) as unknown as Resolution;
      const equal = a.label === b.label;
      return { outcome: equal ? 'success' : 'failure', diagnostics: { equal } };
    },
  } satisfies OutcomeAdapter);
}
