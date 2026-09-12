/**
 * Compiling and running the pipeline document.
 *
 * `createPipeline` binds the DAG's named task handlers to injected
 * seams — the store (any MemoryStore: in-memory for tests and the pages
 * demo, SQLite in the desktop app), an embedder (the @tangleai/models seam:
 * `{ embed, model, dims }` — `createEmbeddingClient` for a wire,
 * `createHashEmbedder` as the offline default), a contradiction judge,
 * a clock, and the tuned thresholds (salvaged memflow defaults). The
 * document stays pure JSON; everything replaceable arrives here.
 *
 * Every vector the embed node writes carries its identity
 * (`embeddedBy: { model, dims }`), the jarenjs rule that lets every
 * later policy refuse to compare vectors from two models.
 *
 * `run()` returns a compact report; the units themselves live in the
 * store, not in the return value. Per-node timing/status records stream
 * through `onNode` exactly as @jarenjs/flow emits them.
 */

import { compileDag } from '@jarenjs/flow';
import type { Embedder } from '@tangleai/models/embed';
import {
  createMemoryUnit,
  noveltyGate,
  planContradictionPairs,
  resolveContradictions,
  planCrystallization,
  applyCrystallization,
  type MemoryStore,
  type MemoryUnitInput,
} from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

import { type Judge, createOfflineEmbedder, numericContrastJudge } from './standins.ts';
import { PIPELINE_DAG } from './dag.ts';

export interface PipelineThresholds {
  /** Near-verbatim repeat filter; keep HIGH so contradictions survive. */
  novelty?: number;
  /** Similar-pair candidate threshold for the judge. */
  contradiction?: number;
  /** Paraphrase merge threshold. */
  crystallize?: number;
}

export interface PipelineOptions {
  store: MemoryStore;
  embedder?: Embedder;
  judge?: Judge;
  now?: () => string;
  thresholds?: PipelineThresholds;
}

export interface DagNodeRecord {
  id: string;
  status: 'ok' | 'error' | 'aborted' | 'restored';
  ms: number;
}

export interface PipelineReport {
  observations: number;
  embedded: number;
  model: string;
  novelty: { admitted: number, filtered: number };
  /** Every attempt is judged or failed; every confirmed verdict is applied or skipped. */
  contradiction: {
    attempted: number,
    judged: number,
    judgeFailures: number,
    confirmed: number,
    contradictions: number,
    applicationSkips: number,
    resolutions: string[],
  };
  /** Every planned merge is written or skipped. */
  crystallize: { examined: number, planned: number, merged: number, applicationSkips: number };
  memories: { live: number, total: number };
}

export interface Pipeline {
  run(
    observations: MemoryUnitInput[],
    options?: { signal?: AbortSignal, onNode?: (record: DagNodeRecord) => void },
  ): Promise<PipelineReport>;
}

export const DEFAULT_THRESHOLDS: Required<PipelineThresholds> = {
  novelty: 0.97,
  contradiction: 0.8,
  crystallize: 0.9,
};

export function createPipeline(options: PipelineOptions): Pipeline {
  const store = options.store;
  const embedder = options.embedder ?? createOfflineEmbedder();
  const judge = options.judge ?? numericContrastJudge();
  const now = options.now ?? ((): string => new Date().toISOString());
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };

  const tasks = {
    async embed({ input }: { with: any, input: any }, signal: AbortSignal): Promise<any> {
      const observations = input as MemoryUnitInput[];
      const missing = observations.filter((o) => o.embedding === undefined);
      const vectors = missing.length > 0
        ? await embedder.embed(missing.map((o) => o.text), { signal })
        : [];
      // the identity: the embedder's settled width, or the reply's
      const dims = embedder.dims ?? vectors[0]?.length;
      const embeddedBy = dims === undefined ? undefined : { model: embedder.model, dims };
      let next = 0;
      const units = observations.map((o) => {
        if (o.embedding !== undefined) return createMemoryUnit({ ...o, confidence: o.confidence ?? 0.5 });
        // the seam answers Float32Array; the record stores plain numbers
        const vector = Array.from(vectors[next++]);
        return createMemoryUnit({ ...o, embedding: vector, embeddedBy, confidence: o.confidence ?? 0.5 });
      });
      return { units, embedded: missing.length, model: embedder.model };
    },

    async novelty({ input }: { with: any, input: any }): Promise<any> {
      const units = input.units as MemoryUnit[];
      const existing = await store.list();
      const { novel, filtered } = noveltyGate(units, existing, { threshold: thresholds.novelty });
      for (const unit of novel) await store.put(unit);
      return { admitted: novel.length, filtered: filtered.length };
    },

    async contradiction(): Promise<any> {
      const units = await store.list();
      const pairs = planContradictionPairs(units, { threshold: thresholds.contradiction });
      const outcome = await resolveContradictions(store, pairs, { now, judge });
      return {
        attempted: outcome.attempted,
        judged: outcome.judged,
        judgeFailures: outcome.judgeFailures,
        confirmed: outcome.confirmed,
        contradictions: outcome.contradictions,
        applicationSkips: outcome.applicationSkips,
        resolutions: outcome.resolutions.map((r) => r.text),
      };
    },

    async crystallize(): Promise<any> {
      const plan = planCrystallization(await store.list(), { threshold: thresholds.crystallize });
      const outcome = await applyCrystallization(store, plan, { now });
      return {
        examined: plan.examined,
        planned: outcome.planned,
        merged: outcome.crystallized,
        applicationSkips: outcome.applicationSkips,
      };
    },
  };

  const dag = compileDag(PIPELINE_DAG, { tasks });

  return {
    async run(observations, runOptions = {}) {
      const result = await dag.run(observations, {
        signal: runOptions.signal,
        onNode: runOptions.onNode,
      });
      const all = await store.list();
      const live = all.filter((u) => u.supersededBy === undefined);
      return {
        observations: observations.length,
        embedded: result.embed.embedded,
        model: result.embed.model,
        novelty: result.novelty,
        contradiction: result.contradiction,
        crystallize: result.crystallize,
        memories: { live: live.length, total: all.length },
      };
    },
  };
}
