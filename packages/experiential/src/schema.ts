/** One closed schema owner; a valid shape confers no lifecycle authority. */
import { deepFreeze } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { formatJSONPointer } from '@jarenjs/json/pointer';
import { JarenValidator } from '@jarenjs/validate';
import schema from '../schemas/experiential.schema.json' with { type: 'json' };
import { experientialIssue, refuseExperiential, sortExperientialIssues } from './errors.ts';
import type { ExperientialResult } from './errors.ts';
import type {
  ExperientialExperience, ExperientialAssessment, ExperientialDataset, ExperientialTrainingRun,
  ExperientialArtifact, ExperientialEvaluation, ExperientialGatePolicy, ExperientialApproval,
  ExperientialDeployment, ExperientialInferencePin, ExperientialRetentionDecision,
  ExperientialEvent, ExperientialHead, ExperientialIssue,
} from './contracts.gen.ts';

export const experientialSchema = deepFreeze(schema);
export interface ExperientialRecordMap {
  experience: ExperientialExperience;
  assessment: ExperientialAssessment;
  dataset: ExperientialDataset;
  trainingRun: ExperientialTrainingRun;
  artifact: ExperientialArtifact;
  evaluation: ExperientialEvaluation;
  gatePolicy: ExperientialGatePolicy;
  approval: ExperientialApproval;
  deployment: ExperientialDeployment;
  inferencePin: ExperientialInferencePin;
  retentionDecision: ExperientialRetentionDecision;
  event: ExperientialEvent;
  head: ExperientialHead;
}
export type ExperientialRecordKind = keyof ExperientialRecordMap;
export const EXPERIENTIAL_RECORD_SCHEMAS = Object.freeze({
  experience: 'ExperientialExperience', assessment: 'ExperientialAssessment', dataset: 'ExperientialDataset',
  trainingRun: 'ExperientialTrainingRun', artifact: 'ExperientialArtifact', evaluation: 'ExperientialEvaluation',
  gatePolicy: 'ExperientialGatePolicy', approval: 'ExperientialApproval', deployment: 'ExperientialDeployment',
  inferencePin: 'ExperientialInferencePin', retentionDecision: 'ExperientialRetentionDecision',
  event: 'ExperientialEvent', head: 'ExperientialHead',
} as const);

interface ValidationError {
  keyword?: string;
  instancePath?: string;
  message?: string;
  params?: { additionalProperty?: string };
}
type Validator = (value: unknown) => { valid: boolean; errors?: ValidationError[] };
const validators = new Map<ExperientialRecordKind, Validator>();
const secretMember = /key|token|secret|password|credential|bearer/i;
const timeMembers = new Set(['recordedAt', 'startedAt', 'finishedAt', 'rollbackUntil']);
const uriMembers = new Set(['storageUri', 'base']);

function attribute(error: ValidationError): ExperientialIssue {
  const path = error.instancePath ?? '';
  if (error.keyword === 'additionalProperties') {
    const member = error.params?.additionalProperty ?? '';
    return experientialIssue('TEXP1001', path, secretMember.test(member)
      ? `Undeclared member '${member}' is secret-shaped.` : `Undeclared member '${member}'.`);
  }
  return experientialIssue('TEXP1001', path, error.message ?? 'The closed record schema refused this value.');
}

/** URI parsing and calendar validation remain pure, with no network or clock read. */
function checkedScalars(value: unknown, path: string[] = [], issues: ExperientialIssue[] = []): ExperientialIssue[] {
  if (value === null || typeof value !== 'object') return issues;
  for (const [key, member] of Object.entries(value)) {
    const at = [...path, key];
    if (typeof member === 'string' && timeMembers.has(key)) {
      const parsed = Date.parse(member);
      if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== member)
        issues.push(experientialIssue('TEXP1001', formatJSONPointer(at), 'Expected a valid normalized UTC instant.'));
    }
    if (typeof member === 'string' && uriMembers.has(key)) {
      try {
        const uri = new URL(member);
        if (!['http:', 'https:', 'urn:', 'memory:'].includes(uri.protocol) || uri.username || uri.password || uri.search || uri.hash)
          issues.push(experientialIssue('TEXP1001', formatJSONPointer(at), 'A URI must be credential-free, without userinfo, query or fragment.'));
      } catch {
        issues.push(experientialIssue('TEXP1001', formatJSONPointer(at), 'Expected a valid credential-free URI.'));
      }
    }
    checkedScalars(member, at, issues);
  }
  return issues;
}

/** Snapshot before validation so later caller mutations cannot change accepted data. */
export function validateExperientialRecord<K extends ExperientialRecordKind>(kind: K, value: unknown): ExperientialResult<ExperientialRecordMap[K]> {
  if (!Object.hasOwn(EXPERIENTIAL_RECORD_SCHEMAS, kind)) throw new TypeError('Unknown experiential record kind.');
  let document: unknown;
  try { document = JSON.parse(canonicalizeJson(value)); }
  catch { return refuseExperiential('TEXP1001', '', 'Only finite JSON data is accepted.'); }
  let validate = validators.get(kind);
  if (!validate) {
    validate = new JarenValidator({ collectErrors: true, skipErrors: false }).compile({
      $defs: experientialSchema.$defs, $ref: '#/$defs/' + EXPERIENTIAL_RECORD_SCHEMAS[kind],
    }) as Validator;
    validators.set(kind, validate);
  }
  const result = validate(document);
  const issues = [...(result.valid ? [] : (result.errors ?? []).map(attribute)), ...checkedScalars(document)];
  if (!result.valid && issues.length === 0) issues.push(experientialIssue('TEXP1001', '', 'The closed record schema refused this value.'));
  if (issues.length) return { ok: false, issues: sortExperientialIssues(issues) };
  return { ok: true, value: deepFreeze(document) as ExperientialRecordMap[K] };
}
