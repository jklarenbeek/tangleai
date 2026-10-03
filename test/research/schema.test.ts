import assert from 'node:assert/strict';
import { it } from 'node:test';
import { researchSchema, validateResearchShape } from '@tangleai/research';
import { CLAIM_EVIDENCE_SCHEMA } from '@tangleai/context';
import { researchRecordSchema, researchReportSchema } from '../../benchmark/lib/research-validation.ts';

const project = {
  id: 'schema-project', topic: 'seed choice', domainProfile: 'computational',
  question: 'Does the registered initializer improve inertia?', owner: 'fixture',
  mode: 'gate-only', safetyClass: 'computational',
  budget: { calls: 0, tokens: 0, ms: 0, physical: 0 }, status: 'CREATED',
  createdAt: '2026-10-03T00:00:00.000Z',
};

it('research schemas refuse unknown fields and lifecycle states with exact pointers', () => {
  assert.equal(validateResearchShape('ResearchProject', project).valid, true);
  for (const [value, path] of [[{ ...project, unregistered: true }, '/unregistered'],
    [{ ...project, budget: { ...project.budget, 'a/b~c': true } }, '/budget/a~1b~0c'],
    [{ ...project, budget: { calls: 0, tokens: 0, ms: 0 } }, '/budget/physical'],
    [{ ...project, status: 'APPROVED_BY_TIMEOUT' }, '/status']] as const) {
    const result = validateResearchShape('ResearchProject', value);
    assert.equal(result.valid, false);
    if (!result.valid) assert.deepEqual(result.issues.map(issue => [issue.code, issue.path]), [['TRSH1001', path]]);
  }
});

it('research identity schemas refuse non-hex and wrong-length identities', () => {
  for (const value of ['g'.repeat(64), 'f'.repeat(63), 'F'.repeat(64)]) {
    const result = validateResearchShape('Sha256', value);
    assert.equal(result.valid, false);
    if (!result.valid) assert.deepEqual(result.issues.map(issue => [issue.code, issue.path]), [['TRSH1001', '']]);
  }
  assert.equal(validateResearchShape('Sha256', 'a'.repeat(64)).valid, true);
});

it('the public schema owns every research record and closes object definitions', () => {
  assert.equal(researchRecordSchema, researchSchema);
  assert.equal(Object.hasOwn(researchReportSchema.$defs, 'ResearchClaim'), false);
  assert.equal(researchReportSchema.$defs.ResearchTopicResult.properties.bundle.$ref,
    researchSchema.$id + '#/$defs/ResearchBundle');
  for (const name of ['ResearchProject', 'ResearchContract', 'Amendment', 'StageAttempt', 'InputManifest',
    'ResearchArtifact', 'LiteratureRecord', 'ScreeningDecision', 'EvidenceCard', 'Synthesis', 'ResearchHypothesis',
    'ExperimentPlan', 'ExperimentBranch', 'WorkspaceManifest', 'ExecutionManifest', 'ExperimentRun',
    'MetricObservation', 'ResearchDecision', 'ResearchClaim', 'Review', 'Intervention', 'ResearchLesson',
    'ResearchManifest', 'DisclosureChecklist']) assert.equal(Object.hasOwn(researchSchema.$defs, name), true, name);
  assert.deepEqual(researchSchema.$defs.ResearchBundle.properties.claimLedger, CLAIM_EVIDENCE_SCHEMA);
  const visit = (value: unknown, path = ''): void => {
    // The native evidence envelope owns its intentionally open artifact metadata.
    if (path === '/ResearchBundle/properties/claimLedger') return;
    if (Array.isArray(value)) { value.forEach((item, i) => visit(item, path + '/' + i)); return; }
    if (value === null || typeof value !== 'object') return;
    const schema = value as Record<string, unknown>;
    if (schema.type === 'object') assert.equal(schema.additionalProperties, false);
    Object.entries(schema).forEach(([key, item]) => visit(item, path + '/' + key));
  };
  visit(researchSchema.$defs);
});
