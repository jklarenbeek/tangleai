/**
 * The LoCoMo evidence-recall instrument — the keyless ceiling.
 *
 * For every scorable question (categories 1–4, 1,540 of them) each
 * retrieval row hands back k memories, and the official `recall_acc`
 * (`lib/recall.ts`) says what fraction of the question's gold turns
 * reached the prompt. No key, no model, no clock: the whole thing is
 * deterministic and CI runs it on every commit.
 *
 * **One store per conversation, one `pipeline.run` per session.** The
 * questions of a conversation are about that conversation, dia_ids
 * repeat across conversations, and a memory system meets sessions weeks
 * apart — so each conversation is ingested into its own store through
 * `createPipeline`, session by session, and every policy runs each
 * time: the novelty gate against what earlier sessions left, the
 * contradiction judge over the store, the crystallizer over the store.
 * What they did is the ingest census beside the row, because "the
 * policies changed the corpus" is exactly what the policy matrix will be
 * measuring and this instrument has to say what the baseline was.
 *
 * **The rows.** Two gate rows over the turn universe — `oracle` (the
 * gold addresses first, padded in transcript order) must equal the
 * analytic ceiling at every k, and `random` (a seeded draw) must land
 * in its band, or the run refuses to publish. Then `recency` (the last
 * k turns — the cheapest non-semantic baseline), and two rows through
 * the real pipeline and `recallByEmbedding`: `near-raw`, with every
 * threshold set to a similarity no cosine reaches so the policies run
 * and do nothing, and `near`, with the shipped defaults. The pair is
 * the point: the same embedder, the same ranker, the same questions,
 * and the difference is what the policies cost or bought.
 *
 * **No clock, anywhere.** The pipeline's `now` is the conversation's
 * last session instant, so `supersededAt` and a crystallized record's
 * `at` are data. The report carries no timing at all; the CLI prints
 * elapsed milliseconds to stderr as a diagnostic, never into the
 * document. Two runs over the same dataset and options produce
 * byte-identical reports, and the test suite asserts it.
 *
 * **The embedder is lexical.** `createOfflineEmbedder` is the suite's
 * hashed-trigram reference at the pipeline's measured width: two texts
 * score high when they share letters. A `near` row therefore says
 * whether the MECHANISM — ingest, gate, rank, cite — carries a fact to
 * the prompt, and nothing about embedding quality; a real model behind
 * the same seam (the policy matrix) is where quality enters. Published beside
 * every table, as jarenjs publishes it.
 */

import { normalizeSeries } from '@jarenjs/core/series';
import { recallByEmbedding, DEFAULT_MAX_PAIRS } from '@tangleai/memory';
import {
  createOfflineEmbedder,
  DEFAULT_THRESHOLDS,
  OFFLINE_EMBEDDER_DIMS,
  type PipelineThresholds,
} from '@tangleai/pipeline';
import { createHashEmbedder } from '@jarenjs/ai/embed';

import {
  CATEGORY_NAMES,
  LOCOMO_DATASET,
  SCORABLE_CATEGORIES,
  type LocomoSample,
} from './locomo.ts';
import { addressOf, addressesOf, conversationCorpus, type ConversationCorpus } from './locomo-corpus.ts';
import { POLICIES_OFF, emptyCensus, ingestConversation, type IngestCensus } from './locomo-ingest.ts';
import {
  average,
  evidenceRecall,
  oracleCeilingOf,
  randomBand,
  type GoldQuestion,
  type RandomBand,
} from './recall.ts';
import { drawDistinct, mulberry32 } from '@jarenjs/core/random';
import { count, pct, score, table, type Cell } from './table.ts';

/** The cut-offs every row is scored at. */
export const KS = [5, 10, 20] as const;
/** The random row's seed — LoCoMo's arXiv number, so it is not a magic constant. */
export const RANDOM_SEED = 17753;
/** The inert-policy thresholds, from the shared ingest (re-exported: this row's key names them). */
export { POLICIES_OFF, type IngestCensus };
/** Why category 5 is not in any number here. */
export const CATEGORY_5_EXCLUSION = 'adversarial questions carry no `answer` (444 of 446) and the official evaluator scores the category by keyword, which marks the factually correct answer wrong';

