import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { researchRevisionOf, sealDomainProfile, validateDomainProfile, type ResearchDomainProfile } from '@tangleai/research';
import { domainFixture } from './domain-fixtures.ts';
import { checked, hash } from './fixtures.ts';

describe('immutable research domain profiles', () => {
  it('refuses functions, credentials and execution paths as content values', async () => {
    const { profile } = await domainFixture();
    for (const change of [
      { evaluate: () => [] }, { credentials: { apiKey: 'not-a-secret' } }, { evaluatorId: '/tmp/evaluator.ts' },
      { evaluatorId: '../evaluator' }, { evaluatorId: 'C:\\evaluator' }, { evaluatorId: 'https://example.test/evaluate' },
      { licence: { spdx: 'MIT', manifestPath: '/tmp/manifest.json' } },
      { licence: { spdx: 'MIT', manifestPath: '../manifest.json' } },
      { runnerManifestTemplate: { ...profile.runnerManifestTemplate, command: 'node evaluator.ts' } },
    ]) {
      const outcome = await validateDomainProfile({ ...profile, ...change });
      assert.equal(outcome.valid, false, JSON.stringify(change));
      if (!outcome.valid) assert.equal(outcome.issues[0].code, 'TRSH2001');
    }
  });
  it('binds every authored field into the revision and rejects stale identities', async () => {
    const { body, profile } = await domainFixture();
    const changes: Partial<Omit<ResearchDomainProfile, 'revision'>>[] = [
      { id: 'another-domain' }, { promptPackIds: [...body.promptPackIds].reverse().concat('extra-prompt') },
      { planValidatorIds: ['another-validator'] }, { runnerManifestTemplate: { ...body.runnerManifestTemplate, maxSeeds: 4 } },
      { evaluatorId: 'another-evaluator' }, { evaluatorVersion: '2' },
      { units: [{ ...body.units[0], direction: 'maximize' }] }, { rubricId: 'another-rubric' },
      { exportTemplateId: 'another-exporter' }, { licence: { ...body.licence, spdx: 'ISC' } },
      { taskFamilies: ['ranking'] }, { bindingRevisions: body.bindingRevisions.map(row => ({ ...row, revision: hash('e') })) },
    ];
    assert.deepEqual(new Set(changes.flatMap(Object.keys)), new Set(Object.keys(body)));
    for (const change of changes) {
      const changed = { ...body, ...change };
      assert.notEqual(await researchRevisionOf(changed), profile.revision);
      assert.equal((await validateDomainProfile({ ...changed, revision: profile.revision })).valid, false);
    }
    const changed = checked(await sealDomainProfile({ ...body, id: 'another-domain' }));
    assert.notEqual(changed.revision, profile.revision);
    assert.ok(Object.isFrozen(changed.units[0]));
  });
  it('requires exact capability coverage, unique units and a full JSON snapshot', async () => {
    const { body } = await domainFixture();
    for (const changed of [
      { ...body, bindingRevisions: body.bindingRevisions.slice(1) },
      { ...body, bindingRevisions: [...body.bindingRevisions, { ...body.bindingRevisions[0], revision: hash('e') }] },
      { ...body, units: [...body.units, { ...body.units[0], unit: 'points' }] },
    ]) assert.equal((await sealDomainProfile(changed)).valid, false);
    const raw = structuredClone(body), pending = sealDomainProfile(raw);
    raw.taskFamilies[0] = 'mutated';
    assert.deepEqual(checked(await pending).taskFamilies, body.taskFamilies);
  });
});
