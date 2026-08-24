/* eslint-disable no-console */
/**
 * The walking skeleton — the whole Tangle loop, end to end, with zero
 * network: ingest → novelty-gate → contradiction-resolve → crystallize →
 * outcome-learn → recall → answer, with the curated memories mirrored
 * into an unmodified @jarenjs/ai ledger.
 *
 * The ORDER is a lesson the first draft of this file taught: a
 * contradiction is, by nature, very similar to the record it contradicts
 * — "the limit is 100" and "the limit is 500" differ by one token. So
 * the novelty gate only filters near-verbatim repeats (high threshold),
 * contradictions are resolved BEFORE crystallization, and the
 * crystallizer then merges only what survived with its meaning intact
 * (it skips superseded records by construction).
 *
 * Two stand-ins keep it offline, both at seams where a host would inject
 * the real thing:
 *  - the embedder is a deterministic character-trigram hash (real enough
 *    that paraphrases land near each other) — swap in
 *    `createEmbeddingClient` from @tangleai/providers for real vectors
 *  - the contradiction judge is a rule — swap in @jarenjs/ai
 *    `createStructuredOutput({ client, schema: CONTRADICTION_VERDICT_SCHEMA })`
 *    over `contradictionMessages(a, b)` for a real one
 *
 * Run: npm run skeleton
 */

import { createLedger, createMemoryStorage } from '@jarenjs/ai';
import { l2Normalize, cosineSimilarity } from '@tangleai/core/similarity';
import { toLedgerMemory, type MemoryUnit } from '@tangleai/core/schemas/memory';
import {
  createMemoryUnitStore,
  createMemoryUnit,
  noveltyGate,
  planCrystallization,
  applyCrystallization,
  planContradictionPairs,
  resolveContradictions,
  applyOutcome,
  rankByEmbedding,
  type ContradictionVerdict,
} from '@tangleai/memory';

// ---------------------------------------------------------------------------
// stand-in embedder: character trigrams hashed into 64 dims, L2-normalised
// ---------------------------------------------------------------------------

function embed(text: string): number[] {
  const v: number[] = new Array(64).fill(0);
  const s = ` ${text.toLowerCase()} `;
  for (let i = 0; i < s.length - 2; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) {
      h ^= s.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    v[(h >>> 0) % 64] += 1;
  }
  return l2Normalize(v);
}

const now = (): string => new Date().toISOString();

// ---------------------------------------------------------------------------
// 1. ingest — observations arrive with evidence and a timestamp, or not at all
// ---------------------------------------------------------------------------

const observations = [
  { text: 'The staging database lives on host db-staging.internal port 5432', evidence: 'ops handbook §3', tags: ['ops', 'database'], at: '2026-08-20T09:00:00Z' },
  { text: 'The staging database lives on host db-staging.internal port 5432.', evidence: 'ops handbook §3 (retold)', tags: ['ops', 'database'], at: '2026-08-21T09:00:00Z' }, // near-verbatim repeat — the gate's job
  { text: 'The staging database is on db-staging.internal at port 5432', evidence: 'deploy log 2026-08-22', tags: ['ops', 'database'], at: '2026-08-22T10:00:00Z' }, // paraphrase — the crystallizer's job
  { text: 'Deploys must run the full gate before shipping', evidence: 'CONTRIBUTING.md', tags: ['ops', 'deploy'], at: '2026-08-22T11:00:00Z' },
  { text: 'The API rate limit is 100 requests per minute', evidence: 'gateway config v1', tags: ['api'], at: '2026-08-19T08:00:00Z' },
  { text: 'The API rate limit is 500 requests per minute', evidence: 'gateway config v2', tags: ['api'], at: '2026-08-23T08:00:00Z' }, // contradiction — the judge's job
];

const store = createMemoryUnitStore();
const candidates = observations.map((o) => createMemoryUnit({ ...o, embedding: embed(o.text), confidence: 0.5 }));

// ---------------------------------------------------------------------------
// 2. novelty gate — near-verbatim repeats only; a contradiction is similar
//    too, and must NOT be eaten here, hence the high threshold
// ---------------------------------------------------------------------------

