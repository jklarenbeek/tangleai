/**
 * The captured SearxNG/document-ingestion diagnostic — the shipped
 * discovery path against a directly curated source, dated, replayable,
 * and never the gate.
 *
 * The selection rule is fixed data: for each of the six registered RFC
 * 9110 questions the query is sent to the configured SearxNG client,
 * result ORDER is kept, and at most the first three distinct normalized
 * HTTP(S) URLs are selected under the existing URL policy — no learned
 * selector, no authority boost, and a later URL is never promoted past
 * a refused earlier one. `SearxngResult.content` is discovery output:
 * it is counted and never serialized into an evidence block, a support
 * set or a citation target.
 *
 * Acquisition runs the shipped path end to end: selected URLs are
 * deduplicated across queries (every question→rank→URL selection edge
 * retained), ingested through `DocumentIngester.ingestMany` — the
 * suite-mapped bounded batch — into a real store, and only successfully
 * fetched/extracted/activated chunks reach the same retriever, prompt
 * serializer and structured-output answerer the flat baseline measured.
 * Every search, fetch, redirect, refusal, extraction and model attempt
 * is a counted value.
 *
 * All HTTP crosses the injected capture adapter (`http-capture.ts`):
 * a capture run records exact bytes; a replay run serves them with ZERO
 * network calls, and a missing capture is a named failure. The scripted
 * capture/replay proof closes the order without internet; the real
 * `--web-live` row is optional, separately authorized, and its absence
 * is a schema-valid stated `notRun` — never a CI failure and never a
 * member of the flat denominator.
 */

import { createBudgetAccount } from '@tangleai/agents/recursive';
import { createStructuredOutput } from '@tangleai/models/structured';
import type { Embedder } from '@tangleai/models/embed';
import { mapConcurrent } from '@jarenjs/core/async';
import { excerpt } from '@jarenjs/core/chunk';
import { mean as meanOf } from '@jarenjs/core/stats';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { RunIdentity } from '@tangleai/config';
import { createSearxngClient, type SearxngResult } from '@tangleai/search';
import {
  SafeStaticFetcher,
  createDocumentIngester,
  normalizeUrl,
  type AddressLookup,
  type EmbeddedBy,
} from '@tangleai/documents';
import { createDocumentStore, openTangleDb, type TangleDb } from '@tangleai/store';
import { nodeDriver } from '@jarenjs/db/node';

import { collectDocumentEvidence, GROUNDING_DEFAULTS } from '../../apps/desktop/src/grounding.ts';
import type { ChatClient } from '../../apps/desktop/src/settings.ts';
import {
  GROUNDED_ANSWER_SCHEMA,
  loadGroundingFixture,
  renderAnswer,
  type EvidenceChunk,
  type EvidenceCorpus,
} from './grounding.ts';
import {
  BudgetStop,
  GROUNDING_ANSWER_PROMPT,
  emptyEvidenceContext,
  emptyTally,
  groundingMessages,
  meter,
  type Account,
  type FetchCounts,
} from './grounding-run.ts';
import type { GroundingWeb, LiveQuestionResult, WebRow, WebSelection } from './grounding.types.ts';
import { f1Score } from './locomo-parity.ts';
import { latency as latencyOf } from './stats.ts';
import { analyticEnvelope, runEnvelope } from './report-envelope.ts';
import type { HttpCapture } from './http-capture.ts';

export type { GroundingWeb };

/** The registered selection rule — the schema's exact constants. */
export const WEB_SELECTION = {
  maxPerQuery: 3,
  policy: 'the first distinct normalized HTTP(S) URLs in SearxNG result order after existing URL policy; no learned selector, no authority boost; snippets are never evidence',
} as const;

/**
 * One query's selection: result order kept, refusals named, scanning
 * stopping once the quota is filled so a later URL can never be
 * promoted past a refused earlier one.
 */
