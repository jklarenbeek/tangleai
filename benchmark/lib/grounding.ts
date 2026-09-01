/**
 * The document-grounding instrument — the claim oracle, the citation
 * state machine, and the keyless report.
 *
 * Everything here serves one sentence: a retrieved chunk is a candidate;
 * only a cited, resolvable, eligible passage that supports a material
 * claim is grounding. The shipped chat path collapses those states into
 * one "citation", so this module keeps them apart:
 *
 * **The answer cannot hide a claim.** The one answer contract
 * (`GROUNDED_ANSWER_SCHEMA`) is either claims-with-citations or an
 * explicit abstention; the visible answer text is DERIVED from the claim
 * texts in array order, so prose cannot carry a material claim the
 * ledger omitted. The same schema drives the scripted and live paths
 * through the suite's `createStructuredOutput` — no local parser or
 * repair loop.
 *
 * **Claims match one-to-one under fixture-authored predicates.** Each
 * expected material claim carries closed matching data — required token
 * groups and forbidden tokens over the officially-normalized text —
 * written with the fixture, before any result existed. Expected claims
 * in manifest order take the earliest unmatched predicted claim that
 * satisfies them; there is no embedding similarity, no model judge, and
 * no threshold invented after results.
 *
 * **Every visible citation ends in exactly one terminal outcome**,
 * walked in the registered order against the exact attempt trace:
 * unknown address, then supply, then version status, then cutoff
 * eligibility, then oracle support. A matched claim without one
 * `supporting` citation is one false positive AND one false negative —
 * never half credit. Duplicate visible ids stay in the raw telemetry
 * and are deduplicated only for set metrics.
 *
 * **The scorer is proven before it prints.** The oracle answers must
 * reach exact 1.000 ceilings on every published metric, and every named
 * bad fixture must reach its intended terminal reason, or the CLI exits
 * before a table exists.
 *
 * Identities are the suite's `canonicalSha256` over explicit
 * credential-free payloads; validation is the one report-validator
 * factory over the generated schema; the official LoCoMo normalizer and
 * token F1 are reused for the answer-F1 diagnostic rather than
 * approximated. The claim/evidence shapes live here under `benchmark/`
 * because the installed suite publishes no generic claim envelope.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mean as meanOf } from '@jarenjs/core/stats';

import { analyticEnvelope } from './report-envelope.ts';
import { f1Score, normalizeAnswer } from './locomo-parity.ts';
import { createReportValidator, describeErrors, type ReportValidator } from './validate.ts';
import { pct, score, table } from './table.ts';
import GROUNDING_SCHEMA from '../schemas/grounding.schema.json' with { type: 'json' };
import RUN_IDENTITY_SCHEMA from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type {
  AnswerValue,
  CitationCounts,
  CitationOutcome,
  CitationRecord,
  ClaimScore,
  FixtureClaim,
  FixtureQuestion,
  GroundingFixture,
  GroundingReport,
  OracleGate,
  OutcomeCounts,
  Predicates,
  Scenario,
  ScriptedAnswer,
  SourceManifest,
} from './grounding.types.ts';

export type {
  AnswerValue,
  CitationOutcome,
  CitationRecord,
  ClaimScore,
  FixtureClaim,
  FixtureQuestion,
  GroundingFixture,
  GroundingReport,
  Scenario,
  ScriptedAnswer,
};

/** Where the fixture lives, relative to the repository root. */
export const GROUNDING_FIXTURE_PATH = 'benchmark/fixtures/grounding/manifest.json';

/** The registered outcome order — the walk IS this list. */
export const CITATION_OUTCOMES: readonly CitationOutcome[] = [
  'supporting', 'resolved-not-supporting', 'not-supplied', 'inactive-version', 'future-evidence', 'unknown-evidence',
];

/**
 * The answer contract is the PRODUCT's, measured here first: the schema
 * object lives with the desktop grounding lane and every benchmark path
 * generates under the same bytes, so the measured contract and the
 * shipped one cannot drift.
 */
export { GROUNDED_ANSWER_SCHEMA } from '../../apps/desktop/src/grounding.ts';
import { GROUNDED_ANSWER_SCHEMA, renderGroundedAnswer, type GroundedAnswer } from '../../apps/desktop/src/grounding.ts';

// ---------------------------------------------------------------------------
// the fixture — loaded, hash-verified and schema-validated before any score
// ---------------------------------------------------------------------------

/** The one validator for fixture and report documents. */
export function createGroundingValidator(): ReportValidator {
  return createReportValidator(GROUNDING_SCHEMA, [RUN_IDENTITY_SCHEMA]);
}

export interface LoadedFixture {
  fixture: GroundingFixture;
  /** Canonical SHA-256 of the manifest document. */
  fixtureId: string;
  /** The manifest and every source file, path/digest ordered. */
  source: SourceManifest;
}

function sha256Of(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + 1);
  }
  return count;
}

/**
 * Load, hash-verify and validate the fixture. Every declared version
 * file must match its recorded digest, every element quote must occur
 * exactly once in its version's bytes, and the manifest must validate —
 * a corpus that moved is refused, never repaired.
 */
