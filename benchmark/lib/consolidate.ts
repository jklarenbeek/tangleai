/** Matched, source-delivery evidence before any consolidation quality claim. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { cloneJson } from '@jarenjs/core/object';
import { consolidationStorageControls } from './consolidate-storage.ts';
import { createReportValidator } from './validate.ts';
import REPORT_SCHEMA from '../schemas/consolidate-report.schema.json' with { type: 'json' };
import { sizeOf } from '@jarenjs/core/chunk';
import { createLedger } from '@tangleai/context/ledger';
import { createHashEmbedder } from '@tangleai/models/embed';
import { recallByEmbedding } from '@tangleai/memory/retrieval';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { conversationCorpus, transcriptUnits } from './locomo-corpus.ts';
import { questionsOf, contextLine } from './locomo-qa.ts';
import { confirmationConversations } from './locomo-policy.ts';
import { evidenceRecall, average } from './recall.ts';
import { officialScore } from './locomo-parity.ts';
import { DEFAULTS, makeCorpus, probe, ceilingFor, programProbe, pairwiseProgram, scorePairwise } from './horizon.ts';
import type { LocomoSample } from './locomo.ts';
import { table, score } from './table.ts';
import JAREN_REGISTRATION from '../registrations/consolidate-jaren.json' with { type: 'json' };
import TIER_REGISTRATION from '../registrations/consolidate-deterministic.json' with { type: 'json' };
import { bootstrapInterval } from './locomo-policy.ts';
import REGISTRATION from '../registrations/consolidate.json' with { type: 'json' };

export { REGISTRATION as CONSOLIDATE_REGISTRATION };
export interface EvidenceSource { key: string; unit: MemoryUnit; sequence: number }
export const FAILURE_KINDS = ['source', 'unsupported', 'refusal', 'budget', 'embedding', 'persistence', 'conflict', 'unknown'] as const;
export type FailureCounts = Record<typeof FAILURE_KINDS[number], number>;
export function emptyFailures(): FailureCounts {
  return { source: 0, unsupported: 0, refusal: 0, budget: 0, embedding: 0, persistence: 0, conflict: 0, unknown: 0 };
}
export interface CandidateStatistics {
  artifacts: number; retainedSources: number; outputChars: number;
  logicalCalls: number; embeddingItems: number; failures: FailureCounts;
}
export interface Candidate {
  key: string;
  origin: 'keyless' | 'scripted';
  /** No questions, answers or gold references enter preparation. */
  prepare(sources: readonly EvidenceSource[]): Promise<{
    /** Source keys in routing order; the instrument resolves exact source text. */
    rank(question: string): Promise<readonly string[]>;
    statistics: CandidateStatistics;
  }>;
}

/** Whole evidence lines only. References alone are never credited. */
export function suppliedEvidence(sources: readonly EvidenceSource[], ranked: readonly string[],
  options = REGISTRATION.retrieval) {
  if (!Number.isInteger(options.k) || options.k < 0 || !Number.isInteger(options.contextChars) || options.contextChars < 0)
    throw new Error('invalid evidence context bounds');
  const lookup = new Map(sources.map(source => [source.key, source]));
  if (lookup.size !== sources.length) throw new Error('duplicate qualified source key');
  const seen = new Set<string>();
  const supplied: EvidenceSource[] = [];
  let chars = 0, missing = 0, trimmed = 0, duplicates = 0;
  for (const key of ranked) {
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const source = lookup.get(key);
    if (!source) { missing++; continue; }
    if (supplied.length >= options.k) break;
    const cost = sizeOf(contextLine(source.unit)) + (supplied.length ? 1 : 0);
    if (cost + chars > options.contextChars) { trimmed++; continue; }
    supplied.push(source); chars += cost;
  }
  return { supplied, chars, missing, trimmed, duplicates };
}

