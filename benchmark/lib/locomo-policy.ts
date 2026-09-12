/**
 * The LoCoMo policy matrix — the instrument that may change a memory
 * default, and the accounting that makes such a change believable.
 *
 * Everything shaped here answers one rule: a memory policy becomes the
 * default only when a preregistered comparison proves it improves
 * answers without hiding a category loss, a cost overrun, a failed call
 * or an unequal denominator. That rule is only worth as much as the
 * bookkeeping under it, so this module owns four things and nothing
 * else:
 *
 * **The registration.** The splits, the objective, the axes and the
 * ordered cell registry are fixed BEFORE a score is read, and they are
 * hashed into a `registrationId`. A cell is a set of effective values —
 * novelty, contradiction, crystallize, k, minScore, the built-in
 * embedding width — never a profile name, because a name is a promise
 * and a value is a measurement. Its `cellId` covers those values and
 * nothing else: a source change or an observed result can never move a
 * frozen treatment.
 *
 * **The identities.** Four, deliberately separate, all through
 * `@jarenjs/json/canonical` so member order cannot change a digest:
 * registration, treatment cell, run (the cell plus the complete
 * credential-free host — endpoint, models, thinking, response contract,
 * retry, deadline, concurrency, ceiling, sample and source revision),
 * and the report (the validated observation). The key itself never
 * reaches any of them; the NAME of the variable it came from may.
 * Source revision is HEAD plus a path/digest manifest, because HEAD
 * alone would label reviewed-but-uncommitted work as a commit that does
 * not contain it.
 *
 * **The power.** Every comparison publishes the realized paired SD, the
 * standard error, the minimum detectable effect at its own denominator,
 * the count of tied pairs and the size of the acting set — the
 * questions whose serialized prompt the cell actually changed. A null
 * is then published as "no effect larger than X was detectable", never
 * as "no effect". The acting set is a blocking secondary: it can refuse
 * a cell that is harmful exactly where it acts, and it can never
 * promote one, because the estimand for a global default is the whole
 * corpus.
 *
 * **The refusals.** A row with a failed call, an invalid reply, an
 * unequal denominator or a different question set is not eligible, and
 * an ineligible row is published with its reason rather than dropped so
 * a mean can look complete.
 *
 * The report's TypeScript comes from `schemas/locomo-policy.schema.json`
 * through `@jarenjs/emit`; this file holds only behaviour. The one
 * primitive built here rather than consumed is the paired bootstrap:
 * `@jarenjs/core/stats` publishes mean/median/quantile/stddev/variance
 * and no resampling, and the inverse normal it needs for a minimum
 * detectable effect is missing beside it.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mean as meanOf, quantile, stddev } from '@jarenjs/core/stats';
import { drawDistinct, mulberry32 } from '@jarenjs/core/random';
import { createHashEmbedder, type Embedder } from '@tangleai/models/embed';
import { sizeOf } from '@jarenjs/core/chunk';
import { sameIdentity } from '@tangleai/context/ledger';
import { analyticEnvelope } from './report-envelope.ts';
import { memoryId, recallByEmbedding, DEFAULT_MAX_PAIRS } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createOfflineEmbedder, OFFLINE_EMBEDDER_DIMS } from '@tangleai/pipeline';

import { LOCOMO_DATASET, SCORABLE_CATEGORIES, type LocomoSample } from './locomo.ts';
import { addressesOf, conversationCorpus, type ConversationCorpus } from './locomo-corpus.ts';
import { emptyCensus, ingestConversation, type IngestCensus } from './locomo-ingest.ts';
import {
  ANSWER_SCHEMA,
  contextLine,
  questionsOf,
  runLocomoQaLive,
  sampleQuestions,
  type LiveReport,
  type QaQuestion,
  type QaRow,
} from './locomo-qa.ts';
import type { AiEnv } from './ai-env.ts';
import type { WireCache } from './wire-cache.ts';
import type { ChatClient } from '../../apps/desktop/src/settings.ts';
import { numpyMean, officialScore } from './locomo-parity.ts';
import { average, evidenceRecall, oracleCeilingOf, randomBand, type GoldQuestion } from './recall.ts';
import { normalQuantile } from './stats.ts';
import { count, pct, score, table, type Cell } from './table.ts';
import type {
  Attempt,
  Axis,
  CauseAtK,
  Causes,
  Cell as CellSpec,
  Clause,
  Comparison,
  Exclusion,
  LocomoPolicy,
  Objective,
  Prompts,
  Reason,
  Registration,
  Run,
  Selection,
  Split,
  WidthDecision,
  ByCategory as MeansBlock,
  QuestionResult,
} from './locomo-policy.types.ts';

export type {
  Attempt,
  Axis,
  Causes,
  CellSpec,
  Clause,
  Comparison,
  Exclusion,
  LocomoPolicy,
  Objective,
  Prompts,
  Registration,
  Run,
  Selection,
  Split,
  WidthDecision,
};

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// the registration — fixed before a score is read
// ---------------------------------------------------------------------------

/** The draw's seed — LoCoMo's arXiv number, as every other instrument here. */
export const POLICY_SEED = 17753;

/** A similarity no cosine reaches: the policy runs and does nothing. */
export const OFF = 2;

/**
 * The held-out conversations, drawn once from the release's own order
 * and never redrawn. Recorded as the draw rather than as three names, so
 * a reader can reproduce the split instead of trusting it.
 */
export function confirmationConversations(sampleIds: readonly string[], seed = POLICY_SEED): string[] {
  const picked = drawDistinct(mulberry32(seed), sampleIds.length, 3).map((i) => sampleIds[i]);
  return [...picked].sort();
}

/**
 * The axes and the inert reference every isolated cell changes exactly
 * one level of. k = 10 is inert because every published LoCoMo number
 * was measured there, so the inert cell reproduces the baseline rather
 * than inventing a new one.
 */
export const POLICY_AXES: readonly Axis[] = [
  { axis: 'novelty', inert: OFF, levels: [0.99, 0.97, 0.9, 0.75] },
  { axis: 'contradiction', inert: OFF, levels: [0.9, 0.8, 0.75] },
  { axis: 'crystallize', inert: OFF, levels: [0.95, 0.9, 0.82] },
  { axis: 'k', inert: 10, levels: [5, 20] },
  { axis: 'minScore', inert: 0, levels: [0.25, 0.5, 0.75] },
  { axis: 'offlineWidth', inert: OFFLINE_EMBEDDER_DIMS, levels: [128, 256, 512] },
];

/** The objective, as registered. Nothing here may move after a score is read. */
export const POLICY_OBJECTIVE: Objective = {
  primary: 'locomo-f1',
  statistic: 'paired-bootstrap',
  resamples: 10000,
  bootstrapSeed: POLICY_SEED,
  level: 0.95,
  quantileMethod: 'nearest-rank',
  categoryLowerBound: -0.05,
  categoryLevel: 0.95,
  tokenRatioMax: 1.1,
  callRatioMax: 1,
  actingSet: 'blocking-secondary',
  futility: 'the inert cell becomes the default and the null is published as a bounded null',
  publishedPower: ['pairedSd', 'standardError', 'minimumDetectableEffect', 'tiedPairs', 'actingSetSize'],
};

/** The selection rule, in the words the report publishes it in. */
export const SELECTION_RULE = 'a challenger is the greatest selection overall paired delta among eligible cells whose point category deltas are all at least the registered floor and whose normalized token and call costs meet the objective, ties broken by ascending cell identity';

type Levels = { novelty: number, contradiction: number, crystallize: number, k: number, minScore: number, width: number };

const INERT_LEVELS: Levels = { novelty: OFF, contradiction: OFF, crystallize: OFF, k: 10, minScore: 0, width: OFFLINE_EMBEDDER_DIMS };
/** The shipped runtime values, as a cell — a published control, never a promotion. */
const SHIPPED_LEVELS: Levels = { ...INERT_LEVELS, novelty: 0.97, contradiction: 0.8, crystallize: 0.9 };

function levelsOf(cell: CellSpec): Levels {
  return {
    novelty: cell.ingest.novelty,
    contradiction: cell.ingest.contradiction,
    crystallize: cell.ingest.crystallize,
    k: cell.retrieval.k,
    minScore: cell.retrieval.minScore,
    width: cell.embedding.dims,
  };
}

function draft(key: string, label: string, role: CellSpec['role'], axis: CellSpec['axis'], levels: Levels): Omit<CellSpec, 'cellId'> {
  return {
    key,
    label,
    role,
    axis,
    ingest: { novelty: levels.novelty, contradiction: levels.contradiction, crystallize: levels.crystallize, maxPairs: DEFAULT_MAX_PAIRS },
    retrieval: { k: levels.k, minScore: levels.minScore },
    embedding: { model: `hash-trigram-${levels.width}`, dims: levels.width },
  };
}

const AXIS_LEVEL: Record<Axis['axis'], keyof Levels> = {
  novelty: 'novelty', contradiction: 'contradiction', crystallize: 'crystallize',
  k: 'k', minScore: 'minScore', offlineWidth: 'width',
};

/**
 * The registry, in publication order: the inert reference, the shipped
 * control, then every registered level in isolation against the inert
 * reference. Pairwise combinations are added by the screen that earns
 * them; a cell nobody registered can never be attempted, and no two
 * cells may carry the same effective values, because a cell IS its
 * values.
 */
export function cellDrafts(): Array<Omit<CellSpec, 'cellId'>> {
  const out = [
    draft('inert', 'inert (every policy off, k 10)', 'inert', null, INERT_LEVELS),
    draft('shipped', 'shipped (the runtime defaults, k 10)', 'shipped', null, SHIPPED_LEVELS),
  ];
  for (const axis of POLICY_AXES) {
    const member = AXIS_LEVEL[axis.axis];
    for (const level of axis.levels) {
      out.push(draft(`${axis.axis}-${level}`, `${axis.axis} ${level} (else inert)`, 'isolated', axis.axis, { ...INERT_LEVELS, [member]: level }));
    }
  }
  // there is no separate "shipped interaction" cell: the inert reference
  // already holds the shipped k, minScore and width, so the three ingest
  // policies at their shipped levels ARE the shipped cell, and a second
  // registration of the same effective values would be the same cellId
  // wearing a candidate's role
  return out;
}

// ---------------------------------------------------------------------------
// the four identities
// ---------------------------------------------------------------------------

/** A treatment cell's identity: its effective values, and nothing else. */
export async function cellIdOf(cell: Omit<CellSpec, 'cellId'>): Promise<string> {
  return canonicalSha256({ ingest: cell.ingest, retrieval: cell.retrieval, embedding: cell.embedding });
}

/** The registration's identity: splits, objective, axes and the ordered registry. */
export async function registrationIdOf(registration: Omit<Registration, 'registrationId'>): Promise<string> {
  return canonicalSha256({
    seed: registration.seed,
    splits: registration.splits,
    objective: registration.objective,
    axes: registration.axes,
    cells: registration.cells.map((c) => c.cellId),
    // the approved host is part of the registration from the moment it is
    // approved: a run under a different endpoint, model or ceiling is a
    // different experiment, never a row to merge into this one
    inference: registration.inference === null ? null : registration.inference.identity,
  });
}

/** A run's identity: the cell, plus every control that has to be equal for two rows to be one experiment. */
export async function runIdOf(cellId: string, run: Run): Promise<string> {
  return canonicalSha256({ cellId, run });
}

/** The digest of a scored question set — what a comparison compares instead of walking two lists. */
export async function questionSetOf(ids: readonly string[]): Promise<string> {
  return canonicalSha256([...ids].sort());
}

/** The report's identity, over the validated observation with the hash field excluded from its own input. */
export async function reportIdOf(report: Omit<LocomoPolicy, 'reportId'> & { reportId?: string }): Promise<string> {
  const { reportId: _ignored, ...rest } = report;
  return canonicalSha256(rest);
}

