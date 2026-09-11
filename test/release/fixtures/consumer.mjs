import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateTokens } from '@tangleai/core/tokens';
import { createMemoryUnit, createMemoryUnitStore } from '@tangleai/memory';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import { extractHtml } from '@tangleai/documents';
import { openTangleDb, createDbMemoryStore } from '@tangleai/store';
import { revisionOf } from '@tangleai/config';

const artifacts = JSON.parse(await readFile(new URL('./artifacts.json', import.meta.url), 'utf8'));
let exportsChecked = 0;
for (const pkg of artifacts.packages) {
  for (const [key, target] of Object.entries(pkg.exports)) {
    const name = pkg.name + (key === '.' ? '' : key.slice(1));
    const json = typeof target === 'string' && target.endsWith('.json');
    const mod = await import(name, json ? { with: { type: 'json' } } : undefined);
    if (key === './package.json') assert.equal(mod.default.version, artifacts.version);
    if (key.startsWith('./schemas/') && json) assert.equal(typeof mod.default, 'object');
    exportsChecked++;
  }
}
assert.equal(estimateTokens('12345678'), 2);
assert.equal(await revisionOf({ a: 1, b: 2 }), await revisionOf({ b: 2, a: 1 }));
const embedder = createOfflineEmbedder();
const [vector] = await embedder.embed(['A packed consumer stores cited memory.']);
assert.equal(vector.length, embedder.dims);
const unit = createMemoryUnit({
  text: 'A packed consumer stores cited memory.', evidence: 'release fixture',
  at: '2026-09-11T00:00:00Z', embedding: Array.from(vector),
  embeddedBy: { model: embedder.model, dims: embedder.dims },
});
const inMemory = createMemoryUnitStore();
await inMemory.put(unit);
assert.equal((await inMemory.get(unit.id)).text, unit.text);
await assert.rejects(inMemory.put({ ...unit, evidence: '' }));
const document = extractHtml('<html><body><main><h1>Release fixture</h1><p>The cobalt release contains the complete consumer contract.</p></main></body></html>', 'https://example.test/release');
assert.ok(JSON.stringify(document).includes('cobalt'));
const db = await openTangleDb();
try {
  const store = createDbMemoryStore(db.collection('memories'));
  await store.put(unit);
  assert.equal((await store.get(unit.id)).text, unit.text);
  assert.equal((await store.list()).length, 1);
  await store.delete(unit.id);
  assert.equal(await store.get(unit.id), undefined);
} finally { await db.close(); }
console.log(JSON.stringify({ ok: true, version: artifacts.version, runtime: process.versions.bun ? 'bun' : 'node', exportsChecked }));