export function hashControl(): Candidate {
  return {
    key: 'raw-hash', origin: 'keyless',
    async prepare(sources) {
      const embedder = createHashEmbedder({ dims: REGISTRATION.retrieval.hashDimensions });
      const identity = { model: embedder.model, dims: embedder.dims };
      const vectors = sources.length ? await embedder.embed(sources.map(source => source.unit.text)) : [];
      const units = sources.map((source, i) => ({ ...source.unit, id: source.key, embedding: Array.from(vectors[i]), embeddedBy: identity }));
      return {
        async rank(question) {
          const [query] = await embedder.embed([question]);
          return recallByEmbedding(units, query, { k: units.length, minScore: 0, identity }).ranked.map(hit => hit.unit.id);
        },
        statistics: { artifacts: 0, retainedSources: sources.length, outputChars: 0,
          logicalCalls: 0, embeddingItems: sources.length, failures: emptyFailures() },
      };
    },
  };
}

export interface ConsolidateQuestionRow {
  candidate: string; id: string; partition: 'development' | 'confirmation'; category: number;
  recall: number; verbatimF1: number; supplied: number; chars: number; missing: number; trimmed: number;
}
export function summarizeRows(rows: readonly ConsolidateQuestionRow[]) {
  return ['all', 'development', 'confirmation'].flatMap(partition => [0, 1, 2, 3, 4].map(category => {
    const selected = rows.filter(row => (partition === 'all' || row.partition === partition) && (!category || row.category === category));
    return { partition, category, questions: selected.length,
      recall: selected.length ? average(selected.map(row => row.recall)) : null,
      verbatimF1: selected.length ? average(selected.map(row => row.verbatimF1)) : null,
      meanChars: selected.length ? average(selected.map(row => row.chars)) : null };
  }));
}

export function pairedComparisons(keys: readonly string[], rows: readonly ConsolidateQuestionRow[]) {
  return keys.flatMap(key => ['raw-hash', 'raw-lexical', 'raw-jaren'].flatMap(control =>
      key === control || !keys.includes(control) ? [] : ['development', 'confirmation'].map(partition => {
        const treatment = rows.filter(row => row.candidate === key && row.partition === partition);
        const baseline = new Map(rows.filter(row => row.candidate === control && row.partition === partition).map(row => [row.id, row]));
        const deltas = treatment.map(row => row.recall - baseline.get(row.id)!.recall);
        return { candidate: key, control, partition, questions: deltas.length,
          meanDelta: deltas.length ? average(deltas) : 0, interval: bootstrapInterval(deltas, { resamples: 10000, seed: 17753, level: 0.95 }) };
      })));
}

export async function compactionControls() {
  const corpus = makeCorpus();
  const rows = [];
  for (const shape of ['front', 'late'] as const) for (const budget of DEFAULTS.budgets) {
    for (const variant of ['synopsis', 'ledger'] as const) {
      const result = await probe({ corpus, budget, shape, ...(variant === 'ledger' ? { ledger: createLedger() } : {}) });
      rows.push({ shape, budget, variant, values: result.valuePresent, recoverable: result.valueRecoverable,
        pairwise: ceilingFor('pairwise', { valuePresent: result.valuePresent, n: corpus.n }),
        chars: result.sent, compacted: result.compacted });
    }
  }
  const program = await programProbe({ corpus, shape: 'late', program: pairwiseProgram() });
  return { parameters: DEFAULTS, rows, program: { values: program.valuesReached,
    pairwise: ceilingFor('pairwise', { valuePresent: program.valuesReached, n: corpus.n }),
    correct: scorePairwise(program.answerText, corpus), rootChars: program.rootChars,
    corpusChars: program.corpusChars, origin: 'scripted', physicalRequests: 0 } };
}

