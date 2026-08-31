/**
 * Document validation as values: the schemas decide, the attribution
 * names what they decided with the pinned `TCFG1xxx` codes, refusals
 * come back sorted, and validated documents come back deeply frozen so
 * a retained reference cannot mutate what a consumer already trusts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ISSUE_CODES,
  validateHostManifest,
  validateIdentityEnvelope,
  validateRegistry,
  validateRequest,
  type ProfileRegistry,
} from '@tangleai/config';

const fixture = JSON.parse(await readFile('test/fixtures/config-conformance.json', 'utf8')) as {
  base: { registry: ProfileRegistry, request: unknown, host: unknown },
};

const codesOf = (outcome: { ok: boolean, issues?: Array<{ code: string }> }): string[] =>
  outcome.ok ? [] : (outcome.issues ?? []).map((issue) => issue.code);

describe('registry validation and attribution', () => {
  it('accepts the fixture base and the production registry, frozen', async () => {
    const outcome = validateRegistry(fixture.base.registry);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.throws(() => { (outcome.value as { version: number }).version = 2; }, /read only|Cannot assign/);
      assert.notEqual(outcome.value, fixture.base.registry, 'the validated value is a clone, not the input');
    }
    const production = JSON.parse(await readFile('config/profiles.json', 'utf8'));
    assert.equal(validateRegistry(production).ok, true, 'the production registry validates');
  });

  it('attributes duplicates, ghosts and kind mismatches to their codes', () => {
    const cases: Array<[string, (d: any) => void, string]> = [
      ['TCFG1004', (d) => d.candidates.push({ ...d.candidates[0] }), 'duplicate candidate id'],
      ['TCFG1002', (d) => { d.profiles[1].extends = 'ghost'; }, 'unknown parent'],
      ['TCFG1006', (d) => { d.profiles[0].embedding = 'chat-alpha'; }, 'chat candidate as embedding'],
      ['TCFG1006', (d) => { d.profiles[0].policyComponent = 'ranker-cosine'; }, 'ranker as policy'],
      ['TCFG1005', (d) => { d.profiles[0].roles.answer.prompt = 'ghost'; }, 'ghost prompt'],
      ['TCFG1001', (d) => { d.profiles[0].roles.answer.capability = 'ghost'; }, 'ghost capability tag'],
      ['TCFG1005', (d) => { d.candidates[0].credentialSlot = 'ghost-slot'; }, 'ghost slot'],
      ['TCFG1014', (d) => { d.candidates[0].apiKey = 'sk-x'; }, 'secret-shaped member'],
      ['TCFG1013', (d) => { d.candidates[1].baseUrl = 'https://user:pw@example.com/v1'; }, 'userinfo base'],
    ];
    for (const [code, mutate, name] of cases) {
      const copy = structuredClone(fixture.base.registry) as any;
      mutate(copy);
      const outcome = validateRegistry(copy);
      assert.equal(outcome.ok, false, `${name} must refuse`);
      assert.equal(codesOf(outcome).includes(code), true, `${name} carries ${code}, got ${codesOf(outcome).join(', ')}`);
    }
  });

  it('returns issues sorted by code then path', () => {
    const copy = structuredClone(fixture.base.registry) as any;
    copy.profiles[0].roles.answer.prompt = 'ghost';
    copy.profiles[0].roles.answer.capability = 'ghost';
    copy.candidates.push({ ...copy.candidates[0] });
    const outcome = validateRegistry(copy);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      const keys = outcome.issues.map((issue) => `${issue.code} ${issue.path}`);
      assert.deepEqual(keys, [...keys].sort(), 'issues arrive sorted');
    }
  });

  it('refuses a non-object without throwing', () => {
    assert.equal(validateRegistry('not a registry').ok, false);
    assert.equal(validateRegistry(null).ok, false);
    assert.equal(validateRegistry(17).ok, false);
  });
});

describe('request, host and envelope validation', () => {
  it('accepts the base request and host, and refuses corrupt shapes', () => {
    assert.equal(validateRequest(fixture.base.request).ok, true);
    assert.equal(validateHostManifest(fixture.base.host).ok, true);
    assert.equal(validateRequest({ kind: 'profile' }).ok, false);
    assert.equal(validateRequest({ kind: 'tag', tag: 'Fast', overrides: null }).ok, false, 'tag grammar is lower-case');
    const host = structuredClone(fixture.base.host) as any;
    host.apiKey = 'sk-x';
    const outcome = validateHostManifest(host);
    assert.equal(outcome.ok, false);
    assert.equal(codesOf(outcome).includes('TCFG1014'), true, 'a secret-shaped host member is named');
  });

  it('pins the dangling-row refusal to TCFG1018', () => {
    const identity = {
      identityId: 'a'.repeat(64),
      registryRevision: null,
      hostManifestRevision: 'b'.repeat(64),
      requested: { kind: 'legacy', chat: { state: 'unconfigured' }, embed: { state: 'unconfigured' }, components: { policy: null, ranker: null }, chatPrompt: null },
      roles: {},
      embedding: { provider: 'builtin', base: null, model: 'hash-trigram-64', dims: 64, credentialSlot: null },
      components: { policy: null, ranker: null },
      budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
    };
    const outcome = validateIdentityEnvelope({
      identities: [identity],
      rows: [{ rowId: 'r1', identityStatus: 'run', identityId: 'c'.repeat(64) }],
    });
    assert.equal(outcome.ok, false);
    assert.equal(codesOf(outcome).includes('TCFG1018'), true);
  });

  it('documents every code exactly once', () => {
    const codes = Object.keys(ISSUE_CODES);
    assert.equal(codes.length, 21);
    assert.deepEqual(codes, [...codes].sort());
    for (const code of codes) assert.match(code, /^TCFG10(0[1-9]|1[0-9]|2[01])$/);
  });
});
