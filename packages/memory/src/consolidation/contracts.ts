/** Immutable evidence identities and explicit domain refusals. */
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { cloneJson } from '@jarenjs/core/object';
import { isVector } from '@jarenjs/core/vector';
import { validateConsolidationShape, type ConsolidationSchemaName, type ConsolidationSource,
  type ConsolidationArtifact, type ConsolidationReason } from '@tangleai/core/schemas/consolidation';
export type * from '@tangleai/core/schemas/consolidation';
export type ConsolidationResult<T> = { status: 'success'; value: T } | {
  status: 'refused'; reason: ConsolidationReason; detail: string;
};
export const consolidationHash = canonicalSha256;
export function consolidationSuccess<T>(value: T): ConsolidationResult<T> { return { status: 'success', value }; }
export function consolidationRefusal(reason: ConsolidationReason, detail: string): ConsolidationResult<never> {
  return { status: 'refused', reason, detail };
}
export function checkConsolidation<T>(name: ConsolidationSchemaName, value: unknown,
  reason: ConsolidationReason): ConsolidationResult<T> {
  try {
    canonicalizeJson(value);
    const checked = validateConsolidationShape(name, value);
    if (!checked.valid) return consolidationRefusal(reason, `invalid ${name}: ${JSON.stringify(checked.errors?.[0] ?? null)}`);
    return consolidationSuccess(cloneJson(value) as T);
  } catch (cause) {
    return consolidationRefusal(reason, cause instanceof Error ? cause.message : String(cause));
  }
}
export const sameConsolidationValue = (a: unknown, b: unknown): boolean => canonicalizeJson(a) === canonicalizeJson(b);
function validEmbedding(value: { embedding?: number[]; embeddedBy?: { model: string; dims: number } }): boolean {
  return value.embedding === undefined ? value.embeddedBy === undefined
    : value.embeddedBy !== undefined && isVector(value.embedding, value.embeddedBy.dims);
}
export async function createConsolidationSource(input: Omit<ConsolidationSource, 'id'>): Promise<ConsolidationResult<ConsolidationSource>> {
  const checked = checkConsolidation<ConsolidationSource>('consolidationSource', { ...input, id: '0'.repeat(64) }, 'invalid-source');
  if (checked.status !== 'success') return checked;
  if (!validEmbedding(checked.value.snapshot)) return consolidationRefusal('invalid-source', 'source embedding does not match its identity');
  const { id: _, ...body } = checked.value;
  return consolidationSuccess({ ...body, id: await consolidationHash(['source', body]) });
}
export async function validateConsolidationSource(input: unknown): Promise<ConsolidationResult<ConsolidationSource>> {
  const checked = checkConsolidation<ConsolidationSource>('consolidationSource', input, 'invalid-source');
  if (checked.status !== 'success') return checked;
  const rebuilt = await createConsolidationSource(checked.value);
  if (rebuilt.status !== 'success') return rebuilt;
  return rebuilt.value.id === checked.value.id ? rebuilt : consolidationRefusal('identity-conflict', 'source snapshot hash differs');
}
export async function createConsolidationArtifact(input: Omit<ConsolidationArtifact, 'id'>): Promise<ConsolidationResult<ConsolidationArtifact>> {
  const checked = checkConsolidation<ConsolidationArtifact>('consolidationArtifact', { ...input, id: '0'.repeat(64) }, 'invalid-artifact');
  if (checked.status !== 'success') return checked;
  if (!validEmbedding(checked.value)) return consolidationRefusal('embedding', 'artifact embedding does not match its identity');
  const { id: _, ...body } = checked.value;
  return consolidationSuccess({ ...body, id: await consolidationHash(['artifact', body]) });
}
export async function validateConsolidationArtifact(input: unknown): Promise<ConsolidationResult<ConsolidationArtifact>> {
  const checked = checkConsolidation<ConsolidationArtifact>('consolidationArtifact', input, 'invalid-artifact');
  if (checked.status !== 'success') return checked;
  const rebuilt = await createConsolidationArtifact(checked.value);
  if (rebuilt.status !== 'success') return rebuilt;
  return rebuilt.value.id === checked.value.id ? rebuilt : consolidationRefusal('identity-conflict', 'artifact content hash differs');
}
