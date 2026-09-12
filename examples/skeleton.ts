/* eslint-disable no-console */
/**
 * The walking skeleton uses the selected memory policy without network calls.
 * Novelty, contradiction and crystallization are disabled by that measured
 * default. The stages remain available through explicit policy overrides;
 * when enabled, contradiction precedes crystallization so a conflicting fact
 * can be resolved before similar records merge. With policies off, conflicting
 * observations remain retrievable: a top hit is not a current-fact judgment.
 *
 * The lexical embedder is @tangleai/models/embed's createHashEmbedder at the
 * selected offline width, exposed by createOfflineEmbedder. A host may inject
 * createEmbeddingClient through the same seam. The numeric rule below is a
 * local contradiction judge; a host may instead use createStructuredOutput
 * from @tangleai/models with contradictionMessages and its verdict schema.
 *
 * Run: npm run skeleton
 */

import { createLedger } from '@tangleai/context/ledger';
import { createMemoryStorage } from '@tangleai/context/storage/memory';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { toLedgerMemory, type MemoryUnit } from '@tangleai/core/schemas/memory';
import {
  createMemoryUnitStore,
  POLICY_PROVENANCE,
  DEFAULT_MEMORY_POLICY,
  policyThresholds,
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
import { createOfflineEmbedder } from '@tangleai/pipeline';

// ---------------------------------------------------------------------------
// stand-in embedder: the suite's own hashed-trigram reference at the
// pipeline's measured width, L2-normalised — one seam,
// `{ embed, model, dims }`, for this and for a wire
// ---------------------------------------------------------------------------

const thresholds = policyThresholds();
console.log(`selected default: ${POLICY_PROVENANCE.cellId}; report ${POLICY_PROVENANCE.reportId}`);
console.log(`policies: novelty=${thresholds.novelty}, contradiction=${thresholds.contradiction}, crystallize=${thresholds.crystallize}; retrieval k=${DEFAULT_MEMORY_POLICY.retrieval.k}, minScore=${DEFAULT_MEMORY_POLICY.retrieval.minScore}`);
const embedder = createOfflineEmbedder();
const embeddedBy = { model: embedder.model, dims: embedder.dims };
const embed = async (text: string): Promise<number[]> => Array.from((await embedder.embed([text]))[0]);

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
const vectors = await embedder.embed(observations.map((o) => o.text));
const candidates = observations.map((o, i) => createMemoryUnit({
  ...o, embedding: Array.from(vectors[i]), embeddedBy, confidence: 0.5,
}));

// ---------------------------------------------------------------------------
// 2. novelty gate — the measured default admits every distinct observation
// ---------------------------------------------------------------------------

const { novel, filtered } = noveltyGate(candidates, await store.list(), { threshold: thresholds.novelty });
for (const unit of novel) await store.put(unit);
console.log(`ingest: ${novel.length} admitted, ${filtered.length} filtered as near-verbatim repeats`);
for (const unit of filtered) console.log(`  filtered: "${unit.text}"`);

// ---------------------------------------------------------------------------
// 3. contradiction — BEFORE crystallization, so conflicting figures are
//    resolved instead of averaged away; a rule stands in for the LLM judge
// ---------------------------------------------------------------------------

const pairs = planContradictionPairs(await store.list(), { threshold: thresholds.contradiction });
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
console.log(`contradiction: attempted ${resolved.attempted} similar pairs, judged ${resolved.judged} (${resolved.judgeFailures} judge failures), confirmed ${resolved.confirmed}, resolved ${resolved.contradictions} (${resolved.applicationSkips} unapplied)`);
for (const r of resolved.resolutions) console.log(`  resolution: "${r.text}" (${r.evidence.slice(0, 72)}…)`);

// ---------------------------------------------------------------------------
// 4. crystallize — an explicit enabled policy can merge surviving paraphrases;
//    superseded records are skipped by construction
// ---------------------------------------------------------------------------

const plan = planCrystallization(await store.list(), { threshold: thresholds.crystallize });
const crystallize = await applyCrystallization(store, plan, { now });
console.log(`crystallize: examined ${plan.examined}, planned ${crystallize.planned}, merged ${crystallize.crystallized} (${crystallize.applicationSkips} unmerged)`);

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
// 6. recall — the selected retrieval defaults; both conflicting limits remain
//    live when the measured default disables contradiction resolution
// ---------------------------------------------------------------------------

const question = 'what is the current api rate limit?';
const ranked = rankByEmbedding(await store.list(), await embed(question), { identity: embeddedBy });
console.log(`\nrecall for: "${question}"`);
for (const { unit, score } of ranked) {
  console.log(`  ${score.toFixed(3)}  [${unit.kind}] ${unit.text}  (evidence: ${unit.evidence.slice(0, 48)})`);
}
const best = ranked[0]?.unit;
if (best) console.log(`top retrieved observation: ${best.text} — per ${best.evidence}`);
console.log("Retrieval preserves conflicting observations; it does not establish which figure is current.");

// ---------------------------------------------------------------------------
// 7. mirror the LIVE curated memories into an unmodified @tangleai/context
//    ledger, where a Tangle agent recalls them by tag — and, since
//    the vectors travel with their identity, by meaning through the same
//    embedder seam
// ---------------------------------------------------------------------------

const ledger = createLedger({ storage: createMemoryStorage(), now, embedder });
let mirrored = 0;
for (const unit of await store.list()) {
  if (unit.supersededBy) continue; // superseded records are audit trail, not knowledge
  const outcome = await ledger.addMemory(toLedgerMemory(unit));
  if (!('error' in outcome)) mirrored++;
}
console.log(`\nledger mirror: ${mirrored} live memories admitted to a @tangleai/context ledger`);
const fromLedger = await ledger.recall({ tags: ['api'], limit: 5 });
if (Array.isArray(fromLedger)) {
  for (const memory of fromLedger) console.log(`  ledger recall [api]: ${memory.text}`);
}
const byMeaning = await ledger.recall({ near: question, limit: 1 });
if (!Array.isArray(byMeaning) && !('error' in byMeaning)) {
  console.log(`  ledger recall near "${question}": ${byMeaning.memories[0]?.text} (${byMeaning.scores[0]?.toFixed(3)}, skipped ${byMeaning.skipped})`);
}

console.log(`\nsimilarities (policies act only when enabled) (${embedder.model} cosine): repeat=${
  cosineSimilarity(vectors[0], vectors[1]).toFixed(3)} paraphrase=${
  cosineSimilarity(vectors[0], vectors[2]).toFixed(3)} contradiction=${
  cosineSimilarity(vectors[4], vectors[5]).toFixed(3)}`);
