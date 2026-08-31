/**
 * The committed config queries: they compile with the suite's engine
 * and nothing else, the pinned output reproduces from the committed
 * inputs, joins refuse dangling and cross-report references before any
 * analysis, and the same tag resolved differently by two hosts stays
 * two rows — never collapsed under the shared spelling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { compileJsonQuery } from '@jarenjs/json/query';
import { validateIdentityEnvelope } from '@tangleai/config';

import { createReportValidator } from '../../benchmark/lib/validate.ts';
import SCHEMA from '../../benchmark/schemas/config-queries.schema.json' with { type: 'json' };

const QUERY_PATHS = [
  'queries/config/identity-inventory.json',
  'queries/config/profile-resolution.json',
  'queries/config/temporal-stack.json',
];

const committed = JSON.parse(await readFile('benchmark/results/config-queries.json', 'utf8'));

async function queryOf(path: string): Promise<(input: unknown) => unknown> {
  const { $comment: _comment, ...query } = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  return compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
}

describe('the committed query documents', () => {
  it('compile directly with compileJsonQuery and carry their own explanation', async () => {
    for (const path of QUERY_PATHS) {
      const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      assert.equal(typeof doc.$comment, 'string', `${path} says what it answers`);
      await queryOf(path);
    }
  });

  it('the committed output is schema-valid and reproduces from the committed inputs', async () => {
    const outcome = createReportValidator(SCHEMA as object)(committed);
    assert.equal(outcome.valid, true, JSON.stringify(outcome.errors?.slice(0, 3)));

    const temporal = await queryOf('queries/config/temporal-stack.json');
    const live = JSON.parse(await readFile('benchmark/results/locomo-qa-live.json', 'utf8'));
    const keyless = JSON.parse(await readFile('benchmark/results/locomo-qa.json', 'utf8'));
    assert.deepEqual(temporal({ live, keyless }), committed.queries.temporalStack,
      'the pinned temporal answer is exactly what the query produces today');
  });

  it('keeps the honest states separate and invents no stack fact', () => {
    const temporal = committed.queries.temporalStack;
    const legacy = temporal.liveStacks.find((row: { identityStatus: string }) => row.identityStatus === 'legacy-unrecorded');
    assert.notEqual(legacy, undefined, 'the historic paid rows stay one stated absence');
    assert.deepEqual(legacy.stack, {}, 'no model fact is invented for an unrecorded stack');
    assert.equal(legacy.temporalQuestions, 83);
    assert.equal(temporal.keylessAnalytic.identityStatus, 'not-run');

    const statuses = Object.fromEntries(committed.queries.identityInventory.byStatus
      .map((row: { identityStatus: string, rows: number }) => [row.identityStatus, row.rows]));
    assert.equal(statuses['legacy-unrecorded'], 6, 'the six paid rows');
    assert.equal(statuses['not-run'], 35, 'the analytic rows of recall, keyless QA and the policy screen');
  });

  it('the same tag across two hosts stays two rows with two identities', () => {
    const byRequest = committed.queries.profileResolution.byRequest;
    const fast = byRequest.find((row: { tag?: string }) => row.tag === 'fast');
    assert.equal(fast.hosts, 2);
    assert.equal(fast.distinctIdentities, 2, 'different effective stacks never collapse under the shared spelling');
    const rows = committed.queries.profileResolution.rows.filter((row: { tag?: string }) => row.tag === 'fast');
    assert.notEqual(rows[0].identityId, rows[1].identityId);
    assert.notEqual(rows[0].answerModel, rows[1].answerModel);
  });

  it('a dangling reference refuses before any query executes', () => {
    const dangling = {
      identities: [],
      rows: [{ rowId: 'r1', identityStatus: 'run', identityId: 'c'.repeat(64) }],
    };
    const outcome = validateIdentityEnvelope(dangling);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.issues.some((issue) => issue.code === 'TCFG1018'), true);
  });

  it('a cross-report join cannot happen by accident: rows resolve only inside their own envelope', async () => {
    const inventory = await queryOf('queries/config/identity-inventory.json');
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
    const out = inventory({
      artifacts: [
        { artifact: 'a.json', envelope: { identities: [identity], rows: [{ rowId: 'r1', identityStatus: 'run', identityId: identity.identityId }] } },
        { artifact: 'b.json', envelope: { identities: [], rows: [{ rowId: 'r1', identityStatus: 'run', identityId: identity.identityId }] } },
      ],
    }) as { inventory: Array<{ artifact: string, requestKind?: string }> };
    const joined = out.inventory.filter((row) => row.requestKind !== undefined);
    assert.deepEqual(joined.map((row) => row.artifact), ['a.json'],
      "b.json's row finds no identity in ITS envelope even though a.json holds the id — the join never crosses reports");
  });
});
