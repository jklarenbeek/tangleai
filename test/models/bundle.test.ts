import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JarenValidator } from '@jarenjs/validate';
import { checkOutcome } from '@jarenjs/core/check';
import profile from '@jarenjs/json/schemas/jaren-query.llm-profile.schema.json' with { type: 'json' };

import { bundleSchema } from '@tangleai/models/structured';

const verdictOf = (schema: any, refs: any[], value: unknown) => {
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true });
  for (const ref of refs) validator.addSchema(ref);
  return checkOutcome(validator.compile(schema)(value)).valid;
};
const refsIn = (node: any, out: string[] = []): string[] => {
  if (Array.isArray(node)) for (const item of node) refsIn(item, out);
  else if (node !== null && typeof node === 'object') for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') out.push(value);
    else if (key !== 'const' && key !== 'enum') refsIn(value, out);
  }
  return out;
};

it('a host schema over a Jaren profile bundles into one document that validates the same values', () => {
  const wrapper = { type: 'object', required: ['filter'], additionalProperties: false, properties: { filter: { $ref: (profile as any).$id } } };
  const bundled = bundleSchema(wrapper, [profile]);
  const refs = refsIn(bundled);
  assert.ok(refs.length > 10);
  for (const ref of refs) {
    assert.match(ref, /^#\/\$defs\/[^/]+/, ref);
    const name = ref.slice('#/$defs/'.length).split('/')[0];
    assert.ok(name in bundled.$defs, `${ref} lands on a definition the bundle holds`);
  }
  assert.ok(!JSON.stringify(bundled.$defs).includes('"$id"'), 'the copies lose their $id');
  const verdicts = [
    { filter: { $eq: ['$.group', '@kruiden'] } },
    { filter: { $and: [{ $gt: ['$.price', 10] }, { $eq: ['$.kind', 'book'] }] } },
    { filter: { $frobnicate: 1 } },
    { filter: 5 },
    { other: true },
  ].map((value) => {
    const original = verdictOf(wrapper, [profile], value);
    assert.equal(verdictOf(bundled, [], value), original, JSON.stringify(value));
    return original;
  });
  assert.ok(verdicts.includes(true) && verdicts.includes(false), `the samples hold both verdicts: ${verdicts}`);
});

it('refuses anchors and shared ids, leaves unknown references and data alone', () => {
  assert.throws(() => bundleSchema({ $ref: 'https://x.test/a#anchor' }, [{ $id: 'https://x.test/a' }]), /declares no such anchor/);
  assert.throws(() => bundleSchema({}, [{ $id: 'https://x.test/a' }, { $id: 'https://x.test/a#' }]), /share the \$id/);
  assert.throws(() => bundleSchema({}, [{}]), /string \$id/);
  const kept = bundleSchema({ properties: { a: { $ref: 'https://unknown.test/b' }, c: { const: { $ref: 'https://x.test/a' } } } }, [{ $id: 'https://x.test/a', type: 'string' }]);
  assert.deepEqual(kept, { properties: { a: { $ref: 'https://unknown.test/b' }, c: { const: { $ref: 'https://x.test/a' } } } });
});

it('admits an anchor as the validator reads it, landing where its pointer would', () => {
  const shared = { $id: 'https://x.test/shared', $defs: { money: { $anchor: 'money', type: 'number', minimum: 0 }, code: { $id: '#code', type: 'string' } } };
  const byAnchor = bundleSchema({ type: 'object', properties: { price: { $ref: 'https://x.test/shared#money' }, sku: { $ref: 'https://x.test/shared#code' } } }, [shared]);
  const byPointer = bundleSchema({ type: 'object', properties: { price: { $ref: 'https://x.test/shared#/$defs/money' }, sku: { $ref: 'https://x.test/shared#/$defs/code' } } }, [shared]);
  assert.deepEqual(byAnchor, byPointer, 'an anchor and its pointer bundle to the same bytes');
  // a same-document anchor of a copied resource, and one of the root
  const nested = bundleSchema({ $ref: 'https://x.test/n' }, [{ $id: 'https://x.test/n', type: 'array', items: { $ref: '#item' }, $defs: { item: { $anchor: 'item', type: 'integer' } } }]);
  assert.equal(nested.$defs[Object.keys(nested.$defs).find(k => nested.$defs[k].type === 'array')!].items.$ref.startsWith('#/$defs/'), true);
  const rooted = bundleSchema({ $id: 'https://x.test/root', $defs: { leaf: { $anchor: 'leaf', type: 'string' } }, properties: { x: { $ref: 'https://x.test/root#leaf' } } });
  assert.equal(rooted.properties.x.$ref, '#/$defs/leaf');
});
