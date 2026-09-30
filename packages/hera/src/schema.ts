/** Generated contracts are the only content gate for every persistence adapter. */
import { JarenValidator } from '@jarenjs/validate';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import schema from '../schemas/hera.schema.json' with { type: 'json' };
import { heraRefuse, type HeraOutcome } from './errors.ts';
import { immutableHeraJson, heraContentIdOf, heraLibraryRevisionOf } from './identity.ts';
import type { HeraRecordKind, HeraRecords } from './store.ts';
export { schema as heraSchema };
export type HeraSchemaName = keyof typeof schema.$defs;
const owner = new JarenValidator({ collectErrors: true, skipErrors: false, unknownFormats: 'ignore' });
owner.addSchema(schema);
const validators = new Map<HeraSchemaName, (value: unknown) => {valid: boolean; errors?: unknown[]}>();
/** Reachable definitions only: model output schemas never include stored trajectory data. */
export function heraSchemaOf(name: HeraSchemaName): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const ref = (value as Record<string, unknown>).$ref;
    if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
      const key = ref.slice(8) as HeraSchemaName;
      if (!Object.hasOwn(definitions, key)) { definitions[key] = schema.$defs[key]; visit(definitions[key]); }
    }
    Object.values(value).forEach(visit);
  };
  visit(schema.$defs[name]);
  return immutableHeraJson({ $id: schema.$id + '/' + name, ...schema.$defs[name], $defs: definitions });
}
export function validateHeraShape<T>(name: HeraSchemaName, value: unknown): HeraOutcome<T> {
  try {
    canonicalizeJson(value);
    let check = validators.get(name);
    if (!check) { check = owner.compile({ $ref: schema.$id + '#/$defs/' + name }); validators.set(name, check); }
    const result = check(value);
    if (!result.valid) {
      const issue = result.errors?.[0] as { instancePath?: string; message?: string } | undefined;
      return heraRefuse('THERA1001', issue?.instancePath ?? '', issue?.message ?? `Invalid ${name}.`);
    }
    return { valid: true, value: immutableHeraJson(value) as T };
  } catch (error) { return heraRefuse('THERA1001', '', `Invalid ${name}.`, error instanceof Error ? error.message : String(error)); }
}
const recordSchemas = {
  operation: 'heraOperation', agent: 'heraAgentDefinition', promptVersion: 'heraPromptVersion', experience: 'heraExperience',
  topology: 'heraTopology', rolloutGroup: 'heraRolloutGroup', trajectory: 'heraTrajectory',
  trajectoryStep: 'heraTrajectoryStep', advantage: 'heraSemanticAdvantage', promptTrial: 'heraPromptTrial',
  snapshot: 'heraLearningSnapshot', head: 'heraHead',
} as const;
/** Execution ids bind their semantic key; learning payloads bind their full immutable content. */
export async function validateHeraRecord<K extends HeraRecordKind>(kind: K, value: unknown): Promise<HeraOutcome<HeraRecords[K]>> {
  const shape = validateHeraShape<HeraRecords[K]>(recordSchemas[kind], value);
  if (!shape.valid) return shape;
  const record = shape.value;
  if (['promptVersion', 'experience', 'snapshot', 'advantage', 'promptTrial'].includes(kind) && record.id !== await heraContentIdOf(record))
    return heraRefuse('THERA1002', '/id', 'The immutable content identity is stale.');
  if (kind === 'snapshot') {
    const snapshot = record as HeraRecords['snapshot'];
    if (snapshot.libraryRevision !== await heraLibraryRevisionOf(snapshot.experienceIds))
      return heraRefuse('THERA1002', '/libraryRevision', 'The frozen library membership differs from its revision.');
  }
  return shape;
}
