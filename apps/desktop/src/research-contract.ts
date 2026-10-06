/** Read-only projections retain the research owners' closed record schemas. */
import { researchSchema, researchSchemaReferences } from '@tangleai/research';
import { RESEARCH_ABLATION_SCHEMA } from '../../../benchmark/lib/research-ablation-schema.ts';
import { contractSchemaResource } from './schema-resources.ts';

const resources = [researchSchema, ...researchSchemaReferences, RESEARCH_ABLATION_SCHEMA];
const addresses = new Map(resources.map((schema, index) => [(schema as any).$id, '#/$defs/researchResources/$defs/r' + index]));
const externals: Record<string, string> = {};
function references(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string' && !item.startsWith('#')) {
      const [base, fragment] = item.split('#'), address = addresses.get(base);
      if (!address) throw new TypeError('Unregistered research surface schema: ' + item);
      externals[item] = address + (fragment ?? '');
    } else references(item);
  }
}
resources.forEach(references);
export const RESEARCH_DEFINITIONS = { researchResources: { $defs: Object.fromEntries(resources.map((schema, index) =>
  ['r' + index, contractSchemaResource(schema, addresses.get((schema as any).$id)!, externals)])) } };
const ref = (name: string) => ({ $ref: addresses.get(researchSchema.$id) + '/$defs/' + name });
const ablation = (name: string) => ({ $ref: addresses.get(RESEARCH_ABLATION_SCHEMA.$id) + '/$defs/' + name });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', additionalProperties: false, properties, required });
const array = (items: object) => ({ type: 'array', items });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const text = { type: 'string' }, id = { type: 'string', minLength: 1, maxLength: 256 };
const count = { type: 'integer', minimum: 0 }, limit = { type: 'integer', minimum: 1, maximum: 200 };
const provenance = array(object({ field: text, recordId: text, path: text }));
const errors = { 'not-found': { status: 404 }, 'research-refused': { status: 422 }, 'report-invalid': { status: 422 } };
const runSummary = object({ projectId: id, profileId: id, status: text, stage: text, attempts: count,
  spend: ref('ResearchCost'), identityStatus: { enum: ['run', 'legacy-unrecorded'] }, lessonSetHash: nullable(ref('Sha256')), provenance });
const lesson = object({ lesson: ref('ResearchLessonV2'), provenance });
const read = (path: string, input: object, output: object) =>
  ({ kind: 'read', policy: { idempotency: 'none' }, input, output, errors, http: { method: 'GET', path } });
const gate = object({ writebackEligible: { type: 'boolean' }, fullAutoEligible: { type: 'boolean' } });

export function researchReadOperations(frame: object) {
  return {
    'research.runs.list': read('/api/research/runs', object({ limit, profileId: id, status: text }, []), array(runSummary)),
    'research.runs.get': read('/api/research/runs/get', object({ projectId: id }), object({
      project: ref('ResearchProject'), states: array(ref('ResearchState')), attempts: array(ref('StageCommitReceipt')),
      artifacts: array(ref('ArtifactAdmission')), branches: array(ref('ExperimentBranch')), gates: array(ref('Intervention')),
      interventions: array(ref('Intervention')), claims: array(ref('ResearchClaim')),
      verification: array(ref('ResearchDraftVerification')), verificationFailures: array(ref('ResearchDraftVerification')), lessons: object({ injected: array(ref('LessonInjection')), proposed: array(ref('ResearchLessonV2')) }),
      spend: ref('ResearchCost'), mermaid: text, reproduce: array(text), execution: array(ref('ExecutionManifest')),
      capabilities: object({ live: { const: true } }), limitations: array(text), provenance,
    })),
    'research.lessons.list': read('/api/research/lessons', object({ profileId: id, state: text, limit }, []), array(lesson)),
    'research.lessons.get': read('/api/research/lessons/get', object({ id }), object({ lesson: ref('ResearchLessonV2'),
      validationRuns: array(ref('LessonValidationRun')), outcome: nullable(object({ versionId: ref('Sha256'),
        head: object({ revision: count, versionId: nullable(ref('Sha256')) }), activationEventId: ref('Sha256') })), provenance })),
    'research.reports.get': read('/api/research/report', object({}), object({ reportId: ref('Sha256'), generatedFrom: ref('Sha256'),
      rows: array(ablation('ResearchAblationRow')), pairs: array(ablation('ResearchAblationPair')), gate,
      audit: array(object({ rowId: text, checked: count, resolved: count, unresolved: count, fabricated: count, missing: count, auditDisagreements: count })),
      document: { const: 'docs/RESEARCH_BENCHMARK.md' }, limitations: array(text), provenance })),
    'research.ablation.get': read('/api/research/ablation', object({ pairId: id }), object({ pair: ablation('ResearchAblationPair'),
      delta: nullable({ type: 'number' }), interval: nullable(object({ low: { type: 'number' }, high: { type: 'number' } })),
      comparable: { type: 'boolean' }, refusals: array(ref('ResearchIssue')), provenance })),
    'research.runs.live': { kind: 'subscribe', input: object({ projectId: id, afterSeq: count }, ['projectId']),
      output: object({ rows: array(frame) }), policy: { stream: { resume: 'replay', heartbeatMs: 15000, maxPatchBytes: 65536 } },
      errors: { ...errors, overflow: { status: 507 } }, http: { method: 'GET', path: '/api/research/runs/live' } },
  } as const;
}
