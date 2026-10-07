/** Stable content addresses; observation metadata is retained beside identity. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { validateExperientialRecord, type ExperientialRecordKind, type ExperientialRecordMap } from './schema.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';

const common = ['document', 'schemaVersion', 'scope'] as const;
/** Explicit projections prevent a future operational field silently changing ancestry. */
const fields = {
  experience: ['taskRef', 'inputRef', 'outputRef', 'observedOutcome', 'sourceRefs', 'producingIdentityId', 'trust', 'privacy', 'contentDigest'],
  assessment: ['experienceId', 'author', 'policyRevision', 'generalizable', 'rationale', 'duplicateOf', 'contradiction', 'trustDecision', 'inclusion', 'reason', 'supportingIds'],
  dataset: ['selectedIds', 'assessmentIds', 'splits', 'groupKeys', 'seed', 'templateRevision', 'tokenizerIdentity', 'chatTemplateIdentity', 'manifestDigest', 'exclusions', 'selection', 'evaluationReferences', 'concepts', 'heldoutPairs', 'groupingExperienceIds', 'groupingAssessmentIds'],
  trainingRun: ['idempotencyKey', 'datasetId', 'baseArtifactId', 'method', 'hyperparameters', 'backendIdentity', 'budget', 'spec', 'pipelineRevision', 'runtime'],
  artifact: ['checksum', 'baseArtifactId', 'kind', 'method', 'storageUri', 'runtime', 'trainingRunId', 'sizeBytes'],
  evaluation: ['artifactId', 'baselineArtifactId', 'gatePolicyId', 'reportId', 'passed', 'failures', 'interval'],
  gatePolicy: ['primaryMetric', 'controls', 'interval', 'learning', 'retention', 'security', 'operations', 'rows', 'requiredRows'],
  approval: ['profile', 'action', 'artifactId', 'evaluationId', 'expectedHead', 'principal', 'reason'],
  deployment: ['profile', 'base', 'activeArtifactId', 'canaryArtifactId', 'rolloutFraction', 'expectedParentArtifactId', 'approvalId', 'revision'],
  inferencePin: ['runId', 'identityId', 'deploymentId', 'deploymentRevision', 'artifactId', 'servedModel', 'canary'],
  retentionDecision: ['episodeIds', 'dependentArtifactId', 'decision', 'reason', 'principal', 'evidence'],
  event: ['seq', 'kind', 'recordId', 'runId', 'detail'],
  head: ['profile'],
} as const satisfies { [K in ExperientialRecordKind]: readonly (keyof ExperientialRecordMap[K])[] };

/** Hash a caller's explicit credential-free identity payload using the canonical owner. */
export const experientialRevisionOf = canonicalSha256;

/** The stable head address is partitioned by both deployment profile and logical scope. */
export function experientialHeadKey(profile: string, scope: string): Promise<string> {
  return experientialRevisionOf({ document: 'experiential-head', schemaVersion: 1, scope, profile });
}

export function experientialRecordId<K extends ExperientialRecordKind>(kind: K, record: ExperientialRecordMap[K]): Promise<string> {
  if (!Object.hasOwn(fields, kind)) throw new TypeError('Unknown experiential record kind.');
  const value = record as unknown as Record<string, unknown>;
  const payload = Object.fromEntries([...common, ...fields[kind]].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  // Measurement cost is an observation, while configured budget ceilings above
  // are part of the experiment. Scientific row contents still bind the record.
  if (kind === 'evaluation') payload.rows = (record as ExperientialRecordMap['evaluation']).rows.map(({ cost: _, ...row }) => row);
  return experientialRevisionOf(payload);
}

export async function checkExperientialRecord<K extends ExperientialRecordKind>(kind: K, input: unknown): Promise<ExperientialResult<ExperientialRecordMap[K]>> {
  const shape = validateExperientialRecord(kind, input);
  if (!shape.ok) return shape;
  if (await experientialRecordId(kind, shape.value) !== shape.value.id)
    return refuseExperiential('TEXP1002', '/id', 'The content identity does not reproduce from its immutable inputs.');
  return shape;
}

/** Snapshot before awaiting a digest; identities never read later caller mutations. */
export async function sealExperientialRecord<K extends ExperientialRecordKind>(kind: K, input: Omit<ExperientialRecordMap[K], 'id'>): Promise<ExperientialResult<ExperientialRecordMap[K]>> {
  let body: Record<string, unknown>;
  try { body = JSON.parse(canonicalizeJson(input)); }
  catch { return refuseExperiential('TEXP1001', '', 'Only finite JSON data is accepted.'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'id'))
    return refuseExperiential('TEXP1001', '/id', 'The record owner supplies the content identity.');
  const shape = validateExperientialRecord(kind, { ...body, id: '0'.repeat(64) });
  if (!shape.ok) return shape;
  const id = await experientialRecordId(kind, shape.value);
  return validateExperientialRecord(kind, { ...shape.value, id });
}
