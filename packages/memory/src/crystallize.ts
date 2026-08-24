/**
 * Crystallization — merge near-duplicate memories into canonical forms.
 * Ported from memflow `CrystallizerModule`, split into the house shape:
 * a PURE planner that decides what to merge, and an applier that executes
 * the plan against a store. memflow fused deciding and Cypher-executing
 * in one method, which meant the merge policy could only ever be tested
 * against a live Memgraph; here the plan is a value you can assert on.
 *
 * Policy (unchanged from memflow):
 *  - pairwise similarity >= threshold (default 0.92) marks a duplicate pair
 *  - the higher-confidence record survives; ties keep the first
 *  - a record participates in at most one merge per pass — a chain
 *    A~B~C collapses over successive passes, not in one ambiguous step
 *
 * Application details that changed, deliberately:
 *  - the survivor's confidence rises by `boost` (0.05), clamped to
 *    [floor, 1]; the floor keeps a record demotable but never erasable
 *  - the absorbed record's id lands in `mergedFrom` (provenance — the
 *    Cypher version kept `originalIds`, same idea)
 *  - tags are unioned, relations are concatenated with per-target
 *    weight summing, evidence strings are joined — nothing is dropped
 *  - the absorbed record is DELETED from the store; its id in
 *    `mergedFrom` is the tombstone
 */

import { cosineSimilarity } from '@tangleai/core/similarity';
import type { MemoryRelation, MemoryUnit } from '@tangleai/core/schemas/memory';
import type { MemoryStore } from './store.ts';

export const DEFAULT_CRYSTALLIZE_THRESHOLD = 0.92;
export const CONFIDENCE_BOOST = 0.05;
export const CONFIDENCE_FLOOR = 0.1;

export interface CrystallizeMerge {
  keepId: string;
  removeId: string;
  similarity: number;
}

export interface CrystallizePlan {
  merges: CrystallizeMerge[];
  examined: number;
}

export interface CrystallizeOptions {
  threshold?: number;
}

/** Decide which records to merge. Pure. */
export function planCrystallization(units: MemoryUnit[], options: CrystallizeOptions = {}): CrystallizePlan {
  const threshold = options.threshold ?? DEFAULT_CRYSTALLIZE_THRESHOLD;

  const candidates: CrystallizeMerge[] = [];

  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      if (!a.embedding || !b.embedding) continue;
      if (a.supersededBy || b.supersededBy) continue;
      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim >= threshold) {
        const keep = (a.confidence ?? 0.5) >= (b.confidence ?? 0.5) ? a : b;
        const remove = keep === a ? b : a;
        candidates.push({ keepId: keep.id, removeId: remove.id, similarity: sim });
      }
    }
  }

  // one merge per record per pass
  const taken = new Set<string>();
  const merges: CrystallizeMerge[] = [];
  for (const m of candidates) {
    if (taken.has(m.keepId) || taken.has(m.removeId)) continue;
    taken.add(m.keepId);
    taken.add(m.removeId);
    merges.push(m);
  }

  return { merges, examined: units.length };
}

export interface ApplyOptions {
  /** Returns RFC 3339 — injected, like every clock in the suite. */
  now: () => string;
}

/** Execute a crystallization plan against a store. */
export async function applyCrystallization(
  store: MemoryStore,
  plan: CrystallizePlan,
  options: ApplyOptions,
): Promise<{ crystallized: number }> {
  let crystallized = 0;

  for (const merge of plan.merges) {
    const keep = await store.get(merge.keepId);
    const remove = await store.get(merge.removeId);
    if (!keep || !remove) continue; // a prior merge or a host raced us; skip, don't guess

    keep.confidence = Math.min(1, Math.max(CONFIDENCE_FLOOR, (keep.confidence ?? 0.5) + CONFIDENCE_BOOST));
    keep.at = options.now();
    keep.mergedFrom = [...(keep.mergedFrom ?? []), remove.id, ...(remove.mergedFrom ?? [])];
    keep.tags = [...new Set([...keep.tags, ...remove.tags])];
    if (remove.evidence && !keep.evidence.includes(remove.evidence)) {
      keep.evidence = `${keep.evidence}; ${remove.evidence}`;
    }

    if (remove.relations?.length) {
      const relations: MemoryRelation[] = keep.relations ? [...keep.relations] : [];
      for (const rel of remove.relations) {
        const existing = relations.find((r) => r.target === rel.target && r.relType === rel.relType);
        if (existing) existing.weight = (existing.weight ?? 0.5) + (rel.weight ?? 0.5);
        else relations.push({ ...rel });
      }
      keep.relations = relations;
    }

    await store.put(keep);
    await store.delete(remove.id);
    crystallized++;
  }

  return { crystallized };
}