// ---------------------------------------------------------------------------
// the report — hand-written beside `schemas/locomo-recall.schema.json`,
// the runtime contract the CLI validates before writing
// ---------------------------------------------------------------------------

export type CategoryKey = '1' | '2' | '3' | '4';

export interface RecallAtK {
  overall: number;
  /** `null` when a restricted run holds no question of that category. */
  byCategory: Record<CategoryKey, number | null>;
}

export interface RecallRow {
  key: string;
  label: string;
  kind: 'gate' | 'baseline' | 'pipeline';
  thresholds?: Required<PipelineThresholds>;
  ingest?: IngestCensus;
  retrieval?: {
    /** Live records the ranker could not score (no vector, or another identity), summed over conversations. */
    unranked: number;
    /** Gold hits credited through an absorbed record's address rather than the survivor's own, per k. */
    creditedViaMerge: Record<string, number>;
  };
  recall: Record<string, RecallAtK>;
}

export interface RecallReport {
  benchmark: 'locomo';
  instrument: 'locomo-recall';
  dataset: {
    path: string;
    sha256: string;
    bytes: number;
    schemaValid: boolean;
    conversations: number;
    /** The sample ids the run was restricted to, or `null` for the whole release. */
    restricted: string[] | null;
  };
  config: {
    embedder: { model: string, dims: number };
    ks: number[];
    seed: number;
    ingest: 'per-session';
    clock: string;
    maxPairs: number;
    thresholds: Required<PipelineThresholds>;
  };
  corpus: {
    conversations: number;
    sessions: number;
    refusedSessions: number;
    turns: number;
    imageTurns: number;
    collapsed: number;
    span: { start: string, end: string } | null;
  };
  questions: {
    total: number;
    scorable: number;
    byCategory: Record<'1' | '2' | '3' | '4' | '5', number>;
    noEvidence: number;
    excluded: { category: 5, count: number, reason: string };
  };
  ceiling: Record<string, RecallAtK>;
  floor: Record<string, RandomBand>;
  rows: RecallRow[];
  gate: { passed: boolean, failures: string[] };
}

export interface RecallRunOptions {
  /** The hash embedder's width; the identity is `hash-trigram-<dims>`. */
  dims?: number;
  ks?: readonly number[];
  seed?: number;
  /** The `near` row's thresholds; the defaults are the pipeline's. */
  thresholds?: PipelineThresholds;
  /** Restrict the run to these sample ids (for tests and quick knobs). */
  samples?: readonly string[];
  onProgress?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// accumulating per-question values into per-category means
// ---------------------------------------------------------------------------

class Scores {
  private readonly values = new Map<number, Map<number, number[]>>();
  private readonly ks: readonly number[];

  constructor(ks: readonly number[]) {
    this.ks = ks;
    for (const k of ks) this.values.set(k, new Map());
  }

  add(k: number, category: number, value: number): void {
    const byCategory = this.values.get(k);
    if (byCategory === undefined) throw new RangeError(`k=${k} is not scored`);
    const list = byCategory.get(category) ?? [];
    list.push(value);
    byCategory.set(category, list);
  }