export async function loadGroundingFixture(root = process.cwd()): Promise<LoadedFixture> {
  const manifestPath = join(root, GROUNDING_FIXTURE_PATH);
  const manifestBytes = await readFile(manifestPath);
  const fixture = JSON.parse(manifestBytes.toString('utf8')) as GroundingFixture;
  const outcome = createGroundingValidator()(fixture);
  if (!outcome.valid) {
    throw new Error(`the grounding fixture does not validate: ${describeErrors(outcome, 5).join('; ')}`);
  }
  const files: Array<{ path: string, sha256: string }> = [
    { path: GROUNDING_FIXTURE_PATH, sha256: sha256Of(manifestBytes) },
  ];
  const versionText = new Map<string, string>();
  for (const source of fixture.sources) {
    for (const version of source.versions) {
      const path = `benchmark/fixtures/grounding/${version.file}`;
      const bytes = await readFile(join(root, path));
      const digest = sha256Of(bytes);
      if (digest !== version.sha256) {
        throw new Error(`${path} does not match the manifest digest (${digest.slice(0, 12)}… against ${version.sha256.slice(0, 12)}…); the corpus moved`);
      }
      files.push({ path, sha256: digest });
      versionText.set(version.key, bytes.toString('utf8'));
    }
  }
  for (const element of fixture.elements) {
    const text = versionText.get(element.version);
    if (text === undefined) throw new Error(`element ${element.key} names version ${element.version}, which no source declares`);
    const count = occurrences(text, element.quote);
    if (count !== 1) {
      throw new Error(`element ${element.key}'s quote occurs ${count} times in ${element.version}; the oracle needs exactly one`);
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    fixture,
    fixtureId: await canonicalSha256(fixture as unknown as Record<string, unknown>),
    source: { files, sha256: await canonicalSha256({ files }) },
  };
}

// ---------------------------------------------------------------------------
// the evidence corpus — one lookup shape for the analytic and real paths
// ---------------------------------------------------------------------------

/** One addressable chunk as the classifier sees it. */
export interface EvidenceChunk {
  id: string;
  version: string;
  status: 'active' | 'superseded';
  admittedAt: string;
  /** The fixture element keys this chunk carries. */
  elements: ReadonlySet<string>;
}

/** The registry of every address a citation could name. */
export interface EvidenceCorpus {
  chunk(id: string): EvidenceChunk | undefined;
}

/** The fixture's own chunks as the analytic corpus — ids ARE fixture keys. */
export function fixtureCorpus(fixture: GroundingFixture): EvidenceCorpus {
  const versions = new Map<string, { status: 'active' | 'superseded', admittedAt: string }>();
  for (const source of fixture.sources) {
    for (const version of source.versions) versions.set(version.key, { status: version.status, admittedAt: version.admittedAt });
  }
  const chunks = new Map<string, EvidenceChunk>();
  for (const chunk of fixture.chunks) {
    const version = versions.get(chunk.version)!;
    chunks.set(chunk.key, {
      id: chunk.key,
      version: chunk.version,
      status: version.status,
      admittedAt: version.admittedAt,
      elements: new Set(chunk.elements),
    });
  }
  return { chunk: (id) => chunks.get(id) };
}

/** What one question's attempt actually supplied — raw, in prompt order. */
export interface AttemptTrace {
  retrieved: readonly string[];
  supplied: readonly string[];
}

// ---------------------------------------------------------------------------
// rendering, predicates, matching, classification — all pure
// ---------------------------------------------------------------------------

/** The visible answer, derived from the ledger — the product's own renderer over the report shape. */
export function renderAnswer(answer: AnswerValue): string {
  return renderGroundedAnswer(answer as GroundedAnswer);
}

/** The predicate text: the official normalizer's output, space-padded so an authored token can anchor on a word edge. */
export function predicateText(text: string): string {
  return ` ${normalizeAnswer(text)} `;
}

/** Whether one predicted claim satisfies one claim's closed predicates. */
export function matchesPredicates(text: string, predicates: Predicates): boolean {
  const padded = predicateText(text);
  for (const token of predicates.forbidden) if (padded.includes(token)) return false;
  return predicates.required.every((group) => group.some((token) => padded.includes(token)));
}

export interface Assignment {
  /** expected claim key -> predicted claim id, in manifest order. */
  matched: Map<string, string>;
  /** predicted claim ids no expected claim took. */
  unmatched: string[];
}

/**
 * The deterministic one-to-one assignment: expected claims in manifest
 * order, each taking the earliest unmatched predicted claim satisfying
 * its predicates. Never a greedy best-score chosen after results.
 */
export function assignClaims(expected: readonly FixtureClaim[], answer: AnswerValue): Assignment {
  const matched = new Map<string, string>();
  const taken = new Set<string>();
  const predicted = answer.disposition === 'answer' ? answer.claims : [];
  for (const claim of expected) {
    const hit = predicted.find((p) => !taken.has(p.id) && matchesPredicates(p.text, claim.predicates));
    if (hit !== undefined) {
      matched.set(claim.key, hit.id);
      taken.add(hit.id);
    }
  }
  return { matched, unmatched: predicted.filter((p) => !taken.has(p.id)).map((p) => p.id) };
}

/**
 * One citation's terminal outcome, walked in the registered order
 * against the exact attempt trace. `support` is the expected claim's
 * oracle support set when the citing claim matched one, and null
 * otherwise — an unmatched claim's resolvable citation can only be
 * `resolved-not-supporting`, because there is no claim to support.
 */
export function classifyCitation(
  citation: string,
  corpus: EvidenceCorpus,
  trace: AttemptTrace,
  cutoff: string,
  support: ReadonlySet<string> | null,
): CitationOutcome {
  const chunk = corpus.chunk(citation);
  if (chunk === undefined) return 'unknown-evidence';
  if (!trace.supplied.includes(citation)) return 'not-supplied';
  if (chunk.status !== 'active') return 'inactive-version';
  if (chunk.admittedAt > cutoff) return 'future-evidence';
  if (support !== null && [...support].some((element) => chunk.elements.has(element))) return 'supporting';
  return 'resolved-not-supporting';
}

function emptyOutcomes(): OutcomeCounts {
  return { supporting: 0, resolvedNotSupporting: 0, notSupplied: 0, inactiveVersion: 0, futureEvidence: 0, unknownEvidence: 0 };
}

const OUTCOME_MEMBER: Record<CitationOutcome, keyof OutcomeCounts> = {
  'supporting': 'supporting',
  'resolved-not-supporting': 'resolvedNotSupporting',
  'not-supplied': 'notSupplied',
  'inactive-version': 'inactiveVersion',
  'future-evidence': 'futureEvidence',
  'unknown-evidence': 'unknownEvidence',
};

export interface ScoredAnswer {
  rendered: string;
  citations: CitationRecord[];
  citationCounts: CitationCounts;
  claims: ClaimScore;
  abstention: Scenario['abstention'];
  answerF1: number | null;
}

/**
 * Score one answer against one question: the assignment, then every
 * visible citation's terminal outcome, then the supported-claim counts.
 * Support is re-read from the citations, so a claim matched on text
 * alone can never count as grounded.
 */
export function scoreAnswer(
  question: FixtureQuestion,
  expected: readonly FixtureClaim[],
  answer: AnswerValue,
  corpus: EvidenceCorpus,
  trace: AttemptTrace,
  cutoff: string,
): ScoredAnswer {
  const assignment = assignClaims(expected, answer);
  const predictedOf = new Map(answer.disposition === 'answer' ? answer.claims.map((c) => [c.id, c]) : []);
  const supportOf = new Map<string, ReadonlySet<string>>();
  for (const claim of expected) {
    const predictedId = assignment.matched.get(claim.key);
    if (predictedId !== undefined) supportOf.set(predictedId, new Set(claim.support));
  }

  const citations: CitationRecord[] = [];
  const byOutcome = emptyOutcomes();
  const outcomesById = new Map<string, Set<CitationOutcome>>();
  if (answer.disposition === 'answer') {
    for (const predicted of answer.claims) {
      for (const citation of predicted.citations) {
        const outcome = classifyCitation(citation, corpus, trace, cutoff, supportOf.get(predicted.id) ?? null);
        citations.push({ claimId: predicted.id, citation, outcome });
        byOutcome[OUTCOME_MEMBER[outcome]]++;
        const set = outcomesById.get(citation) ?? new Set<CitationOutcome>();
        set.add(outcome);
        outcomesById.set(citation, set);
      }
    }
  }
  const resolvedUnique = [...outcomesById.values()].filter((set) => set.has('supporting') || set.has('resolved-not-supporting')).length;
  const supportingUnique = [...outcomesById.values()].filter((set) => set.has('supporting')).length;

  // a matched claim is supported only when one of ITS visible citations
  // reached `supporting`; otherwise it is one FP and one FN together
  const supportedPredicted = new Set<string>();
  for (const record of citations) if (record.outcome === 'supporting') supportedPredicted.add(record.claimId);
  const matches: ClaimScore['matches'] = expected.map((claim) => {
    const predictedId = assignment.matched.get(claim.key) ?? null;
    return {
      claim: claim.key,
      predictedId,
      matched: predictedId !== null,
      supported: predictedId !== null && supportedPredicted.has(predictedId),
    };
  });
  const tp = matches.filter((m) => m.supported).length;
  const fn = expected.length - tp;
  const fp = predictedOf.size - tp;
  const answerable = question.kind === 'answerable';
  const f1 = !answerable ? null : (2 * tp + fp + fn === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn));

  const rendered = renderAnswer(answer);
  const abstained = answer.disposition === 'abstain';
  return {
    rendered,
    citations,
    citationCounts: {
      raw: citations.length,
      unique: outcomesById.size,
      resolvedUnique,
      supportingUnique,
      byOutcome,
    },
    claims: { expected: expected.map((c) => c.key), matches, tp, fp, fn, f1 },
    abstention: { expected: !answerable, given: abstained, correct: abstained === !answerable },
    answerF1: question.reference === null ? null : f1Score(rendered, question.reference),
  };
}

