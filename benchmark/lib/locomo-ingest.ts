/**
 * One conversation through the real pipeline — the ingest every LoCoMo
 * instrument shares.
 *
 * The recall instrument settled it and the answer path and the policy
 * matrix inherit it unchanged: one
 * store per conversation, one `pipeline.run` per session, every policy
 * running each time against what the earlier sessions left, and the
 * pipeline's clock the conversation's last session instant so that
 * `supersededAt` and a crystallized record's `at` are data rather than
 * a reading of the wall. What the policies did is the census beside
 * the row, because "the policies changed the corpus" is exactly what
 * the policy matrix measures and every instrument has to say what the
 * baseline
 * was.
 *
 * Shared by the recall and the answer instruments; the recall report is
 * asserted byte-identical to its committed document, so nothing here may
 * change its number.
 */

import type { Embedder } from '@tangleai/models/embed';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createMemoryUnitStore } from '@tangleai/memory';
import { createPipeline, type PipelineReport, type PipelineThresholds } from '@tangleai/pipeline';

import type { ConversationCorpus } from './locomo-corpus.ts';

/**
 * What the ingest reads of a corpus: its sessions and its clock. The
 * turn corpus satisfies it, and so do the release's derived corpora
 * (the observation and summary rows) — the same ingest over a
 * different set of inputs is exactly the comparison those rows make.
 */
export type IngestCorpus = Pick<ConversationCorpus, 'sessions' | 'lastAt'>;

/** A similarity no cosine reaches: the pipeline runs, every policy is inert. */
export const POLICIES_OFF: Required<PipelineThresholds> = { novelty: 2, contradiction: 2, crystallize: 2 };

/**
 * What the policies did, counted so that nothing they attempted can
 * disappear. Every fork has both of its halves here — an attempt is
 * judged or it failed, a confirmed verdict is applied or its record had
 * vanished, a planned merge is written or its records had vanished — so
 * "the policy did nothing" and "the policy could not run" are never the
 * same row.
 */
export interface IngestCensus {
  /** `pipeline.run` calls — one per ingested session. */
  runs: number;
  observations: number;
  embedded: number;
  admitted: number;
  filtered: number;
  /** Pairs handed to the contradiction judge. */
  judgeAttempts: number;
  /** Pairs the judge answered. */
  judged: number;
  /** Judge calls that threw. */
  judgeFailures: number;
  /** Verdicts confirming a contradiction. */
  confirmed: number;
  /** Confirmed contradictions written (the older record superseded). */
  contradictions: number;
  /** Confirmed contradictions whose older record was gone at write time. */
  contradictionSkips: number;
  resolutions: number;
  /** Merges the crystallizer planned. */
  crystallizePlanned: number;
  merged: number;
  /** Planned merges whose records were gone at write time. */
  mergeSkips: number;
  live: number;
  total: number;
  superseded: number;
}

export function emptyCensus(): IngestCensus {
  return {
    runs: 0, observations: 0, embedded: 0, admitted: 0, filtered: 0,
    judgeAttempts: 0, judged: 0, judgeFailures: 0, confirmed: 0, contradictions: 0,
    contradictionSkips: 0, resolutions: 0, crystallizePlanned: 0, merged: 0, mergeSkips: 0,
    live: 0, total: 0, superseded: 0,
  };
}

function addReport(census: IngestCensus, report: PipelineReport): void {
  census.runs++;
  census.observations += report.observations;
  census.embedded += report.embedded;
  census.admitted += report.novelty.admitted;
  census.filtered += report.novelty.filtered;
  census.judgeAttempts += report.contradiction.attempted;
  census.judged += report.contradiction.judged;
  census.judgeFailures += report.contradiction.judgeFailures;
  census.confirmed += report.contradiction.confirmed;
  census.contradictions += report.contradiction.contradictions;
  census.contradictionSkips += report.contradiction.applicationSkips;
  census.resolutions += report.contradiction.resolutions.length;
  census.crystallizePlanned += report.crystallize.planned;
  census.merged += report.crystallize.merged;
  census.mergeSkips += report.crystallize.applicationSkips;
}

export interface IngestOptions {
  embedder: Embedder;
  thresholds: Required<PipelineThresholds>;
  /** Accumulated across conversations when the caller passes one in. */
  census?: IngestCensus;
}

/** The pipeline's clock for a conversation: its last session instant. */
export function clockOf(corpus: IngestCorpus): string {
  return new Date(corpus.lastAt).toISOString();
}

/**
 * Ingest one conversation session by session and hand back every unit
 * the store holds afterwards — live and superseded alike, so a caller
 * ranking with `recallByEmbedding` sees exactly what the app would.
 */
export async function ingestConversation(
  corpus: IngestCorpus,
  options: IngestOptions,
): Promise<{ units: MemoryUnit[], census: IngestCensus }> {
  const census = options.census ?? emptyCensus();
  const clock = clockOf(corpus);
  const store = createMemoryUnitStore();
  const pipeline = createPipeline({ store, embedder: options.embedder, now: () => clock, thresholds: options.thresholds });
  let last: PipelineReport | null = null;
  for (const session of corpus.sessions) {
    last = await pipeline.run(session.inputs);
    addReport(census, last);
  }
  if (last !== null) {
    census.live += last.memories.live;
    census.total += last.memories.total;
    census.superseded += last.memories.total - last.memories.live;
  }
  return { units: await store.list(), census };
}
