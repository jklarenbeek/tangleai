import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { experientialSchema, EXPERIENTIAL_RECORD_SCHEMAS, validateExperientialRecord,
  experientialIssue, sortExperientialIssues } from '@tangleai/experiential';
import type { ExperientialRecordKind, ExperientialResult } from '@tangleai/experiential';
import { experientialSchemaFixtures } from './schema-fixtures.ts';

function refused(result: ExperientialResult<unknown>, text?: RegExp) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected a refusal.');
  assert(result.issues.length > 0);
  assert(result.issues.every(issue => issue.code === 'TEXP1001'));
  if (text) assert(result.issues.some(issue => text.test(issue.detail)));
  return result.issues;
}
const kinds = Object.keys(EXPERIENTIAL_RECORD_SCHEMAS) as ExperientialRecordKind[];

describe('closed experiential record contracts', () => {
  for (const kind of kinds) {
    it(`${kind} accepts a detached record and refuses undeclared and secret-shaped members`, () => {
      const input = experientialSchemaFixtures()[kind];
      const result = validateExperientialRecord(kind, input);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) throw new Error('Expected structural acceptance.');
      assert.deepEqual(result.value, input);
      assert.notEqual(result.value, input);
      assert(Object.isFrozen(result.value));
      input.scope = 'changed-after-validation';
      assert.equal(result.value.scope, 'fixture');
      refused(validateExperientialRecord(kind, { ...input, unexpectedMember: true }), /undeclared/i);
      refused(validateExperientialRecord(kind, { ...input, apiKey: 'private-test-value' }), /secret-shaped/);
      refused(validateExperientialRecord(kind, { ...input, id: 'not-a-sha256' }));
      refused(validateExperientialRecord(kind, { ...input, scope: ' ' }));
      refused(validateExperientialRecord(kind, { ...input, schemaVersion: 2 }));
      refused(validateExperientialRecord(kind, { ...input, recordedAt: '2026-02-30T00:00:00.000Z' }));
      refused(validateExperientialRecord(kind, { ...input, recordedAt: '2026-09-13T02:00:00.000+02:00' }));
    });
  }

  it('declared tokenizer, grouping and idempotency fields remain valid while nested secrets refuse', () => {
    const fixture = experientialSchemaFixtures();
    assert.equal(validateExperientialRecord('dataset', fixture.dataset).ok, true);
    assert.equal(validateExperientialRecord('trainingRun', fixture.trainingRun).ok, true);
    for (const key of ['accessToken', 'secret', 'password', 'credential', 'bearer']) {
      const result = validateExperientialRecord('trainingRun', { ...fixture.trainingRun,
        hyperparameters: { ...fixture.trainingRun.hyperparameters, [key]: 'private-test-value' } });
      const issues = refused(result, /secret-shaped/);
      assert(!JSON.stringify(issues).includes('private-test-value'));
    }
    refused(validateExperientialRecord('experience', { ...fixture.experience,
      sourceRefs: [{ ...fixture.experience.sourceRefs[0], rawTrace: 'undeclared text' }] }));
    refused(validateExperientialRecord('dataset', { ...fixture.dataset,
      exclusions: { total: 1, byReason: { 'secret-canary': 'private-test-value' } } }));
  });

  it('refuses credential-bearing, malformed and unsupported URIs at every runtime location', () => {
    const fixture = experientialSchemaFixtures();
    for (const uri of ['https://user:private-test-value@example.test/a', 'https://example.test/a?token=private-test-value',
      'https://example.test/a#private-test-value', 'https://example.test:99999/a', 'https://', 'file:///tmp/weights',
      'https://%75ser:password@example.test/a', 'https://example.test/line\nbreak']) {
      for (const result of [
        validateExperientialRecord('artifact', { ...fixture.artifact, storageUri: uri }),
        validateExperientialRecord('artifact', { ...fixture.artifact, runtime: { ...fixture.artifact.runtime, base: uri } }),
        validateExperientialRecord('deployment', { ...fixture.deployment, base: { ...fixture.deployment.base, base: uri } }),
      ]) {
        const issues = refused(result);
        assert(!JSON.stringify(issues).includes('private-test-value'));
      }
    }
    for (const uri of ['https://example.test/path', 'http://127.0.0.1:8080/weights', 'urn:sha256:abc', 'memory:fixture/weights'])
      assert.equal(validateExperientialRecord('artifact', { ...fixture.artifact, storageUri: uri }).ok, true, uri);
  });

  it('rejects non-JSON and non-finite input as coded values', () => {
    const fixture = experientialSchemaFixtures().experience;
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [undefined, null, [], () => null, 1n, cycle,
      { ...fixture, observedOutcome: { ...fixture.observedOutcome, value: NaN } },
      { ...fixture, observedOutcome: { ...fixture.observedOutcome, value: Infinity } },
      { ...fixture, sourceRefs: undefined }]) refused(validateExperientialRecord('experience', value));
  });

  it('freezes nested evidence and never rereads an accepted caller object', () => {
    const input = experientialSchemaFixtures().experience;
    const result = validateExperientialRecord('experience', input);
    assert(result.ok);
    assert(Object.isFrozen(result.value.sourceRefs));
    assert(Object.isFrozen(result.value.sourceRefs[0]));
    input.sourceRefs[0].sourceId = 'changed';
    assert.equal(result.value.sourceRefs[0].sourceId, 'episode-a');
  });

  it('keeps the registered scientific boundary and retention vocabulary closed', () => {
    const fixture = experientialSchemaFixtures();
    refused(validateExperientialRecord('gatePolicy', { ...fixture.gatePolicy, learning: { minLowerBound: -0.1 } }));
    refused(validateExperientialRecord('gatePolicy', { ...fixture.gatePolicy, controls: ['frozen-retrieval'] }));
    refused(validateExperientialRecord('gatePolicy', { ...fixture.gatePolicy, interval: { ...fixture.gatePolicy.interval, statistic: 'invented' } }));
    refused(validateExperientialRecord('retentionDecision', { ...fixture.retentionDecision, decision: 'delete' }));
    refused(validateExperientialRecord('approval', { ...fixture.approval, principal: { ...fixture.approval.principal, kind: 'model' } }));
  });

  it('closes every record object and retains native refusal causes during deduplication', () => {
    assert.equal(kinds.length, 13);
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      if ('type' in value && value.type === 'object') assert.equal((value as { additionalProperties?: unknown }).additionalProperties, false);
      Object.values(value).forEach(visit);
    }
    visit(experientialSchema);
    const native = { code: 'OUTC1013', path: '/head', detail: 'The head moved.' };
    const issue = experientialIssue('TEXP1007', '/head', 'Stale deployment.', native);
    const sorted = sortExperientialIssues([issue, issue, experientialIssue('TEXP1001', '', 'Invalid record.')]);
    assert.equal(sorted.length, 2);
    assert.deepEqual(sorted.find(value => value.code === 'TEXP1007')?.cause, native);
    assert.deepEqual(sorted, sortExperientialIssues([...sorted].reverse()));
  });

  it('imports its public root without a network request or database', () => {
    const script = `globalThis.fetch = () => { throw Error('unexpected network request'); };
      const api = await import('@tangleai/experiential');
      if (typeof api.validateExperientialRecord !== 'function') throw Error('missing public validator');
      process.stdout.write('pure-import');`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }), 'pure-import');
  });
});