// ---------------------------------------------------------------------------
// the source revision — HEAD is not enough while work is uncommitted
// ---------------------------------------------------------------------------

/** The directories whose bytes decide what a cell does. */
export const SOURCE_ROOTS: readonly string[] = [
  'benchmark/lib',
  'benchmark/schemas',
  'packages/memory/src',
  'packages/pipeline/src',
];

/** The files beside those directories that are equally load-bearing. */
export const SOURCE_FILES: readonly string[] = [
  'benchmark/locomo-policy.ts',
  'benchmark/locomo-qa.ts',
  'benchmark/locomo-recall.ts',
];

async function gitLine(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await exec('git', [...args], { cwd });
  return stdout;
}

/**
 * HEAD, whether the tree is clean, and an ordered path/digest manifest
 * of everything a cell's behaviour reads. Two runs of the same bytes
 * produce the same revision; a byte changed without a commit changes it,
 * and an ignored campaign file does not.
 */
export async function sourceRevision(root = process.cwd()): Promise<LocomoPolicy['source']> {
  const head = (await gitLine(root, ['rev-parse', 'HEAD'])).trim();
  const clean = (await gitLine(root, ['status', '--porcelain'])).trim() === '';
  const paths: string[] = [...SOURCE_FILES];
  for (const dir of SOURCE_ROOTS) {
    const names = await readdir(join(root, dir));
    for (const name of names) {
      if (name.endsWith('.ts') || name.endsWith('.json')) paths.push(`${dir}/${name}`);
    }
  }
  paths.sort();
  const files: Array<{ path: string, sha256: string }> = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { head, clean, files, sha256: await canonicalSha256({ head, files }) };
}

// ---------------------------------------------------------------------------
// paired statistics — the power a report may not publish a mean without
// ---------------------------------------------------------------------------

export interface Pair {
  id: string;
  category: 1 | 2 | 3 | 4;
  treatment: number;
  control: number;
  delta: number;
  /** True when the two cells produced a different serialized prompt for this question. */
  acting: boolean;
}

/** The paired rows two attempts share, in the treatment's order; an id only one holds is not a pair. */
export function pairsOf(treatment: Attempt, control: Attempt): Pair[] {
  const byId = new Map(control.results.map((r) => [r.id, r]));
  const pairs: Pair[] = [];
  for (const t of treatment.results) {
    const c = byId.get(t.id);
    if (c === undefined) continue;
    pairs.push({
      id: t.id,
      category: t.category,
      treatment: t.score,
      control: c.score,
      delta: t.score - c.score,
      acting: t.promptSha256 !== c.promptSha256,
    });
  }
  return pairs;
}

export interface PowerBlock {
  pairedSd: number;
  standardError: number;
  minimumDetectableEffect: number;
  tiedPairs: number;
  actingSetSize: number;
}

/**
 * What the comparison could have seen. The minimum detectable effect is
 * the two-sided bound at the registered level over the realized paired
 * SD at THIS denominator — the number that turns "no difference" into
 * "no difference larger than this".
 */
export function powerOf(pairs: readonly Pair[], level: number): PowerBlock {
  const deltas = pairs.map((p) => p.delta);
  const sd = deltas.length < 2 ? 0 : (stddev(deltas) ?? 0);
  const se = deltas.length === 0 ? 0 : sd / Math.sqrt(deltas.length);
  return {
    pairedSd: sd,
    standardError: se,
    minimumDetectableEffect: normalQuantile(1 - (1 - level) / 2) * se,
    tiedPairs: pairs.filter((p) => p.delta === 0).length,
    actingSetSize: pairs.filter((p) => p.acting).length,
  };
}

/**
 * The paired bootstrap: resample the pairs WITH replacement, take the
 * mean each time, and read the percentile interval by the suite's own
 * nearest-rank quantile. Seeded, so the interval is a property of the
 * data and not of the day it was computed.
 *
 * Written here because `@jarenjs/core/stats` publishes no resampling.
 */
export function bootstrapInterval(
  deltas: readonly number[],
  options: { resamples: number, seed: number, level: number },
): { low: number, high: number } {
  if (deltas.length === 0) return { low: 0, high: 0 };
  const random = mulberry32(options.seed);
  const means: number[] = [];
  for (let r = 0; r < options.resamples; r++) {
    let sum = 0;
    for (let i = 0; i < deltas.length; i++) sum += deltas[Math.floor(random() * deltas.length)];
    means.push(sum / deltas.length);
  }
  const tail = (1 - options.level) / 2;
  return {
    low: quantile(means, tail, { method: 'nearest-rank' }) ?? 0,
    high: quantile(means, 1 - tail, { method: 'nearest-rank' }) ?? 0,
  };
}

/** The one-sided lower bound at `level` over a sample's own SD. */
function lowerBound(values: readonly number[], level: number): number {
  if (values.length === 0) return 0;
  const m = meanOf(values) ?? 0;
  const sd = values.length < 2 ? 0 : (stddev(values) ?? 0);
  return m - normalQuantile(level) * sd / Math.sqrt(values.length);
}

// ---------------------------------------------------------------------------
// eligibility — a failure stays in the row and refuses the comparison
// ---------------------------------------------------------------------------

export interface Denominators {
  planned: number;
  answered: number;
  unanswered: { wire: number, budget: number };
  invalid: number;
  questionSet: string;
}

/** Why this attempt cannot enter a comparison, or an empty list. */
export function eligibilityReasons(denominators: Denominators, operations: IngestCensus): Reason[] {
  const reasons: Reason[] = [];
  if (denominators.planned !== denominators.answered) {
    reasons.push({ code: 'incomplete', detail: `${denominators.answered} of ${denominators.planned} planned questions were answered` });
  }
  if (denominators.invalid > 0) reasons.push({ code: 'invalid-reply', detail: `${denominators.invalid} replies failed their contract after repair` });
  if (denominators.unanswered.wire > 0) reasons.push({ code: 'wire-failure', detail: `${denominators.unanswered.wire} questions were never asked: the wire failed` });
  if (denominators.unanswered.budget > 0) reasons.push({ code: 'budget-stop', detail: `${denominators.unanswered.budget} questions were never asked: the budget stopped the run` });
  if (operations.judgeFailures > 0) reasons.push({ code: 'judge-failure', detail: `${operations.judgeFailures} contradiction judgments failed` });
  if (operations.contradictionSkips > 0) reasons.push({ code: 'policy-application-failure', detail: `${operations.contradictionSkips} confirmed contradictions could not be applied` });
  if (operations.mergeSkips > 0) reasons.push({ code: 'policy-application-failure', detail: `${operations.mergeSkips} planned merges could not be applied` });
  return reasons;
}

