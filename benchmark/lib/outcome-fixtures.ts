/** Registered inputs and independent golden outcomes; no lifecycle implementation. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import schema from '../schemas/outcome-conformance.schema.json' with { type: 'json' };
import { createReportValidator } from './validate.ts';
import type { Case, HeldCase, Lifecycle, Manifest, Json } from './outcome-conformance.types.ts';

const validators = new Map<string, ReturnType<typeof createReportValidator>>();
export function validateFixture<T>(name: string, value: unknown): T {
  let validate = validators.get(name);
  if (!validate) { validate = createReportValidator({ $defs: schema.$defs, $ref: `#/$defs/${name}` }); validators.set(name, validate); }
  const result = validate(value);
  if (!result.valid) throw new Error(`invalid outcome ${name}: ${JSON.stringify(result.errors)}`);
  return value as T;
}
export const caseDigest = (row: { domain: string; input: Json; outcome: Json }) => canonicalSha256({ domain: row.domain, input: row.input, outcome: row.outcome });
export async function loadOutcomeFixtures(root = process.cwd()) {
  const dir = join(root, 'benchmark/fixtures/outcome');
  const read = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(dir, name), 'utf8'));
  const manifest = validateFixture<Manifest>('manifest', await read('manifest.json'));
  const { registrationId, ...payload } = manifest;
  if (await canonicalSha256(payload) !== registrationId) throw new Error('outcome registration digest mismatch');
  if (manifest.files.map(f => f.path).join(',') !== 'quality.json,held-out.json,lifecycle.json') throw new Error('outcome fixture allowlist mismatch');
  const loaded = new Map<string, unknown>();
  for (const entry of manifest.files) {
    const value = await read(entry.path);
    if (await canonicalSha256(value) !== entry.digest) throw new Error(`outcome fixture digest mismatch: ${entry.path}`);
    loaded.set(entry.path, value);
  }
  const qualityRaw = loaded.get('quality.json'), heldRaw = loaded.get('held-out.json');
  if (!Array.isArray(qualityRaw) || !Array.isArray(heldRaw)) throw new Error('outcome fixture arrays missing');
  const quality = qualityRaw.map(v => validateFixture<Case>('case', v));
  const held = heldRaw.map(v => validateFixture<HeldCase>('heldCase', v));
  const lifecycle = validateFixture<Lifecycle>('lifecycle', loaded.get('lifecycle.json'));
  if (quality.length !== 32 || quality.filter(c => c.outcome !== null).length !== 24 || held.length !== 24 || lifecycle.scenarios.length < 24) throw new Error('outcome fixture census mismatch');
  const cases = [...quality, ...held];
  if (new Set(cases.map(c => c.id)).size !== cases.length || new Set(await Promise.all(cases.map(caseDigest))).size !== cases.length) throw new Error('outcome training/held-out id or content overlap');
  for (const domain of ['direction-delta','exact-match']) {
    for (let round=1; round<=4; round++) if (quality.filter(c => c.domain===domain && c.round===round).length!==4) throw new Error('outcome round partition mismatch');
    for (let slot=1; slot<=3; slot++) if (held.filter(c => c.domain===domain && c.slot===slot).length!==4) throw new Error('outcome held-out slot mismatch');
  }
  return { manifest, quality, held, lifecycle };
}
export type OutcomeFixtures = Awaited<ReturnType<typeof loadOutcomeFixtures>>;