export function selectUrls(question: string, query: string, results: readonly SearxngResult[]): WebSelection {
  const selected: Array<{ rank: number, url: string }> = [];
  const refused: Array<{ rank: number, url: string, reason: string }> = [];
  const seen = new Set<string>();
  let resultsWithSnippets = 0;
  for (const [rank, result] of results.entries()) {
    if (result.content !== undefined && result.content !== '') resultsWithSnippets++;
    if (selected.length >= WEB_SELECTION.maxPerQuery) continue;
    let normalized: string;
    try {
      normalized = normalizeUrl(result.url);
    } catch (error) {
      refused.push({ rank, url: result.url, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push({ rank, url: normalized });
  }
  return { question, query, results: results.length, resultsWithSnippets, selected, refused };
}

export interface WebRunOptions {
  tier: 'scripted' | 'paid';
  provider: string;
  model: string;
  keySource: string | null;
  thinking: 'off' | 'default';
  chat: ChatClient;
  embedder: Embedder;
  /** The capture adapter every HTTP crosses; also the manifest source. */
  capture: HttpCapture;
  /** Whether this run replays captures (zero network) or records them. */
  replay: boolean;
  /** The SearxNG base, credential-free; the client's transport is the capture's. */
  searxBase: string;
  /** DNS injection for the safe fetcher — a replay must not resolve names. */
  lookup: AddressLookup;
  /** Linked flat baseline identities, or nulls when none is recorded. */
  baseline: { reportId: string | null, registrationId: string | null };
  maxCalls: number;
  concurrency: number;
  configIdentityFor: (observed: { model: string, dims: number }) => Promise<RunIdentity>;
  fetchCounts: FetchCounts;
  clock?: () => Date;
  timer?: () => number;
  onProgress?: (message: string) => void;
  root?: string;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

interface WebCorpus {
  db: TangleDb;
  store: ReturnType<typeof createDocumentStore>;
  corpus: EvidenceCorpus;
  census: WebRow['corpus'];
  ingest: WebRow['ingest'];
  close(): Promise<void>;
}

async function buildWebCorpus(
  urls: readonly string[],
  documentFetch: typeof globalThis.fetch,
  lookup: AddressLookup,
  embedder: Embedder,
): Promise<WebCorpus> {
  const db = await openTangleDb({ driver: nodeDriver() });
  const store = createDocumentStore(db);
  const ingester = createDocumentIngester({
    store,
    embedder,
    fetcher: new SafeStaticFetcher({ fetch: documentFetch, lookup, limits: { respectRobots: false, perHostDelayMs: 0 } }),
  });
  const results = await ingester.ingestMany(urls.map((url) => ({ url, strategy: 'recursive', maxTokens: 450, overlapTokens: 48 })), { concurrency: 3 });
  const ingest: WebRow['ingest'] = results.map((result) => ({
    url: result.url,
    outcome: result.error !== undefined ? 'failed' : result.outcome!.status,
    error: result.error ?? null,
  }));
  const registry = new Map<string, EvidenceChunk>();
  const census = { sources: 0, versions: 0, chunks: 0, elements: 0, embeddingCalls: 0 };
  for (const result of results) {
    if (result.error !== undefined) continue;
    census.sources++;
    census.versions++;
    census.embeddingCalls += result.outcome!.version.metrics.embeddingCalls;
    const versionId = result.outcome!.version.id;
    census.elements += (await store.listElements(versionId)).length;
    for (const chunk of await store.listChunks(versionId)) {
      census.chunks++;
      registry.set(chunk.id, { id: chunk.id, version: versionId, status: 'active', admittedAt: EPOCH, elements: new Set(chunk.elementIds) });
    }
  }
  return { db, store, corpus: { chunk: (id) => registry.get(id) }, census, ingest, close: () => db.close() };
}

function outcomeMember(outcome: string): keyof NonNullable<WebRow['citations']>['byOutcome'] {
  switch (outcome) {
    case 'supporting': return 'supporting';
    case 'resolved-not-supporting': return 'resolvedNotSupporting';
    case 'not-supplied': return 'notSupplied';
    case 'inactive-version': return 'inactiveVersion';
    case 'future-evidence': return 'futureEvidence';
    default: return 'unknownEvidence';
  }
}

/**
 * Run the diagnostic: six registered questions, the curated source
 * against Searx discovery, everything through the capture transport.
 */
export async function runGroundingWeb(options: WebRunOptions): Promise<GroundingWeb> {
  const clock = options.clock ?? ((): Date => new Date());
  const timer = options.timer ?? ((): number => performance.now());
  const progress = options.onProgress ?? ((): void => {});
  const root = options.root ?? process.cwd();
  const loaded = await loadGroundingFixture(root);
  const questions = loaded.fixture.rfc9110.questions;
  const curatedUrl = loaded.fixture.rfc9110.url;

  const registrationBody = {
    questions,
    curatedUrl,
    searxBase: options.searxBase,
    selection: { maxPerQuery: WEB_SELECTION.maxPerQuery, policy: WEB_SELECTION.policy },
    retrieval: {
      chunkerVersion: 'heading-recursive/1' as const,
      maxTokens: 450 as const,
      overlapTokens: 48 as const,
      k: GROUNDING_DEFAULTS.k,
      minScore: GROUNDING_DEFAULTS.minScore,
      maxPerSource: GROUNDING_DEFAULTS.maxPerSource,
      neighbours: GROUNDING_DEFAULTS.neighbours,
    },
    promptRevision: await canonicalSha256({ prompt: GROUNDING_ANSWER_PROMPT }),
    maxRepairs: 1 as const,
    concurrency: options.concurrency,
  };
  const registration: GroundingWeb['registration'] = {
    registrationId: await canonicalSha256({ ...registrationBody, baseline: options.baseline }),
    ...registrationBody,
  };

  const searxFetch = options.capture.fetchFor('searxng', { replay: options.replay });
  const documentFetch = options.capture.fetchFor('document', { replay: options.replay });
  const searx = createSearxngClient({ baseUrl: options.searxBase, fetch: searxFetch });

  // --- discovery: order kept, refusals named, snippets only counted
  const selection: WebSelection[] = [];
  for (const question of questions) {
    let results: SearxngResult[] = [];
    try {
      results = (await searx.search(question.text)).results;
    } catch (error) {
      progress(`search ${question.key}: ${error instanceof Error ? error.message : String(error)} (captured as a failure)`);
    }
    const picked = selectUrls(question.key, question.text, results);
    selection.push(picked);
    progress(`search ${question.key}: ${picked.results} results, ${picked.selected.length} selected, ${picked.refused.length} refused`);
  }
  const discovered: string[] = [];
  const seen = new Set<string>();
  for (const entry of selection) {
    for (const pick of entry.selected) {
      if (seen.has(pick.url)) continue;
      seen.add(pick.url);
      discovered.push(pick.url);
    }
  }

  const shared: Account = { account: createBudgetAccount({ turns: options.maxCalls }, timer), timer };
  const errors: string[] = [];
  const noteError = (message: string): void => { if (errors.length < 10) errors.push(excerpt(message, 160)); };

  const rows: WebRow[] = [];
  let observedDims = options.embedder.dims ?? 0;
  for (const row of [
    { key: 'curated-rfc' as const, urls: [curatedUrl] },
    { key: 'searx-discovered' as const, urls: discovered },
  ]) {
    const corpus = await buildWebCorpus(row.urls, documentFetch, options.lookup, options.embedder);
    try {
      const cost = emptyTally();
      const latencies: number[] = [];
      const byOutcome = { supporting: 0, resolvedNotSupporting: 0, notSupplied: 0, inactiveVersion: 0, futureEvidence: 0, unknownEvidence: 0 };
      const citationSums = { raw: 0, unique: 0, resolvedUnique: 0, supportingUnique: 0 };
      const supply = { candidates: 0, blocks: 0, uniqueSupplied: 0, duplicateExpansions: 0, characters: 0, estimatedTokens: 0 };
      const answerF1s: number[] = [];
      const results: LiveQuestionResult[] = new Array(questions.length);

      await mapConcurrent(questions, options.concurrency, async (question, index) => {
        const [vector] = await options.embedder.embed([question.text]);
        if (observedDims === 0) observedDims = vector.length;
        const identity: EmbeddedBy = { model: options.embedder.model, dims: vector.length };
        const outcome = await collectDocumentEvidence(corpus.store, vector, identity, GROUNDING_DEFAULTS);
        const evidence = outcome.ok ? outcome.evidence : null;
        if (!outcome.ok) noteError(`${question.key} retrieval: ${outcome.error.code} ${outcome.error.message}`);
        const base = {
          id: question.key,
          category: null,
          trace: evidence === null ? null : {
            retrieved: evidence.ranked.map((item) => item.chunk.id),
            supplied: [...evidence.suppliedChunkIds],
            blocks: evidence.blocks.length,
            uniqueSupplied: evidence.suppliedChunkIds.length,
            duplicateExpansions: evidence.duplicateExpansions,
            characters: evidence.characters,
            estimatedTokens: evidence.estimatedTokens,
          },
          retrievedRecall: null,
          suppliedRecall: null,
          claims: null,
          abstention: null,
          citedRecall: null,
        };
        const mine = emptyTally();
        const generator = createStructuredOutput({
          client: meter(options.chat, shared, [cost, mine], latencies),
          schema: GROUNDED_ANSWER_SCHEMA,
          name: 'grounding_answer',
          maxRepairs: 1,
        });
        let reply: { value: import('./grounding.ts').AnswerValue } | { errors: unknown[], raw: string };
        try {
          reply = await generator.generate(groundingMessages(question.text, evidence === null ? emptyEvidenceContext() : evidence.context)) as typeof reply;
        } catch (error) {
          const budget = error instanceof BudgetStop;
          if (!budget) noteError(`${question.key}: ${error instanceof Error ? error.message : String(error)}`);
          results[index] = { ...base, status: budget ? 'budget-stop' : 'wire-failure', answer: null, rendered: null, citations: [], citationCounts: null, answerF1: null, tokens: mine.tokens, ms: mine.ms, replayed: mine.replayed, attempts: mine.turns };
          return;
        }
        if (!('value' in reply)) {
          results[index] = { ...base, status: 'invalid', answer: null, rendered: excerpt(reply.raw, 400), citations: [], citationCounts: null, answerF1: null, tokens: mine.tokens, ms: mine.ms, replayed: mine.replayed, attempts: mine.turns };
          return;
        }
        const answer = reply.value;
        const rendered = renderAnswer(answer);
        const supplied = new Set(evidence?.suppliedChunkIds ?? []);
        const records: LiveQuestionResult['citations'] = [];
        const idsSeen = new Map<string, Set<string>>();
        if (answer.disposition === 'answer') {
          for (const claim of answer.claims) {
            for (const citation of claim.citations) {
              // no oracle exists on the open web: a resolvable eligible
              // citation is at most resolved-not-supporting, and the walk
              // still refuses unknown and unsupplied ids
              const chunk = corpus.corpus.chunk(citation);
              const outcome2 = chunk === undefined ? 'unknown-evidence' : !supplied.has(citation) ? 'not-supplied' : 'resolved-not-supporting';
              records.push({ claimId: claim.id, citation, outcome: outcome2 });
              const set = idsSeen.get(citation) ?? new Set<string>();
              set.add(outcome2);
              idsSeen.set(citation, set);
            }
          }
        }
        for (const record of records) byOutcome[outcomeMember(record.outcome)]++;
        const resolvedUnique = [...idsSeen.values()].filter((set) => set.has('resolved-not-supporting')).length;
        citationSums.raw += records.length;
        citationSums.unique += idsSeen.size;
        citationSums.resolvedUnique += resolvedUnique;
        const f1 = f1Score(rendered, question.reference);
        answerF1s.push(f1);
        if (base.trace !== null) {
          supply.candidates += base.trace.retrieved.length;
          supply.blocks += base.trace.blocks;
          supply.uniqueSupplied += base.trace.uniqueSupplied;
          supply.duplicateExpansions += base.trace.duplicateExpansions;
          supply.characters += base.trace.characters;
          supply.estimatedTokens += base.trace.estimatedTokens;
        }
        results[index] = {
          ...base,
          status: 'answered',
          answer,
          rendered,
          citations: records,
          citationCounts: {
            raw: records.length,
            unique: idsSeen.size,
            resolvedUnique,
            supportingUnique: 0,
            byOutcome: { ...byOutcome },
          },
          answerF1: f1,
          tokens: mine.tokens,
          ms: mine.ms,
          replayed: mine.replayed,
          attempts: mine.turns,
        };
      });

      // per-question byOutcome snapshots above accumulate; rebuild each
      // result's own counts from its records so the rows stay per-question
      for (const result of results) {
        if (result.citationCounts === null) continue;
        const own = { supporting: 0, resolvedNotSupporting: 0, notSupplied: 0, inactiveVersion: 0, futureEvidence: 0, unknownEvidence: 0 };
        for (const record of result.citations) own[outcomeMember(record.outcome)]++;
        result.citationCounts = { ...result.citationCounts, byOutcome: own };
      }

      const answered = results.filter((r) => r.status === 'answered');
      rows.push({
        key: row.key,
        questionSet: await canonicalSha256(answered.map((r) => r.id).sort()),
        questions: {
          planned: results.length,
          answered: answered.length,
          unanswered: {
            wire: results.filter((r) => r.status === 'wire-failure').length,
            budget: results.filter((r) => r.status === 'budget-stop').length,
          },
          invalid: results.filter((r) => r.status === 'invalid').length,
          results,
        },
        answerF1: answerF1s.length === 0 ? null : (meanOf(answerF1s) ?? null),
        citations: { ...citationSums, byOutcome },
        supply,
        corpus: corpus.census,
        ingest: corpus.ingest,
        cost: { ...cost },
        latency: latencyOf(latencies),
      });
      progress(`${row.key}: ${corpus.census.chunks} chunks from ${corpus.census.sources} sources; answered ${answered.length}/${results.length}`);
    } finally {
      await corpus.close();
    }
  }

  const runIdentity = await options.configIdentityFor({ model: options.embedder.model, dims: observedDims });
  const envelope = runEnvelope([runIdentity], rows.map((row) => ({ rowId: row.key, identityId: runIdentity.identityId })));
  const captureStats = options.capture.stats();
  const report: Omit<GroundingWeb, 'reportId'> = {
    document: 'grounding-web',
    benchmark: 'grounding',
    instrument: { entry: 'benchmark/grounding.ts' },
    configIdentities: envelope as unknown as GroundingWeb['configIdentities'],
    generated: {
      at: clock().toISOString(),
      tier: options.tier,
      provider: options.provider,
      model: options.model,
      embedder: { model: options.embedder.model, dims: observedDims },
      keySource: options.keySource,
      thinking: options.thinking,
    },
    baseline: options.baseline,
    registration,
    source: loaded.source,
    capture: {
      manifest: await options.capture.manifest(),
      captures: captureStats.captures,
      replayHits: captureStats.replayHits,
      replayMisses: captureStats.replayMisses,
    },
    selection,
    rows,
    notRun: null,
  };
  return { ...report, reportId: await webReportIdOf(report) };
}

/** A schema-valid stated absence: the diagnostic did not run, and why. */
export async function notRunGroundingWeb(reason: string, options: { clock?: () => Date, root?: string } = {}): Promise<GroundingWeb> {
  const clock = options.clock ?? ((): Date => new Date());
  const loaded = await loadGroundingFixture(options.root ?? process.cwd());
  const registrationBody = {
    questions: loaded.fixture.rfc9110.questions,
    curatedUrl: loaded.fixture.rfc9110.url,
    searxBase: null,
    selection: { maxPerQuery: WEB_SELECTION.maxPerQuery, policy: WEB_SELECTION.policy },
    retrieval: {
      chunkerVersion: 'heading-recursive/1' as const,
      maxTokens: 450 as const,
      overlapTokens: 48 as const,
      k: GROUNDING_DEFAULTS.k,
      minScore: GROUNDING_DEFAULTS.minScore,
      maxPerSource: GROUNDING_DEFAULTS.maxPerSource,
      neighbours: GROUNDING_DEFAULTS.neighbours,
    },
    promptRevision: await canonicalSha256({ prompt: GROUNDING_ANSWER_PROMPT }),
    maxRepairs: 1 as const,
    concurrency: 1,
  };
  const report: Omit<GroundingWeb, 'reportId'> = {
    document: 'grounding-web',
    benchmark: 'grounding',
    instrument: { entry: 'benchmark/grounding.ts' },
    configIdentities: analyticEnvelope([]) as unknown as GroundingWeb['configIdentities'],
    generated: {
      at: clock().toISOString(),
      tier: 'scripted',
      provider: 'none',
      model: 'none',
      embedder: { model: 'none', dims: 0 },
      keySource: null,
      thinking: 'default',
    },
    baseline: { reportId: null, registrationId: null },
    registration: { registrationId: await canonicalSha256({ ...registrationBody, baseline: { reportId: null, registrationId: null } }), ...registrationBody },
    source: loaded.source,
    capture: { manifest: [], captures: 0, replayHits: 0, replayMisses: 0 },
    selection: [],
    rows: [],
    notRun: reason,
  };
  return { ...report, reportId: await webReportIdOf(report) };
}

/** The web report's clock/cost-free identity — a byte-identical replay reproduces it. */
export async function webReportIdOf(report: Omit<GroundingWeb, 'reportId'> & { reportId?: string }): Promise<string> {
  return canonicalSha256({
    document: report.document,
    tier: report.generated.tier,
    provider: report.generated.provider,
    model: report.generated.model,
    embedder: report.generated.embedder,
    thinking: report.generated.thinking,
    baseline: report.baseline,
    registration: report.registration,
    source: report.source,
    configIdentities: report.configIdentities,
    capture: {
      manifest: report.capture.manifest,
    },
    selection: report.selection,
    notRun: report.notRun,
    rows: report.rows.map((row) => ({
      key: row.key,
      questionSet: row.questionSet,
      answerF1: row.answerF1,
      citations: row.citations,
      supply: row.supply,
      corpus: row.corpus,
      ingest: row.ingest,
      results: row.questions.results.map((result) => ({
        id: result.id,
        status: result.status,
        trace: result.trace,
        answer: result.answer,
        rendered: result.rendered,
        citations: result.citations,
        answerF1: result.answerF1,
      })),
    })),
  });
}
