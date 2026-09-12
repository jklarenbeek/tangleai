import { runOutcomeExample } from './outcomes-example.ts';
import { runSupervisedStoreExample } from './supervised-store.ts';
import { nodeProcessDriver } from '@jarenjs/db/node-process';
import { createMemoryOutcomeStore } from '@tangleai/outcomes';
import { createOutcomeStore } from '@tangleai/store';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateTokens } from '@tangleai/core/tokens';
import { createMemoryUnit, createMemoryUnitStore } from '@tangleai/memory';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import { extractHtml } from '@tangleai/documents';
import { openTangleDb, createDbMemoryStore } from '@tangleai/store';
import { revisionOf } from '@tangleai/config';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createEnvironment } from '@tangleai/context/environment';
import { createProgramRunner, readProgramAnswer } from '@tangleai/agents/program';
import { createToolbox, registerModelContext } from '@tangleai/agents/toolbox';

const artifacts = JSON.parse(await readFile(new URL('./artifacts.json', import.meta.url), 'utf8'));
let exportsChecked = 0;
for (const pkg of artifacts.packages) {
  for (const [key, target] of Object.entries(pkg.exports)) {
    const name = pkg.name + (key === '.' ? '' : key.slice(1));
    const json = typeof target === 'string' && target.endsWith('.json');
    if (typeof target === 'string' && target.endsWith('.css')) {
      assert.match(await readFile(new URL(import.meta.resolve(name)), 'utf8'), /tangle-assistant/);
      exportsChecked++; continue;
    }
    const mod = await import(name, json ? { with: { type: 'json' } } : undefined);
    if (key === './package.json') assert.equal(mod.default.version, artifacts.version);
    if (key.startsWith('./schemas/') && json) assert.equal(typeof mod.default, 'object');
    exportsChecked++;
  }
}
assert.equal(estimateTokens('12345678'), 2);
const migration = JSON.parse(await readFile(new URL('./migration.json', import.meta.url), 'utf8'));
for (const owner of ['models', 'context', 'agents']) {
  const expected = migration.rootSymbols.filter(symbol => symbol.destination.entry.startsWith(`@tangleai/${owner}/`)).map(symbol => symbol.name).sort();
  assert.deepEqual(Object.keys(await import(`@tangleai/${owner}`)).sort(), expected);
}
const hashEmbedder = createHashEmbedder({ dims: 32 });
assert.equal((await hashEmbedder.embed(['A deterministic consumer']))[0].length, 32);
const environment = createEnvironment();
const payload = JSON.stringify({ complete: 'x'.repeat(3000) });
await environment.put('answer', payload);
const result = await createProgramRunner({ environment }).run({ steps: [{ op: 'answer', from: 'answer' }] });
assert.equal(result.ok, true); assert.equal(result.answer.truncated, true);
const full = await readProgramAnswer(environment, result.answer, { maxChars: payload.length });
assert.equal(full.ok, true); assert.equal(full.answer.text, payload); assert.equal(full.answer.truncated, false);
const invalid = await createProgramRunner({ environment }).run({ steps: [] });
assert.equal(invalid.ok, false); assert.equal(invalid.answer, null); assert.equal(invalid.failed, 0);
const toolbox = createToolbox();
toolbox.add({ name: 'value', description: 'Read value', inputSchema: { type: 'object' }, execute: () => 7 });
let definition; const removed = [];
const binding = registerModelContext(toolbox, { registerTool(tool) { definition = tool; }, unregisterTool(name) { removed.push(name); } });
assert.equal((await binding.ready).status, 'registered'); assert.equal(definition.execute({}), 7);
await binding.dispose(); assert.deepEqual(removed, ['value']); assert.match(definition.execute({}).error, /inactive/);
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
const outcomeMemory = createMemoryOutcomeStore();
const initialOutcome = await runOutcomeExample(outcomeMemory);
const replayOutcome = await runOutcomeExample(outcomeMemory);
assert.equal(replayOutcome.writes, 0); assert.equal(replayOutcome.sourceReads, 0);
assert.deepEqual(replayOutcome.ids, initialOutcome.ids);
const db = await openTangleDb();
try {
  const sqliteOutcome = await runOutcomeExample(createOutcomeStore(db));
  assert.deepEqual(sqliteOutcome.ids, initialOutcome.ids);
  const store = createDbMemoryStore(db.collection('memories'));
  await store.put(unit);
  assert.equal((await store.get(unit.id)).text, unit.text);
  assert.ok((await store.list()).some(memory => memory.id === unit.id));
  await store.delete(unit.id);
  assert.equal(await store.get(unit.id), undefined);
  await db.backupTo('consumer-backup.db');
  const restored = await openTangleDb({ path: 'consumer-backup.db' });
  try {
    const replay = await runOutcomeExample(createOutcomeStore(restored));
    assert.equal(replay.writes, 0);
    assert.deepEqual(replay.ids, initialOutcome.ids);
  } finally { await restored.close(); }
} finally { await db.close(); }
if (process.versions.bun) {
  await assert.rejects(() => nodeProcessDriver().open(), error => error.code === 'JD0003');
} else {
  const supervised = await runSupervisedStoreExample('consumer-supervised.db');
  assert.equal(supervised.replay.writes, 0);
  assert.equal(supervised.owners, 0);
}
console.log(JSON.stringify({ ok: true, version: artifacts.version, runtime: process.versions.bun ? 'bun' : 'node', exportsChecked }));
