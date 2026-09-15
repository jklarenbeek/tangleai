/**
 * An immutable address covers every semantic field except the address.
 *
 * No clock enters an identity. A host tick lives beside the record, so
 * the same experiment re-derived on another day hashes the same — which
 * is what lets a replay prove it read the bytes it claims to have read.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { checkRecordShape } from './schema.ts';
import { refuseOne, type EvolveOutcome } from './errors.ts';

/** The one identity helper. Everything addressable in this package uses it. */
export const evolveRevision = canonicalSha256;

/** The id a record must carry: its own canonical hash, without the id. */
export async function recordIdOf(value: { id?: string } & Record<string, unknown>): Promise<string> {
  const { id: _id, ...data } = value;
  return canonicalSha256(data);
}

/** Validate a record's shape AND that its id is the hash of its own bytes. */
export async function validateRecord<T extends { id: string }>(value: unknown, path = ''): Promise<EvolveOutcome<T>> {
  const shape = checkRecordShape<T>(value, path);
  if (!shape.ok) return shape;
  const expected = await recordIdOf(shape.value as unknown as { id?: string } & Record<string, unknown>);
  if (expected !== shape.value.id) {
    return refuseOne<T>('TEVO1002', path + '/id', 'Immutable record bytes do not match their id.');
  }
  return shape;
}

/** Compute the id for a record written without one, then validate it. */
export async function sealRecord<T extends { id: string }>(value: unknown, path = ''): Promise<EvolveOutcome<T>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refuseOne<T>('TEVO1001', path, 'A record must be a JSON object.');
  }
  const { id: _id, ...data } = value as { id?: string } & Record<string, unknown>;
  let id: string;
  try {
    id = await canonicalSha256(data);
  }
  catch {
    return refuseOne<T>('TEVO1001', path, 'Only finite JSON data can be sealed.');
  }
  return validateRecord<T>({ ...data, id }, path);
}

/** The semantic uniqueness key: one experiment per repository, base and proposal. */
export function experimentKey(repositoryId: string, baseRevision: string, proposalId: string): string {
  return repositoryId + ' ' + baseRevision + ' ' + proposalId;
}
