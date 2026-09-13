/** Keyless host-driven consolidation; scripted support is an example, not live QA. */
import assert from 'node:assert/strict';
import { createConsolidationMemoryStore, createConsolidationSource, createConsolidationExecutor,
  createConsolidationRunner, createConsolidationLexicalIndex, type ConsolidationResult } from '@tangleai/memory/consolidation';
const must = <T>(result: ConsolidationResult<T>): T => {
  if (result.status !== 'success') throw new Error(`${result.reason}: ${result.detail}`);
  return result.value;
};
const store = createConsolidationMemoryStore(), scope = 'trip-example';
const text = ['On 10 May Sam moved to Paris.', 'On 21 May Alex visited Sam in Paris.'];
const sources = await Promise.all(text.map(async (value, sequence) => must(await createConsolidationSource({
  scope, key: `conversation-1/turn-${sequence + 1}`, sequence, snapshot: { id: `event-${sequence + 1}`,
    text: value, evidence: `conversation-1/turn-${sequence + 1}`, tags: ['travel'], kind: 'event', at: '2024-05-21T12:00:00Z' },
}))));
const relation = 'Alex visited Sam in Paris after Sam moved there.';
let callbacks = 0;
const executor = createConsolidationExecutor({ store,
  synthesizer: { id: 'example-known-relation/1', async run(request) {
    callbacks++;
    return { status: 'ok', claims: [{ text: relation, sourceIds: request.sources.map(source => source.id) }] };
  } },
  verifier: { id: 'example-hand-checked-support/1', async run(request) {
    callbacks++;
    // This checks the two known fixture events. A live host supplies its own
    // explicit semantic verifier; citation validity alone does not prove support.
    return { status: 'ok', supported: request.claims.map(claim => claim.text === relation
      && text.every(value => request.sources.some(source => source.text === value))) };
  } },
});
const runner = createConsolidationRunner({ store, executor,
  policy: { enabled: true, tier: 'combined', countThreshold: 2 }, now: () => 1716292800000 });
try {
  must(await runner.enqueue(sources));
  const request = { scope, key: 'trip-pass', trigger: 'count' as const };
  const activated = must(await runner.run(request));
  const state = must(await runner.inspect(scope));
  assert.equal(state.sources.length, 2); assert.equal(state.buffer.pending.length, 0);
  const replay = must(await runner.run(request));
  assert.equal(replay.writes, 0); assert.equal(replay.logicalCalls, 0); assert.equal(callbacks, 2);
  const index = createConsolidationLexicalIndex(state.artifacts.map(artifact => ({ id: artifact.id, text: artifact.text })));
  const artifacts = new Map(state.artifacts.map(artifact => [artifact.id, artifact]));
  const exact = new Map(state.sources.map(source => [source.id, source]));
  const rankedSources = [...new Set(index.rank('Alex Paris').flatMap(hit => artifacts.get(hit.id)!.sourceIds))];
  // Supply complete original evidence within a final host budget. Merely listing
  // an artifact's references does not supply those source texts to a reader.
  const evidence: string[] = []; let chars = 0;
  for (const id of rankedSources) {
    const source = exact.get(id)!;
    const line = `[${source.key}] ${source.snapshot.text}`;
    const cost = line.length + (evidence.length ? 1 : 0);
    if (evidence.length === 10 || chars + cost > 6000) continue;
    evidence.push(line); chars += cost;
  }
  assert.equal(evidence.length, 2);
  console.log(JSON.stringify({ origin: 'scripted', physicalRequests: 0, callbacks,
    artifacts: activated.artifactIds.length, sourcesRetained: state.sources.length,
    replayWrites: replay.writes, suppliedChars: chars, evidence }, null, 2));
} finally { await runner.close(); }
