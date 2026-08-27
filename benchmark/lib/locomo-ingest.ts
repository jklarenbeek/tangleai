/**
 * One conversation through the real pipeline — the ingest every LoCoMo
 * instrument shares.
 *
 * Order 02 settled it and orders 16 and 03 inherit it unchanged: one
 * store per conversation, one `pipeline.run` per session, every policy
 * running each time against what the earlier sessions left, and the
 * pipeline's clock the conversation's last session instant so that
 * `supersededAt` and a crystallized record's `at` are data rather than
 * a reading of the wall. What the policies did is the census beside
 * the row, because "the policies changed the corpus" is exactly what
 * order 03 measures and every instrument has to say what the baseline
 * was.
 *
 * Extracted from `locomo-recall.ts` when the answer path (16) needed
 * the same units: the recall report is asserted byte-identical across
 * the move, so this file changes nothing about order 02's number.
 */

import type { Embedder } from '@jarenjs/ai/embed';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createMemoryUnitStore } from '@tangleai/memory';
import { createPipeline, type PipelineReport, type PipelineThresholds } from '@tangleai/pipeline';

import type { ConversationCorpus } from './locomo-corpus.ts';

/**
 * What the ingest reads of a corpus: its sessions and its clock. The
 * turn corpus satisfies it, and so do the release's derived corpora
 * (order 17's observation and summary rows) — the same ingest over a
 * different set of inputs is exactly the comparison those rows make.
 */
export type IngestCorpus = Pick<ConversationCorpus, 'sessions' | 'lastAt'>;

/** A similarity no cosine reaches: the pipeline runs, every policy is inert. */
export const POLICIES_OFF: Required<PipelineThresholds> = { novelty: 2, contradiction: 2, crystallize: 2 };

export interface IngestCensus {
  /** `pipeline.run` calls — one per ingested session. */
  runs: number;
  observations: number;
  embedded: number;
  admitted: number;
  filtered: number;
  judged: number;
  contradictions: number;
  resolutions: number;
  merged: number;
  live: number;
  total: number;
  superseded: number;
}

export function emptyCensus(): IngestCensus {
  return {
    runs: 0, observations: 0, embedded: 0, admitted: 0, filtered: 0, judged: 0,
    contradictions: 0, resolutions: 0, merged: 0, live: 0, total: 0, superseded: 0,
  };
}

function addReport(census: IngestCensus, report: PipelineReport): void {
  census.runs++;
  census.observations += report.observations;
  census.embedded += report.embedded;
  census.admitted += report.novelty.admitted;
  census.filtered += report.novelty.filtered;
  census.judged += report.contradiction.judged;
  census.contradictions += report.contradiction.contradictions;
  census.resolutions += report.contradiction.resolutions.length;
  census.merged += report.crystallize.merged;
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