const { novel, filtered } = noveltyGate(candidates, await store.list(), { threshold: 0.97 });
for (const unit of novel) await store.put(unit);
console.log(`ingest: ${novel.length} admitted, ${filtered.length} filtered as near-verbatim repeats`);
for (const unit of filtered) console.log(`  filtered: "${unit.text}"`);

// ---------------------------------------------------------------------------
// 3. contradiction — BEFORE crystallization, so conflicting figures are
//    resolved instead of averaged away; a rule stands in for the LLM judge
// ---------------------------------------------------------------------------

const pairs = planContradictionPairs(await store.list(), { threshold: 0.8 });
const resolved = await resolveContradictions(store, pairs, {
  now,
  judge: async (a: MemoryUnit, b: MemoryUnit): Promise<ContradictionVerdict> => {
    const numbers = (t: string): string => t.match(/\d+/g)?.join(',') ?? '';
    if (numbers(a.text) !== numbers(b.text)) {
      const newer = a.at <= b.at ? b : a;
      return { contradiction: true, reason: 'same subject, different figures', resolution: newer.text };
    }
    return { contradiction: false };
  },
});
console.log(`contradiction: judged ${resolved.judged} similar pairs, resolved ${resolved.contradictions}`);
for (const r of resolved.resolutions) console.log(`  resolution: "${r.text}" (${r.evidence.slice(0, 72)}…)`);

// ---------------------------------------------------------------------------
// 4. crystallize — merge the paraphrase pair that survived with its meaning
//    intact; superseded records are skipped by construction
// ---------------------------------------------------------------------------

const plan = planCrystallization(await store.list(), { threshold: 0.9 });
const { crystallized } = await applyCrystallization(store, plan, { now });
console.log(`crystallize: examined ${plan.examined}, merged ${crystallized}`);

// ---------------------------------------------------------------------------
// 5. outcome — ground truth moves confidence
// ---------------------------------------------------------------------------

const gateMemory = (await store.list()).find((u) => u.tags.includes('deploy'));
if (gateMemory) {
  await applyOutcome(store, {
    memoryIds: [gateMemory.id], outcome: 'success', at: now(),
    evidence: 'release 0.1.0 shipped clean after running the gate',
  });
  console.log(`outcome: "${gateMemory.text}" boosted to confidence ${(await store.get(gateMemory.id))?.confidence} on real-world success`);
}

// ---------------------------------------------------------------------------
// 6. recall — vector-ranked on the tangle side; the superseded limit and
//    the absorbed paraphrase can no longer surface
// ---------------------------------------------------------------------------

const question = 'what is the current api rate limit?';
const ranked = rankByEmbedding(await store.list(), embed(question), { k: 3 });
console.log(`\nrecall for: "${question}"`);
for (const { unit, score } of ranked) {
  console.log(`  ${score.toFixed(3)}  [${unit.kind}] ${unit.text}  (evidence: ${unit.evidence.slice(0, 48)})`);
}
const best = ranked[0]?.unit;
if (best) console.log(`answer (grounded): ${best.text} — per ${best.evidence}`);

// ---------------------------------------------------------------------------
// 7. mirror the LIVE curated memories into an unmodified @jarenjs/ai
//    ledger, where a plain jarenjs agent recalls them by tag
// ---------------------------------------------------------------------------

const ledger = createLedger({ storage: createMemoryStorage(), now });
let mirrored = 0;
for (const unit of await store.list()) {
  if (unit.supersededBy) continue; // superseded records are audit trail, not knowledge
  const outcome = await ledger.addMemory(toLedgerMemory(unit)) as { error?: string };
  if (outcome.error === undefined) mirrored++;
}
console.log(`\nledger mirror: ${mirrored} live memories admitted to a @jarenjs/ai ledger`);
const fromLedger = await ledger.recall({ tags: ['api'], limit: 5 });
if (Array.isArray(fromLedger)) {
  for (const memory of fromLedger) console.log(`  ledger recall [api]: ${memory.text}`);
}

console.log(`\nwhy the stages fired (trigram cosine): repeat=${
  cosineSimilarity(embed(observations[0].text), embed(observations[1].text)).toFixed(3)} paraphrase=${
  cosineSimilarity(embed(observations[0].text), embed(observations[2].text)).toFixed(3)} contradiction=${
  cosineSimilarity(embed(observations[4].text), embed(observations[5].text)).toFixed(3)}`);