/** Full question coverage; candidate registration is separate from its observed result. */
export async function runConsolidate(dataset: { samples: LocomoSample[]; sha256: string },
  options: { candidates?: Candidate[]; sourceHash: string; compaction?: boolean; storage?: boolean } ) {
  const candidates = options.candidates ?? [hashControl()];
  if (new Set(candidates.map(candidate => candidate.key)).size !== candidates.length) throw new Error('duplicate candidate identity');
  const confirmation = confirmationConversations(dataset.samples.map(sample => sample.sample_id));
  const rows: ConsolidateQuestionRow[] = [];
  const statistics = new Map(candidates.map(candidate => [candidate.key, {
    artifacts: 0, retainedSources: 0, outputChars: 0, logicalCalls: 0, embeddingItems: 0, failures: emptyFailures(),
  }]));
  let questionCount = 0, sourceChars = 0;
  let sources = 0, excluded = 0, emptyGold = 0, unresolvedGold = 0, refusedSessions = 0;
  for (const sample of dataset.samples) {
    const corpus = conversationCorpus(sample);
    const evidence = transcriptUnits(corpus).map((unit, sequence) => ({ key: unit.evidence, unit, sequence }));
    sources += evidence.length; sourceChars += evidence.reduce((sum, source) => sum + source.unit.text.length, 0); refusedSessions += corpus.refused;
    const questions = questionsOf(sample, corpus).filter(question => {
      if (question.category === 5) { excluded++; return false; }
      if (!question.gold.length) emptyGold++;
      unresolvedGold += question.gold.length - question.resolvable;
      return true;
    });
    questionCount += questions.length;
    for (const candidate of candidates) {
      const prepared = await candidate.prepare(cloneJson(evidence));
      const values = [prepared.statistics.artifacts, prepared.statistics.retainedSources, prepared.statistics.outputChars,
        prepared.statistics.logicalCalls, prepared.statistics.embeddingItems, ...FAILURE_KINDS.map(key => prepared.statistics.failures[key])];
      if (values.some(value => !Number.isSafeInteger(value) || value < 0) || prepared.statistics.retainedSources > evidence.length)
        throw new Error('invalid candidate accounting');
      const stat = statistics.get(candidate.key)!;
      for (const key of ['artifacts', 'retainedSources', 'outputChars', 'logicalCalls', 'embeddingItems'] as const)
        stat[key] += prepared.statistics[key];
      for (const key of FAILURE_KINDS) stat.failures[key] += prepared.statistics.failures[key];
      for (const question of questions) {
        const context = suppliedEvidence(evidence, await prepared.rank(question.text));
        // This intentionally weak reader copies supplied text. It is no model QA claim.
        const scored = officialScore({ prediction: context.supplied.map(source => source.unit.text).join('\n'),
          answer: question.answer!, category: question.category });
        rows.push({ candidate: candidate.key, id: question.id,
          partition: confirmation.includes(sample.sample_id) ? 'confirmation' : 'development', category: question.category,
          recall: evidenceRecall(question.gold, new Set(context.supplied.map(source => source.key))),
          verbatimF1: scored.scored ? scored.f1 : 0, supplied: context.supplied.length,
          chars: context.chars, missing: context.missing, trimmed: context.trimmed });
      }
    }
  }
  const report = {
    instrument: 'consolidation-evidence', revision: 1, registration: REGISTRATION,
    registrationHash: await canonicalSha256(REGISTRATION), tierRegistration: TIER_REGISTRATION,
    tierRegistrationHash: await canonicalSha256(TIER_REGISTRATION), lexicalOwner: JAREN_REGISTRATION, sourceHash: options.sourceHash,
    dataset: { sha256: dataset.sha256, conversations: dataset.samples.length, sources, sourceChars, questions: questionCount, excluded, emptyGold, unresolvedGold, refusedSessions, confirmation },
    candidates: candidates.map(candidate => ({ key: candidate.key, origin: candidate.origin,
      statistics: statistics.get(candidate.key)!, summary: summarizeRows(rows.filter(row => row.candidate === candidate.key)) })),
    unmeasured: REGISTRATION.tiers.filter(tier => !candidates.some(candidate => candidate.key === tier)),
    storage: options.storage === false ? null : await consolidationStorageControls(),
    comparisons: pairedComparisons(candidates.map(candidate => candidate.key), rows),
    questionRows: rows, compaction: options.compaction === false ? null : await compactionControls(),
    physicalRequests: 0, liveQuality: null, liveTokens: null, liveCostUsd: null, liveLatencyMs: null,
    default: { enabled: false, reason: 'No registered paired live reader/judge quality and cost evidence' },
  };
  const sealed = { ...report, sha256: await canonicalSha256(report) };
  if (!validateConsolidate(sealed)) throw new Error('inconsistent consolidation report');
  return sealed;
}
export type ConsolidateReport = Awaited<ReturnType<typeof runConsolidate>>;

