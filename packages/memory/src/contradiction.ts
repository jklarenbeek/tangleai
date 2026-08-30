/**
 * Contradiction resolution — ported from memflow `ContradictionModule`,
 * with the LLM moved behind a seam.
 *
 * memflow called `llm.invoke()` inline and regex-scraped JSON out of the
 * reply. Here the judge is INJECTED: any async function answering the
 * verdict shape. The intended production judge is two lines of
 * @jarenjs/ai — `createStructuredOutput({ client, schema:
 * CONTRADICTION_VERDICT_SCHEMA })` over `contradictionMessages(a, b)` —
 * which buys schema-constrained decoding and the bounded repair loop
 * instead of a regex. The tests inject a table.
 *
 * Policy (unchanged): only pairs similar enough to be ABOUT the same
 * thing (>= threshold, default 0.75) are worth judging; the most similar
 * pairs are judged first; at most `maxPairs` LLM calls per pass. On a
 * confirmed contradiction the OLDER record is marked superseded (never
 * deleted — "what did we believe before" stays answerable). A judge
 * failure skips the pair; it never kills the pass.
 *
 * Tolerance is not silence. A pass that skipped every pair because the
 * judge was down and a pass that judged every pair and found nothing
 * are different outcomes, and a measurement that cannot tell them apart
 * cannot say what a threshold did — so the outcome counts both halves
 * of both forks: every attempt is judged or failed, and every confirmed
 * verdict is applied or skipped because its older record was already
 * gone.
 *
 * Only a SYNTHESIZED resolution becomes a new record. When the judge
 * answers with the newer record's own text (or nothing), the newer
 * record IS the resolution — writing it again would content-address to
 * the same id and overwrite the embedded fact with an un-embedded
 * summary, which is how the winner disappears from ranked recall.
 */

import { cosineSimilarity } from '@jarenjs/core/vector';
import type { JsonSchema, MemoryUnit } from '@tangleai/core/schemas/memory';
import { createMemoryUnit } from './ingest.ts';
import type { MemoryStore } from './store.ts';

export const DEFAULT_CONTRADICTION_THRESHOLD = 0.75;
export const DEFAULT_MAX_PAIRS = 20;

/** What a judge must answer. Wire it to @jarenjs/ai `createStructuredOutput`
 * as the `schema` and the repair loop enforces it for free. */
export const CONTRADICTION_VERDICT_SCHEMA: JsonSchema = {
  $id: 'https://tangleai.dev/schemas/contradiction-verdict.json',
  type: 'object',
  properties: {
    contradiction: { type: 'boolean' },
    reason: { type: 'string' },
    resolution: { type: 'string' },
  },
  required: ['contradiction'],
  additionalProperties: false,
};

export interface ContradictionVerdict {
  contradiction: boolean;
  reason?: string;
  resolution?: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * The judge's chat messages for one pair — kept beside the schema so the
 * prompt and the contract cannot drift apart.
 */
export function contradictionMessages(a: MemoryUnit, b: MemoryUnit): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'You judge whether two memory records contradict each other. '
        + 'Two records contradict when both cannot be true at once — differing detail or scope is not contradiction. '
        + 'When they do contradict, state the reason and write a single resolution sentence that reflects the better-evidenced record.',
    },
    {
      role: 'user',
      content: `Record A (${a.at}): "${a.text}" (evidence: ${a.evidence})\n`
        + `Record B (${b.at}): "${b.text}" (evidence: ${b.evidence})\n`
        + 'Do these contradict?',
    },
  ];
}

export interface ContradictionPair {
  a: MemoryUnit;
  b: MemoryUnit;
  similarity: number;
}

export interface ContradictionPlanOptions {
  threshold?: number;
  maxPairs?: number;
}

/** Select the pairs worth judging. Pure. */
export function planContradictionPairs(
  units: MemoryUnit[],
  options: ContradictionPlanOptions = {},
): ContradictionPair[] {
  const threshold = options.threshold ?? DEFAULT_CONTRADICTION_THRESHOLD;
  const maxPairs = options.maxPairs ?? DEFAULT_MAX_PAIRS;

  const candidates: ContradictionPair[] = [];
  const live = units.filter((u) => !u.supersededBy);

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (!a.embedding || !b.embedding) continue;
      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim >= threshold) candidates.push({ a, b, similarity: sim });
    }
  }

  candidates.sort((x, y) => y.similarity - x.similarity);
  return candidates.slice(0, maxPairs);
}

export interface ResolveOptions {
  judge: (a: MemoryUnit, b: MemoryUnit) => Promise<ContradictionVerdict | null>;
  /** RFC 3339. */
  now: () => string;
}

export interface ResolveOutcome {
  /** Planned pairs handed to the judge. */
  attempted: number;
  /** Pairs the judge answered. */
  judged: number;
  /** Judge calls that threw: the pair is skipped, the pass continues. */
  judgeFailures: number;
  /** Verdicts that confirmed a contradiction — applied or skipped. */
  confirmed: number;
  /** Confirmed contradictions written: the older record marked superseded. */
  contradictions: number;
  /** Confirmed contradictions whose older record was gone at write time. */
  applicationSkips: number;
  resolutions: MemoryUnit[];
}

/** Judge the planned pairs and resolve confirmed contradictions in the store. */
export async function resolveContradictions(
  store: MemoryStore,
  pairs: ContradictionPair[],
  options: ResolveOptions,
): Promise<ResolveOutcome> {
  let contradictions = 0;
  let judged = 0;
  let judgeFailures = 0;
  let confirmed = 0;
  let applicationSkips = 0;
  const resolutions: MemoryUnit[] = [];

  for (const pair of pairs) {
    let verdict: ContradictionVerdict | null = null;
    try {
      verdict = await options.judge(pair.a, pair.b);
    }
    catch {
      judgeFailures++; // a judge failure skips the pair, never the pass — and is counted
      continue;
    }
    judged++;
    if (!verdict?.contradiction) continue;
    confirmed++;

    const older = pair.a.at <= pair.b.at ? pair.a : pair.b;
    const newer = older === pair.a ? pair.b : pair.a;

    const supersededAt = options.now();
    const loser = await store.get(older.id);
    if (!loser) { applicationSkips++; continue; } // a prior pass or a host raced us
    loser.supersededBy = newer.id;
    loser.supersededAt = supersededAt;
    loser.supersededReason = verdict.reason ?? 'contradiction detected';
    await store.put(loser);

    if (verdict.resolution !== undefined && verdict.resolution !== newer.text) {
      const resolution = createMemoryUnit({
        text: verdict.resolution,
        evidence: `contradiction resolution of ${older.id} by ${newer.id}: ${verdict.reason ?? 'contradiction detected'}`,
        tags: [...new Set([...older.tags, ...newer.tags, 'resolution'])],
        at: supersededAt,
        kind: 'summary',
      });
      await store.put(resolution);
      resolutions.push(resolution);
    }
    contradictions++;
  }

  return { attempted: pairs.length, judged, judgeFailures, confirmed, contradictions, applicationSkips, resolutions };
}
