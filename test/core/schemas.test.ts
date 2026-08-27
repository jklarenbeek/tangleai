import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { JarenValidator } from '@jarenjs/validate';
import {
  MEMORY_UNIT_SCHEMA,
  MEMORY_RELATION_SCHEMA,
  OUTCOME_REPORT_SCHEMA,
  toLedgerMemory,
  type JsonSchema,
  type MemoryUnit,
} from '@tangleai/core/schemas/memory';

const AT = '2026-08-24T12:00:00Z';

function unit(overrides: Partial<MemoryUnit> & Record<string, unknown> = {}): MemoryUnit {
  return {
    id: 'm-1',
    text: 'the sky is blue',
    evidence: 'observed at noon',
    tags: ['sky'],
    at: AT,
    kind: 'fact',
    ...overrides,
  } as MemoryUnit;
}

function compile(schema: JsonSchema) {
  // TCollect is inferred as `true` from `collectErrors: true`, so the
  // compiled check answers a typed `{ valid, errors }` — the dogfood
  // moment for @jarenjs/validate's generics.
  const v = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  v.addSchema(MEMORY_RELATION_SCHEMA);
  return v.compile(schema);
}

describe('MEMORY_UNIT_SCHEMA', () => {
  const check = compile(MEMORY_UNIT_SCHEMA);

  it('accepts a minimal evidenced unit', () => {
    assert.ok(check(unit()).valid);
  });
  it('accepts the full optional surface', () => {
    assert.ok(check(unit({
      embedding: [0.1, 0.2],
      embeddedBy: { model: 'hash-trigram-2', dims: 2 },
      confidence: 0.8,
      supersededBy: 'm-2',
      supersededAt: AT,
      supersededReason: 'contradicted',
      mergedFrom: ['m-0'],
      relations: [{ target: 'm-3', relType: 'RELATES_TO', weight: 0.5 }],
    })).valid);
  });
  it('rejects a unit without evidence — a memory without evidence is a guess', () => {
    const u: Record<string, unknown> = { ...unit() };
    delete u.evidence;
    assert.ok(!check(u).valid);
  });
  it('rejects an unknown kind and unknown properties', () => {
    assert.ok(!check(unit({ kind: 'vibe' as MemoryUnit['kind'] })).valid);
    assert.ok(!check(unit({ surprise: true })).valid);
  });
  it('rejects a junk timestamp — recency sorts these strings', () => {
    assert.ok(!check(unit({ at: 'yesterday-ish' })).valid);
  });
  it('embedding and embeddedBy travel together — the jarenjs ledger rule', () => {
    assert.ok(!check(unit({ embedding: [0.1] })).valid, 'a vector without its identity');
    assert.ok(!check(unit({ embeddedBy: { model: 'm', dims: 1 } })).valid, 'an identity without its vector');
    assert.ok(!check(unit({ embedding: [], embeddedBy: { model: 'm', dims: 1 } })).valid, 'an empty vector');
    assert.ok(!check(unit({ embedding: [0.1], embeddedBy: { model: 'm' } as unknown as MemoryUnit['embeddedBy'] })).valid, 'an identity without a width');
  });
});

describe('OUTCOME_REPORT_SCHEMA', () => {
  const check = compile(OUTCOME_REPORT_SCHEMA);

  it('accepts an evidenced report and rejects an unevidenced one', () => {
    assert.ok(check({ memoryIds: ['m-1'], outcome: 'success', at: AT, evidence: 'deploy went green' }).valid);
    assert.ok(!check({ memoryIds: ['m-1'], outcome: 'success', at: AT }).valid);
  });
  it('rejects an empty memoryIds list', () => {
    assert.ok(!check({ memoryIds: [], outcome: 'failure', at: AT, evidence: 'x' }).valid);
  });
});

describe('toLedgerMemory', () => {
  it('projects the five jarenjs ledger fields and nothing tangle-only', () => {
    const projected = toLedgerMemory(unit({ confidence: 0.9, mergedFrom: ['m-0'] }));
    assert.deepEqual(projected, {
      id: 'm-1', text: 'the sky is blue', evidence: 'observed at noon', tags: ['sky'], at: AT,
    });
  });
  it('carries the embedding pair across, so the ledger can recall by meaning', () => {
    const projected = toLedgerMemory(unit({ embedding: [1], embeddedBy: { model: 'm', dims: 1 }, confidence: 0.9 }));
    assert.deepEqual(projected, {
      id: 'm-1', text: 'the sky is blue', evidence: 'observed at noon', tags: ['sky'], at: AT,
      embedding: [1], embeddedBy: { model: 'm', dims: 1 },
    });
  });
});