const validateShape = createReportValidator(REPORT_SCHEMA);
export function validateConsolidate(value: unknown): boolean {
  if (!validateShape(value).valid) return false;
  const report = value as ConsolidateReport;
  if (report.candidates.length === 0 || new Set(report.candidates.map(candidate => candidate.key)).size !== report.candidates.length) return false;
  if (report.storage && (new Set(report.storage.map(row => row.backend)).size !== 3
    || report.storage.some(row => row.passed !== row.cases.length || JSON.stringify(row.cases) !== JSON.stringify(report.storage![0].cases)))) return false;
  for (const candidate of report.candidates) {
    const rows = report.questionRows.filter(row => row.candidate === candidate.key);
    if (rows.length !== report.dataset.questions || new Set(rows.map(row => row.id)).size !== rows.length) return false;
    const control = report.questionRows.filter(row => row.candidate === report.candidates[0].key);
    if (rows.some((row, index) => row.id !== control[index]?.id || row.category !== control[index]?.category
      || row.partition !== control[index]?.partition)) return false;
    if (JSON.stringify(candidate.summary) !== JSON.stringify(summarizeRows(rows))) return false;
    if (candidate.statistics.retainedSources > report.dataset.sources) return false;
  }
  if (JSON.stringify(report.comparisons) !== JSON.stringify(pairedComparisons(report.candidates.map(row => row.key), report.questionRows))) return false;
  return report.questionRows.every(row => report.candidates.some(candidate => candidate.key === row.candidate)
    && row.chars <= report.registration.retrieval.contextChars && row.supplied <= report.registration.retrieval.k);
}

