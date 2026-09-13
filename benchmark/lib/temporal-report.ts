/** Reconciled keyless matrix report. Generated types and validation share one schema. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { mean } from '@jarenjs/core/stats';
import { createReportValidator } from './validate.ts';
import { sha256 } from './longmemeval-source.ts';
import { LME_TYPES } from './longmemeval.ts';
import { TEMPORAL_ROWS } from './temporal-registration.ts';
import type { runTemporalKeyless } from './temporal-experiment.ts';
import type { TemporalConformanceReport } from './temporal-conformance.ts';
import type { TemporalPurchasePlan } from './temporal-live.ts';
import type { Experiment, ExperimentSummary, KeylessQuestion, Summary, Metric, PlanSummary } from './temporal-report.types.ts';
import SCHEMA from '../schemas/temporal-report.schema.json' with { type: 'json' };
const shape = createReportValidator(SCHEMA), digest = (value: unknown) => sha256(canonicalizeJson(value));
export function temporalPlanSummary(plan: TemporalPurchasePlan): PlanSummary {
  return { sha256: plan.sha256, questions: plan.questions, profileCases: plan.profileCases, sourceOccurrences: plan.sourceOccurrences, physicalRequestsMaximum: plan.worstCaseRequests,
    inputByteTokenCeiling: plan.jobs.reduce((n, j) => n + j.inputBytes, 0), outputTokenCeiling: plan.jobs.reduce((n, j) => n + j.outputTokens, 0),
    embeddingLogicalItems: plan.embedding.logicalItems, embeddingPhysicalBatches: plan.embedding.physicalBatches, blockedSources: plan.blockedSources,
    roleRequests: { extract: plan.byRole.extract.physicalRequests, resolve: plan.byRole.resolve.physicalRequests, answer: plan.byRole.answer.physicalRequests,
      judge: plan.byRole.judge.physicalRequests, embedding: plan.byRole.embedding.physicalRequests }, worstCaseUsd: plan.worstCaseUsd, eligibleForApproval: plan.eligibleForApproval };
}
export function summarizeTemporalMatrix(questions: KeylessQuestion[]): Summary[] {
  const summaries: Summary[] = [];
  for (const profile of ['provided-history', 'strict-as-of'] as const) for (const fold of ['all', 'development', 'confirmation'] as const) for (const row of TEMPORAL_ROWS) {
    const selected = questions.filter(q => q.profile === profile && (fold === 'all' || q.fold === fold));
    const at = (q: KeylessQuestion) => q.rows.find(r => r.row === row)!;
    function metric(qs: KeylessQuestion[]): Metric {
      const eligible = qs.filter(q => !q.abstention), measured = eligible.filter(q => at(q).retrieval !== null);
      const average = (key: 'recallAny' | 'recallAll' | 'sessionFractionRecall') => measured.length === eligible.length && eligible.length ? mean(measured.map(q => at(q).retrieval![key] ?? 0)) ?? null : null;
      return { qaQuestions: qs.length, retrievalQuestions: eligible.length, measuredRetrieval: measured.length, recallAny: average('recallAny'), recallAll: average('recallAll'), sessionFractionRecall: average('sessionFractionRecall') };
    }
    const results = selected.map(at), failures: Record<string, number> = {};
    for (const r of results) if (r.reason !== null) failures[r.reason] = (failures[r.reason] ?? 0) + 1;
    summaries.push({ profile, fold, row, questionIdentity: digest(selected.map(q => q.id).sort()), groups: new Set(selected.map(q => q.group)).size, questions: selected.length,
      abstentions: selected.filter(q => q.abstention).length, futureGoldQuestions: selected.filter(q => q.futureGold).length, occurrences: selected.reduce((n,q)=>n+q.occurrences,0), emptyTurns: selected.reduce((n,q)=>n+q.emptyTurns,0),
      measured: results.filter(r => r.status === 'measured').length, unmeasured: results.filter(r => r.status === 'unmeasured').length,
      refused: results.filter(r => r.status === 'refused').length, fallback: results.filter(r => r.status === 'fallback').length,
      trimmed: results.reduce((n,r)=>n+r.trimmed,0), contextBytes: results.reduce((n,r)=>n+r.bytes,0), retrieval: metric(selected),
      byType: Object.fromEntries(LME_TYPES.map(type => [type, metric(selected.filter(q => q.type === type))])) as Summary['byType'], failures, qaAccuracy: null });
  }
  return summaries;
}
function countsOf(questions: KeylessQuestion[]): Experiment['counts'] {
  const rows = questions.flatMap(q => q.rows);
  return { questions: new Set(questions.map(q=>q.id)).size, profileCases: questions.length, plannedRows: rows.length,
    measuredRows: rows.filter(r=>r.status==='measured').length, unmeasuredRows: rows.filter(r=>r.status==='unmeasured').length,
    refusedRows: rows.filter(r=>r.status==='refused').length, fallbackRows: rows.filter(r=>r.status==='fallback').length };
}
export function temporalExperimentReport(keyless: Awaited<ReturnType<typeof runTemporalKeyless>>, conformance: TemporalConformanceReport, plan: TemporalPurchasePlan): Experiment {
  if (keyless.registrationHash !== conformance.context.registrationHash || keyless.registrationHash !== plan.registrationHash) throw Error('matrix registration changed');
  const body: Omit<Experiment, 'sha256'> = { instrument: 'temporal-experiment-v1', origin: 'keyless', context: conformance.context, registrationHash: keyless.registrationHash,
    questionRows: keyless.questions, summaries: summarizeTemporalMatrix(keyless.questions), plan: temporalPlanSummary(plan), strict: conformance.counts, counts: countsOf(keyless.questions),
    physicalRequests: 0, default: 'off', liveQuality: 'unmeasured', liveCost: 'unmeasured' };
  const report = { ...body, sha256: digest(body) };
  if (!validateTemporalExperiment(report)) throw Error('temporal experiment report is inconsistent');
  return report;
}
export function validateTemporalExperiment(value: unknown): value is Experiment {
  if (!shape(value).valid || (value as Experiment).instrument !== 'temporal-experiment-v1' || !('questionRows' in (value as Experiment))) return false;
  const report = value as Experiment, { sha256: identity, ...body } = report;
  if (identity !== digest(body) || canonicalizeJson(report.counts) !== canonicalizeJson(countsOf(report.questionRows))) return false;
  if (new Set(report.questionRows.map(q => `${q.id}:${q.profile}`)).size !== report.questionRows.length || report.counts.profileCases !== report.counts.questions * 2) return false;
  for (const q of report.questionRows) {
    if (canonicalizeJson(q.rows.map(r=>r.row)) !== canonicalizeJson(TEMPORAL_ROWS) || q.emptyTurns > q.occurrences) return false;
    if (q.rows.some(r => new Set(r.selectedIds).size !== r.selectedIds.length || r.bytes > 12000 || r.selectedIds.length > 10 || r.poolIds.length > 100 || (r.status === 'unmeasured') !== (r.retrieval === null))) return false;
    if (q.rows.some(r => r.retrieval && (r.retrieval.eligible === q.abstention || r.retrieval.unresolvedCitations !== 0))) return false;
    if (q.rows.slice(2,6).some(r => canonicalizeJson(r.poolIds) !== canonicalizeJson(q.rows[2].poolIds))) return false;
    if (q.rows.slice(2,6).some(r => r.selectedIds.some(id=>!r.poolIds.includes(id)))) return false;
    const other = report.questionRows.find(r=>r.id===q.id&&r.profile!==q.profile);
    if (!other || ['group','fold','type','abstention','futureGold'].some(k=>q[k as keyof KeylessQuestion]!==other[k as keyof KeylessQuestion])) return false;
  }
  return report.counts.questions === report.context.lme.qa && report.registrationHash === report.context.registrationHash && report.plan.questions === report.counts.questions && report.plan.profileCases === report.counts.profileCases &&
    report.plan.sourceOccurrences === report.questionRows.reduce((n,q)=>n+q.occurrences,0) && canonicalizeJson(report.summaries) === canonicalizeJson(summarizeTemporalMatrix(report.questionRows));
}
/** Compact tracked receipt: raw question/pool rows remain reproducible in the full ignored JSON. */
export function temporalExperimentSummary(report: Experiment): ExperimentSummary {
  if (!validateTemporalExperiment(report)) throw Error('refusing inconsistent question rows');
  const { questionRows, sha256: _hash, ...rest } = report, body = { ...rest, questionRowsHash: digest(questionRows) };
  return { ...body, sha256: digest(body) };
}
export function validateTemporalExperimentSummary(value: unknown): value is ExperimentSummary {
  if (!shape(value).valid || !('questionRowsHash' in (value as ExperimentSummary))) return false;
  const report = value as ExperimentSummary, { sha256: hash, ...body } = report;
  if (hash !== digest(body) || report.summaries.length !== 48 || report.counts.profileCases !== report.counts.questions * 2 || report.counts.plannedRows !== report.counts.profileCases * 8) return false;
  if (report.counts.questions !== report.context.lme.qa || report.plan.questions !== report.counts.questions || report.registrationHash !== report.context.registrationHash) return false;
  for (const profile of ['provided-history','strict-as-of']) for (const row of TEMPORAL_ROWS) {
    const cells = report.summaries.filter(s=>s.profile===profile&&s.row===row);
    if (cells.length !== 3 || new Set(cells.map(s=>s.fold)).size !== 3) return false;
    const all = cells.find(s=>s.fold==='all')!, dev = cells.find(s=>s.fold==='development')!, confirm = cells.find(s=>s.fold==='confirmation')!;
    if (all.questions !== report.counts.questions || all.questions !== dev.questions + confirm.questions) return false;
    for (const cell of cells) {
      if (cell.questions !== cell.measured + cell.unmeasured + cell.refused + cell.fallback || cell.retrieval.retrievalQuestions !== cell.questions - cell.abstentions || cell.qaAccuracy !== null) return false;
      if (Object.values(cell.byType).reduce((n,m)=>n+m.qaQuestions,0)!==cell.questions) return false;
    }
  }
  return true;
}
export function renderTemporalExperiment(input: Experiment | ExperimentSummary): string {
  const report = 'questionRows' in input ? temporalExperimentSummary(input) : input;
  if (!validateTemporalExperimentSummary(report)) throw Error('refusing to render inconsistent temporal report');
  const f = (n: number | null) => n === null ? 'unmeasured' : n.toFixed(4);
  const table = (rows: Summary[]) => ['| Profile | Fold | Row | QA / retrieval | Measured / unmeasured | Any-session recall | All-session recall | Trimmed turns |', '|---|---|---|---:|---:|---:|---:|---:|',
    ...rows.map(r=>`| ${r.profile} | ${r.fold} | ${r.row} | ${r.questions} / ${r.retrieval.retrievalQuestions} | ${r.measured} / ${r.unmeasured} | ${f(r.retrieval.recallAny)} | ${f(r.retrieval.recallAll)} | ${r.trimmed} |`)];
  return ['# Temporal evaluation', '', 'Generated by `node benchmark/temporal-eval.ts --require --md docs/TEMPORAL_EVALUATION.md`.', '',
    `Effective source bytes: \`${report.context.sourceHash}\`. Frozen registration: \`${report.registrationHash}\`. Report: \`${report.sha256}\`.`, '',
    `Default: **off**. Live model quality and provider costs are **unmeasured**. Physical requests: ${report.physicalRequests}. Strict conformance: ${report.strict.passed}/${report.strict.planned} passed, ${report.strict.failed} failed, ${report.strict.unavailable} unavailable.`, '',
    'The reference embedder is hash-trigram-512. It measures lexical retrieval mechanics. These are upstream any/all-session retrieval scores, not answer accuracy. QA includes abstentions; retrieval excludes them. No failed, future-gold or empty-history question leaves its declared denominator. Temporal model-dependent cells remain unmeasured until independently prepared claims and query proposals exist.', '',
    'All matched rows use M100, final k10, minScore0, both speaker roles and a 12,000 UTF-8-byte context ceiling. Byte counts conservatively bound text tokens; they are not tokenizer measurements. Whole turns that do not fit are counted as trimmed. The temporal pool is formed before subject and time filtering. Legacy text-keyed selection is a separate compatibility control. Timestamp-only selection preserves that ranking; added metadata can remove context evidence under the same cap.', '',
    ...table(report.summaries.filter(r=>r.fold==='all')), '',
    'Oracle evidence is evaluator-only: one representative per gold session, preferring annotated turns and shorter text, then remaining candidates up to the same k/context cap. It is a capped evidence control, not a proof of the optimal possible answer. Its labels never enter production extraction, resolution or caches. Oracle windows need independently certified bounds and are currently unavailable for the external corpus.', '',
    '## Registered folds', '', ...table(report.summaries.filter(r=>r.fold!=='all'&&r.row==='matched-pool-lane-off')), '',
    '## Per-type matched control', '', '| Profile | Type | QA / retrieval | Any-session recall | All-session recall |', '|---|---|---:|---:|---:|',
    ...report.summaries.filter(r=>r.fold==='all'&&r.row==='matched-pool-lane-off').flatMap(r=>LME_TYPES.map(t=>{const m=r.byType[t];return `| ${r.profile} | ${t} | ${m.qaQuestions} / ${m.retrievalQuestions} | ${f(m.recallAny)} | ${f(m.recallAll)} |`;})), '',
    '## Request plan and deployment gate', '', `Dry plan: \`${report.plan.sha256}\`. ${report.plan.physicalRequestsMaximum} maximum physical purchases including every allowed repair; ${report.plan.blockedSources} source views exceed the registered chunk boundary.`, '',
    '| Role | Maximum physical requests |', '|---|---:|', ...Object.entries(report.plan.roleRequests).map(([r,n])=>`| ${r} | ${n} |`), '',
    `Local embedding inputs: ${report.plan.embeddingLogicalItems}; embedding API batches: ${report.plan.embeddingPhysicalBatches}. Total input byte-token reservation: ${report.plan.inputByteTokenCeiling}; output-token ceiling: ${report.plan.outputTokenCeiling}. Model/price metadata and a dollar cap require a separately approved plan before live use. No credentials are read by this command.`, '',
    'The default gate uses paired independent-group bootstrap, 10,000 resamples, seed 17753, nearest-rank two-sided 95% percentile intervals. Full-kernel minus matched-pool-lane-off must have a positive lower bound for held-out provided-history temporal QA; all five other LongMemEval types and LoCoMo F1 categories 1–4 need lower bounds at least −0.05. Missing pairs or categories cannot pass. Strict violations must be zero. Cold provider cost ratio must be ≤3, the explicitly modelled 100-queries-per-scope amortized ratio ≤2, and measured warm p95 ratio ≤2 on the same host/workload; an approved absolute dollar ceiling also applies. Zero denominators require pre-registered absolute ceilings. None of those model-quality or deployment-cost criteria is inferred from these keyless retrieval scores.', '',
    'Canonical [LoCoMo recall](LOCOMO_RECALL.md) and [answer scoring](LOCOMO_BENCHMARK.md) keep their original rows, datasets and scorers. LoCoMo has session dates but no QA anchor; no gold evidence is used to invent one. See [strict temporal conformance](TEMPORAL_BENCHMARK.md) and [LongMemEval source qualification](LONGMEMEVAL_BENCHMARK.md) for date, denominator and official-judge caveats.', ''].join('\n');
}