  summary(): Record<string, RecallAtK> {
    const out: Record<string, RecallAtK> = {};
    for (const k of this.ks) {
      const byCategory = this.values.get(k)!;
      const all = SCORABLE_CATEGORIES.flatMap((c) => byCategory.get(c) ?? []);
      const categories = {} as Record<CategoryKey, number | null>;
      for (const c of SCORABLE_CATEGORIES) {
        const list = byCategory.get(c) ?? [];
        categories[String(c) as CategoryKey] = list.length === 0 ? null : average(list);
      }
      out[String(k)] = { overall: all.length === 0 ? 0 : average(all), byCategory: categories };
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// the questions of one conversation
// ---------------------------------------------------------------------------

interface ScoredQuestion extends GoldQuestion {
  text: string;
}

function questionsOf(sample: LocomoSample, corpus: ConversationCorpus): ScoredQuestion[] {
  const out: ScoredQuestion[] = [];
  for (const qa of sample.qa) {
    if (!(SCORABLE_CATEGORIES as readonly number[]).includes(qa.category)) continue;
    const gold = (qa.evidence ?? []).map((id) => addressOf(sample.sample_id, id));
    out.push({
      text: qa.question,
      category: qa.category,
      gold,
      resolvable: gold.filter((address) => corpus.addresses.has(address)).length,
      universe: corpus.turns.length,
    });
  }
  return out;
}

/** The top-k prefix of an address list as a set, per k. */
function prefixes(addresses: readonly string[], ks: readonly number[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const k of ks) out.set(k, new Set(addresses.slice(0, k)));
  return out;
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

export async function runLocomoRecall(
  dataset: { samples: LocomoSample[], bytes: number, sha256: string, valid: boolean },
  options: RecallRunOptions = {},
): Promise<RecallReport> {
  const ks = [...(options.ks ?? KS)].sort((a, b) => a - b);
  const maxK = ks[ks.length - 1];
  const seed = options.seed ?? RANDOM_SEED;
  const dims = options.dims ?? OFFLINE_EMBEDDER_DIMS;
  const thresholds: Required<PipelineThresholds> = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const embedder = dims === OFFLINE_EMBEDDER_DIMS ? createOfflineEmbedder() : createHashEmbedder({ dims });
  const identity = { model: embedder.model, dims: embedder.dims };
  const progress = options.onProgress ?? ((): void => {});

  const wanted = options.samples === undefined ? null : new Set(options.samples);
  const samples = wanted === null ? dataset.samples : dataset.samples.filter((s) => wanted.has(s.sample_id));
  if (wanted !== null) {
    for (const id of wanted) {
      if (!samples.some((s) => s.sample_id === id)) throw new Error(`no sample '${id}' in the release`);
    }
  }

  const random = mulberry32(seed);

  const pipelineRows: Array<{ key: string, label: string, thresholds: Required<PipelineThresholds> }> = [
    { key: 'near-raw', label: 'near (policies off)', thresholds: POLICIES_OFF },
    { key: 'near', label: 'near (pipeline defaults)', thresholds },
  ];

  const scores = new Map<string, Scores>();
  for (const key of ['oracle', 'random', 'recency', ...pipelineRows.map((r) => r.key)]) scores.set(key, new Scores(ks));
  const ceilingScores = new Scores(ks);
  const census = new Map<string, IngestCensus>(pipelineRows.map((r) => [r.key, emptyCensus()]));
  const unranked = new Map<string, number>(pipelineRows.map((r) => [r.key, 0]));
  const viaMerge = new Map<string, Map<number, number>>(
    pipelineRows.map((r) => [r.key, new Map(ks.map((k) => [k, 0]))]),
  );

  const allQuestions: GoldQuestion[] = [];
  const questionCounts: Record<'1' | '2' | '3' | '4' | '5', number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let noEvidence = 0;
  let sessions = 0;
  let refusedSessions = 0;
  let turns = 0;
  let imageTurns = 0;
  let collapsed = 0;
  const instants: Array<{ at: string }> = [];

  for (const sample of samples) {
    const corpus = conversationCorpus(sample);
    const questions = questionsOf(sample, corpus);
    for (const qa of sample.qa) questionCounts[String(qa.category) as keyof typeof questionCounts]++;
    for (const q of questions) if (q.gold.length === 0) noEvidence++;
    allQuestions.push(...questions);
    sessions += corpus.sessions.length;
    refusedSessions += corpus.refused;
    turns += corpus.turns.length;
    imageTurns += corpus.imageTurns;
    collapsed += corpus.collapsed;
    for (const session of corpus.sessions) instants.push({ at: session.atText });

    const byAddress = corpus.turns.map((t) => t.address);

    // --- the gate rows and the baseline, over the turn universe
    for (const q of questions) {
      for (const k of ks) ceilingScores.add(k, q.category, oracleCeilingOf(q, k));

      const oracle: string[] = [];
      const seen = new Set<string>();
      for (const address of q.gold) {
        if (corpus.addresses.has(address) && !seen.has(address)) { oracle.push(address); seen.add(address); }
      }
      for (const address of byAddress) {
        if (oracle.length >= maxK) break;
        if (!seen.has(address)) { oracle.push(address); seen.add(address); }
      }
      for (const [k, set] of prefixes(oracle, ks)) scores.get('oracle')!.add(k, q.category, evidenceRecall(q.gold, set));

      const drawn = drawDistinct(random, byAddress.length, maxK).map((i) => byAddress[i]);
      for (const [k, set] of prefixes(drawn, ks)) scores.get('random')!.add(k, q.category, evidenceRecall(q.gold, set));

      const recent = byAddress.slice(-maxK).reverse();
      for (const [k, set] of prefixes(recent, ks)) scores.get('recency')!.add(k, q.category, evidenceRecall(q.gold, set));
    }

    // --- the pipeline rows: one store each, the real DAG, session by session
    const queryVectors = questions.length === 0 ? [] : await embedder.embed(questions.map((q) => q.text));
    for (const row of pipelineRows) {
      const { units } = await ingestConversation(corpus, { embedder, thresholds: row.thresholds, census: census.get(row.key)! });
      const rowScores = scores.get(row.key)!;
      const rowMerge = viaMerge.get(row.key)!;
      let skippedSeen = false;
      questions.forEach((q, index) => {
        const { ranked, skipped } = recallByEmbedding(units, queryVectors[index], { k: maxK, identity });
        if (!skippedSeen) { unranked.set(row.key, unranked.get(row.key)! + skipped); skippedSeen = true; }
        const cited = ranked.map((r) => addressesOf(r.unit.evidence, sample.sample_id));
        for (const k of ks) {
          const retrieved = new Set<string>();
          const own = new Set<string>();
          for (const addresses of cited.slice(0, k)) {
            addresses.forEach((address, i) => { retrieved.add(address); if (i === 0) own.add(address); });
          }
          rowScores.add(k, q.category, evidenceRecall(q.gold, retrieved));
          for (const address of q.gold) {
            if (retrieved.has(address) && !own.has(address)) rowMerge.set(k, rowMerge.get(k)! + 1);
          }
        }
      });
    }

    progress(`${sample.sample_id}: ${corpus.sessions.length} sessions, ${corpus.turns.length} turns, ${questions.length} scorable questions`);
  }

  // the corpus span, through the series kernel: every instant is
  // validated as it is sorted, and the bounds are the first and last row
  const series = normalizeSeries(instants, { at: 'at', value: () => null });
  const span = series.length === 0
    ? null
    : { start: new Date(series[0].at).toISOString(), end: new Date(series[series.length - 1].at).toISOString() };

  const ceiling = ceilingScores.summary();
  const floor: Record<string, RandomBand> = {};
  for (const k of ks) floor[String(k)] = allQuestions.length === 0 ? { floor: 0, low: 0, high: 1 } : randomBand(allQuestions, k);

  const rows: RecallRow[] = [
    { key: 'oracle', label: 'oracle (gold first)', kind: 'gate', recall: scores.get('oracle')!.summary() },
    { key: 'random', label: `random (seed ${seed})`, kind: 'gate', recall: scores.get('random')!.summary() },
    { key: 'recency', label: 'recency (last k turns)', kind: 'baseline', recall: scores.get('recency')!.summary() },
    ...pipelineRows.map((row): RecallRow => ({
      key: row.key,
      label: row.label,
      kind: 'pipeline',
      thresholds: row.thresholds,
      ingest: census.get(row.key)!,
      retrieval: {
        unranked: unranked.get(row.key)!,
        creditedViaMerge: Object.fromEntries([...viaMerge.get(row.key)!].map(([k, n]) => [String(k), n])),
      },
      recall: scores.get(row.key)!.summary(),
    })),
  ];

  const report: RecallReport = {
    benchmark: 'locomo',
    instrument: 'locomo-recall',
    dataset: {
      path: LOCOMO_DATASET,
      sha256: dataset.sha256,
      bytes: dataset.bytes,
      schemaValid: dataset.valid,
      conversations: samples.length,
      restricted: wanted === null ? null : samples.map((s) => s.sample_id),
    },
    config: {
      embedder: identity,
      ks,
      seed,
      ingest: 'per-session',
      clock: 'the last session instant of each conversation',
      maxPairs: DEFAULT_MAX_PAIRS,
      thresholds,
    },
    corpus: { conversations: samples.length, sessions, refusedSessions, turns, imageTurns, collapsed, span },
    questions: {
      total: Object.values(questionCounts).reduce((a, b) => a + b, 0),
      scorable: allQuestions.length,
      byCategory: questionCounts,
      noEvidence,
      excluded: { category: 5, count: questionCounts['5'], reason: CATEGORY_5_EXCLUSION },
    },
    ceiling,
    floor,
    rows,
    gate: { passed: true, failures: [] },
  };
  report.gate.failures = gateFailures(report);
  report.gate.passed = report.gate.failures.length === 0;
  return report;
}

// ---------------------------------------------------------------------------
// the gate — the scorer proven before any number is read
// ---------------------------------------------------------------------------

/**
 * What is wrong with the gate rows, as sentences naming the row and the
 * k; empty when the scorer is proven. The oracle must EQUAL the analytic
 * ceiling — the same per-question values through the same mean, so
 * equality is exact, and a 1.000 where the ceiling says 0.996 is the
 * global-lookup bug by name. The random row must sit inside its band.
 */
export function gateFailures(report: RecallReport): string[] {
  const failures: string[] = [];
  const oracle = report.rows.find((r) => r.key === 'oracle');
  const random = report.rows.find((r) => r.key === 'random');
  if (oracle === undefined || random === undefined) return ['the oracle and random rows are the scorer\'s gate and both must run'];
  for (const k of report.config.ks) {
    const key = String(k);
    const expected = report.ceiling[key];
    const got = oracle.recall[key];
    if (got.overall !== expected.overall) {
      failures.push(`oracle recall@${k} is ${got.overall.toFixed(4)}, not the analytic ceiling ${expected.overall.toFixed(4)}`
        + (got.overall > expected.overall ? ' — an oracle above its ceiling is resolving evidence it should not reach' : ''));
    }
    for (const c of SCORABLE_CATEGORIES) {
      const ck = String(c) as CategoryKey;
      if (got.byCategory[ck] !== expected.byCategory[ck]) {
        failures.push(`oracle recall@${k} for category ${c} is ${score(got.byCategory[ck])}, not ${score(expected.byCategory[ck])}`);
      }
    }
    const band = report.floor[key];
    const value = random.recall[key].overall;
    if (value < band.low || value > band.high) {
      failures.push(`random recall@${k} is ${value.toFixed(4)}, outside its analytic band [${band.low.toFixed(4)}, ${band.high.toFixed(4)}] around ${band.floor.toFixed(4)}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// the published form
// ---------------------------------------------------------------------------

const CATEGORY_HEAD = SCORABLE_CATEGORIES.map((c) => `${c} ${CATEGORY_NAMES[c]}`);

function categoryCells(at: RecallAtK): Cell[] {
  return [score(at.overall), ...SCORABLE_CATEGORIES.map((c) => score(at.byCategory[String(c) as CategoryKey]))];
}

/** The Markdown a run prints and `docs/LOCOMO_RECALL.md` keeps. */
export function renderMarkdown(report: RecallReport): string {
  const out: string[] = [];
  const { config, corpus, questions } = report;
  out.push('# LoCoMo evidence recall — the keyless ceiling');
  out.push('');
  out.push(`Source: \`${report.dataset.path}\` (sha256 \`${report.dataset.sha256.slice(0, 12)}…\`, ${count(report.dataset.bytes)} bytes, schema ${report.dataset.schemaValid ? 'valid' : '**INVALID**'})`
    + (report.dataset.restricted === null ? '' : ` — restricted to ${report.dataset.restricted.map((id) => `\`${id}\``).join(', ')}`) + '.');
  out.push(`Embedder \`${config.embedder.model}\` (${config.embedder.dims} dims) — the suite's deterministic reference, LEXICAL: two texts score high when they share letters, so every \`near\` row below is a mechanism score, not an embedding-quality claim. Random seed ${config.seed}. Reproduce with \`npm run benchmark:locomo:recall\`.`);
  out.push('');
  out.push('Evidence recall is the official `recall_acc` of `task_eval/evaluation.py`: per question, the fraction of its gold `evidence` turns present in the k retrieved memories (a question citing nothing scores 1), averaged. A fact that never reached the prompt cannot be answered from it, so this is the model-free ceiling on any answer — and it costs nothing, which is why CI runs it on every commit.');
  out.push('');
  out.push('## The corpus, as ingested');
  out.push('');
  out.push(`${corpus.conversations} conversations · ${count(corpus.sessions)} sessions (${corpus.refusedSessions} refused for an unparseable stamp) · ${count(corpus.turns)} turns, ${count(corpus.imageTurns)} of them with an image caption appended · ${corpus.collapsed} turns collapsed onto an identical earlier turn by the content-addressed id`
    + (corpus.span === null ? '.' : ` · span ${corpus.span.start} → ${corpus.span.end} (read as UTC, a convention — LoCoMo names no zone).`));
  out.push(`One memory per turn, \`evidence\` = \`<sample_id>/<dia_id>\`, tags = speaker and session, \`at\` = the session instant; one store per conversation, one \`pipeline.run\` per session, the pipeline's clock the conversation's last session instant. Max ${config.maxPairs} contradiction pairs judged per run (the pipeline's default).`);
  out.push('');
  out.push(`${count(questions.total)} questions; **${count(questions.scorable)} scorable** — ${SCORABLE_CATEGORIES.map((c) => `${questions.byCategory[String(c) as CategoryKey]} ${CATEGORY_NAMES[c]}`).join(', ')} — of which ${questions.noEvidence} cite no evidence and score 1 by the official rule. Category 5 (${questions.excluded.count}) is excluded: ${questions.excluded.reason}.`);
  out.push('');
  out.push('## What the pipeline did to the corpus');
  out.push('');
  const pipelineRows = report.rows.filter((r) => r.kind === 'pipeline');
  out.push(table({
    head: ['row', 'novelty / contradiction / crystallize', 'runs', 'observations', 'admitted', 'filtered', 'judged', 'judge failed', 'contradictions', 'unapplied', 'resolutions', 'merged', 'unmerged', 'live', 'total', 'unranked'],
    numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    rows: pipelineRows.map((r) => [
      r.key,
      r.thresholds === undefined ? '—' : `${r.thresholds.novelty} / ${r.thresholds.contradiction} / ${r.thresholds.crystallize}`,
      r.ingest?.runs ?? null, r.ingest?.observations ?? null, r.ingest?.admitted ?? null, r.ingest?.filtered ?? null,
      r.ingest?.judged ?? null, r.ingest?.judgeFailures ?? null, r.ingest?.contradictions ?? null, r.ingest?.contradictionSkips ?? null,
      r.ingest?.resolutions ?? null, r.ingest?.merged ?? null, r.ingest?.mergeSkips ?? null,
      r.ingest?.live ?? null, r.ingest?.total ?? null, r.retrieval?.unranked ?? null,
    ]),
  }));
  out.push('');
  out.push('`filtered` is the novelty gate; `contradictions` marks the older record superseded (unretrievable, kept for audit) and `resolutions` are the synthesized records it wrote (no vector, so `unranked`); `merged` is the crystallizer absorbing a record into a survivor whose `evidence` then cites both turns. A threshold of 2 is a similarity no cosine reaches: the policies ran and did nothing, and that row is the baseline corpus the policy matrix measures against.');
  out.push('');
  out.push('`judge failed` is a judge call that threw — the pair is skipped and the pass goes on, but a row that judged nothing because the judge was down is not a row that judged everything and found nothing. `unapplied` and `unmerged` are the confirmed contradictions and the planned merges whose records had already been raced away when the write came. Every attempt is judged or failed; every confirmed verdict is applied or unapplied; every planned merge is merged or unmerged. A zero in these columns is a measurement, not an absence.');
  out.push('');
  out.push('## The gate');
  out.push('');
  const oracle = report.rows.find((r) => r.key === 'oracle')!;
  const random = report.rows.find((r) => r.key === 'random')!;
  out.push(table({
    head: ['k', 'oracle', 'analytic ceiling', 'random', 'analytic band'],
    rows: config.ks.map((k) => {
      const key = String(k);
      const band = report.floor[key];
      return [k, score(oracle.recall[key].overall), score(report.ceiling[key].overall), score(random.recall[key].overall),
        `${band.low.toFixed(4)} – ${band.high.toFixed(4)} around ${band.floor.toFixed(4)}`];
    }),
  }));
  out.push('');
  out.push(report.gate.passed
    ? '**Gate passed.** The oracle row equals its analytic ceiling at every k and the random row sits in its band. The ceiling is below 1 because 9 of 2,815 evidence ids resolve to no turn (see the census), and below that at small k because a question may cite up to 19 turns — an oracle at 1.000 would be a global dia_id lookup reading another conversation\'s turns.'
    : `**GATE FAILED.** ${report.gate.failures.join(' ')}`);
  out.push('');
  out.push('## Evidence recall@k, per category');
  out.push('');
  for (const k of config.ks) {
    const key = String(k);
    out.push(`### k = ${k}`);
    out.push('');
    out.push(table({
      head: ['row', 'overall', ...CATEGORY_HEAD],
      rows: [
        ...report.rows.map((r) => [r.kind === 'gate' ? `_${r.label}_` : `**${r.label}**`, ...categoryCells(r.recall[key])]),
        ['_analytic ceiling_', ...categoryCells(report.ceiling[key])],
      ],
    }));
    const merges = pipelineRows.map((r) => `${r.key} ${r.retrieval?.creditedViaMerge[key] ?? 0}`).join(', ');
    out.push('');
    out.push(`Gold hits credited through a crystallized survivor's absorbed address rather than its own: ${merges}.`);
    out.push('');
  }
  const near = report.rows.find((r) => r.key === 'near');
  const raw = report.rows.find((r) => r.key === 'near-raw');
  if (near !== undefined && raw !== undefined) {
    const k = String(config.ks[config.ks.length - 1]);
    const delta = near.recall[k].overall - raw.recall[k].overall;
    out.push('## What this table can and cannot decide');
    out.push('');
    out.push(`At k = ${k} the shipped policies move overall evidence recall by ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)} points against the same pipeline with every policy inert (${pct(near.recall[k].overall, 2)} vs ${pct(raw.recall[k].overall, 2)}), at a ceiling of ${pct(report.ceiling[k].overall, 2)}. ${delta < 0 ? 'That is a LOSS, and it is published as one: ' : 'That is the sign to read, and it is small: '}what the gate filtered and the judge superseded is what these questions could no longer retrieve.`);
    out.push('');
    out.push('What it cannot decide is embedding quality. The ranker here is the hashed-trigram reference, so `near` finds turns that share letters with the question. Read category 2 with that in mind: a temporal question quotes the event it asks about ("when did Caroline go to the support group"), so a lexical ranker finds the turn easily — but the turn holds no date; the answer is arithmetic over the session stamp, which no recall metric sees, and which is exactly the failure the category measures. The policy matrix (open in `docs/ROADMAP.md`) puts a real embedding client behind the same seam and re-runs this exact instrument; the temporal lane gives the ranker a notion of *when*; the answer path\'s F1 (`docs/LOCOMO_BENCHMARK.md`) says what recall could not, beside this ceiling. Until then, every number above is a property of the mechanism — ingest, gate, rank, cite — and not of any model.');
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push('LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.');
  return out.join('\n');
}