export function renderConsolidate(report: ConsolidateReport): string {
  if (!validateConsolidate(report)) throw new Error('refusing inconsistent consolidation report');
  const lines = ['# Context consolidation: evidence and controls', '',
    'Generated by `node benchmark/consolidate.ts --require --md docs/CONSOLIDATE_BENCHMARK.md`.', '',
    `Registration: \`${report.registrationHash}\`. Effective source: \`${report.sourceHash}\`. Report: \`${report.sha256}\`.`, '',
    `Corpus \`${report.dataset.sha256}\`: ${report.dataset.conversations} conversations, ${report.dataset.sources} exact source occurrences, ${report.dataset.questions} scorable questions, ${report.dataset.excluded} excluded category-5 questions, ${report.dataset.emptyGold} questions without evidence, ${report.dataset.unresolvedGold} unresolved gold references, ${report.dataset.refusedSessions} refused sessions.`, '',
    `Confirmation conversations: ${report.dataset.confirmation.join(', ')}. All other conversations are development. Configuration is fixed before candidate evaluation.`, '',
    `Matched context: at most ${REGISTRATION.retrieval.k} complete source lines and ${REGISTRATION.retrieval.contextChars} UTF-16 characters, including rendered dates, speakers, ids and separators. Oversized lines are skipped whole. Artifact references earn credit only after their original source text is supplied within this same budget.`, '',
    'The canonical selected policy is measured separately by [LoCoMo recall](LOCOMO_RECALL.md). These matched rows preserve equal-text source occurrences separately and apply a final context budget, so their identity differs from that historical control.', '',
    '## Matched retrieval and verbatim floor', '',
    'The shipped lexical API consumes the public Jaren search owner. Native rows carry `jaren` in their key. The original raw-lexical/deterministic/deterministic-hybrid BM25 rows remain frozen benchmark references, with their scorer confined to the benchmark. The native scoring profile differs and is separately registered; this architecture correction was fixed before native evaluation and was not selected by confirmation performance.', '',
    `Native registration: ${JSON.stringify(report.lexicalOwner)}.`, '',
    'Recall uses the official fractional evidence scorer. Verbatim F1 copies supplied source text through the official answer scorer; it does not measure a model reader or judge. A retrieval gain alone does not qualify a default.', '',
    table({ head: ['Candidate', 'Partition', 'Category', 'Questions', 'Recall', 'Verbatim F1', 'Mean context chars'],
      rows: report.candidates.flatMap(candidate => candidate.summary.map(row => [candidate.key, row.partition, row.category || 'all', row.questions, score(row.recall), score(row.verbatimF1), row.meanChars?.toFixed(1) ?? null])) }), '',
    '## Paired retrieval diagnostics', '',
    'Configuration and tier parameters were fixed before confirmation. Intervals resample paired questions, using the existing policy bootstrap (10,000 resamples, seed 17753). Questions within a conversation are correlated; the three confirmation conversations limit generalization. These retrieval intervals do not qualify the live QA default gate.', '',
    table({ head: ['Candidate', 'Control', 'Partition', 'Questions', 'Recall delta', '95% question-bootstrap interval'], rows: report.comparisons.map(row => [row.candidate, row.control, row.partition, row.questions, score(row.meanDelta), `${score(row.interval.low)} to ${score(row.interval.high)}`]) }), '',
    '## Preparation and failures', '',
    table({ head: ['Candidate', 'Origin', 'Artifacts', 'Sources retained', 'Output chars', 'Logical calls', 'Local embedding items', 'Failures'],
      rows: report.candidates.map(candidate => [candidate.key, candidate.origin, candidate.statistics.artifacts, candidate.statistics.retainedSources,
        candidate.statistics.outputChars, candidate.statistics.logicalCalls, candidate.statistics.embeddingItems, JSON.stringify(candidate.statistics.failures)]) }), '',
    `Exact source text totals ${report.dataset.sourceChars} UTF-16 characters. Artifact output counts preview text only: the original sources and artifact references remain stored, so shorter previews do not mean reduced total storage. Tier registration: \`${report.tierRegistrationHash}\`; parameters \`${JSON.stringify(report.tierRegistration)}\`.`, '',
    `Unmeasured tiers: ${report.unmeasured.join(', ') || 'none'}. Physical requests: ${report.physicalRequests} (keyless/scripted only). Live quality, model tokens, USD and latency: unmeasured. Opaque callback counts must not be relabeled physical requests.`, '',
    '**Default: off.** ' + report.default.reason + '. The registered gate requires a positive paired live QA bootstrap lower bound, category delta ≥ -0.05, token ratio ≤ 1.1 and physical-request ratio ≤ 1.0.', '',
  ];
  if (report.storage) lines.push('## Atomic storage qualification', '',
    'The same independently asserted protocol runs in memory, Node SQLite and Bun SQLite. It covers immutable occurrence identity, capacity, evidence membership, rollback at every write boundary, independent-adapter contention, durable operation reservations and actual reopen/replay. Failed activation retains every pending source; completed replay has zero writes or callback invocations.', '',
    table({ head: ['Backend', 'Cases passed', 'Failures', 'Physical requests', 'Legacy memories preserved'], rows: report.storage.map(row => [row.backend, row.passed, row.failed, row.physicalRequests, row.legacyMemoriesPreserved]) }), '',
    ...report.storage[0].cases.map(name => `- ${name}`), '');
  if (report.compaction) lines.push('## Existing history compaction and full-corpus program', '',
    'These run the public agent and ledger. Direct pairwise is determinacy from every value, not a bound on lucky answers. Recoverable values require archive reads. Character counts here serialize the whole message array; the agent budget sums individual message sizes, excluding array punctuation.', '',
    table({ head: ['Shape', 'Budget', 'Variant', 'Direct values', 'Recoverable', 'Pairwise determinacy', 'Serialized chars', 'Compacted'],
      rows: report.compaction.rows.map(row => [row.shape, row.budget, row.variant, row.values, row.recoverable, row.pairwise, row.chars, String(row.compacted)]) }), '',
    `The scripted full-corpus program reaches ${report.compaction.program.values} values, pairwise determinacy ${report.compaction.program.pairwise}, correct result ${report.compaction.program.correct}; root ${report.compaction.program.rootChars} characters, corpus ${report.compaction.program.corpusChars}. Physical requests: 0. Compaction is therefore neither universally pairwise-zero nor the first available way to recover all evidence.`, '');
  return lines.join('\n');
}
