/** Exhaustive source persistence qualification, distinct from model answer accuracy. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createTemporalProjection, temporalValue, type TemporalStore, type TemporalHead, type ProjectionReceipt } from '@tangleai/memory/temporal';
import { longMemEvalViews, LME_TYPES, type LmeRawQuestion } from './longmemeval.ts';
import { materializeLongMemEval } from './longmemeval-runtime.ts';
export async function qualifyLongMemEvalRoundtrip(rows: readonly LmeRawQuestion[], open: () => Promise<{ store: TemporalStore; close(): Promise<void> }>, progress?: (completed: number, total: number) => void) {
  const digest = createHash('sha256'), profiles = ['provided-history', 'strict-as-of'] as const;
  const counts = Object.fromEntries(profiles.map(profile => [profile, { questions: 0, occurrences: 0, claims: 0, scopeProbes: 0, types: Object.fromEntries(LME_TYPES.map(t => [t, 0])) }])) as Record<typeof profiles[number], { questions: number; occurrences: number; claims: number; scopeProbes: number; types: Record<string, number> }>;
  let writes = 0, activations = 0, completed = 0;
  for (const question of rows) {
    const backend = await open();
    try {
      let expectedHead: TemporalHead | null = null;
      for (const profile of profiles) {
        const { runtime, evaluator } = longMemEvalViews(question, profile), materialized = await materializeLongMemEval(runtime);
        const bundle = temporalValue(await createTemporalProjection({ scope: runtime.scope, sources: materialized.sources, claims: [], knowledge: materialized.knowledge,
          sourceIdentity: materialized.sourceIdentity, viewIdentity: runtime.viewId, policyIdentity: 'source-roundtrip-v1', modelIdentity: 'host-source-only', promptIdentity: 'none',
          embeddedBy: { model: 'hash-trigram-512', dims: 512 }, embeddings: [], complete: true }));
        const priorHead: TemporalHead | null = expectedHead;
        const receipt: ProjectionReceipt = temporalValue(await backend.store.apply(bundle, { key: profile, expectedHead })); expectedHead = receipt.head;
        const snapshot = temporalValue(await backend.store.snapshot(runtime.scope, receipt.head));
        assert.deepEqual(snapshot.sources, bundle.sources); assert.deepEqual(snapshot.projection, bundle.projection); assert.deepEqual(snapshot.claims, []);
        assert.equal(snapshot.sources.length, runtime.occurrences.length); assert.equal(new Set(snapshot.sources.map(s => s.id)).size, snapshot.sources.length);
        if (profile === 'strict-as-of') assert.ok(snapshot.sources.every(s => s.knownAt <= runtime.anchor.at));
        if (snapshot.sources.length) { const foreign = await backend.store.occurrence('foreign-scope', snapshot.sources[0].id); assert.equal(foreign.status !== 'success' && foreign.reason, 'identity-mismatch'); counts[profile].scopeProbes++; }
        const replay: ProjectionReceipt = temporalValue(await backend.store.apply(bundle, { key: profile, expectedHead: priorHead }));
        assert.equal(replay.replayed, true); assert.equal(replay.writes, 0); assert.equal(replay.activations, 0);
        digest.update(canonicalizeJson({ scope: runtime.scope, profile, sources: snapshot.sources, projection: snapshot.projection }));
        counts[profile].questions++; counts[profile].occurrences += snapshot.sources.length; counts[profile].types[evaluator.type]++;
      }
      writes += backend.store.stats().writes; activations += backend.store.stats().activations;
    } finally { await backend.close(); }
    progress?.(++completed, rows.length);
  }
  return { instrument: 'longmemeval-source-roundtrip-v1', questions: rows.length, profileCases: rows.length * 2,
    passed: Object.values(counts).reduce((n, c) => n + c.questions, 0), failed: 0, counts, writes, activations, sha256: digest.digest('hex'),
    limits: 'Source occurrence, knowledge-view, immutable projection and scope qualification. Empty host-asserted claim sets and no embeddings are deliberate. This does not measure extraction, retrieval quality or model QA accuracy.' };
}