// ---------------------------------------------------------------------------
// identities
// ---------------------------------------------------------------------------

/** The scorer's registered rules, exactly as the schema constants state them. */
export const SCORER_REGISTRATION = {
  matching: 'expected claims in manifest order take the earliest unmatched predicted claim satisfying the fixture predicates; one-to-one; no similarity threshold',
  normalizer: 'the official LoCoMo normalizer (benchmark/lib/locomo-parity.ts normalizeAnswer)',
  outcomes: [...CITATION_OUTCOMES],
} as const;

/** The answer contract's content revision — part of every registration. */
export async function answerSchemaRevision(): Promise<string> {
  return canonicalSha256(GROUNDED_ANSWER_SCHEMA as unknown as Record<string, unknown>);
}

/** The registration identity: the fixed inputs, never an observed result. */
export async function registrationIdOf(registration: Omit<GroundingReport['registration'], 'registrationId'>): Promise<string> {
  return canonicalSha256({
    fixtureId: registration.fixtureId,
    cutoff: registration.cutoff,
    questionIds: registration.questionIds,
    claimKeys: registration.claimKeys,
    scorer: registration.scorer,
    answerSchemaRevision: registration.answerSchemaRevision,
  });
}

/** The report's identity: the whole validated observation, with the hash member excluded from its own input. */
export async function reportIdOf(report: Omit<GroundingReport, 'reportId'> & { reportId?: string }): Promise<string> {
  const { reportId: _ignored, ...rest } = report;
  return canonicalSha256(rest as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// the keyless run
// ---------------------------------------------------------------------------

function traceOf(fixture: GroundingFixture, questionKey: string): AttemptTrace {
  const trace = fixture.trace.find((t) => t.question === questionKey)!;
  return { retrieved: trace.retrieved, supplied: trace.supplied };
}

function meanOr(values: readonly number[], empty: number): number {
  return values.length === 0 ? empty : (meanOf(values) ?? empty);
}

/** The exact oracle ceilings the gate requires, each a named failure when missed. */
export function gateOf(scenarios: readonly Scenario[]): OracleGate {
  const oracle = scenarios.filter((s) => s.kind === 'oracle');
  const failures: string[] = [];
  const tp = oracle.reduce((n, s) => n + s.claims.tp, 0);
  const fp = oracle.reduce((n, s) => n + s.claims.fp, 0);
  const fn = oracle.reduce((n, s) => n + s.claims.fn, 0);
  const microPrecision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const microRecall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const microF1 = 2 * tp + fp + fn === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  const perQuestion = oracle.map((s) => s.claims.f1).filter((f1): f1 is number => f1 !== null);
  const meanF1 = meanOr(perQuestion, 0);
  const answers = oracle.map((s) => s.answerF1).filter((f1): f1 is number => f1 !== null);
  const answerF1 = meanOr(answers, 0);
  const unique = oracle.reduce((n, s) => n + s.citationCounts.unique, 0);
  const resolved = oracle.reduce((n, s) => n + s.citationCounts.resolvedUnique, 0);
  const supporting = oracle.reduce((n, s) => n + s.citationCounts.supportingUnique, 0);
  const citationResolution = unique === 0 ? 0 : resolved / unique;
  const citationSupport = resolved === 0 ? 0 : supporting / resolved;
  const abstentionAccuracy = oracle.length === 0 ? 0 : oracle.filter((s) => s.abstention.correct).length / oracle.length;

  if (fp !== 0 || fn !== 0) failures.push(`the oracle scores TP=${tp} FP=${fp} FN=${fn}; the claim oracle must be exact`);
  if (meanF1 !== 1) failures.push(`the oracle's mean per-question supported-claim F1 is ${meanF1.toFixed(4)}, not 1`);
  if (microF1 !== 1) failures.push(`the oracle's micro supported-claim F1 is ${microF1.toFixed(4)}, not 1`);
  if (answerF1 !== 1) failures.push(`the oracle's answer F1 is ${answerF1.toFixed(4)}, not 1`);
  if (citationResolution !== 1) failures.push(`the oracle's citation resolution is ${citationResolution.toFixed(4)}, not 1`);
  if (citationSupport !== 1) failures.push(`the oracle's citation support is ${citationSupport.toFixed(4)}, not 1`);
  if (abstentionAccuracy !== 1) failures.push(`the oracle abstains wrongly on ${oracle.filter((s) => !s.abstention.correct).length} question(s)`);

  return {
    passed: failures.length === 0,
    failures,
    questions: oracle.length,
    tp,
    fp,
    fn,
    microPrecision,
    microRecall,
    microF1,
    meanF1,
    answerF1,
    citationResolution,
    citationSupport,
    abstentionAccuracy,
  };
}

/** Score every scripted answer of the fixture over its analytic trace. */
export function scoreScripted(fixture: GroundingFixture): Scenario[] {
  const corpus = fixtureCorpus(fixture);
  const questionOf = new Map(fixture.questions.map((q) => [q.key, q]));
  return fixture.scripted.map((scripted): Scenario => {
    const question = questionOf.get(scripted.question)!;
    const expected = fixture.claims.filter((c) => c.question === question.key);
    const trace = traceOf(fixture, question.key);
    const scored = scoreAnswer(question, expected, scripted.answer, corpus, trace, fixture.cutoff);
    return {
      key: scripted.key,
      kind: scripted.kind,
      question: question.key,
      trace: {
        retrieved: [...trace.retrieved],
        supplied: [...trace.supplied],
        counts: { retrieved: trace.retrieved.length, supplied: trace.supplied.length },
      },
      answer: scripted.answer,
      rendered: scored.rendered,
      citations: scored.citations,
      citationCounts: scored.citationCounts,
      claims: scored.claims,
      abstention: scored.abstention,
      answerF1: scored.answerF1,
    };
  });
}

/** The keyless report: clock-free, key-free, byte-reproducible. */
export async function runGroundingKeyless(loaded: LoadedFixture): Promise<GroundingReport> {
  const { fixture } = loaded;
  const scenarios = scoreScripted(fixture);
  const gate = gateOf(scenarios);
  const outcomes = emptyOutcomes();
  for (const scenario of scenarios) {
    for (const member of Object.keys(outcomes) as Array<keyof OutcomeCounts>) {
      outcomes[member] += scenario.citationCounts.byOutcome[member];
    }
  }
  const registrationBody = {
    fixtureId: loaded.fixtureId,
    cutoff: fixture.cutoff,
    questionIds: fixture.questions.map((q) => q.key),
    claimKeys: fixture.claims.map((c) => c.key),
    scorer: { ...SCORER_REGISTRATION, outcomes: [...SCORER_REGISTRATION.outcomes] },
    answerSchemaRevision: await answerSchemaRevision(),
  };
  const report: Omit<GroundingReport, 'reportId'> = {
    document: 'grounding-report',
    benchmark: 'grounding',
    instrument: { entry: 'benchmark/grounding.ts' },
    configIdentities: analyticEnvelope(scenarios.map((s) => s.key)) as unknown as GroundingReport['configIdentities'],
    fixture: {
      id: loaded.fixtureId,
      path: 'benchmark/fixtures/grounding/manifest.json',
      license: 'MIT',
      census: fixture.census,
    },
    registration: { registrationId: await registrationIdOf(registrationBody), ...registrationBody },
    source: loaded.source,
    gate: { oracle: gate },
    scenarios,
    summary: {
      scenarios: scenarios.length,
      outcomes,
      wrongAbstentions: scenarios.filter((s) => !s.abstention.correct).length,
    },
    decision: {
      state: 'not-evaluated',
      reason: 'a keyless run scores scripted answers over the analytic trace; the current-path baseline is still unmeasured, and no product behavior may change from it',
    },
  };
  return { ...report, reportId: await reportIdOf(report) };
}

// ---------------------------------------------------------------------------
// the mechanical product decision — read from the validated report, never argued
// ---------------------------------------------------------------------------

import type { GroundingLive, LiveDecision } from './grounding.types.ts';

/**
 * The four registered clauses, read one at a time from the validated
 * primary live report and published whether they passed or not. Absent
 * or ineligible data fails a clause — it can never be read as a pass —
 * and neither outcome may change retrieval, chunking, selection, memory
 * policy or provider profile.
 */
export function decideGrounding(live: GroundingLive): LiveDecision {
  const fixture = live.strata.find((stratum) => stratum.key === 'fixture');
  const grounded = fixture?.rows.find((row) => row.key === 'grounded-answer');
  const clauses: Array<{ clause: 'eligible-pair' | 'citation-outcomes' | 'claim-delta' | 'answer-floor', passed: boolean, detail: string }> = [];

  const eligible = fixture !== undefined && fixture.pairing.eligible;
  clauses.push({
    clause: 'eligible-pair',
    passed: eligible,
    detail: eligible
      ? 'both generated fixture rows answered the complete identical question set with no hidden failure'
      : fixture === undefined
        ? 'no fixture stratum exists in the live report'
        : `the pair is ineligible: ${fixture.pairing.reasons.map((reason) => reason.code).join(', ') || 'no reason recorded'}`,
  });

  const citations = grounded?.citations ?? null;
  const forbidden = citations === null
    ? null
    : citations.byOutcome.notSupplied + citations.byOutcome.inactiveVersion + citations.byOutcome.futureEvidence + citations.byOutcome.unknownEvidence;
  const resolves = citations !== null && citations.unique === citations.resolvedUnique && forbidden === 0;
  clauses.push({
    clause: 'citation-outcomes',
    passed: resolves,
    detail: citations === null
      ? 'the grounded row recorded no citation counts'
      : resolves
        ? `every visible citation resolves (${citations.resolvedUnique}/${citations.unique} unique) with zero not-supplied/inactive/future/unknown outcomes`
        : `${forbidden} forbidden outcome(s) and ${citations.unique - citations.resolvedUnique} unresolved unique id(s)`,
  });

  const claimComparison = eligible ? fixture.pairing.comparisons.find((comparison) => comparison.metric === 'supported-claim-f1') : undefined;
  const claimPass = claimComparison !== undefined && claimComparison.interval.low > 0;
  clauses.push({
    clause: 'claim-delta',
    passed: claimPass,
    detail: claimComparison === undefined
      ? 'no supported-claim-f1 paired comparison is evaluable'
      : `the 10,000-resample two-sided 95% interval is [${claimComparison.interval.low.toFixed(4)}, ${claimComparison.interval.high.toFixed(4)}]; the lower bound must exceed 0`,
  });

  const answerComparison = eligible ? fixture.pairing.comparisons.find((comparison) => comparison.metric === 'answer-f1') : undefined;
  const answerPass = answerComparison !== undefined && answerComparison.oneSidedLowerBound >= -0.05;
  clauses.push({
    clause: 'answer-floor',
    passed: answerPass,
    detail: answerComparison === undefined
      ? 'no answer-f1 paired comparison is evaluable'
      : `the one-sided 95% lower bound is ${answerComparison.oneSidedLowerBound.toFixed(4)} against the −0.05 floor`,
  });

  const adopt = clauses.every((clause) => clause.passed);
  return {
    state: adopt ? 'adopt-claim-citations' : 'retain-current',
    reason: adopt
      ? 'every registered clause of the validated primary live row passed; desktop citations may move from retrieved candidates to structured answer-used sources, and nothing else may change'
      : `the following clause(s) failed or were not evaluable: ${clauses.filter((clause) => !clause.passed).map((clause) => clause.clause).join(', ')}; product behavior and retrieval defaults stay unchanged and claim-linked product grounding remains with the downstream campaign`,
    clauses,
    liveReportId: live.reportId,
  };
}

// ---------------------------------------------------------------------------
// the Markdown — rendered from the validated JSON, never beside it
// ---------------------------------------------------------------------------

const OUTCOME_LABEL: Record<keyof OutcomeCounts, CitationOutcome> = {
  supporting: 'supporting',
  resolvedNotSupporting: 'resolved-not-supporting',
  notSupplied: 'not-supplied',
  inactiveVersion: 'inactive-version',
  futureEvidence: 'future-evidence',
  unknownEvidence: 'unknown-evidence',
};

/** Render the keyless report — and, when they exist, the paired live baseline and the dated web diagnostic — as the committed Markdown document. */
export function renderGroundingMarkdown(report: GroundingReport, live: import('./grounding.types.ts').GroundingLive | null = null, web: import('./grounding.types.ts').GroundingWeb | null = null): string {
  const lines: string[] = [];
  lines.push('# Document grounding benchmark');
  lines.push('');
  lines.push('> A retrieved chunk is a candidate; only a cited, resolvable, eligible passage that supports a material claim is grounding.');
  lines.push('');
  lines.push('This document is generated from the validated reports and is regenerated by `npm run benchmark:grounding`. The keyless tables prove the grounding **instrument** — the claim oracle, the one-to-one predicate matcher and the citation state machine — over a Tangle-authored MIT fixture and scripted answers.');
  if (live === null) {
    lines.push('');
    lines.push('**The shipped retrieval path\'s grounding baseline is still unmeasured here: no paid comparison exists in this document, and nothing below is evidence that document grounding improves answers.**');
  }
  lines.push('');
  lines.push(`- fixture: \`${report.fixture.path}\` — ${report.fixture.census.sources} sources, ${report.fixture.census.questions} questions, ${report.fixture.census.claims} expected material claims, ${report.fixture.census.abstentions} required abstentions (identity \`${report.fixture.id}\`)`);
  lines.push(`- registration: \`${report.registration.registrationId}\``);
  lines.push(`- source manifest: \`${report.source.sha256}\` over ${report.source.files.length} files`);
  lines.push(`- report: \`${report.reportId}\``);
  lines.push(`- product decision: **${report.decision.state}** — ${report.decision.reason}`);
  lines.push('');
  lines.push('## The scorer\'s gate — exact, or nothing prints');
  lines.push('');
  const gate = report.gate.oracle;
  lines.push(table({
    head: ['oracle ceiling', 'value'],
    rows: [
      ['questions scored', gate.questions],
      ['supported-claim TP / FP / FN', `${gate.tp} / ${gate.fp} / ${gate.fn}`],
      ['micro precision / recall / F1', `${score(gate.microPrecision)} / ${score(gate.microRecall)} / ${score(gate.microF1)}`],
      ['mean per-question supported-claim F1', score(gate.meanF1)],
      ['answer F1', score(gate.answerF1)],
      ['citation resolution', score(gate.citationResolution)],
      ['citation support', score(gate.citationSupport)],
      ['abstention accuracy', pct(gate.abstentionAccuracy)],
    ],
  }));
  lines.push('');
  lines.push('## Scripted failure modes — each bad answer reaches its named terminal reason');
  lines.push('');
  lines.push(table({
    head: ['scenario', 'question', 'TP', 'FP', 'FN', 'claim F1', 'answer F1', 'citations raw/unique', 'outcomes', 'abstention'],
    numeric: [2, 3, 4, 5, 6, 7],
    rows: report.scenarios.filter((s) => s.kind !== 'oracle').map((s) => [
      s.kind,
      s.question,
      s.claims.tp,
      s.claims.fp,
      s.claims.fn,
      s.claims.f1 === null ? null : score(s.claims.f1),
      s.answerF1 === null ? null : score(s.answerF1),
      `${s.citationCounts.raw}/${s.citationCounts.unique}`,
      (Object.keys(s.citationCounts.byOutcome) as Array<keyof OutcomeCounts>)
        .filter((member) => s.citationCounts.byOutcome[member] > 0)
        .map((member) => `${OUTCOME_LABEL[member]}×${s.citationCounts.byOutcome[member]}`)
        .join(', ') || '—',
      s.abstention.correct ? 'correct' : '**wrong**',
    ]),
  }));
  lines.push('');
  lines.push('## Terminal outcome census over every scripted scenario');
  lines.push('');
  lines.push(table({
    head: ['outcome', 'count'],
    rows: (Object.keys(report.summary.outcomes) as Array<keyof OutcomeCounts>)
      .map((member) => [OUTCOME_LABEL[member], report.summary.outcomes[member]]),
  }));
  lines.push('');
  lines.push(`${report.summary.wrongAbstentions} scripted scenario(s) abstain wrongly or answer an unanswerable question; both stay counted rather than folded into a mean.`);
  lines.push('');
  if (live !== null) lines.push(...renderLiveSection(live));
  if (web !== null) lines.push(...renderWebSection(web));
  lines.push('## Reproduction');
  lines.push('');
  lines.push('```');
  lines.push('npm run benchmark:grounding');
  lines.push('```');
  lines.push('');
  lines.push('The keyless tier is clock-free and network-free: two runs produce byte-identical JSON and Markdown. `--live` prints a frozen credential-free dry plan and spends nothing; only `--live --authorize <plan-id>` executes it, replaying what the wire cache already holds. The six RFC 9110 questions in the fixture belong to the separate optional web diagnostic and enter none of the counts above.');
  return lines.join('\n');
}

function renderLiveSection(live: import('./grounding.types.ts').GroundingLive): string[] {
  const lines: string[] = [];
  const runRow = (live.configIdentities as { rows?: Array<{ identityStatus: string, identityId?: string }> }).rows?.find((row) => row.identityStatus === 'run');
  lines.push(`## The paired baseline — ${live.generated.tier} attempt, ${live.generated.at}`);
  lines.push('');
  lines.push(`- report \`${live.reportId}\` · plan \`${live.plan.planId}\` · registration \`${live.registration.registrationId}\``);
  lines.push(`- stack: ${live.generated.provider} \`${live.generated.model}\` · embeddings \`${live.generated.embedder.model}\` (${live.generated.embedder.dims} dims) · thinking ${live.generated.thinking} · config identity \`${runRow?.identityId ?? '(none)'}\``);
  lines.push(`- treatment: recursive ${live.registration.retrieval.maxTokens}/${live.registration.retrieval.overlapTokens}, k=${live.registration.retrieval.k}, minScore=${live.registration.retrieval.minScore}, maxPerSource=${live.registration.retrieval.maxPerSource}, neighbours=${live.registration.retrieval.neighbours}; the only difference between the generated rows is the supplied evidence`);
  lines.push(`- spend: ${live.spent.turns} wire calls · ${live.spent.tokens} provider-reported tokens · ${live.replayed} chat replays · ${live.embedding.requests} embedding requests (${live.embedding.cached} texts from the cache) · ${live.errors.count} wire errors`);
  lines.push('');
  for (const stratum of live.strata) {
    lines.push(stratum.key === 'fixture'
      ? '### Fixture stratum — the gate corpus (16 questions, 24 expected material claims)'
      : '### LoCoMo stratum — separately labelled external-validity DIAGNOSTIC (no material-claim score exists here)');
    lines.push('');
    lines.push(table({
      head: ['row', 'answered', 'claim TP/FP/FN', 'micro F1', 'mean F1', 'answer F1', 'abstention', 'cite resolve/support', 'cited recall', 'retr/sup recall', 'prompt chars (dupes)', 'calls', 'tokens', 'replayed', 'p50/p95 ms'],
      rows: stratum.rows.map((row) => [
        row.key,
        `${row.questions.answered}/${row.questions.planned}${row.questions.invalid > 0 ? ` (${row.questions.invalid} invalid)` : ''}${row.questions.unanswered.wire + row.questions.unanswered.budget > 0 ? ` (${row.questions.unanswered.wire} wire, ${row.questions.unanswered.budget} budget lost)` : ''}`,
        row.claims === null ? null : `${row.claims.tp}/${row.claims.fp}/${row.claims.fn}`,
        row.claims === null ? null : score(row.claims.microF1),
        row.claims === null ? null : score(row.claims.meanF1),
        row.answerF1 === null ? null : score(row.answerF1),
        row.abstention === null || row.abstention.accuracy === null ? null : pct(row.abstention.accuracy),
        row.citations === null || row.citations.unique === 0 ? null : `${score(row.citations.resolvedUnique / row.citations.unique)}/${row.citations.resolvedUnique === 0 ? '—' : score(row.citations.supportingUnique / row.citations.resolvedUnique)}`,
        row.citedRecall === null ? null : score(row.citedRecall),
        row.retrievedRecall === null ? null : `${score(row.retrievedRecall)}/${row.suppliedRecall === null ? '—' : score(row.suppliedRecall)}`,
        row.supply === null ? null : `${row.supply.characters} (${row.supply.duplicateExpansions})`,
        row.cost === null ? null : row.cost.turns,
        row.cost === null ? null : row.cost.tokens,
        row.cost === null ? null : row.cost.replayed,
        row.latency === null || row.latency.medianMs === null ? null : `${row.latency.medianMs.toFixed(0)}/${(row.latency.p95Ms ?? 0).toFixed(0)}`,
      ]),
    }));
    lines.push('');
    if (stratum.pairing.eligible) {
      for (const comparison of stratum.pairing.comparisons) {
        lines.push(`- **${comparison.metric}** (grounded − no-documents, ${comparison.pairs} pairs): mean ${comparison.mean.toFixed(4)}, two-sided 95% [${comparison.interval.low.toFixed(4)}, ${comparison.interval.high.toFixed(4)}], one-sided 95% lower bound ${comparison.oneSidedLowerBound.toFixed(4)}; no effect larger than ${comparison.power.minimumDetectableEffect.toFixed(4)} was detectable (paired SD ${comparison.power.pairedSd.toFixed(4)}, ${comparison.power.tiedPairs} tied pairs).`);
      }
      const grounded = stratum.rows.find((row) => row.key === 'grounded-answer');
      if (grounded?.citations != null) {
        const forbidden = grounded.citations.byOutcome.notSupplied + grounded.citations.byOutcome.inactiveVersion + grounded.citations.byOutcome.futureEvidence + grounded.citations.byOutcome.unknownEvidence;
        lines.push(`- grounded-row citation outcomes: supporting ${grounded.citations.byOutcome.supporting}, resolved-not-supporting ${grounded.citations.byOutcome.resolvedNotSupporting}, not-supplied ${grounded.citations.byOutcome.notSupplied}, inactive-version ${grounded.citations.byOutcome.inactiveVersion}, future-evidence ${grounded.citations.byOutcome.futureEvidence}, unknown-evidence ${grounded.citations.byOutcome.unknownEvidence} — ${forbidden} forbidden outcome(s).`);
      }
    } else {
      lines.push(`- the paired comparison is **not eligible**: ${stratum.pairing.reasons.map((reason) => `${reason.code} (${reason.detail})`).join('; ')}. No mean is published over an unequal denominator.`);
    }
    lines.push('');
  }
  if (live.locomoSkipped !== null) {
    lines.push(`The LoCoMo stratum was skipped: ${live.locomoSkipped}.`);
    lines.push('');
  }
  lines.push(`Product decision recorded on this attempt: **${live.decision.state}** — ${live.decision.reason}`);
  lines.push('');
  return lines;
}

function renderWebSection(web: import('./grounding.types.ts').GroundingWeb): string[] {
  const lines: string[] = [];
  lines.push('## The optional web diagnostic — dated, separate from the flat gate, never an input to the product decision');
  lines.push('');
  if (web.notRun !== null) {
    lines.push(`**Not run** — ${web.notRun}. The stated absence is the record; the flat baseline above is unaffected.`);
    lines.push('');
    return lines;
  }
  lines.push(`- report \`${web.reportId}\` · registration \`${web.registration.registrationId}\` · ${web.generated.tier} attempt, ${web.generated.at}`);
  lines.push(`- linked flat baseline: report \`${web.baseline.reportId ?? '(none recorded)'}\``);
  lines.push(`- captures: ${web.capture.captures} recorded, ${web.capture.replayHits} replayed, ${web.capture.replayMisses} replay misses; only manifests and byte hashes leave the gitignored cache`);
  lines.push('');
  lines.push(table({
    head: ['row', 'answered', 'answer F1', 'cite resolve', 'sources/chunks', 'prompt chars', 'calls', 'tokens', 'p50/p95 ms'],
    rows: web.rows.map((row) => [
      row.key,
      `${row.questions.answered}/${row.questions.planned}${row.questions.invalid > 0 ? ` (${row.questions.invalid} invalid)` : ''}`,
      row.answerF1 === null ? null : score(row.answerF1),
      row.citations === null || row.citations.unique === 0 ? null : score(row.citations.resolvedUnique / row.citations.unique),
      `${row.corpus.sources}/${row.corpus.chunks}`,
      row.supply === null ? null : row.supply.characters,
      row.cost === null ? null : row.cost.turns,
      row.cost === null ? null : row.cost.tokens,
      row.latency === null || row.latency.medianMs === null ? null : `${row.latency.medianMs.toFixed(0)}/${(row.latency.p95Ms ?? 0).toFixed(0)}`,
    ]),
  }));
  lines.push('');
  lines.push('Search snippets are discovery output and appear in no evidence block; no oracle exists on the open web, so a resolvable citation is at most `resolved-not-supporting` here and the material-claim score deliberately does not exist.');
  lines.push('');
  return lines;
}
