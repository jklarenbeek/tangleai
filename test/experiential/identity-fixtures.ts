import assert from 'node:assert/strict';
import { sealExperientialRecord, type ExperientialRecordKind, type ExperientialRecordMap, type ExperientialResult } from '@tangleai/experiential';
import { experientialSchemaFixtures } from './schema-fixtures.ts';

export function accepted<T>(result: ExperientialResult<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Expected a successful fixture result.');
  return result.value;
}
export async function addressedFixture<K extends ExperientialRecordKind>(kind: K, changes: Partial<ExperientialRecordMap[K]> = {}): Promise<ExperientialRecordMap[K]> {
  const { id: _, ...body } = { ...experientialSchemaFixtures()[kind], ...changes };
  return accepted(await sealExperientialRecord(kind, body as Omit<ExperientialRecordMap[K], 'id'>));
}