/** Why two attempts cannot be compared, or an empty list. */
export function comparabilityReasons(treatment: Attempt, control: Attempt): Reason[] {
  const reasons: Reason[] = [];
  if (treatment.phase !== control.phase) {
    reasons.push({ code: 'different-phase', detail: `${treatment.phase} against ${control.phase}` });
  }
  if (treatment.denominators.questionSet !== control.denominators.questionSet) {
    reasons.push({ code: 'different-questions', detail: 'the two rows did not score the same question set' });
  }
  if (treatment.denominators.answered !== control.denominators.answered) {
    reasons.push({ code: 'unequal-denominator', detail: `${treatment.denominators.answered} answers against ${control.denominators.answered}` });
  }
  if (treatment.run.embedder.model !== control.run.embedder.model || treatment.run.embedder.dims !== control.run.embedder.dims) {
    reasons.push({
      code: 'different-embedding-identity',
      detail: 'vectors from two identities never rank against each other, so two such rows are not one experiment;'
        + ' a built-in width is read from the rows themselves as a lexical-tier result, never from a paired comparison',
    });
  }
  if (treatment.run.answerModel !== control.run.answerModel || treatment.run.judgeModel !== control.run.judgeModel) {
    reasons.push({ code: 'different-model', detail: 'the answer or judge model differs' });
  }
  if (treatment.run.tier !== control.run.tier) reasons.push({ code: 'different-tier', detail: `${treatment.run.tier} against ${control.run.tier}` });
  if (treatment.run.source !== control.run.source) reasons.push({ code: 'different-source', detail: 'the two rows ran different bytes' });
  for (const attempt of [treatment, control]) {
    for (const reason of attempt.eligibility.reasons) {
      reasons.push({ code: reason.code, detail: `${attempt.cellId.slice(0, 12)}…: ${reason.detail}` });
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// the comparison
// ---------------------------------------------------------------------------

/**
 * Per-category means and the mean over categories 1-4 together. The
 * aggregate is a parameter because recall averages as the recall
 * instrument averages and an official F1 averages as NumPy does — two
 * means, both correct, and never each other's.
 */
function meansBlock(
  values: ReadonlyArray<{ category: number, value: number }>,
  aggregate: (values: readonly number[]) => number = average,
): MeansBlock {
  const byCategory = {} as MeansBlock['byCategory'];
  for (const c of SCORABLE_CATEGORIES) {
    const own = values.filter((v) => v.category === c).map((v) => v.value);
    byCategory[String(c) as '1'] = own.length === 0 ? null : aggregate(own);
  }
  const all = values.filter((v) => (SCORABLE_CATEGORIES as readonly number[]).includes(v.category)).map((v) => v.value);
  return { overall: all.length === 0 ? 0 : aggregate(all), byCategory };
}

/** One treatment against one control, with everything the objective reads and everything a reader needs to disbelieve it. */
export function comparisonOf(
  treatment: Attempt,
  control: Attempt,
  objective: Objective,
  metric: Comparison['metric'],
): Comparison {
  const pairs = pairsOf(treatment, control);
  const deltas = pairs.map((p) => p.delta);
  const reasons = comparabilityReasons(treatment, control);
  const eligible = reasons.length === 0 && pairs.length > 0
    && treatment.eligibility.eligible && control.eligibility.eligible;
  if (pairs.length === 0) reasons.push({ code: 'no-pairs', detail: 'the two rows share no scored question' });
  const power = powerOf(pairs, objective.level);
  const interval = bootstrapInterval(deltas, { resamples: objective.resamples, seed: objective.bootstrapSeed, level: objective.level });
  const acting = pairs.filter((p) => p.acting);
  const actingInterval = bootstrapInterval(acting.map((p) => p.delta), { resamples: objective.resamples, seed: objective.bootstrapSeed, level: objective.level });
  const byCategory = SCORABLE_CATEGORIES.map((c) => {
    const own = pairs.filter((p) => p.category === c).map((p) => p.delta);
    return {
      category: c as 1 | 2 | 3 | 4,
      pairs: own.length,
      mean: own.length === 0 ? 0 : average(own),
      sd: own.length < 2 ? 0 : (stddev(own) ?? 0),
      lowerBound: lowerBound(own, objective.categoryLevel),
    };
  });
  const cost = treatment.cost === null || control.cost === null || control.cost.tokensPerAnswer === 0 || control.cost.callsPerAnswer === 0
    ? null
    : {
      tokenRatio: treatment.cost.tokensPerAnswer / control.cost.tokensPerAnswer,
      callRatio: treatment.cost.callsPerAnswer / control.cost.callsPerAnswer,
    };
  const blocks = acting.length > 0 && actingInterval.high < 0;

  // every registered clause, read one at a time and published whether it
  // passed or not — a default that changed because "the numbers looked
  // good" is exactly what the objective exists to replace
  const lost = byCategory.filter((row) => row.pairs > 0 && row.lowerBound < objective.categoryLowerBound);
  const clauses: Clause[] = [
    { clause: 'eligible', passed: eligible, detail: eligible ? 'both rows answered the same questions with no hidden failure' : 'an ineligible comparison can never promote a cell' },
    { clause: 'primary-objective', passed: metric === objective.primary, detail: metric === objective.primary ? `${metric}, the registered primary` : `${metric} is a screen: a retrieval-only win can never change a default` },
    { clause: 'held-out-split', passed: treatment.phase === 'confirmation', detail: treatment.phase === 'confirmation' ? 'measured on the held-out split' : `a ${treatment.phase} result allocates budget; only the held-out confirmation may change a default` },
    { clause: 'overall-interval', passed: interval.low > 0, detail: `the ${(objective.level * 100).toFixed(0)}% lower bound is ${interval.low.toFixed(4)}` },
    {
      clause: 'category-floor',
      passed: lost.length === 0,
      detail: lost.length === 0
        ? `every category's one-sided lower bound is at least ${objective.categoryLowerBound}`
        : lost.map((row) => `category ${row.category}'s lower bound ${row.lowerBound.toFixed(4)} is below ${objective.categoryLowerBound}`).join('; '),
    },
    {
      clause: 'token-ratio',
      passed: cost !== null && cost.tokenRatio <= objective.tokenRatioMax,
      detail: cost === null ? 'no provider cost exists on this tier, so the clause cannot be satisfied' : `${cost.tokenRatio.toFixed(3)}× the control's tokens per answered question, against a ceiling of ${objective.tokenRatioMax.toFixed(2)}`,
    },
    {
      clause: 'call-ratio',
      passed: cost !== null && cost.callRatio <= objective.callRatioMax,
      detail: cost === null ? 'no provider cost exists on this tier, so the clause cannot be satisfied' : `${cost.callRatio.toFixed(3)}× the control's calls per answered question, against a ceiling of ${objective.callRatioMax.toFixed(2)}`,
    },
    {
      clause: 'acting-set',
      passed: !blocks,
      detail: acting.length === 0
        ? 'the cell changed no prompt at all'
        : `on the ${acting.length} prompts it changed the interval is [${actingInterval.low.toFixed(4)}, ${actingInterval.high.toFixed(4)}]${blocks ? ' — harmful exactly where it acts' : ''}`,
    },
  ];
  const verdict: Comparison['verdict'] = {
    promotes: clauses.every((c) => c.passed),
    clauses,
    reasons: clauses.filter((c) => !c.passed).map((c) => ({ code: c.clause, detail: c.detail })),
  };

  return {
    key: `${treatment.cellId.slice(0, 12)} vs ${control.cellId.slice(0, 12)} @ ${treatment.phase}`,
    phase: treatment.phase,
    metric,
    treatment: treatment.cellId,
    control: control.cellId,
    eligible,
    reasons,
    pairs: pairs.length,
    questionSet: treatment.denominators.questionSet,
    mean: deltas.length === 0 ? 0 : average(deltas),
    interval,
    power,
    byCategory,
    actingSet: { size: acting.length, mean: acting.length === 0 ? 0 : average(acting.map((p) => p.delta)), sd: acting.length < 2 ? 0 : (stddev(acting.map((p) => p.delta)) ?? 0), interval: actingInterval, blocks },
    cost,
    boundedNull: `no effect larger than ${power.minimumDetectableEffect.toFixed(4)} was detectable at ${pairs.length} pairs (paired SD ${power.pairedSd.toFixed(4)}, standard error ${power.standardError.toFixed(4)}, ${power.tiedPairs} tied, ${power.actingSetSize} acting)`,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// merging attempts — identity equality, never a hand-written subset
// ---------------------------------------------------------------------------

/** Why a fresh attempt cannot join a report, or null. */
export function attemptRefusal(report: LocomoPolicy, fresh: Attempt): string | null {
  if (!report.registration.cells.some((c) => c.cellId === fresh.cellId)) {
    return `cell ${fresh.cellId.slice(0, 12)}… is not in the registration`;
  }
  const clash = report.attempts.find((a) => a.cellId === fresh.cellId && a.phase === fresh.phase && a.runId !== fresh.runId);
  if (clash !== undefined) {
    return `cell ${fresh.cellId.slice(0, 12)}… already has a ${fresh.phase} attempt under run ${clash.runId.slice(0, 12)}…; a run identity is not interchangeable with another`;
  }
  if (fresh.phase === 'confirmation' && report.selection.state === 'open') {
    return 'confirmation cannot be attempted while the shortlist is open';
  }
  return null;
}

/**
 * A fresh attempt replaces the attempt of the same cell, phase AND run
 * identity — a replay completing a registered cell — and is otherwise
 * appended. Anything else is refused with its reason; nothing is
 * silently dropped.
 */
export function mergeAttempt(report: LocomoPolicy, fresh: Attempt): LocomoPolicy {
  const refusal = attemptRefusal(report, fresh);
  if (refusal !== null) throw new Error(`the attempt cannot join this report: ${refusal}`);
  const kept = report.attempts.filter((a) => a.runId !== fresh.runId);
  return { ...report, attempts: [...kept, fresh] };
}
// ---------------------------------------------------------------------------
// where every gold address went — the exclusive cause census
// ---------------------------------------------------------------------------

/**
 * The ordered, exhaustive, mutually exclusive vocabulary: from what the
 * release lost before any policy ran, through what each policy disposed
 * of, to what the prompt actually carried. Every gold address of every
 * scored question lands in exactly one bucket at each k, and the schema
 * refuses a report whose buckets do not sum to the denominator — so
 * "the fact never reached the prompt" always says WHERE it was lost.
 */
export const CAUSES = [
  'source-unresolved',
  'content-collapsed',
  'novelty-filtered',
  'contradiction-superseded',
  'crystallized-not-carried',
  'identity-unranked',
  'below-min-score',
  'outside-k',
  'retrieved',
] as const;

export type CauseName = typeof CAUSES[number];

/** The vocabulary's revision, carried by every census written against it. */
export const CAUSE_VOCABULARY = '1';

/** The cut-offs every census is reported at, beside the cell's own k. */
export const CENSUS_KS = [5, 10, 20] as const;

/** What one conversation's ingested store says about its addresses. */
export interface Disposition {
  addresses: ReadonlySet<string>;
  idOf: ReadonlyMap<string, string>;
  byId: ReadonlyMap<string, MemoryUnit>;
  owners: ReadonlyMap<string, MemoryUnit[]>;
  mergedFrom: ReadonlySet<string>;
}

export function dispositionOf(corpus: ConversationCorpus, units: readonly MemoryUnit[]): Disposition {
  const idOf = new Map<string, string>();
  for (const session of corpus.sessions) {
    for (const input of session.inputs) idOf.set(input.evidence, memoryId(input.text));
  }
  const byId = new Map<string, MemoryUnit>();
  const owners = new Map<string, MemoryUnit[]>();
  const mergedFrom = new Set<string>();
  for (const unit of units) {
    byId.set(unit.id, unit);
    for (const id of unit.mergedFrom ?? []) mergedFrom.add(id);
    for (const address of addressesOf(unit.evidence, corpus.sampleId)) {
      const list = owners.get(address) ?? [];
      list.push(unit);
      owners.set(address, list);
    }
  }
  return { addresses: corpus.addresses, idOf, byId, owners, mergedFrom };
}

/** One question's whole ranking, before k and before the cell's cutoff. */
export interface Ranking {
  /** Passing the cell's minScore, best first — the list k cuts. */
  passing: Array<{ unit: MemoryUnit, score: number }>;
  /** Every address any passing unit credits. */
  passingAddresses: ReadonlySet<string>;
  /** Live records the ranker could not score at all. */
  unranked: number;
  /** Whether this address has a live record the ranker could compare. */
  comparable: (address: string) => boolean;
}

/**
 * The one terminal disposition of one gold address at one k. The order
 * of the branches IS the vocabulary's order, which is what makes the
 * buckets exclusive without a second pass to de-duplicate them.
 */
export function causeOf(
  address: string,
  disposition: Disposition,
  ranking: Ranking,
  creditedAtK: ReadonlySet<string>,
): CauseName {
  if (!disposition.addresses.has(address)) return 'source-unresolved';
  const owners = disposition.owners.get(address) ?? [];
  if (owners.length === 0) {
    const id = disposition.idOf.get(address);
    // the content-addressed id is shared with another turn and the store's
    // record under it credits that other turn: this address was overwritten
    if (id !== undefined && disposition.byId.has(id)) return 'content-collapsed';
    if (id !== undefined && disposition.mergedFrom.has(id)) return 'crystallized-not-carried';
    return 'novelty-filtered';
  }
  if (owners.every((u) => u.supersededBy !== undefined)) return 'contradiction-superseded';
  if (creditedAtK.has(address)) return 'retrieved';
  if (ranking.passingAddresses.has(address)) return 'outside-k';
  if (!ranking.comparable(address)) return 'identity-unranked';
  return 'below-min-score';
}

function emptyTally(): Map<CauseName, number> {
  return new Map(CAUSES.map((cause) => [cause, 0]));
}

function causeBlock(byK: ReadonlyMap<number, Map<CauseName, number>>): Causes {
  const out: Causes['byK'] = {};
  for (const [k, tally] of [...byK].sort((a, b) => a[0] - b[0])) {
    const partition = CAUSES.map((cause) => ({ cause, count: tally.get(cause) ?? 0 }));
    const block: CauseAtK = { denominator: partition.reduce((n, p) => n + p.count, 0), partition };
    out[String(k)] = block;
  }
  return { version: CAUSE_VOCABULARY, byK: out };
}

// ---------------------------------------------------------------------------
// the keyless screen
// ---------------------------------------------------------------------------

/** Which questions a run scores, and over which conversations. */
export type PolicyPhase = 'screen' | 'selection';

export interface PolicyRunOptions {
  /**
   * `selection` scores the registered selection sample over the
   * selection conversations — the phase whose outcome may freeze a
   * shortlist. `screen` scores every scorable question of whatever
   * conversations it is given, which is a diagnostic and never freezes
   * anything. `confirmation` is not a value here: a held-out result
   * cannot be reached by a flag on a screen.
   */
  phase?: PolicyPhase;
  /** Cell keys to attempt; `['all']` runs the whole registry. The inert reference always runs. */
  cells?: readonly string[];
  /** Restrict the run to these sample ids. In the selection phase they must be selection conversations. */
  samples?: readonly string[];
  seed?: number;
  /** Injected so a test can pin it without a git process. */
  source?: LocomoPolicy['source'];
  onProgress?: (message: string) => void;
}

interface Dataset { samples: LocomoSample[], bytes: number, sha256: string, valid: boolean }

function embedderFor(dims: number): Embedder & { dims: number } {
  return dims === OFFLINE_EMBEDDER_DIMS ? createOfflineEmbedder() : createHashEmbedder({ dims });
}

/** The keyless run identity: no host, no key, and the bytes that produced it. */
function keylessRun(cell: CellSpec, ids: readonly string[], questionSet: string, source: string): Run {
  return {
    tier: 'keyless',
    provider: 'none',
    endpoint: null,
    answerModel: null,
    judgeModel: null,
    embedder: { model: cell.embedding.model, dims: cell.embedding.dims },
    thinking: null,
    responseSchema: null,
    retry: null,
    deadlineMs: null,
    concurrency: 1,
    budgetCeiling: null,
    keySource: null,
    questionSet,
    sampleIds: [...ids],
    source,
  };
}

/** One conversation as every cell reads it. */
interface Entry { corpus: ConversationCorpus, questions: QaQuestion[] }

/** What one cell did, before it is turned into an attempt. */
interface Measurement {
  cell: CellSpec;
  operations: IngestCensus;
  results: QuestionResult[];
  causes: Causes;
  tokenProxy: number;
  unranked: number;
  recall: MeansBlock;
  oracleCeiling: MeansBlock;
  verbatimFloor: MeansBlock;
  /** Sum of the policy operations a cell spent — the shortlist's cost co-objective. */
  policyOperations: number;
}

/**
 * Screen one cell: ingest each conversation through the real pipeline at
 * the cell's thresholds, rank at the cell's own k and minScore, score
 * the official evidence recall, quote the retrieved context as the
 * model-free floor, and assign every gold address its one terminal
 * cause at every censused k.
 */
async function measureCell(
  cell: CellSpec,
  entries: ReadonlyArray<Entry>,
  progress: (message: string) => void,
): Promise<Measurement> {
  const embedder = embedderFor(cell.embedding.dims);
  const identity = { model: embedder.model, dims: embedder.dims };
  const operations = emptyCensus();
  const results: QuestionResult[] = [];
  const recallValues: Array<{ category: number, value: number }> = [];
  const ceilingValues: Array<{ category: number, value: number }> = [];
  const floorValues: Array<{ category: number, value: number }> = [];
  const ks = [...new Set<number>([...CENSUS_KS, cell.retrieval.k])].sort((a, b) => a - b);
  const tally = new Map<number, Map<CauseName, number>>(ks.map((k) => [k, emptyTally()]));
  let tokenProxy = 0;
  let unranked = 0;

  for (const entry of entries) {
    const { corpus, questions } = entry;
    const { units } = await ingestConversation(corpus, {
      embedder,
      thresholds: { novelty: cell.ingest.novelty, contradiction: cell.ingest.contradiction, crystallize: cell.ingest.crystallize },
      census: operations,
    });
    const disposition = dispositionOf(corpus, units);
    const vectors = questions.length === 0 ? [] : await embedder.embed(questions.map((q) => q.text));
    let unrankedSeen = false;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      // the whole ranking, once: k and the cutoff are read from it rather
      // than bought again, so a cause and a score never disagree
      const all = recallByEmbedding(units, vectors[i], { k: units.length, minScore: 0, identity });
      if (!unrankedSeen) { unranked += all.skipped; unrankedSeen = true; }
      const passing = all.ranked.filter((r) => r.score >= cell.retrieval.minScore);
      const passingAddresses = new Set<string>();
      for (const r of passing) for (const a of addressesOf(r.unit.evidence, corpus.sampleId)) passingAddresses.add(a);
      const ranking: Ranking = {
        passing,
        passingAddresses,
        unranked: all.skipped,
        comparable: (address) => (disposition.owners.get(address) ?? []).some(
          (u) => u.supersededBy === undefined && u.embedding !== undefined && u.embeddedBy !== undefined
            && sameIdentity(u.embeddedBy, identity),
        ),
      };

      const creditedAt = new Map<number, Set<string>>();
      for (const k of ks) {
        const credited = new Set<string>();
        for (const r of passing.slice(0, k)) for (const a of addressesOf(r.unit.evidence, corpus.sampleId)) credited.add(a);
        creditedAt.set(k, credited);
        const bucket = tally.get(k)!;
        for (const address of q.gold) {
          const cause = causeOf(address, disposition, ranking, credited);
          bucket.set(cause, (bucket.get(cause) ?? 0) + 1);
        }
      }

      const context = passing.slice(0, cell.retrieval.k).map((r) => r.unit);
      const lines = context.map(contextLine);
      tokenProxy += sizeOf(lines.join('\n'));
      const recall = evidenceRecall(q.gold, creditedAt.get(cell.retrieval.k)!);
      recallValues.push({ category: q.category, value: recall });
      ceilingValues.push({ category: q.category, value: oracleCeilingOf(q, cell.retrieval.k) });
      const quoted = q.answer === undefined
        ? null
        : officialScore({ category: q.category, prediction: context.map((u) => u.text).join(' '), answer: q.answer });
      if (quoted !== null && quoted.scored) floorValues.push({ category: q.category, value: quoted.f1 });
      results.push({
        id: q.id,
        category: q.category as 1 | 2 | 3 | 4,
        score: recall,
        f1: null,
        // the ceiling this score is read against is the recall the
        // retrieval reached; on a tier that scores that recall they are
        // the same number, and the analytic ceiling is published apart
        ceiling: recall,
        // the serialized prompt, so the acting set is read from what the
        // cell CHANGED and never from what it scored
        promptSha256: await canonicalSha256(lines),
        tokens: 0,
        calls: 0,
      });
    }
    progress(`${cell.key} ${corpus.sampleId}: ${units.length} memories, ${questions.length} scored questions`);
  }

  return {
    cell,
    operations,
    results,
    causes: causeBlock(tally),
    tokenProxy,
    unranked,
    recall: meansBlock(recallValues),
    oracleCeiling: meansBlock(ceilingValues),
    verbatimFloor: meansBlock(floorValues, numpyMean),
    policyOperations: operations.filtered + operations.judgeAttempts + operations.confirmed + operations.crystallizePlanned,
  };
}

// ---------------------------------------------------------------------------
// the frontier, the filters and the freeze
// ---------------------------------------------------------------------------

/** The ladder the shortlist is ordered by, in exactly this order. */
export const TIE_BREAK = 'evidence recall at the cell\'s own effective k descending, verbatim floor at that same k descending, prompt-token proxy ascending, policy operations ascending, cell identity ascending';
/** The screen's algorithm, recorded with the freeze so a reader can reproduce it. */
export const FREEZE_ALGORITHM = 'Pareto frontier over evidence recall and verbatim floor at each cell\'s own k against prompt-token proxy and policy operations, subject to no category losing more than the registered floor; then the cost-feasibility and live-applicability filters; then the registered tie-break';

/** How many non-control cells a freeze may carry. */
export const SHORTLIST_LIMIT = 4;

/**
 * What the shortlist ranks a cell by. `recall` and `floor` are read at
 * the cell's OWN effective k — comparing two cells at a fixed k would
 * make the k axis meaningless, and the token proxy is the co-objective
 * that makes a larger k pay for the recall it buys.
 */
export interface Objectives {
  cellId: string;
  recall: number;
  floor: number;
  tokenProxy: number;
  operations: number;
}

function objectivesOf(m: Measurement): Objectives {
  return { cellId: m.cell.cellId, recall: m.recall.overall, floor: m.verbatimFloor.overall, tokenProxy: m.tokenProxy, operations: m.policyOperations };
}

/** True when `a` is at least as good on every objective and better on one. */
export function dominates(a: Objectives, b: Objectives): boolean {
  const atLeast = a.recall >= b.recall && a.floor >= b.floor && a.tokenProxy <= b.tokenProxy && a.operations <= b.operations;
  const better = a.recall > b.recall || a.floor > b.floor || a.tokenProxy < b.tokenProxy || a.operations < b.operations;
  return atLeast && better;
}

/** The categories this cell loses more than the registered floor on, against inert. */
function categoryLosses(m: Measurement, inert: Measurement, floor: number): number[] {
  const lost: number[] = [];
  for (const c of SCORABLE_CATEGORIES) {
    const key = String(c) as '1';
    const mine = m.recall.byCategory[key];
    const theirs = inert.recall.byCategory[key];
    if (mine === null || theirs === null) continue;
    if (mine - theirs < floor) lost.push(c);
  }
  return lost;
}

/** The registered ladder, in exactly its registered order. */
export function compareByLadder(a: Objectives, b: Objectives): number {
  if (a.recall !== b.recall) return b.recall - a.recall;
  if (a.floor !== b.floor) return b.floor - a.floor;
  if (a.tokenProxy !== b.tokenProxy) return a.tokenProxy - b.tokenProxy;
  if (a.operations !== b.operations) return a.operations - b.operations;
  return a.cellId < b.cellId ? -1 : a.cellId > b.cellId ? 1 : 0;
}

function tieBreak(a: Measurement, b: Measurement): number {
  return compareByLadder(objectivesOf(a), objectivesOf(b));
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

/**
 * Screen the requested cells: no key, no clock, no model. Two runs of
 * the same registration over the same bytes are byte-identical, which
 * is the whole point of a screen that spends nothing.
 *
 * In the `selection` phase the run scores the registered selection
 * sample over the selection conversations, expands the registry with
 * the pairwise combinations its own Pareto frontier earns, decides the
 * built-in embedding width on this tier, and — only when every
 * registered isolated cell has an attempt — freezes at most four
 * non-control candidates. It never reads a confirmation outcome,
 * because it never has one.
 */
export async function runLocomoPolicy(dataset: Dataset, options: PolicyRunOptions = {}): Promise<LocomoPolicy> {
  const seed = options.seed ?? POLICY_SEED;
  const phase: PolicyPhase = options.phase ?? 'selection';
  const progress = options.onProgress ?? ((): void => {});
  const source = options.source ?? await sourceRevision();

  const releaseIds = dataset.samples.map((s) => s.sample_id);
  const confirmation = confirmationConversations(releaseIds, seed);
  const selectionConversations = releaseIds.filter((id) => !confirmation.includes(id));

  const wanted = options.samples === undefined ? null : new Set(options.samples);
  if (wanted !== null) {
    for (const id of wanted) if (!releaseIds.includes(id)) throw new Error(`no sample '${id}' in the release`);
  }
  if (phase === 'selection') {
    for (const id of wanted ?? selectionConversations) {
      if (confirmation.includes(id)) {
        throw new Error(`${id} is a held-out confirmation conversation; a selection screen may not read it`);
      }
    }
  }
  const chosen = phase === 'selection'
    ? (wanted === null ? selectionConversations : selectionConversations.filter((id) => wanted.has(id)))
    : (wanted === null ? releaseIds : releaseIds.filter((id) => wanted.has(id)));
  const samples = dataset.samples.filter((s) => chosen.includes(s.sample_id));

  // --- the questions this phase scores
  const entries: Entry[] = [];
  const everyQuestion: QaQuestion[] = [];
  for (const sample of samples) {
    const corpus = conversationCorpus(sample);
    everyQuestion.push(...questionsOf(sample, corpus));
    entries.push({ corpus, questions: [] });
  }
  const registration0 = await buildRegistration(releaseIds, confirmation, seed);
  const spec = registration0.splits.selection;
  const scored = phase === 'selection'
    ? sampleQuestions(everyQuestion, { seed, perCategory: spec.perCategory['1'], adversarial: spec.adversarial }).filter((q) => q.category !== 5)
    : everyQuestion.filter((q) => q.category !== 5);
  const scoredIds = new Set(scored.map((q) => q.id));
  entries.forEach((entry, i) => {
    entry.questions = questionsOf(samples[i], entry.corpus).filter((q) => scoredIds.has(q.id));
  });

  const ids = scored.map((q) => q.id);
  const questionSet = await questionSetOf(ids);
  const inertSpec = registration0.cells.find((c) => c.role === 'inert')!;
  const failures = gateFailuresOf(entries, scored, inertSpec.retrieval.k, seed);

  // --- which registered cells to attempt
  const requested = new Set(options.cells ?? ['inert', 'shipped']);
  const all = requested.has('all');
  for (const key of requested) {
    if (key !== 'all' && !registration0.cells.some((c) => c.key === key)) throw new Error(`no cell '${key}' in the registration`);
  }
  const attempted = registration0.cells.filter((c) => all || c.role === 'inert' || requested.has(c.key));

  const measured: Measurement[] = [];
  for (const cell of attempted) measured.push(await measureCell(cell, entries, progress));
  const inert = measured.find((m) => m.cell.role === 'inert')!;

  // --- pairwise combinations, registered from the selection frontier alone
  const cells = [...registration0.cells];
  const isolated = measured.filter((m) => m.cell.role === 'isolated');
  const complete = phase === 'selection' && all;
  let frontier: Measurement[] = [];
  if (complete) {
    // only a cell that could itself spend budget may be paired: a
    // combination carrying a built-in width can never be a live
    // treatment (one run resolves one embedder identity), and a
    // combination carrying a cost-infeasible level inherits its cost,
    // so pairing either would buy screen time for a cell the shortlist
    // could never reach
    const budget = inert.tokenProxy * POLICY_OBJECTIVE.tokenRatioMax;
    const feasible = isolated.filter((m) => m.cell.axis !== 'offlineWidth'
      && m.tokenProxy <= budget
      && categoryLosses(m, inert, POLICY_OBJECTIVE.categoryLowerBound).length === 0);
    frontier = feasible.filter((m) => !feasible.some((other) => other !== m && dominates(objectivesOf(other), objectivesOf(m))));
    const known = new Set(cells.map((c) => c.cellId));
    const pairs: Array<Omit<CellSpec, 'cellId'>> = [];
    const ordered = [...frontier].sort((a, b) => (a.cell.key < b.cell.key ? -1 : 1));
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i].cell;
        const b = ordered[j].cell;
        if (a.axis === null || b.axis === null || a.axis === b.axis) continue;
        const levels = { ...INERT_LEVELS, [AXIS_LEVEL[a.axis]]: levelsOf(a)[AXIS_LEVEL[a.axis]], [AXIS_LEVEL[b.axis]]: levelsOf(b)[AXIS_LEVEL[b.axis]] };
        pairs.push(draft(`${a.key}+${b.key}`, `${a.label} with ${b.label}`, 'combination', null, levels as Levels));
      }
    }
    for (const spec2 of pairs) {
      const cellId = await cellIdOf(spec2);
      if (known.has(cellId)) continue;
      known.add(cellId);
      const cell: CellSpec = { ...spec2, cellId };
      cells.push(cell);
      measured.push(await measureCell(cell, entries, progress));
    }
  }

  const registration: Registration = {
    ...registration0,
    cells,
    registrationId: await registrationIdOf({ ...registration0, cells }),
  };

  // --- what the cells did to the prompt, against the inert reference
  const inertPrompts = new Map(inert.results.map((r) => [r.id, r.promptSha256]));
  const promptsOf = (m: Measurement): Prompts => {
    const changedIds = m.results.filter((r) => inertPrompts.get(r.id) !== r.promptSha256).map((r) => r.id);
    return {
      unchanged: m.results.length - changedIds.length,
      changed: changedIds.length,
      changedIds,
      tokenProxy: m.tokenProxy,
      proxy: 'sizeOf-characters',
      against: inert.cell.cellId,
    };
  };

  // --- one attempt per measured cell
  const attempts: Attempt[] = [];
  for (const m of measured) {
    const denominators: Denominators = {
      planned: ids.length,
      answered: m.results.length,
      unanswered: { wire: 0, budget: 0 },
      invalid: 0,
      questionSet,
    };
    const reasons = eligibilityReasons(denominators, m.operations);
    const run = keylessRun(m.cell, ids, questionSet, source.sha256);
    attempts.push({
      cellId: m.cell.cellId,
      runId: await runIdOf(m.cell.cellId, run),
      phase,
      run,
      denominators,
      eligibility: { eligible: reasons.length === 0, reasons },
      operations: m.operations,
      causes: m.causes,
      prompts: promptsOf(m),
      recall: m.recall,
      oracleCeiling: m.oracleCeiling,
      verbatimFloor: m.verbatimFloor,
      quality: { f1: null, ceiling: m.recall, citedRecall: null },
      cost: null,
      results: m.results,
    });
  }

  // --- every non-inert attempt against the inert reference
  const inertAttempt = attempts.find((a) => a.cellId === inert.cell.cellId)!;
  const comparisons: Comparison[] = [];
  for (const attempt of attempts) {
    if (attempt.cellId === inert.cell.cellId) continue;
    comparisons.push(comparisonOf(attempt, inertAttempt, registration.objective, 'evidence-recall'));
  }

  // --- the built-in width, decided on the only tier that can decide it
  const widthDecision = complete ? widthDecisionOf(measured, inertSpec.retrieval.k) : null;

  const selection = complete
    ? await freezeSelection(measured, inert, attempts, registration)
    : {
      state: 'open' as const,
      rule: `${SELECTION_RULE}; the tie-break is ${TIE_BREAK}`,
      shortlist: [],
      excluded: [],
      frozen: null,
      transition: null,
      finalist: null,
      decision: null,
    };

  const report: Omit<LocomoPolicy, 'reportId'> = {
    benchmark: 'locomo',
    instrument: 'locomo-policy',
    configIdentities: analyticEnvelope(attempts.map((attempt) => attempt.runId)),
    dataset: {
      path: LOCOMO_DATASET,
      sha256: dataset.sha256,
      bytes: dataset.bytes,
      schemaValid: dataset.valid,
      conversations: samples.length,
      restricted: wanted === null && phase !== 'selection' ? null : samples.map((s) => s.sample_id),
    },
    source,
    registration,
    plan: null,
    census: null,
    attempts,
    comparisons,
    selection,
    widthDecision,
    gate: { passed: failures.length === 0, failures },
  };
  return { ...report, reportId: await reportIdOf(report) };
}

/**
 * The built-in embedding width, by evidence recall at the registered k
 * with the floor and the costs beside it. A LEXICAL result: it governs
 * the width used when no provider is configured, which never serves a
 * live answer, and it is never an answer-quality claim.
 */
export function widthDecisionOf(measured: readonly Measurement[], k: number): WidthDecision | null {
  const widths = measured.filter((m) => m.cell.role === 'inert' || m.cell.axis === 'offlineWidth');
  if (widths.length === 0) return null;
  const ranked = [...widths].sort(tieBreak);
  return {
    tier: 'lexical',
    k,
    proposedDims: ranked[0].cell.embedding.dims,
    rows: [...widths].sort((a, b) => a.cell.embedding.dims - b.cell.embedding.dims).map((m) => ({
      cellId: m.cell.cellId,
      dims: m.cell.embedding.dims,
      recall: m.recall.overall,
      verbatimFloor: m.verbatimFloor.overall,
      tokenProxy: m.tokenProxy,
      operations: m.policyOperations,
    })),
    caveat: 'a lexical-tier retrieval result: it governs OFFLINE_EMBEDDER_DIMS, the width used when no provider is configured, which never serves a live answer. It is not an answer-quality result and it enters no clause of the objective.',
  };
}

/**
 * Freeze the live shortlist: the two filters that decide what may spend
 * budget at all, then the category constraint, then the Pareto rule,
 * then the registered tie-break. Every rejected cell is kept with its
 * reason — a screen that published only its survivors would be a screen
 * nobody could check.
 */
async function freezeSelection(
  measured: readonly Measurement[],
  inert: Measurement,
  attempts: readonly Attempt[],
  registration: Registration,
): Promise<Selection> {
  const eligibleById = new Map(attempts.map((a) => [a.cellId, a.eligibility.eligible]));
  const controls = measured.filter((m) => m.cell.role === 'inert' || m.cell.role === 'shipped');
  const candidates = measured.filter((m) => m.cell.role !== 'inert' && m.cell.role !== 'shipped');
  const excluded: Exclusion[] = [];
  const surviving: Measurement[] = [];
  const budget = inert.tokenProxy * registration.objective.tokenRatioMax;

  for (const m of candidates) {
    if (eligibleById.get(m.cell.cellId) !== true) {
      excluded.push({ cellId: m.cell.cellId, code: 'ineligible', detail: 'the row carries a failure, so it cannot enter a comparison' });
      continue;
    }
    if (m.cell.embedding.dims !== inert.cell.embedding.dims) {
      excluded.push({
        cellId: m.cell.cellId,
        code: 'live-inapplicable',
        detail: `a live run resolves one embedder identity and the wire model is not parameterized by a hash width, so a ${m.cell.embedding.dims}-dimension built-in cell can never be a live treatment`,
      });
      continue;
    }
    if (m.tokenProxy > budget) {
      excluded.push({
        cellId: m.cell.cellId,
        code: 'cost-infeasible',
        detail: `${count(m.tokenProxy)} proxy characters against the inert cell's ${count(inert.tokenProxy)}, which cannot land inside ${registration.objective.tokenRatioMax.toFixed(2)}× however good the answers are`,
      });
      continue;
    }
    const lost = categoryLosses(m, inert, registration.objective.categoryLowerBound);
    if (lost.length > 0) {
      excluded.push({
        cellId: m.cell.cellId,
        code: 'category-loss',
        detail: `category ${lost.join(', ')} loses more than ${registration.objective.categoryLowerBound} evidence recall against the inert cell`,
      });
      continue;
    }
    surviving.push(m);
  }

  const frontier = surviving.filter((m) => !surviving.some((other) => other !== m && dominates(objectivesOf(other), objectivesOf(m))));
  for (const m of surviving) {
    if (frontier.includes(m)) continue;
    const by = surviving.find((other) => other !== m && dominates(objectivesOf(other), objectivesOf(m)))!;
    excluded.push({ cellId: m.cell.cellId, code: 'dominated', detail: `${by.cell.key} is at least as good on recall, floor, token proxy and operations, and better on one` });
  }

  const ordered = [...frontier].sort(tieBreak);
  const kept = ordered.slice(0, SHORTLIST_LIMIT);
  for (const m of ordered.slice(SHORTLIST_LIMIT)) {
    excluded.push({ cellId: m.cell.cellId, code: 'dominated', detail: `the registered tie-break kept ${SHORTLIST_LIMIT} candidates and this cell ranked below them` });
  }

  const shortlist = [...controls.map((m) => m.cell.cellId), ...kept.map((m) => m.cell.cellId)];
  return {
    state: 'frozen',
    rule: `${SELECTION_RULE}; the tie-break is ${TIE_BREAK}`,
    shortlist,
    excluded,
    frozen: {
      cells: shortlist,
      algorithm: FREEZE_ALGORITHM,
      revision: CAUSE_VOCABULARY,
      identity: await canonicalSha256({ registrationId: registration.registrationId, algorithm: FREEZE_ALGORITHM, cells: shortlist }),
    },
    transition: null,
    finalist: null,
    decision: null,
  };
}

/** The registration for a release, with every identity computed. */
export async function buildRegistration(
  releaseIds: readonly string[],
  confirmation: readonly string[],
  seed = POLICY_SEED,
  inference: Registration['inference'] = null,
): Promise<Registration> {
  const cells: CellSpec[] = [];
  for (const spec of cellDrafts()) cells.push({ ...spec, cellId: await cellIdOf(spec) });
  const selectionConversations = releaseIds.filter((id) => !confirmation.includes(id));
  const splits: Registration['splits'] = {
    selection: split(selectionConversations, { 1: 16, 2: 16, 3: 16, 4: 16 }, 6),
    // deliberately larger and deliberately unbalanced: 16 per category
    // puts a category whose true delta is zero below the registered
    // floor on sampling noise alone, and category 3's whole supply in
    // the held-out split is 17 questions
    confirmation: split([...confirmation], { 1: 24, 2: 24, 3: 17, 4: 24 }, 8),
  };
  const draftRegistration = { seed, splits, objective: POLICY_OBJECTIVE, axes: POLICY_AXES as Axis[], cells, inference };
  return { registrationId: await registrationIdOf(draftRegistration), ...draftRegistration };
}

function split(conversations: readonly string[], perCategory: Split['perCategory'], adversarial: number): Split {
  return {
    conversations: [...conversations],
    perCategory,
    adversarial,
    scorable: perCategory['1'] + perCategory['2'] + perCategory['3'] + perCategory['4'],
  };
}

// ---------------------------------------------------------------------------
// the gate — the instrument proven before any result is read
// ---------------------------------------------------------------------------

/**
 * The oracle row must EQUAL the analytic ceiling and the seeded random
 * row must sit inside its band at the inert cell's k, or no policy
 * number is published. Same rows, same rule, same reason as the recall
 * instrument: a scorer nobody proved is a scorer nobody can read.
 */
export function gateFailuresOf(
  conversations: ReadonlyArray<{ corpus: ReturnType<typeof conversationCorpus>, questions: QaQuestion[] }>,
  gold: readonly GoldQuestion[],
  k: number,
  seed: number,
): string[] {
  if (gold.length === 0) return ['the policy screen scored no question, so its scorer is unproven'];
  const random = mulberry32(seed);
  const oracleValues: number[] = [];
  const ceilingValues: number[] = [];
  const randomValues: number[] = [];
  for (const entry of conversations) {
    const addresses = entry.corpus.turns.map((t) => t.address);
    for (const q of entry.questions) {
      ceilingValues.push(oracleCeilingOf(q, k));
      const first: string[] = [];
      const seen = new Set<string>();
      for (const address of q.gold) {
        if (entry.corpus.addresses.has(address) && !seen.has(address)) { first.push(address); seen.add(address); }
      }
      for (const address of addresses) {
        if (first.length >= k) break;
        if (!seen.has(address)) { first.push(address); seen.add(address); }
      }
      oracleValues.push(evidenceRecall(q.gold, new Set(first.slice(0, k))));
      const drawn = drawDistinct(random, addresses.length, k).map((i) => addresses[i]);
      randomValues.push(evidenceRecall(q.gold, new Set(drawn)));
    }
  }
  const failures: string[] = [];
  const oracle = average(oracleValues);
  const ceiling = average(ceilingValues);
  if (oracle !== ceiling) {
    failures.push(`oracle recall@${k} is ${oracle.toFixed(4)}, not the analytic ceiling ${ceiling.toFixed(4)}`
      + (oracle > ceiling ? ' — an oracle above its ceiling is resolving evidence it should not reach' : ''));
  }
  const band = randomBand(gold, k);
  const drawn = average(randomValues);
  if (drawn < band.low || drawn > band.high) {
    failures.push(`random recall@${k} is ${drawn.toFixed(4)}, outside its analytic band [${band.low.toFixed(4)}, ${band.high.toFixed(4)}] around ${band.floor.toFixed(4)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// the published form
// ---------------------------------------------------------------------------

/** The ks any attempt reported a cause census at, ascending. */
function censusKs(report: LocomoPolicy): number[] {
  const ks = new Set<number>();
  for (const attempt of report.attempts) for (const k of Object.keys(attempt.causes?.byK ?? {})) ks.add(Number(k));
  return [...ks].sort((a, b) => a - b);
}

function cellOf(report: LocomoPolicy, cellId: string): CellSpec | undefined {
  return report.registration.cells.find((c) => c.cellId === cellId);
}

function categoryCells(block: MeansBlock | null): Cell[] {
  if (block === null) return [null, null, null, null, null];
  return [score(block.overall), ...SCORABLE_CATEGORIES.map((c) => score(block.byCategory[String(c) as '1']))];
}

/** The Markdown a run prints. Every number here comes from the validated JSON; nothing is asserted beside it. */
export function renderMarkdown(report: LocomoPolicy): string {
  const out: string[] = [];
  const { registration } = report;
  out.push('# LoCoMo policy matrix — the keyless screen');
  out.push('');
  out.push(`Source: \`${report.dataset.path}\` (sha256 \`${report.dataset.sha256.slice(0, 12)}…\`, ${count(report.dataset.bytes)} bytes, schema ${report.dataset.schemaValid ? 'valid' : '**INVALID**'})`
    + (report.dataset.restricted === null ? '' : ` — restricted to ${report.dataset.restricted.map((id) => `\`${id}\``).join(', ')}`) + '.');
  out.push(`Registration \`${registration.registrationId.slice(0, 12)}…\` · report \`${report.reportId.slice(0, 12)}…\` · source \`${report.source.sha256.slice(0, 12)}…\` (HEAD \`${report.source.head.slice(0, 12)}…\`, working tree ${report.source.clean ? 'clean' : 'modified'}, ${report.source.files.length} files in the manifest).`);
  out.push('');
  out.push('A memory policy becomes the default only when a preregistered comparison proves it improves answers without hiding a category loss, a cost overrun, a failed call or an unequal denominator. **Nothing on this page is such a proof.** The embedder here is the suite\'s hashed-trigram reference: two texts score high when they share letters, so every number below is a property of the MECHANISM — ingest, gate, rank, cite — and of no model. This page is a screen, and a screen allocates budget; it does not predict the wire. The same shipped cell fires the contradiction judge about thirty times more often under this lexical embedder than under a real one, so a frontier read here says what is worth paying to measure, never what a policy does to an answer. Only an eligible live comparison on the held-out split can select a default.');
  out.push('');
  out.push('## The registration');
  out.push('');
  out.push(`Seed ${registration.seed}. Primary objective: **${registration.objective.primary}**, ${registration.objective.statistic} over ${count(registration.objective.resamples)} resamples at the ${(registration.objective.level * 100).toFixed(0)}% level (${registration.objective.quantileMethod} quantiles, seed ${registration.objective.bootstrapSeed}). A category's one-sided ${(registration.objective.categoryLevel * 100).toFixed(0)}% lower bound may not fall below ${registration.objective.categoryLowerBound}; tokens per answered question may not exceed ${registration.objective.tokenRatioMax.toFixed(2)}× the control's and calls may not exceed ${registration.objective.callRatioMax.toFixed(2)}×. The acting set is a ${registration.objective.actingSet}. If nothing passes, ${registration.objective.futility}.`);
  out.push('');
  out.push(table({
    head: ['split', 'conversations', 'per category 1 / 2 / 3 / 4', 'scorable', 'adversarial'],
    numeric: [3, 4],
    rows: (['selection', 'confirmation'] as const).map((name) => {
      const s = registration.splits[name];
      return [name, s.conversations.join(', '), `${s.perCategory['1']} / ${s.perCategory['2']} / ${s.perCategory['3']} / ${s.perCategory['4']}`, s.scorable, s.adversarial];
    }),
  }));
  out.push('');
  out.push(table({
    head: ['axis', 'inert level', 'registered levels'],
    numeric: [1],
    rows: registration.axes.map((a) => [a.axis, a.inert, a.levels.join(', ')]),
  }));
  out.push('');
  out.push(`${registration.cells.length} cells are registered; ${report.attempts.length} were attempted in this run. Every cell is effective VALUES, never a profile name.`);
  out.push('');
  out.push('## What each attempted cell did to the corpus');
  out.push('');
  out.push(table({
    head: ['cell', 'novelty / contradiction / crystallize', 'k', 'minScore', 'width', 'runs', 'admitted', 'filtered', 'judged', 'judge failed', 'contradictions', 'unapplied', 'merged', 'unmerged', 'live', 'total'],
    numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    rows: report.attempts.map((a) => {
      const cell = cellOf(report, a.cellId);
      const o = a.operations;
      return [
        cell?.key ?? a.cellId.slice(0, 12),
        cell === undefined ? '—' : `${cell.ingest.novelty} / ${cell.ingest.contradiction} / ${cell.ingest.crystallize}`,
        cell?.retrieval.k ?? null, cell?.retrieval.minScore ?? null, cell?.embedding.dims ?? null,
        o.runs, o.admitted, o.filtered, o.judged, o.judgeFailures, o.contradictions, o.contradictionSkips,
        o.merged, o.mergeSkips, o.live, o.total,
      ];
    }),
  }));
  out.push('');
  out.push('## The denominators, and whether the row may be compared at all');
  out.push('');
  out.push(table({
    head: ['cell', 'phase', 'tier', 'planned', 'answered', 'wire', 'budget', 'invalid', 'eligible', 'why not'],
    numeric: [3, 4, 5, 6, 7],
    rows: report.attempts.map((a) => [
      cellOf(report, a.cellId)?.key ?? a.cellId.slice(0, 12),
      a.phase, a.run.tier,
      a.denominators.planned, a.denominators.answered, a.denominators.unanswered.wire, a.denominators.unanswered.budget, a.denominators.invalid,
      a.eligibility.eligible ? 'yes' : '**no**',
      a.eligibility.reasons.length === 0 ? '—' : a.eligibility.reasons.map((r) => r.code).join(', '),
    ]),
  }));
  out.push('');
  out.push('## Evidence recall at each cell\'s own k');
  out.push('');
  out.push(table({
    head: ['cell', 'overall', ...SCORABLE_CATEGORIES.map((c) => `category ${c}`)],
    rows: report.attempts.map((a) => [cellOf(report, a.cellId)?.key ?? a.cellId.slice(0, 12), ...categoryCells(a.recall)]),
  }));
  out.push('');
  out.push('## Where every gold address went');
  out.push('');
  out.push(`Each of a question's gold evidence addresses lands in exactly one bucket at each k — the buckets are ordered from what the release lost before any policy ran to what the prompt actually carried, and they are checked against the gold-address denominator by the report's own schema. A fact that never reached the prompt therefore says WHERE it was lost, which is the only way a policy's cost can be attributed to the policy. Vocabulary revision ${report.attempts.find((a) => a.causes !== null)?.causes?.version ?? '—'}.`);
  for (const k of censusKs(report)) {
    out.push('');
    out.push(`### k = ${k}`);
    out.push('');
    out.push(table({
      head: ['cell', 'gold addresses', ...CAUSES],
      numeric: CAUSES.map((_, i) => i + 1),
      rows: report.attempts.map((a) => {
        const at = a.causes?.byK[String(k)];
        return [
          cellOf(report, a.cellId)?.key ?? a.cellId.slice(0, 12),
          at?.denominator ?? null,
          ...CAUSES.map((cause) => at?.partition.find((p) => p.cause === cause)?.count ?? null),
        ];
      }),
    }));
  }
  out.push('');
  out.push('## What each cell did to the prompt, and what it cost');
  out.push('');
  out.push(table({
    head: ['cell', 'prompts unchanged', 'prompts changed', 'token proxy', 'per question', 'ratio vs inert', 'policy operations', 'verbatim floor'],
    numeric: [1, 2, 3, 4, 5, 6, 7],
    rows: report.attempts.map((a) => {
      const inertProxy = report.attempts.find((x) => x.cellId === a.prompts.against)?.prompts.tokenProxy ?? 0;
      return [
        cellOf(report, a.cellId)?.key ?? a.cellId.slice(0, 12),
        a.prompts.unchanged, a.prompts.changed, count(a.prompts.tokenProxy),
        a.denominators.answered === 0 ? null : Math.round(a.prompts.tokenProxy / a.denominators.answered),
        inertProxy === 0 ? null : (a.prompts.tokenProxy / inertProxy).toFixed(3),
        a.operations.filtered + a.operations.judgeAttempts + a.operations.confirmed + a.operations.crystallizePlanned,
        score(a.verbatimFloor === null ? null : a.verbatimFloor.overall),
      ];
    }),
  }));
  out.push('');
  out.push('`token proxy` is `sizeOf` over the serialized context — characters, the suite\'s one size rule — and it IS a proxy: a tier that buys nothing has no provider usage to report. `prompts changed` counts the questions whose serialized prompt this cell made different from the inert reference\'s, read from the prompt bytes and never from a score; it is what the acting set below is computed from. `verbatim floor` is the retrieved context quoted as the answer and scored by the official evaluator — the best a model could do by copying, at this cell\'s own k.');
  out.push('');
  out.push('## Every comparison, with what it could have seen');
  out.push('');
  if (report.comparisons.length === 0) out.push('_No comparison ran._');
  else {
    out.push(table({
      head: ['treatment', 'control', 'metric', 'pairs', 'mean Δ', 'interval', 'paired SD', 'SE', 'min. detectable', 'tied', 'acting', 'eligible', 'promotes'],
      numeric: [3, 4, 6, 7, 8, 9, 10],
      rows: report.comparisons.map((c) => [
        cellOf(report, c.treatment)?.key ?? c.treatment.slice(0, 12),
        cellOf(report, c.control)?.key ?? c.control.slice(0, 12),
        c.metric, c.pairs, c.mean.toFixed(4),
        `[${c.interval.low.toFixed(4)}, ${c.interval.high.toFixed(4)}]`,
        c.power.pairedSd.toFixed(4), c.power.standardError.toFixed(4), c.power.minimumDetectableEffect.toFixed(4),
        c.power.tiedPairs, c.power.actingSetSize,
        c.eligible ? 'yes' : '**no**', c.verdict.promotes ? '**yes**' : 'no',
      ]),
    }));
    out.push('');
    for (const c of report.comparisons) {
      out.push(`- **${cellOf(report, c.treatment)?.key ?? c.treatment.slice(0, 12)}**: ${c.boundedNull}. `
        + (c.verdict.promotes ? 'Every registered clause holds.' : `Does not promote: ${c.verdict.reasons.map((r) => r.detail).join('; ')}.`)
        + (c.actingSet.size === 0 ? ' The cell changed no prompt at all.' : ` On the ${c.actingSet.size} prompts it changed the mean is ${c.actingSet.mean.toFixed(4)} with interval [${c.actingSet.interval.low.toFixed(4)}, ${c.actingSet.interval.high.toFixed(4)}]${c.actingSet.blocks ? ' — **harmful exactly where it acts**' : ''}.`));
    }
  }
  out.push('');
  out.push('The acting set is a blocking secondary: a policy that changes a quarter of the prompts can only move the product by a quarter of its local effect, so it can refuse a cell and never promote one. A comparison with a zero-crossing interval is a bounded null, not a proven absence.');
  out.push('');
  out.push('## The gate');
  out.push('');
  out.push(report.gate.passed
    ? `**Gate passed.** The oracle row equals its analytic ceiling at k = ${registration.cells.find((c) => c.role === 'inert')!.retrieval.k} and the seeded random row sits in its band, so the scorer under every number above is proven.`
    : `**GATE FAILED.** ${report.gate.failures.join(' ')}`);
  out.push('');
  out.push('## Selection state');
  out.push('');
  out.push(`State **${report.selection.state}**. ${report.selection.rule}.`);
  out.push(report.selection.shortlist.length === 0
    ? 'No shortlist is frozen, so no held-out confirmation may be attempted.'
    : `Shortlist: ${report.selection.shortlist.map((id) => `\`${cellOf(report, id)?.key ?? id.slice(0, 12)}\``).join(', ')}.`);
  if (report.selection.frozen !== null) {
    out.push('');
    out.push(`Frozen as \`${report.selection.frozen.identity.slice(0, 12)}…\` by: ${report.selection.frozen.algorithm}.`);
  }
  if (report.selection.excluded.length > 0) {
    out.push('');
    out.push('Every cell the screen rejected, with the reason — a screen that published only its survivors would be a screen nobody could check:');
    out.push('');
    out.push(table({
      head: ['cell', 'reason', 'detail'],
      numeric: [],
      rows: report.selection.excluded.map((e) => [cellOf(report, e.cellId)?.key ?? e.cellId.slice(0, 12), e.code, e.detail]),
    }));
  }
  if (report.widthDecision !== null) {
    const w = report.widthDecision;
    out.push('');
    out.push('## The built-in embedding width — a lexical-tier result');
    out.push('');
    out.push(table({
      head: ['width', 'evidence recall @ k', 'verbatim floor', 'token proxy', 'policy operations'],
      numeric: [1, 2, 3, 4],
      rows: w.rows.map((r) => [r.dims, score(r.recall), score(r.verbatimFloor), count(r.tokenProxy), r.operations]),
    }));
    out.push('');
    out.push(`Read at k = ${w.k}. Proposed \`OFFLINE_EMBEDDER_DIMS\`: **${w.proposedDims}** — ${w.caveat}`);
    out.push('');
    out.push('This is the only decision this page proposes, and it is proposed here because this is the only tier that can decide it: a live run resolves one embedder identity, the wire model is not parameterized by a hash width, and vectors from two identities never rank against each other.');
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('Retrieval recall is the official `recall_acc` of `task_eval/evaluation.py`, and the verbatim floor is that evaluator\'s F1 over the retrieved context quoted as the answer. Neither is an answer-quality result. This page makes no default claim and selects no policy: it names what is worth paying to measure, and the live comparison on the held-out split is what may change a runtime default.');
  out.push('');
  out.push('LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// the live tier — authorized, censused, then bought
// ---------------------------------------------------------------------------

/** The answer contract every live cell decodes against, by id and revision. */
export const RESPONSE_SCHEMA_REVISION = `${ANSWER_SCHEMA.$id}@1`;

/** What the operator approves, resolved from the environment and never from a key. */
export interface InferenceControls {
  provider: string;
  endpoint: string;
  answerModel: string;
  judgeModel: string;
  embedder: { model: string, dims: number };
  thinking: 'off' | 'default';
  responseSchema: string;
  retry: { attempts: number, baseMs: number, maxMs: number };
  deadlineMs: number | null;
  concurrency: number;
  perRunCeiling: number;
  campaignCeiling: number;
  keySource: string | null;
}

/**
 * The identity of a live host. Everything that has to be equal for two
 * rows to be one experiment is in it; the key is not, and the NAME of
 * the variable it came from is — so a report can say where the
 * credential came from without ever carrying one.
 */
export async function inferenceIdentityOf(controls: InferenceControls): Promise<string> {
  return canonicalSha256({ ...controls, authorized: true });
}

/** The approved host, as the registration stores it. */
export async function approvedInference(controls: InferenceControls): Promise<Registration['inference']> {
  return { authorized: true, ...controls, identity: await inferenceIdentityOf(controls) };
}

/**
 * What a phase would spend, counted before anything is bought. A plan
 * is not permission: a warm cache and a present key are facts about the
 * machine, and the operator's approval of THIS plan is what makes a
 * request allowed.
 */
export interface PlanInput {
  phase: 'census' | 'selection' | 'confirmation';
  cells: readonly string[];
  scorable: number;
  adversarial: number;
  embedFresh: number;
  embedCached: number;
  controls: InferenceControls;
  inference: string | null;
}

export function planOf(input: PlanInput): NonNullable<LocomoPolicy['plan']> {
  const cells = input.cells.length;
  // a census buys embeddings and nothing else; every answering phase asks
  // one question per cell and answers-then-judges each adversarial one
  const chat = input.phase === 'census' ? 0 : cells * (input.scorable + input.adversarial);
  const judge = input.phase === 'census' ? 0 : cells * input.adversarial;
  const total = input.embedFresh + chat + judge;
  return {
    phase: input.phase,
    cells: [...input.cells],
    questions: { scorable: input.phase === 'census' ? 0 : input.scorable, adversarial: input.phase === 'census' ? 0 : input.adversarial },
    requests: { embedFresh: input.embedFresh, embedCached: input.embedCached, chat, judge, total },
    ceilings: { perRun: input.controls.perRunCeiling, campaign: input.controls.campaignCeiling },
    withinCeilings: total <= input.controls.perRunCeiling && total <= input.controls.campaignCeiling,
    inference: input.inference,
  };
}

/** The plan as the operator reads it before approving or amending it. */
export function describePlan(plan: NonNullable<LocomoPolicy['plan']>, controls: InferenceControls, registration: Registration): string[] {
  const key = (id: string): string => registration.cells.find((c) => c.cellId === id)?.key ?? id.slice(0, 12);
  return [
    `phase                 ${plan.phase}`,
    `registration          ${registration.registrationId}`,
    `cells                 ${plan.cells.map(key).join(', ')}`,
    `provider              ${controls.provider}`,
    `endpoint              ${controls.endpoint}`,
    `answer model          ${controls.answerModel}`,
    `judge model           ${controls.judgeModel}`,
    `embedder              ${controls.embedder.model} @ ${controls.embedder.dims} dims`,
    `thinking              ${controls.thinking}`,
    `response contract     ${controls.responseSchema}`,
    `retry                 ${controls.retry.attempts} attempts, ${controls.retry.baseMs}–${controls.retry.maxMs} ms backoff`,
    `deadline              ${controls.deadlineMs === null ? 'none' : `${controls.deadlineMs} ms`}`,
    `concurrency           ${controls.concurrency}`,
    `key                   ${controls.keySource === null ? 'none resolved' : `read from ${controls.keySource} (never printed, never hashed)`}`,
    `questions             ${plan.questions.scorable} scorable + ${plan.questions.adversarial} adversarial per cell`,
    `embedding requests    ${plan.requests.embedFresh} fresh, ${plan.requests.embedCached} texts the cache already holds`,
    `answer requests       ${plan.requests.chat}`,
    `judge requests        ${plan.requests.judge}`,
    `TOTAL FRESH REQUESTS  ${plan.requests.total}`,
    `ceilings              ${plan.ceilings.perRun} per run, ${plan.ceilings.campaign} campaign total`,
    `within ceilings       ${plan.withinCeilings ? 'yes' : 'NO — this plan would be refused'}`,
    `inference identity    ${plan.inference ?? '(not yet approved)'}`,
  ];
}

/**
 * The frozen shortlist under the real embedder, before an answer exists.
 * Reads operation counts and retrieved-context bytes, never a score. A
 * cell is mechanically inert only when BOTH halves hold: its live counts
 * equal the inert cell's AND every registered selection question
 * retrieves byte-identical ordered context under the cell's own k and
 * minScore — only then does it provably produce inert's prompts, so
 * buying its answers would buy the inert cell twice. Equal counts alone
 * prove nothing for a retrieval-axis cell, which acts after ingest on
 * the ranking cutoff and can change every prompt while changing no
 * count. The context lines are the live prompt's own (`contextLine`),
 * and the question vectors are cell-independent, bought once per
 * conversation — texts the plan already priced. A census handed no
 * questions claims nothing and drops nothing.
 */
export interface CensusInput {
  cells: readonly CellSpec[];
  inertCellId: string;
  /** The corpora and the registered selection questions: a census reads what the policies DID and what retrieval WOULD hand the prompt, never what a question scored. */
  entries: ReadonlyArray<{ corpus: ConversationCorpus, questions: readonly QaQuestion[] }>;
  embedder: Embedder & { dims: number };
  onProgress?: (message: string) => void;
}

export async function runLiveCensus(input: CensusInput): Promise<NonNullable<LocomoPolicy['census']>> {
  const progress = input.onProgress ?? ((): void => {});
  let embedRequests = 0;
  const embedder: Embedder = {
    model: input.embedder.model,
    dims: input.embedder.dims,
    embed: async (texts, hooks) => { embedRequests++; return input.embedder.embed(texts, hooks); },
  };
  const identity = { model: input.embedder.model, dims: input.embedder.dims };
  const questionIds = input.entries.flatMap((entry) => entry.questions.map((q) => q.id));
  const questionVectors: Array<Awaited<ReturnType<Embedder['embed']>>> = [];
  for (const entry of input.entries) {
    questionVectors.push(entry.questions.length === 0 ? [] : await embedder.embed(entry.questions.map((q) => q.text)));
  }
  const counted = new Map<string, IngestCensus>();
  const contexts = new Map<string, string[]>();
  for (const cell of input.cells) {
    const operations = emptyCensus();
    const retrieved: string[] = [];
    for (let e = 0; e < input.entries.length; e++) {
      const entry = input.entries[e];
      const before = embedRequests;
      const { units } = await ingestConversation(entry.corpus, {
        embedder,
        thresholds: { novelty: cell.ingest.novelty, contradiction: cell.ingest.contradiction, crystallize: cell.ingest.crystallize },
        census: operations,
      });
      const vectors = questionVectors[e];
      for (let i = 0; i < entry.questions.length; i++) {
        const { ranked } = recallByEmbedding(units, vectors[i] as never, { k: cell.retrieval.k, minScore: cell.retrieval.minScore, identity });
        retrieved.push(ranked.map((r) => contextLine(r.unit)).join('\n'));
      }
      progress(`census ${cell.key} ${entry.corpus.sampleId}: ${embedRequests - before} embed calls`);
    }
    counted.set(cell.cellId, operations);
    contexts.set(cell.cellId, retrieved);
  }
  const inert = counted.get(input.inertCellId)!;
  const inertContexts = contexts.get(input.inertCellId)!;
  const same = (a: IngestCensus, b: IngestCensus): boolean =>
    (Object.keys(a) as Array<keyof IngestCensus>).every((member) => a[member] === b[member]);
  return {
    embedRequests,
    chatCalls: 0,
    rows: input.cells.map((cell) => {
      const operations = counted.get(cell.cellId)!;
      const reference = cell.cellId === input.inertCellId;
      const countsEqualInert = same(operations, inert);
      const own = contexts.get(cell.cellId)!;
      const changedIds = reference ? [] : questionIds.filter((_, i) => own[i] !== inertContexts[i]);
      const prompts = reference ? null : { questions: questionIds.length, changed: changedIds.length, changedIds };
      const mechanicallyInert = !reference && countsEqualInert && prompts !== null && prompts.questions > 0 && prompts.changed === 0;
      return { cellId: cell.cellId, operations, countsEqualInert, prompts, mechanicallyInert, dropped: mechanicallyInert };
    }),
  };
}

/**
 * The registered challenger: the greatest paired delta among eligible
 * candidates whose point category deltas clear the floor and whose
 * normalized costs meet the objective; ties by ascending cell identity.
 * When none clears the preliminary constraints, the greatest-delta
 * eligible cell is nominated as a deliberately LOSING challenger, so
 * confirmation can falsify it. The shipped cell is never nominated: it
 * is a published control, and "leave it as it is because it is what we
 * shipped" is the reasoning this instrument exists to replace.
 */
export interface ChallengerChoice {
  challenger: string | null;
  calculation: string;
}

export function chooseChallenger(
  comparisons: readonly Comparison[],
  candidates: readonly string[],
  objective: Objective,
): ChallengerChoice {
  const own = comparisons.filter((c) => candidates.includes(c.treatment) && c.eligible);
  if (own.length === 0) {
    return { challenger: null, calculation: 'no non-control cell produced an eligible comparison, so no challenger can be nominated and the shipped cell cannot be nominated in its place' };
  }
  const clears = (c: Comparison): boolean =>
    c.byCategory.every((row) => row.pairs === 0 || row.mean >= objective.categoryLowerBound)
    && c.cost !== null && c.cost.tokenRatio <= objective.tokenRatioMax && c.cost.callRatio <= objective.callRatioMax;
  const ranked = (pool: readonly Comparison[]): Comparison[] =>
    [...pool].sort((a, b) => (b.mean !== a.mean ? b.mean - a.mean : a.treatment < b.treatment ? -1 : a.treatment > b.treatment ? 1 : 0));
  const preliminary = ranked(own.filter(clears));
  if (preliminary.length > 0) {
    return {
      challenger: preliminary[0].treatment,
      calculation: `greatest eligible paired delta (${preliminary[0].mean.toFixed(4)}) among ${preliminary.length} cells whose point category deltas all clear ${objective.categoryLowerBound} and whose token and call ratios meet the objective; ties by ascending cell identity`,
    };
  }
  const fallback = ranked(own)[0];
  return {
    challenger: fallback.treatment,
    calculation: `no eligible cell cleared the preliminary constraints, so the greatest eligible paired delta (${fallback.mean.toFixed(4)}) is nominated as a deliberately losing challenger for confirmation to falsify; ties by ascending cell identity`,
  };
}

/** The phase transition that gates confirmation. Nothing may move after it exists. */
export async function transitionOf(
  choice: ChallengerChoice,
  registration: Registration,
  frozenIdentity: string,
): Promise<NonNullable<Selection['transition']>> {
  if (choice.challenger === null) throw new Error(`no challenger to freeze: ${choice.calculation}`);
  return {
    challenger: choice.challenger,
    rule: SELECTION_RULE,
    calculation: choice.calculation,
    identity: await canonicalSha256({
      registrationId: registration.registrationId,
      inference: registration.inference?.identity ?? null,
      shortlist: frozenIdentity,
      challenger: choice.challenger,
      calculation: choice.calculation,
    }),
  };
}

/**
 * The decision the next campaign consumes without reinterpretation.
 * `qualifiesAsDefault` is false whenever any registered clause failed —
 * including when nothing was powered enough to see, which is a designed
 * outcome and not a fallback.
 */
export function decisionOf(
  confirmation: Comparison | null,
  inertCellId: string,
  objective: Objective,
): NonNullable<Selection['decision']> {
  if (confirmation === null) {
    return {
      default: inertCellId,
      qualifiesAsDefault: false,
      rule: 'a policy is enabled by default only when an eligible, preregistered comparison proves it improves answers without hiding a category loss, a cost overrun, a failed call or an unequal denominator',
      statement: 'no confirmation comparison exists, so the inert cell stands as the default and nothing was measured that could change it',
      reasons: [{ code: 'no-confirmation', detail: 'the held-out split produced no eligible comparison' }],
    };
  }
  const qualifies = confirmation.verdict.promotes;
  return {
    default: qualifies ? confirmation.treatment : inertCellId,
    qualifiesAsDefault: qualifies,
    rule: `paired bootstrap over ${objective.resamples} resamples at the ${(objective.level * 100).toFixed(0)}% level, every category's one-sided lower bound at least ${objective.categoryLowerBound}, tokens at most ${objective.tokenRatioMax.toFixed(2)}× and calls at most ${objective.callRatioMax.toFixed(2)}× the control's, and no acting-set harm`,
    statement: qualifies
      ? `the challenger passed every registered clause on the held-out split: mean ${confirmation.mean.toFixed(4)}, interval [${confirmation.interval.low.toFixed(4)}, ${confirmation.interval.high.toFixed(4)}] over ${confirmation.pairs} pairs`
      : `the challenger did not pass every registered clause, so the inert cell is the default and the result is a bounded null: ${confirmation.boundedNull}`,
    reasons: confirmation.verdict.reasons,
  };
}

/** What the live phase needs of the world; every seam injected, none created here. */
export interface LivePhaseInput {
  /** Resolves the run's config identity once the embedding identity is observed; required before spend by the live path. */
  configIdentityFor?: (observed: { model: string, dims: number }) => Promise<import('@tangleai/config').RunIdentity>;
  dataset: Dataset;
  phase: 'selection' | 'confirmation';
  cells: readonly CellSpec[];
  conversations: readonly string[];
  perCategory: number;
  adversarial: number;
  controls: InferenceControls;
  source: string;
  env: AiEnv;
  chat: ChatClient;
  judge: ChatClient;
  embedder: Embedder;
  cache?: WireCache;
  fresh?: boolean;
  seed?: number;
  clock?: () => Date;
  timer?: () => number;
  onProgress?: (message: string) => void;
}

/** A policy cell as the one live path reads it: effective values, nothing named. */
export function rowOf(cell: CellSpec): QaRow {
  return {
    key: cell.key,
    label: cell.label,
    kind: 'pipeline',
    corpus: 'turns',
    thresholds: { novelty: cell.ingest.novelty, contradiction: cell.ingest.contradiction, crystallize: cell.ingest.crystallize },
    retrieval: { k: cell.retrieval.k, minScore: cell.retrieval.minScore },
  };
}

/**
 * Buy one phase's answers through the ONE live path this repository has:
 * the desktop's provider factories, the suite's budget account, the
 * existing wire cache and `mapConcurrent`. Every cell in a run shares
 * one embedder identity, because vectors from two identities never rank
 * against each other and a matrix that varied the embedder would not be
 * one experiment.
 *
 * An invalid reply is NOT an answer here: the answer instrument scores
 * it as raw text, which is right for a published table, and this
 * instrument refuses it, which is right for a comparison that decides a
 * default. It stays in the denominator and makes the row ineligible.
 */
export async function runLivePhase(input: LivePhaseInput): Promise<{ attempts: Attempt[], live: LiveReport }> {
  const seed = input.seed ?? POLICY_SEED;
  const live = await runLocomoQaLive(input.dataset, {
    env: input.env,
    ...(input.configIdentityFor === undefined ? {} : { configIdentityFor: input.configIdentityFor }),
    chat: input.chat,
    judge: input.judge,
    embedder: input.embedder,
    ...(input.cache === undefined ? {} : { cache: input.cache }),
    ...(input.fresh === undefined ? {} : { fresh: input.fresh }),
    thinking: input.controls.thinking,
    rowSpecs: input.cells.map(rowOf),
    digestPrompt: (lines) => canonicalSha256([...lines]),
    seed,
    perCategory: input.perCategory,
    adversarial: input.adversarial,
    samples: [...input.conversations],
    ...(input.clock === undefined ? {} : { clock: input.clock }),
    ...(input.timer === undefined ? {} : { timer: input.timer }),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  });

  const attempts: Attempt[] = [];
  for (const cell of input.cells) {
    const row = live.configurations.find((c) => c.key === cell.key);
    if (row === undefined) continue;
    const scored = row.questions.results.filter((r) => !r.invalid);
    const ids = row.questions.results.map((r) => r.id);
    const questionSet = await questionSetOf(ids);
    const denominators: Denominators = {
      planned: row.questions.planned,
      answered: scored.length,
      unanswered: { wire: row.questions.unanswered.wire, budget: row.questions.unanswered.budget },
      invalid: row.questions.invalid,
      questionSet,
    };
    const reasons = eligibilityReasons(denominators, row.ingest ?? emptyCensus());
    const run: Run = {
      tier: 'live',
      provider: input.controls.provider,
      endpoint: input.controls.endpoint,
      answerModel: input.controls.answerModel,
      judgeModel: input.controls.judgeModel,
      embedder: input.controls.embedder,
      thinking: input.controls.thinking,
      responseSchema: input.controls.responseSchema,
      retry: input.controls.retry,
      deadlineMs: input.controls.deadlineMs,
      concurrency: input.controls.concurrency,
      budgetCeiling: input.controls.perRunCeiling,
      keySource: input.controls.keySource,
      questionSet,
      sampleIds: ids,
      source: input.source,
    };
    const answered = scored.length;
    attempts.push({
      cellId: cell.cellId,
      runId: await runIdOf(cell.cellId, run),
      phase: input.phase,
      run,
      denominators,
      eligibility: { eligible: reasons.length === 0, reasons },
      operations: row.ingest ?? emptyCensus(),
      causes: null,
      prompts: { unchanged: 0, changed: 0, changedIds: [], tokenProxy: 0, proxy: 'provider-prompt-tokens', against: cell.cellId },
      recall: row.ceiling,
      oracleCeiling: null,
      verbatimFloor: null,
      quality: { f1: row.f1, ceiling: row.ceiling, citedRecall: row.citedRecall },
      cost: {
        calls: row.cost.turns,
        replayed: row.cost.replayed,
        tokens: row.cost.tokens,
        promptTokens: row.cost.promptTokens,
        completionTokens: row.cost.completionTokens,
        tokensPerAnswer: answered === 0 ? 0 : row.cost.tokens / answered,
        callsPerAnswer: answered === 0 ? 0 : row.cost.turns / answered,
      },
      results: scored.map((r) => ({
        id: r.id,
        category: r.category,
        score: r.f1,
        f1: r.f1,
        ceiling: r.ceiling,
        promptSha256: r.promptSha256 ?? EMPTY_PROMPT,
        tokens: r.tokens,
        calls: 1,
      })),
    });
  }
  return { attempts, live };
}

/** The digest of an empty prompt — what a row that recorded none carries, rather than a lie. */
const EMPTY_PROMPT = '0'.repeat(64);

/** Fill each live attempt's prompt accounting against the run's inert row. */
export function withPrompts(attempts: readonly Attempt[], inertCellId: string): Attempt[] {
  const inert = attempts.find((a) => a.cellId === inertCellId);
  if (inert === undefined) return [...attempts];
  const reference = new Map(inert.results.map((r) => [r.id, r.promptSha256]));
  return attempts.map((attempt) => {
    const changedIds = attempt.results.filter((r) => reference.get(r.id) !== r.promptSha256).map((r) => r.id);
    return {
      ...attempt,
      prompts: {
        unchanged: attempt.results.length - changedIds.length,
        changed: changedIds.length,
        changedIds,
        // a tier that bought its answers has the provider's own prompt
        // tokens; there is nothing to approximate
        tokenProxy: attempt.cost?.promptTokens ?? 0,
        proxy: 'provider-prompt-tokens' as const,
        against: inertCellId,
      },
    };
  });
}
