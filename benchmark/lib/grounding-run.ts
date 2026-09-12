/**
 * The paired grounding run — two corpora through the current contracts,
 * three registered rows, a frozen dry plan, and one metered attempt.
 *
 * **The corpora are built by the shipped path, never hand-constructed.**
 * The fixture stratum serves the committed source bytes through an
 * injected fetch into the real `createDocumentIngester` at the current
 * recursive defaults (450/48) and a real document store; the superseded
 * relay-history version is ingested first and superseded by its
 * successor exactly as re-ingestion supersedes in production, with its
 * addresses captured for the classifier before activation deletes its
 * chunks. The LoCoMo stratum projects each seeded conversation into one
 * document source whose ordered elements are transcript turns under
 * their scoped dialog addresses, chunked by the same recursive chunker,
 * activated through the same store, retrieved by the same retriever.
 *
 * **Three rows, one treatment.** Per question the current path's
 * retrieval/supply trace is collected ONCE (`collectDocumentEvidence`,
 * the product's own serializer): `documents-retrieved` publishes it as
 * the no-generation ceiling, `grounded-answer` generates over its exact
 * bytes, and `no-documents` generates over the serializer's own empty
 * block. The two generated rows share prompt, schema, repair ceiling,
 * model, concurrency and question ids; the only difference is the
 * evidence. A wire failure, budget stop or invalid reply stays in the
 * attempt as that question's outcome and makes the pair ineligible —
 * never a narrowed mean.
 *
 * **Nothing is spent before the plan is authorized.** The dry plan is
 * computed from a no-embedding corpus walk plus the wire cache's exact
 * per-text hits, hashed into a `planId`, and only an explicit matching
 * authorization executes. Generation runs through the suite's
 * structured output, one budget account, and the suite's bounded
 * mapper; scoring is GROUND-independent pure reuse of the keyless
 * instrument's claim/citation functions.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createBudgetAccount } from '@tangleai/agents/recursive';
import { createStructuredOutput } from '@tangleai/models/structured';
import { resolveEndpoint } from '@tangleai/models/providers';
import type { Embedder } from '@tangleai/models/embed';
import { mapConcurrent } from '@jarenjs/core/async';
import { excerpt } from '@jarenjs/core/chunk';
import { mean as meanOf, stddev } from '@jarenjs/core/stats';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { RunIdentity } from '@tangleai/config';
import {
  RecursiveDocumentChunker,
  SafeStaticFetcher,
  createDocumentIngester,
  extractDocument,
  type DocumentChunk,
  type DocumentCorpusStore,
  type DocumentElement,
  type DocumentSource,
  type DocumentVersion,
  type EmbeddedBy,
} from '@tangleai/documents';
import { createDocumentStore, openTangleDb, type TangleDb } from '@tangleai/store';
import { nodeDriver } from '@jarenjs/db/node';

import { collectDocumentEvidence, GROUNDING_DEFAULTS, serializeDocumentEvidence, type DocumentEvidence } from '../../apps/desktop/src/grounding.ts';
import type { ChatClient } from '../../apps/desktop/src/settings.ts';
import { normalizedWireBase } from '../../apps/desktop/src/ai-host.ts';
import type { AiEnv } from './ai-env.ts';
import {
  GROUNDED_ANSWER_SCHEMA,
  SCORER_REGISTRATION,
  answerSchemaRevision,
  decideGrounding,
  loadGroundingFixture,
  registrationIdOf as keylessRegistrationIdOf,
  scoreAnswer,
  type AnswerValue,
  type EvidenceChunk,
  type EvidenceCorpus,
  type FixtureQuestion,
  type GroundingFixture,
  type LoadedFixture,
} from './grounding.ts';
import type {
  GroundingLive,
  LiveComparison,
  LivePlan,
  LiveQuestionResult,
  LiveRow,
  LiveStratum,
} from './grounding.types.ts';
import { conversationCorpus, type ConversationCorpus } from './locomo-corpus.ts';
import { dateText, questionsOf, sampleQuestions, type QaQuestion } from './locomo-qa.ts';
import { bootstrapInterval } from './locomo-policy.ts';
import { officialScore } from './locomo-parity.ts';
import { evidenceRecall } from './recall.ts';
import { latency as latencyOf, normalQuantile } from './stats.ts';
import { runEnvelope } from './report-envelope.ts';
import type { LocomoSample } from './locomo.ts';
import type { ReplayEndpoint, WireCache } from './wire-cache.ts';

export type { GroundingLive };

/** The LoCoMo stratum's registered draw. */
export const LOCOMO_STRATUM = { seed: 17753, perCategory: 4 } as const;

/** The one answer instruction every row shares — the treatment is the evidence, never the prompt. */
export const GROUNDING_ANSWER_PROMPT = [
  'You answer a question using ONLY the document evidence below.',
  'Each evidence block begins `[id] (score)`; the id inside the square brackets is the evidence id, and the block may span several passages of its source.',
  'Return every factual statement of your answer as one entry in `claims` — one short sentence each — and put the ids of the evidence you actually used in that claim\'s `citations`. Cite only ids listed below.',
  'If the evidence does not contain the answer, return disposition "abstain" with a short reason and no claims. Do not answer from your own knowledge of the world beyond the evidence.',
].join(' ');

/** The messages one question is asked with, on every row. */
export function groundingMessages(question: string, context: string): Array<{ role: string, content: string }> {
  return [
    { role: 'system', content: `${GROUNDING_ANSWER_PROMPT}\n\n${context}` },
    { role: 'user', content: `Question: ${question}` },
  ];
}

/** The serializer's own empty section — what the no-documents row generates under. */
export function emptyEvidenceContext(): string {
  return serializeDocumentEvidence([]).context;
}

function sha256Of(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// the fixture corpus, through the real ingester
// ---------------------------------------------------------------------------

const LOOKUP = async (): Promise<Array<{ address: string, family: number }>> => [{ address: '93.184.216.34', family: 4 }];

export interface BuiltCorpus {
  db: TangleDb;
  store: DocumentCorpusStore;
  corpus: EvidenceCorpus;
  census: { sources: number, versions: number, chunks: number, elements: number, embeddingCalls: number };
  close(): Promise<void>;
}

/**
 * Ingest the committed fixture bytes through the shipped
 * fetch/extract/chunk/embed/store path and register every address —
 * superseded members included — for the citation classifier. Every
 * fixture element quote must map to exactly one ingested element, or
 * the corpus is refused.
 */
export async function buildFixtureCorpus(fixture: GroundingFixture, embedder: Embedder, root = process.cwd()): Promise<BuiltCorpus> {
  const db = await openTangleDb({ driver: nodeDriver() });
  const store = createDocumentStore(db);
  const served = new Map<string, { bytes: Uint8Array, mimeType: string }>();
  let clock = '1970-01-01T00:00:00.000Z';
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const body = served.get(url);
    if (body === undefined) return new Response('not in the fixture', { status: 404 });
    return new Response(body.bytes.slice() as unknown as BodyInit, { status: 200, headers: { 'content-type': body.mimeType } });
  }) as typeof globalThis.fetch;
  const ingester = createDocumentIngester({
    store,
    embedder,
    fetcher: new SafeStaticFetcher({ fetch: fetchImpl, lookup: LOOKUP, limits: { respectRobots: false, perHostDelayMs: 0 }, now: () => clock }),
    now: () => clock,
  });

  const chunks = new Map<string, EvidenceChunk>();
  let versions = 0;
  let chunkCount = 0;
  let elementCount = 0;
  let embeddingCalls = 0;
  for (const source of fixture.sources) {
    for (const version of source.versions) {
      const bytes = await readFile(join(root, `benchmark/fixtures/grounding/${version.file}`));
      served.set(source.url, { bytes, mimeType: source.mimeType });
      clock = version.admittedAt;
      const outcome = await ingester.ingest({ url: source.url, strategy: 'recursive', maxTokens: 450, overlapTokens: 48, force: true });
      versions++;
      embeddingCalls += outcome.version.metrics.embeddingCalls;

      // register this version's addresses BEFORE a successor's activation
      // deletes its rows; status and admission come from the fixture, the
      // ids from what the shipped path actually produced
      const realElements = await store.listElements(outcome.version.id);
      const elementKeyOf = new Map<string, string>();
      for (const declared of fixture.elements.filter((e) => e.version === version.key)) {
        const matches = realElements.filter((e) => e.text.includes(declared.quote));
        if (matches.length !== 1) {
          await db.close();
          throw new Error(`fixture element ${declared.key} maps to ${matches.length} ingested elements of ${version.key}; the oracle needs exactly one`);
        }
        elementKeyOf.set(matches[0].id, declared.key);
      }
      const realChunks = await store.listChunks(outcome.version.id);
      elementCount += realElements.length;
      chunkCount += realChunks.length;
      for (const chunk of realChunks) {
        chunks.set(chunk.id, {
          id: chunk.id,
          version: version.key,
          status: version.status,
          admittedAt: version.admittedAt,
          elements: new Set(chunk.elementIds.map((id) => elementKeyOf.get(id)).filter((key): key is string => key !== undefined)),
        });
      }
    }
  }
  return {
    db,
    store,
    corpus: { chunk: (id) => chunks.get(id) },
    census: { sources: fixture.sources.length, versions, chunks: chunkCount, elements: elementCount, embeddingCalls },
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
// the LoCoMo projection, through the same contracts
// ---------------------------------------------------------------------------

export interface LocomoProjection {
  db: TangleDb;
  /** One store per conversation — a question retrieves only its own transcript. */
  stores: Map<string, DocumentCorpusStore>;
  corpus: EvidenceCorpus;
  census: { sources: number, versions: number, chunks: number, elements: number, embeddingCalls: number };
  close(): Promise<void>;
}

/** One conversation's turns as ordered document elements under their scoped dialog addresses. */
export function locomoElements(corpus: ConversationCorpus, sourceId: string, versionId: string): DocumentElement[] {
  const elements: DocumentElement[] = [];
  let order = 0;
  for (const session of corpus.sessions) {
    for (const input of session.inputs) {
      const speaker = (input.tags ?? []).find((tag) => !tag.startsWith('session:')) ?? '';
      elements.push({
        id: input.evidence,
        sourceId,
        versionId,
        text: `(${dateText(input.at)}) ${speaker === '' ? '' : `${speaker}: `}${input.text}`,
        role: 'paragraph',
        order: order++,
        headingPath: [],
      });
    }
  }
  return elements;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

async function activateLocomoConversation(
  db: TangleDb,
  corpus: ConversationCorpus,
  embedder: Embedder,
): Promise<{ store: DocumentCorpusStore, chunks: DocumentChunk[], elements: DocumentElement[], embeddingCalls: number }> {
  const store = createDocumentStore(db);
  const url = `https://benchmark.tangleai.dev/locomo/${corpus.sampleId}`;
  const sourceId = `src-${sha256Of(url).slice(0, 24)}`;
  const versionId = `ver-${sha256Of(`${sourceId}|turns`).slice(0, 32)}`;
  const elements = locomoElements(corpus, sourceId, versionId);
  const chunker = new RecursiveDocumentChunker({ maxTokens: 450, overlapTokens: 48 });
  const drafts = (await chunker.chunk(elements)).chunks;
  let embeddingCalls = 0;
  const vectors: number[][] = [];
  for (let start = 0; start < drafts.length; start += 32) {
    const batch = drafts.slice(start, start + 32);
    const embedded = await embedder.embed(batch.map((draft) => draft.text));
    vectors.push(...embedded.map((vector) => Array.from(vector)));
    embeddingCalls++;
  }
  const dims = embedder.dims ?? vectors[0]?.length ?? 0;
  const embeddedBy: EmbeddedBy = { model: embedder.model, dims };
  const chunkIds = drafts.map((draft, order) => `chk-${sha256Of(`${versionId}|${order}|${draft.text}`).slice(0, 32)}`);
  const chunks: DocumentChunk[] = drafts.map((draft, order) => ({
    ...draft,
    id: chunkIds[order],
    sourceId,
    versionId,
    previousId: order === 0 ? undefined : chunkIds[order - 1],
    nextId: order + 1 === chunkIds.length ? undefined : chunkIds[order + 1],
    embedding: vectors[order],
    embeddedBy,
  }));
  const version: DocumentVersion = {
    id: versionId,
    sourceId,
    contentHash: sha256Of(elements.map((element) => element.text).join('\n')),
    extractionVersion: 'locomo-turn-projection/1',
    chunkerVersion: chunker.version,
    chunkerConfig: { maxTokens: chunker.maxTokens, overlapTokens: chunker.overlapTokens },
    embeddedBy,
    status: 'staging',
    fetchedAt: EPOCH,
    metrics: {
      bytes: 0, elements: elements.length, chunks: chunks.length,
      extractionMs: 0, chunkingMs: 0, embeddingMs: 0, embeddingCalls,
      estimatedEmbeddingTokens: 0, partial: false, warnings: [],
    },
  };
  const source: DocumentSource = {
    id: sourceId,
    requestedUrl: url,
    finalUrl: url,
    canonicalUrl: url,
    title: corpus.sampleId,
    mimeType: 'text/plain',
    fetchMode: 'static',
    status: 'ready',
    fetchedAt: EPOCH,
    activeVersionId: versionId,
  };
  await store.activate({ source, version, elements, chunks });
  return { store, chunks, elements, embeddingCalls };
}

/** Project every selected conversation through chunker/store/retriever contracts. */
export async function buildLocomoProjection(samples: readonly LocomoSample[], embedder: Embedder): Promise<LocomoProjection> {
  const stores = new Map<string, DocumentCorpusStore>();
  const registry = new Map<string, EvidenceChunk>();
  const dbs: TangleDb[] = [];
  const census = { sources: 0, versions: 0, chunks: 0, elements: 0, embeddingCalls: 0 };
  for (const sample of samples) {
    const corpus = conversationCorpus(sample);
    const db = await openTangleDb({ driver: nodeDriver() });
    dbs.push(db);
    const built = await activateLocomoConversation(db, corpus, embedder);
    stores.set(sample.sample_id, built.store);
    census.sources++;
    census.versions++;
    census.chunks += built.chunks.length;
    census.elements += built.elements.length;
    census.embeddingCalls += built.embeddingCalls;
    for (const chunk of built.chunks) {
      registry.set(chunk.id, { id: chunk.id, version: chunk.versionId, status: 'active', admittedAt: EPOCH, elements: new Set(chunk.elementIds) });
    }
  }
  return {
    db: dbs[0],
    stores,
    corpus: { chunk: (id) => registry.get(id) },
    census,
    close: async () => { for (const db of dbs) await db.close(); },
  };
}

/** The seeded 16-question LoCoMo slice: four per scorable category, release order. */
export function locomoStratumQuestions(samples: readonly LocomoSample[]): QaQuestion[] {
  const all: QaQuestion[] = [];
  for (const sample of samples) all.push(...questionsOf(sample, conversationCorpus(sample)));
  return sampleQuestions(all, { seed: LOCOMO_STRATUM.seed, perCategory: LOCOMO_STRATUM.perCategory, adversarial: 0 })
    .filter((q) => q.category !== 5);
}

// ---------------------------------------------------------------------------
// the plan — frozen, credential-free, authorized or nothing
// ---------------------------------------------------------------------------

/** The credential-free wire the plan freezes; only variable NAMES, never values. */
export interface WireDescriptor {
  provider: string;
  base: string | null;
  model: string;
  embedModel: string | null;
  keySource: string | null;
  thinking: 'off' | 'default';
  maxCalls: number;
  maxConcurrency: number;
}

export function wireDescriptorOf(env: AiEnv, thinking: 'off' | 'default'): WireDescriptor {
  return {
    provider: env.provider,
    base: normalizedWireBase(env.provider, env.baseUrl),
    model: env.model,
    embedModel: env.embedModel === '' ? null : env.embedModel,
    keySource: env.keySource,
    thinking,
    maxCalls: env.maxCalls,
    maxConcurrency: env.maxConcurrency,
  };
}

export interface PlanContext {
  loaded: LoadedFixture;
  registration: GroundingLive['registration'];
  locomoRegistration: GroundingLive['locomoRegistration'];
  locomoSkipped: string | null;
  locomoSamples: LocomoSample[];
  locomoQuestions: QaQuestion[];
  wire: WireDescriptor;
  plan: LivePlan;
}

export interface PlanOptions {
  env: AiEnv;
  thinking: 'off' | 'default';
  cache?: WireCache;
  fresh?: boolean;
  /** The LoCoMo release, or null with the stated reason. */
  locomo: { samples: LocomoSample[], sha256: string } | null;
  locomoSkipReason?: string;
  root?: string;
}

/**
 * Every embedding request a run can make, batch by batch, exactly as the
 * run makes them: the ingester embeds each version's chunk texts in
 * batches of 32, the LoCoMo projection does the same per conversation,
 * and each question is embedded alone. A batch whose texts the cache all
 * holds costs zero requests; a batch with one miss costs one.
 */
async function plannedBatches(fixture: GroundingFixture, locomoSamples: readonly LocomoSample[], questions: { fixture: readonly FixtureQuestion[], locomo: readonly QaQuestion[] }, root: string): Promise<string[][]> {
  const batches: string[][] = [];
  const slice = (texts: readonly string[]): void => {
    for (let start = 0; start < texts.length; start += 32) batches.push(texts.slice(start, start + 32));
  };
  for (const source of fixture.sources) {
    for (const version of source.versions) {
      const bytes = await readFile(join(root, `benchmark/fixtures/grounding/${version.file}`));
      const extracted = await extractDocument(new Uint8Array(bytes), { mimeType: source.mimeType, url: source.url });
      const elements: DocumentElement[] = extracted.elements.map((element, order) => ({
        ...element, id: `dry-${order}`, sourceId: 'dry', versionId: 'dry', order,
      }));
      const chunked = await new RecursiveDocumentChunker({ maxTokens: 450, overlapTokens: 48 }).chunk(elements);
      slice(chunked.chunks.map((chunk) => chunk.text));
    }
  }
  for (const sample of locomoSamples) {
    const corpus = conversationCorpus(sample);
    const elements = locomoElements(corpus, 'dry', 'dry');
    const chunked = await new RecursiveDocumentChunker({ maxTokens: 450, overlapTokens: 48 }).chunk(elements);
    slice(chunked.chunks.map((chunk) => chunk.text));
  }
  for (const q of questions.fixture) batches.push([q.text]);
  for (const q of questions.locomo) batches.push([q.text]);
  return batches;
}

/**
 * Compute the frozen dry plan: zero embedding calls, zero chat calls,
 * exact cache hits, exact maximum fresh calls. The `planId` covers the
 * registered inputs and ceilings; the operator authorizes exactly it.
 */
export async function planGroundingLive(options: PlanOptions): Promise<PlanContext> {
  const root = options.root ?? process.cwd();
  const loaded = await loadGroundingFixture(root);
  const { fixture } = loaded;
  const wire = wireDescriptorOf(options.env, options.thinking);
  const fresh = options.fresh === true;

  const locomoSamples = options.locomo === null ? [] : options.locomo.samples;
  const locomoQuestions = options.locomo === null ? [] : locomoStratumQuestions(locomoSamples);
  const selectedSampleIds = new Set(locomoQuestions.map((q) => q.sampleId));
  const selectedSamples = locomoSamples.filter((s) => selectedSampleIds.has(s.sample_id));
  const locomoRegistration: GroundingLive['locomoRegistration'] = options.locomo === null ? null : {
    seed: LOCOMO_STRATUM.seed,
    perCategory: LOCOMO_STRATUM.perCategory,
    questionIds: locomoQuestions.map((q) => q.id),
    datasetSha256: options.locomo.sha256,
  };
  const locomoSkipped = options.locomo === null
    ? (options.locomoSkipReason ?? 'the LoCoMo submodule is absent; the external-validity stratum is skipped with this stated reason')
    : null;

  const keylessBody = {
    fixtureId: loaded.fixtureId,
    cutoff: fixture.cutoff,
    questionIds: fixture.questions.map((q) => q.key),
    claimKeys: fixture.claims.map((c) => c.key),
    scorer: { ...SCORER_REGISTRATION, outcomes: [...SCORER_REGISTRATION.outcomes] },
    answerSchemaRevision: await answerSchemaRevision(),
  };
  const registration: GroundingLive['registration'] = {
    ...keylessBody,
    registrationId: '',
    retrieval: {
      chunkerVersion: 'heading-recursive/1',
      maxTokens: 450,
      overlapTokens: 48,
      k: GROUNDING_DEFAULTS.k,
      minScore: GROUNDING_DEFAULTS.minScore,
      maxPerSource: GROUNDING_DEFAULTS.maxPerSource,
      neighbours: GROUNDING_DEFAULTS.neighbours,
    },
    promptRevision: await canonicalSha256({ prompt: GROUNDING_ANSWER_PROMPT }),
    maxRepairs: 1,
    concurrency: options.env.maxConcurrency,
    seed: 17753,
  };
  registration.registrationId = await canonicalSha256({
    keyless: await keylessRegistrationIdOf(keylessBody),
    retrieval: registration.retrieval,
    promptRevision: registration.promptRevision,
    maxRepairs: registration.maxRepairs,
    seed: registration.seed,
  });

  const isWire = options.env.embedModel !== '';
  const batches = await plannedBatches(fixture, selectedSamples, { fixture: fixture.questions, locomo: locomoQuestions }, root);
  const texts = [...new Set(batches.flat())];
  const known = new Set<string>();
  if (isWire && options.cache !== undefined && !fresh) {
    const resolved = resolveEndpoint({ provider: options.env.provider, baseUrl: options.env.baseUrl ?? undefined, model: options.env.embedModel });
    const endpoint: ReplayEndpoint = { provider: resolved.provider, base: resolved.base, model: options.env.embedModel };
    const hits = await options.cache.embeddingHits(endpoint, texts);
    texts.forEach((text, index) => { if (hits[index] !== undefined) known.add(text); });
  }
  const cacheHits = isWire ? known.size : 0;
  const cacheMisses = isWire ? texts.length - cacheHits : 0;
  // a batch already answered in full by the cache makes no request; a text
  // bought earlier in the same run is cached for its later batches too
  const bought = new Set(known);
  let maxFreshRequests = 0;
  if (isWire) {
    for (const batch of batches) {
      if (batch.some((text) => !bought.has(text))) {
        maxFreshRequests++;
        for (const text of batch) bought.add(text);
      }
    }
  }
  const generatedQuestions = fixture.questions.length + locomoQuestions.length;
  const chatPlanned = generatedQuestions * 2;
  const chat = { planned: chatPlanned, maxRepairs: 1, maxFreshCalls: chatPlanned * 2 };
  const embedding = {
    texts: texts.length,
    cacheHits,
    cacheMisses,
    maxFreshRequests,
  };
  const maxFreshTotal = embedding.maxFreshRequests + chat.maxFreshCalls;
  const skipped = maxFreshTotal > options.env.maxCalls
    ? `${maxFreshTotal} maximum fresh requests exceed TANGLE_AI_MAX_CALLS=${options.env.maxCalls}; nothing was spent`
    : null;
  const planId = await canonicalSha256({
    registrationId: registration.registrationId,
    locomoRegistration,
    source: loaded.source.sha256,
    wire,
    embedding,
    chat,
    maxFreshTotal,
    maxCalls: options.env.maxCalls,
    concurrency: options.env.maxConcurrency,
    fresh,
  });
  return {
    loaded,
    registration,
    locomoRegistration,
    locomoSkipped,
    locomoSamples: selectedSamples,
    locomoQuestions,
    wire,
    plan: {
      planId,
      authorized: false,
      fresh,
      embedding,
      chat,
      maxFreshTotal,
      maxCalls: options.env.maxCalls,
      concurrency: options.env.maxConcurrency,
      skipped,
    },
  };
}

/** What an authorization argument means against a frozen plan — the one rule the CLI applies. */
export function authorizationOf(plan: LivePlan, authorize: string | undefined): 'skipped' | 'dry-run' | 'refused' | 'execute' {
  if (plan.skipped !== null) return 'skipped';
  if (authorize === undefined) return 'dry-run';
  return authorize === plan.planId ? 'execute' : 'refused';
}

/** The printable plan — complete and credential-free, what `--authorize` must match. */
export function describePlan(context: PlanContext): string[] {
  const { plan, wire, registration, locomoRegistration } = context;
  return [
    `plan ${plan.planId}`,
    `  registration ${registration.registrationId} · fixture ${registration.fixtureId}`,
    `  source manifest ${context.loaded.source.sha256}`,
    `  wire ${wire.provider} · model ${wire.model} · embeddings ${wire.embedModel ?? '(builtin)'} · base ${wire.base ?? '(suite default)'} · thinking ${wire.thinking} · key from ${wire.keySource ?? '(none)'}`,
    `  fixture questions (${registration.questionIds.length}): ${registration.questionIds.join(', ')}`,
    locomoRegistration === null
      ? `  locomo stratum: skipped — ${context.locomoSkipped}`
      : `  locomo questions (${locomoRegistration.questionIds.length}, seed ${locomoRegistration.seed}): ${locomoRegistration.questionIds.join(', ')}`,
    `  embeddings: ${plan.embedding.texts} texts · ${plan.embedding.cacheHits} cache hits · ${plan.embedding.cacheMisses} misses · at most ${plan.embedding.maxFreshRequests} fresh requests`,
    `  chat: ${plan.chat.planned} planned answers · at most ${plan.chat.maxFreshCalls} fresh calls (one repair each)`,
    `  ceilings: at most ${plan.maxFreshTotal} fresh requests against TANGLE_AI_MAX_CALLS=${plan.maxCalls} · concurrency ${plan.concurrency}${plan.fresh ? ' · FRESH (cache reads ignored)' : ''}`,
    plan.skipped === null ? '  fits the configured ceiling' : `  SKIPPED: ${plan.skipped}`,
  ];
}

// ---------------------------------------------------------------------------
// execution — one metered attempt
// ---------------------------------------------------------------------------

export class BudgetStop extends Error {
  constructor(reason: string) { super(reason); this.name = 'BudgetStop'; }
}

export interface Tally { turns: number, tokens: number, promptTokens: number, completionTokens: number, ms: number, replayed: number }

export function emptyTally(): Tally {
  return { turns: 0, tokens: 0, promptTokens: 0, completionTokens: 0, ms: 0, replayed: 0 };
}

function replayMs(result: unknown): number | null {
  const replayed = (result as { replayed?: { ms?: unknown } } | null)?.replayed;
  const ms = replayed?.ms;
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

function charge(tallies: readonly Tally[], latencies: number[], usage: any, elapsed: number, replayed: boolean): void {
  const prompt = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completion = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const total = typeof usage?.total_tokens === 'number' && usage.total_tokens > 0 ? usage.total_tokens : prompt + completion;
  for (const tally of tallies) {
    tally.turns++;
    tally.tokens += total;
    tally.promptTokens += prompt;
    tally.completionTokens += completion;
    tally.ms += elapsed;
    if (replayed) tally.replayed++;
  }
  latencies.push(elapsed);
}

export interface Account { account: ReturnType<typeof createBudgetAccount>, timer: () => number }

export function meter(client: ChatClient, shared: Account, tallies: readonly Tally[], latencies: number[]): { endpoint: { provider: string }, complete: (request: any) => Promise<any> } {
  return {
    endpoint: client.endpoint,
    async complete(request: any) {
      const stop = shared.account.stop();
      if (stop !== null) throw new BudgetStop(stop);
      const started = shared.timer();
      const result = await client.complete(request);
      const rememberedMs = replayMs(result);
      const replayed = rememberedMs !== null;
      const elapsed = rememberedMs ?? shared.timer() - started;
      if (!replayed) {
        shared.account.reserve();
        shared.account.settle(result.usage);
      }
      charge(tallies, latencies, result.usage, elapsed, replayed);
      return result;
    },
  };
}

/** Every wire call the run's injected fetch actually made, by kind. */
export interface FetchCounts { embeddings: number, chat: number, other: number }

/** A fetch that counts what actually crossed the wire — the run's spend truth. */
export function countingFetch(inner: typeof globalThis.fetch = globalThis.fetch): { fetch: typeof globalThis.fetch, counts: FetchCounts } {
  const counts: FetchCounts = { embeddings: 0, chat: 0, other: 0 };
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/embeddings')) counts.embeddings++;
    else if (url.endsWith('/chat/completions')) counts.chat++;
    else counts.other++;
    return inner(input, init);
  }) as typeof globalThis.fetch;
  return { fetch: wrapped, counts };
}

/** An embedder that honours the shared budget for the wire requests it causes. */
function meteredEmbedder(wire: Embedder, shared: Account, counts: FetchCounts, tally: { texts: number }): Embedder {
  return {
    model: wire.model,
    dims: wire.dims,
    async embed(texts, hooks) {
      const stop = shared.account.stop();
      if (stop !== null) throw new BudgetStop(stop);
      const before = counts.embeddings;
      const vectors = await wire.embed(texts, hooks);
      tally.texts += texts.length;
      for (let i = counts.embeddings - before; i > 0; i--) shared.account.reserve();
      return vectors;
    },
  };
}

export interface ExecuteOptions {
  env: AiEnv;
  chat: ChatClient;
  embedder: Embedder;
  fetchCounts: FetchCounts;
  tier: 'scripted' | 'paid';
  configIdentityFor: (observed: { model: string, dims: number }) => Promise<RunIdentity>;
  clock?: () => Date;
  timer?: () => number;
  onProgress?: (message: string) => void;
  root?: string;
}

interface RowSums {
  claims: { tp: number, fp: number, fn: number };
  claimF1s: number[];
  answerF1s: number[];
  abstention: { expected: number, correct: number, scored: number };
  retrievedRecalls: number[];
  suppliedRecalls: number[];
  citedRecalls: number[];
  citations: { raw: number, unique: number, resolvedUnique: number, supportingUnique: number, byOutcome: Record<string, number> };
  supply: { candidates: number, blocks: number, uniqueSupplied: number, duplicateExpansions: number, characters: number, estimatedTokens: number };
}

function emptySums(): RowSums {
  return {
    claims: { tp: 0, fp: 0, fn: 0 },
    claimF1s: [],
    answerF1s: [],
    abstention: { expected: 0, correct: 0, scored: 0 },
    retrievedRecalls: [],
    suppliedRecalls: [],
    citedRecalls: [],
    citations: { raw: 0, unique: 0, resolvedUnique: 0, supportingUnique: 0, byOutcome: { supporting: 0, resolvedNotSupporting: 0, notSupplied: 0, inactiveVersion: 0, futureEvidence: 0, unknownEvidence: 0 } },
    supply: { candidates: 0, blocks: 0, uniqueSupplied: 0, duplicateExpansions: 0, characters: 0, estimatedTokens: 0 },
  };
}

function meanOrNull(values: readonly number[]): number | null {
  return values.length === 0 ? null : (meanOf(values) ?? null);
}

/** One question's shared context: what the current path retrieved and supplied for it. */
interface QuestionContext {
  id: string;
  category: 1 | 2 | 3 | 4 | null;
  text: string;
  evidence: DocumentEvidence | null;
  evidenceError: { code: string, message: string } | null;
  /** The claim/abstention oracle for the fixture stratum; null on LoCoMo. */
  fixtureQuestion: FixtureQuestion | null;
  /** Gold support element keys/addresses this question is scored against. */
  support: ReadonlySet<string>;
  /** The official released answer, LoCoMo only. */
  official: { category: 1 | 2 | 3 | 4, answer: string | number } | null;
}

function traceBlock(evidence: DocumentEvidence): NonNullable<LiveQuestionResult['trace']> {
  return {
    retrieved: evidence.ranked.map((item) => item.chunk.id),
    supplied: [...evidence.suppliedChunkIds],
    blocks: evidence.blocks.length,
    uniqueSupplied: evidence.suppliedChunkIds.length,
    duplicateExpansions: evidence.duplicateExpansions,
    characters: evidence.characters,
    estimatedTokens: evidence.estimatedTokens,
  };
}

function recallsOf(question: QuestionContext, corpus: EvidenceCorpus, evidence: DocumentEvidence | null): { retrieved: number | null, supplied: number | null } {
  if (question.support.size === 0) return { retrieved: null, supplied: null };
  const elementsOf = (ids: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const id of ids) {
      const chunk = corpus.chunk(id);
      if (chunk !== undefined) for (const element of chunk.elements) out.add(element);
    }
    return out;
  };
  const gold = [...question.support];
  return {
    retrieved: evidenceRecall(gold, elementsOf(evidence?.ranked.map((item) => item.chunk.id) ?? [])),
    supplied: evidenceRecall(gold, elementsOf(evidence?.suppliedChunkIds ?? [])),
  };
}

/** Score one generated reply into a live question result. */
function scoreLiveAnswer(
  question: QuestionContext,
  answer: AnswerValue,
  corpus: EvidenceCorpus,
  evidence: DocumentEvidence | null,
  cutoff: string,
  fixture: GroundingFixture | null,
): Omit<LiveQuestionResult, 'id' | 'category' | 'status' | 'tokens' | 'ms' | 'replayed' | 'attempts' | 'trace' | 'retrievedRecall' | 'suppliedRecall'> {
  const trace = {
    retrieved: evidence?.ranked.map((item) => item.chunk.id) ?? [],
    supplied: evidence?.suppliedChunkIds ?? [],
  };
  if (question.fixtureQuestion !== null && fixture !== null) {
    const expected = fixture.claims.filter((c) => c.question === question.fixtureQuestion!.key);
    const scored = scoreAnswer(question.fixtureQuestion, expected, answer, corpus, trace, cutoff);
    const citedRecall = citedRecallOf(question, scored.citations, corpus);
    return {
      answer,
      rendered: scored.rendered,
      citations: scored.citations,
      citationCounts: scored.citationCounts,
      claims: scored.claims,
      abstention: scored.abstention,
      answerF1: scored.answerF1,
      citedRecall,
    };
  }
  // LoCoMo: official answer F1, terminal citation outcomes against the
  // gold addresses, and never a material-claim score
  const pseudoQuestion: FixtureQuestion = { key: question.id, kind: 'answerable', text: question.text, reference: null, claims: [] };
  const scored = scoreAnswer(pseudoQuestion, [], answer, corpus, trace, cutoff);
  // re-classify support against the gold addresses: scoreAnswer had no
  // expected claims, so every resolvable citation came back not-supporting
  const citations = scored.citations.map((record) => {
    if (record.outcome !== 'resolved-not-supporting') return record;
    const chunk = corpus.chunk(record.citation);
    const supports = chunk !== undefined && [...question.support].some((address) => chunk.elements.has(address));
    return supports ? { ...record, outcome: 'supporting' as const } : record;
  });
  const byOutcome = { supporting: 0, resolvedNotSupporting: 0, notSupplied: 0, inactiveVersion: 0, futureEvidence: 0, unknownEvidence: 0 };
  const outcomesById = new Map<string, Set<string>>();
  for (const record of citations) {
    const member = record.outcome === 'supporting' ? 'supporting'
      : record.outcome === 'resolved-not-supporting' ? 'resolvedNotSupporting'
        : record.outcome === 'not-supplied' ? 'notSupplied'
          : record.outcome === 'inactive-version' ? 'inactiveVersion'
            : record.outcome === 'future-evidence' ? 'futureEvidence' : 'unknownEvidence';
    byOutcome[member as keyof typeof byOutcome]++;
    const set = outcomesById.get(record.citation) ?? new Set<string>();
    set.add(record.outcome);
    outcomesById.set(record.citation, set);
  }
  const rendered = scored.rendered;
  const official = question.official === null
    ? null
    : officialScore({ category: question.official.category, prediction: rendered, answer: question.official.answer });
  return {
    answer,
    rendered,
    citations,
    citationCounts: {
      raw: citations.length,
      unique: outcomesById.size,
      resolvedUnique: [...outcomesById.values()].filter((set) => set.has('supporting') || set.has('resolved-not-supporting')).length,
      supportingUnique: [...outcomesById.values()].filter((set) => set.has('supporting')).length,
      byOutcome,
    },
    claims: null,
    abstention: null,
    answerF1: official !== null && official.scored ? official.f1 : null,
    citedRecall: citedRecallOf(question, citations, corpus),
  };
}

function citedRecallOf(question: QuestionContext, citations: ReadonlyArray<{ citation: string, outcome: string }>, corpus: EvidenceCorpus): number | null {
  if (question.support.size === 0) return null;
  const covered = new Set<string>();
  for (const record of citations) {
    if (record.outcome !== 'supporting' && record.outcome !== 'resolved-not-supporting') continue;
    const chunk = corpus.chunk(record.citation);
    if (chunk === undefined) continue;
    for (const element of chunk.elements) covered.add(element);
  }
  return evidenceRecall([...question.support], covered);
}

function addSums(sums: RowSums, result: LiveQuestionResult): void {
  if (result.claims !== null) {
    sums.claims.tp += result.claims.tp;
    sums.claims.fp += result.claims.fp;
    sums.claims.fn += result.claims.fn;
    if (result.claims.f1 !== null) sums.claimF1s.push(result.claims.f1);
  }
  if (result.answerF1 !== null) sums.answerF1s.push(result.answerF1);
  if (result.abstention !== null) {
    sums.abstention.scored++;
    if (result.abstention.expected) sums.abstention.expected++;
    if (result.abstention.correct) sums.abstention.correct++;
  }
  if (result.retrievedRecall !== null) sums.retrievedRecalls.push(result.retrievedRecall);
  if (result.suppliedRecall !== null) sums.suppliedRecalls.push(result.suppliedRecall);
  if (result.citedRecall !== null) sums.citedRecalls.push(result.citedRecall);
  if (result.citationCounts !== null) {
    sums.citations.raw += result.citationCounts.raw;
    sums.citations.unique += result.citationCounts.unique;
    sums.citations.resolvedUnique += result.citationCounts.resolvedUnique;
    sums.citations.supportingUnique += result.citationCounts.supportingUnique;
    for (const [member, count] of Object.entries(result.citationCounts.byOutcome)) {
      sums.citations.byOutcome[member] += count;
    }
  }
  if (result.trace !== null) {
    sums.supply.candidates += result.trace.retrieved.length;
    sums.supply.blocks += result.trace.blocks;
    sums.supply.uniqueSupplied += result.trace.uniqueSupplied;
    sums.supply.duplicateExpansions += result.trace.duplicateExpansions;
    sums.supply.characters += result.trace.characters;
    sums.supply.estimatedTokens += result.trace.estimatedTokens;
  }
}

async function questionSetOf(results: readonly LiveQuestionResult[], statuses: readonly string[]): Promise<string> {
  return canonicalSha256(results.filter((r) => statuses.includes(r.status)).map((r) => r.id).sort());
}

function rowBlock(
  key: LiveRow['key'],
  generates: boolean,
  questionSet: string,
  results: LiveQuestionResult[],
  sums: RowSums,
  hasEvidence: boolean,
  fixtureStratum: boolean,
  cost: Tally | null,
  latencies: number[] | null,
): LiveRow {
  const answered = results.filter((r) => r.status === 'answered').length;
  const micro = sums.claims;
  const denominator = 2 * micro.tp + micro.fp + micro.fn;
  return {
    key,
    generates,
    questionSet,
    questions: {
      planned: results.length,
      answered,
      unanswered: {
        wire: results.filter((r) => r.status === 'wire-failure').length,
        budget: results.filter((r) => r.status === 'budget-stop').length,
      },
      invalid: results.filter((r) => r.status === 'invalid').length,
      results,
    },
    claims: !generates || !fixtureStratum ? null : {
      tp: micro.tp,
      fp: micro.fp,
      fn: micro.fn,
      microPrecision: micro.tp + micro.fp === 0 ? 0 : micro.tp / (micro.tp + micro.fp),
      microRecall: micro.tp + micro.fn === 0 ? 0 : micro.tp / (micro.tp + micro.fn),
      microF1: denominator === 0 ? 0 : (2 * micro.tp) / denominator,
      meanF1: meanOrNull(sums.claimF1s) ?? 0,
    },
    answerF1: generates ? meanOrNull(sums.answerF1s) : null,
    abstention: !generates || !fixtureStratum ? null : {
      expected: sums.abstention.expected,
      correct: sums.abstention.correct,
      accuracy: sums.abstention.scored === 0 ? null : sums.abstention.correct / sums.abstention.scored,
    },
    citations: !generates ? null : {
      raw: sums.citations.raw,
      unique: sums.citations.unique,
      resolvedUnique: sums.citations.resolvedUnique,
      supportingUnique: sums.citations.supportingUnique,
      byOutcome: {
        supporting: sums.citations.byOutcome.supporting,
        resolvedNotSupporting: sums.citations.byOutcome.resolvedNotSupporting,
        notSupplied: sums.citations.byOutcome.notSupplied,
        inactiveVersion: sums.citations.byOutcome.inactiveVersion,
        futureEvidence: sums.citations.byOutcome.futureEvidence,
        unknownEvidence: sums.citations.byOutcome.unknownEvidence,
      },
    },
    citedRecall: generates ? meanOrNull(sums.citedRecalls) : null,
    retrievedRecall: hasEvidence ? meanOrNull(sums.retrievedRecalls) : null,
    suppliedRecall: hasEvidence ? meanOrNull(sums.suppliedRecalls) : null,
    supply: hasEvidence ? { ...sums.supply } : null,
    cost: cost === null ? null : { turns: cost.turns, tokens: cost.tokens, promptTokens: cost.promptTokens, completionTokens: cost.completionTokens, ms: cost.ms, replayed: cost.replayed },
    latency: latencies === null ? null : latencyOf(latencies),
  };
}

function pairingOf(rows: readonly LiveRow[]): { eligible: boolean, reasons: Array<{ code: string, detail: string }> } {
  const reasons: Array<{ code: string, detail: string }> = [];
  const generated = rows.filter((row) => row.generates);
  for (const row of generated) {
    if (row.questions.answered !== row.questions.planned) {
      reasons.push({ code: 'incomplete', detail: `${row.key} answered ${row.questions.answered} of ${row.questions.planned} planned questions` });
    }
    if (row.questions.invalid > 0) reasons.push({ code: 'invalid-reply', detail: `${row.key} holds ${row.questions.invalid} replies invalid after repair` });
    if (row.questions.unanswered.wire > 0) reasons.push({ code: 'wire-failure', detail: `${row.key} lost ${row.questions.unanswered.wire} questions to the wire` });
    if (row.questions.unanswered.budget > 0) reasons.push({ code: 'budget-stop', detail: `${row.key} lost ${row.questions.unanswered.budget} questions to the budget` });
  }
  if (generated.length === 2 && generated[0].questionSet !== generated[1].questionSet) {
    reasons.push({ code: 'different-questions', detail: 'the two generated rows did not answer the same question set' });
  }
  return { eligible: reasons.length === 0, reasons };
}

function comparisonOf(metric: LiveComparison['metric'], deltas: readonly number[]): LiveComparison {
  const interval = bootstrapInterval(deltas, { resamples: 10000, seed: 17753, level: 0.95 });
  const sd = deltas.length < 2 ? 0 : (stddev(deltas) ?? 0);
  const se = deltas.length === 0 ? 0 : sd / Math.sqrt(deltas.length);
  const mean = deltas.length === 0 ? 0 : (meanOf(deltas) ?? 0);
  return {
    metric,
    treatment: 'grounded-answer',
    control: 'no-documents',
    pairs: deltas.length,
    mean,
    interval,
    oneSidedLowerBound: mean - normalQuantile(0.95) * se,
    power: {
      pairedSd: sd,
      standardError: se,
      minimumDetectableEffect: normalQuantile(0.975) * se,
      tiedPairs: deltas.filter((delta) => delta === 0).length,
    },
  };
}

function pairedDeltas(
  grounded: readonly LiveQuestionResult[],
  control: readonly LiveQuestionResult[],
  value: (result: LiveQuestionResult) => number | null,
): number[] {
  const controlOf = new Map(control.map((result) => [result.id, result]));
  const deltas: number[] = [];
  for (const treatment of grounded) {
    const other = controlOf.get(treatment.id);
    if (other === undefined) continue;
    const a = value(treatment);
    const b = value(other);
    if (a === null || b === null) continue;
    deltas.push(a - b);
  }
  return deltas;
}

/**
 * Execute one authorized (or scripted) attempt over an already-frozen
 * plan. Zero calls when the plan was skipped; otherwise the corpora are
 * built through the shipped path, every question is asked on both
 * generated rows under the shared controls, and the complete raw
 * per-question record is retained.
 */
export async function executeGroundingLive(context: PlanContext, options: ExecuteOptions): Promise<GroundingLive> {
  const clock = options.clock ?? ((): Date => new Date());
  const timer = options.timer ?? ((): number => performance.now());
  const progress = options.onProgress ?? ((): void => {});
  const root = options.root ?? process.cwd();
  const { loaded, registration } = context;
  const fixture = loaded.fixture;

  const header = {
    document: 'grounding-live' as const,
    benchmark: 'grounding' as const,
    instrument: { entry: 'benchmark/grounding.ts' as const },
    generated: {
      at: clock().toISOString(),
      tier: options.tier,
      provider: context.wire.provider,
      model: context.wire.model,
      embedder: { model: options.embedder.model, dims: options.embedder.dims ?? 0 },
      keySource: context.wire.keySource,
      thinking: context.wire.thinking,
    },
    fixture: { id: loaded.fixtureId, path: 'benchmark/fixtures/grounding/manifest.json' as const, license: 'MIT' as const, census: fixture.census },
    registration,
    locomoRegistration: context.locomoRegistration,
    locomoSkipped: context.locomoSkipped,
    source: loaded.source,
  };

  const shared: Account = { account: createBudgetAccount({ turns: options.env.maxCalls }, timer), timer };
  const embeddingTally = { texts: 0 };
  const embedder = meteredEmbedder(options.embedder, shared, options.fetchCounts, embeddingTally);
  const errors: string[] = [];
  let errorCount = 0;
  const noteError = (message: string): void => { errorCount++; if (errors.length < 10) errors.push(excerpt(message, 160)); };

  const strata: LiveStratum[] = [];
  const closers: Array<() => Promise<void>> = [];
  // the wire embedder's width is proven by its replies, exactly as the
  // desktop treats it — never assumed before one arrives
  let observedDimsOut = options.embedder.dims ?? 0;
  try {
    // --- the corpora, through the shipped contracts
    const fixtureCorpusBuilt = await buildFixtureCorpus(fixture, embedder, root);
    closers.push(fixtureCorpusBuilt.close);
    progress(`fixture corpus: ${fixtureCorpusBuilt.census.chunks} chunks over ${fixtureCorpusBuilt.census.versions} versions (${fixtureCorpusBuilt.census.embeddingCalls} embedding calls)`);
    const locomoBuilt = context.locomoSamples.length === 0 ? null : await buildLocomoProjection(context.locomoSamples, embedder);
    if (locomoBuilt !== null) {
      closers.push(locomoBuilt.close);
      progress(`locomo projection: ${locomoBuilt.census.chunks} chunks over ${locomoBuilt.census.sources} conversations (${locomoBuilt.census.embeddingCalls} embedding calls)`);
    }

    const supportOf = new Map(fixture.claims.map((c) => [c.question, new Set<string>()]));
    for (const claim of fixture.claims) for (const element of claim.support) supportOf.get(claim.question)!.add(element);

    interface StratumSpec {
      key: 'fixture' | 'locomo';
      corpus: EvidenceCorpus;
      census: BuiltCorpus['census'];
      storeFor: (question: QuestionContext) => DocumentCorpusStore;
      questions: QuestionContext[];
    }
    const specs: StratumSpec[] = [{
      key: 'fixture',
      corpus: fixtureCorpusBuilt.corpus,
      census: fixtureCorpusBuilt.census,
      storeFor: () => fixtureCorpusBuilt.store,
      questions: fixture.questions.map((q): QuestionContext => ({
        id: q.key,
        category: null,
        text: q.text,
        evidence: null,
        evidenceError: null,
        fixtureQuestion: q,
        support: supportOf.get(q.key) ?? new Set(),
        official: null,
      })),
    }];
    if (locomoBuilt !== null) {
      specs.push({
        key: 'locomo',
        corpus: locomoBuilt.corpus,
        census: locomoBuilt.census,
        storeFor: (question) => locomoBuilt.stores.get(question.id.split('#')[0])!,
        questions: context.locomoQuestions.map((q): QuestionContext => ({
          id: q.id,
          category: q.category as 1 | 2 | 3 | 4,
          text: q.text,
          evidence: null,
          evidenceError: null,
          fixtureQuestion: null,
          support: new Set(q.gold),
          official: q.answer === undefined ? null : { category: q.category as 1 | 2 | 3 | 4, answer: q.answer },
        })),
      });
    }

    for (const spec of specs) {
      // one trace per question, shared by the retrieved and grounded rows
      for (const question of spec.questions) {
        const [vector] = await embedder.embed([question.text]);
        if (observedDimsOut === 0) observedDimsOut = vector.length;
        const identity: EmbeddedBy = { model: embedder.model, dims: vector.length };
        const outcome = await collectDocumentEvidence(spec.storeFor(question), vector, identity, GROUNDING_DEFAULTS);
        if (outcome.ok) question.evidence = outcome.evidence;
        else {
          question.evidenceError = outcome.error;
          noteError(`${question.id} retrieval: ${outcome.error.code} ${outcome.error.message}`);
        }
      }

      const rows: LiveRow[] = [];
      for (const key of ['no-documents', 'documents-retrieved', 'grounded-answer'] as const) {
        const generates = key !== 'documents-retrieved';
        const sums = emptySums();
        const cost = generates ? emptyTally() : null;
        const latencies = generates ? [] : null;
        const results: LiveQuestionResult[] = new Array(spec.questions.length);

        await mapConcurrent(spec.questions, options.env.maxConcurrency, async (question, index) => {
          const evidence = key === 'no-documents' ? null : question.evidence;
          const recalls = key === 'no-documents'
            ? { retrieved: null, supplied: null }
            : recallsOf(question, spec.corpus, evidence);
          const base = {
            id: question.id,
            category: question.category,
            trace: key === 'no-documents' ? null : (evidence === null ? null : traceBlock(evidence)),
            retrievedRecall: recalls.retrieved,
            suppliedRecall: recalls.supplied,
          };
          if (!generates) {
            results[index] = {
              ...base,
              status: 'analytic',
              answer: null,
              rendered: null,
              citations: [],
              citationCounts: null,
              claims: null,
              abstention: null,
              answerF1: null,
              citedRecall: null,
              tokens: 0,
              ms: 0,
              replayed: 0,
              attempts: 0,
            };
            return;
          }
          const context2 = key === 'no-documents'
            ? emptyEvidenceContext()
            : (evidence?.context ?? emptyEvidenceContext());
          const mine = emptyTally();
          const generator = createStructuredOutput({
            client: meter(options.chat, shared, [cost!, mine], latencies!),
            schema: GROUNDED_ANSWER_SCHEMA,
            name: 'grounding_answer',
            maxRepairs: 1,
          });
          let reply: { value: AnswerValue } | { errors: unknown[], raw: string, attempts: number };
          try {
            reply = await generator.generate(groundingMessages(question.text, context2)) as typeof reply;
          } catch (error) {
            const budget = error instanceof BudgetStop;
            if (!budget) noteError(`${question.id} ${key}: ${error instanceof Error ? error.message : String(error)}`);
            results[index] = {
              ...base,
              status: budget ? 'budget-stop' : 'wire-failure',
              answer: null,
              rendered: null,
              citations: [],
              citationCounts: null,
              claims: null,
              abstention: null,
              answerF1: null,
              citedRecall: null,
              tokens: mine.tokens,
              ms: mine.ms,
              replayed: mine.replayed,
              attempts: mine.turns,
            };
            return;
          }
          if (!('value' in reply)) {
            results[index] = {
              ...base,
              status: 'invalid',
              answer: null,
              rendered: excerpt(reply.raw, 400),
              citations: [],
              citationCounts: null,
              claims: null,
              abstention: null,
              answerF1: null,
              citedRecall: null,
              tokens: mine.tokens,
              ms: mine.ms,
              replayed: mine.replayed,
              attempts: mine.turns,
            };
            return;
          }
          const scored = scoreLiveAnswer(
            question,
            reply.value,
            spec.corpus,
            key === 'no-documents' ? null : evidence,
            fixture.cutoff,
            spec.key === 'fixture' ? fixture : null,
          );
          results[index] = {
            ...base,
            status: 'answered',
            ...scored,
            tokens: mine.tokens,
            ms: mine.ms,
            replayed: mine.replayed,
            attempts: mine.turns,
          };
        });

        for (const result of results) if (result.status === 'answered' || result.status === 'analytic') addSums(sums, result);
        const questionSet = await questionSetOf(results, generates ? ['answered'] : ['analytic']);
        rows.push(rowBlock(key, generates, questionSet, results, sums, key !== 'no-documents', spec.key === 'fixture', cost, latencies));
        progress(`${spec.key}/${key}: planned ${results.length} / answered ${rows.at(-1)!.questions.answered} / invalid ${rows.at(-1)!.questions.invalid} / wire ${rows.at(-1)!.questions.unanswered.wire} / budget ${rows.at(-1)!.questions.unanswered.budget}`);
      }

      const pairing = pairingOf(rows);
      const comparisons: LiveComparison[] = [];
      if (pairing.eligible) {
        const grounded = rows.find((row) => row.key === 'grounded-answer')!.questions.results;
        const control = rows.find((row) => row.key === 'no-documents')!.questions.results;
        if (spec.key === 'fixture') {
          comparisons.push(comparisonOf('supported-claim-f1', pairedDeltas(grounded, control, (r) => r.claims?.f1 ?? null)));
        }
        comparisons.push(comparisonOf('answer-f1', pairedDeltas(grounded, control, (r) => r.answerF1)));
      }
      strata.push({ key: spec.key, corpus: { ...spec.census }, rows, pairing: { ...pairing, comparisons } });
    }
  } finally {
    for (const close of closers) await close();
  }

  const runIdentity = await options.configIdentityFor({ model: embedder.model, dims: observedDimsOut });
  const envelopeRows: Array<{ rowId: string, identityId: string }> = [];
  const analyticRows: string[] = [];
  for (const stratum of strata) {
    for (const row of stratum.rows) {
      const rowId = `${stratum.key}/${row.key}`;
      if (row.generates) envelopeRows.push({ rowId, identityId: runIdentity.identityId });
      else analyticRows.push(rowId);
    }
  }
  const envelope = runEnvelope([runIdentity], envelopeRows);
  envelope.rows.push(...analyticRows.map((rowId) => ({ rowId, identityStatus: 'not-run' as const })));

  const spent = shared.account.spent();
  header.generated.embedder = { model: options.embedder.model, dims: observedDimsOut };
  const report: Omit<GroundingLive, 'reportId'> = {
    ...header,
    configIdentities: envelope as unknown as GroundingLive['configIdentities'],
    plan: { ...context.plan, authorized: true },
    strata,
    spent: { turns: spent.turns, tokens: spent.tokens, ms: spent.ms },
    embedding: {
      requests: options.fetchCounts.embeddings,
      texts: embeddingTally.texts,
      cached: context.plan.embedding.cacheHits,
    },
    replayed: strata.reduce((n, stratum) => n + stratum.rows.reduce((m, row) => m + (row.cost?.replayed ?? 0), 0), 0),
    errors: { count: errorCount, sample: errors },
    decision: { state: 'not-evaluated', reason: 'pending the mechanical decision below' },
  };
  // the identity excludes the decision, so the mechanical decision is
  // computed over the finished observation and can never move it
  const reportId = await liveReportIdOf(report);
  const finished: GroundingLive = { ...report, reportId };
  return { ...finished, decision: decideGrounding(finished) };
}

/**
 * The live report's identity: an explicit clock-free, cost-free
 * projection — registration, plan, per-question answers and outcomes —
 * so a replay that spends nothing reproduces the identity of the run
 * that bought it.
 */
export async function liveReportIdOf(report: Omit<GroundingLive, 'reportId'> & { reportId?: string }): Promise<string> {
  return canonicalSha256({
    document: report.document,
    tier: report.generated.tier,
    provider: report.generated.provider,
    model: report.generated.model,
    embedder: report.generated.embedder,
    thinking: report.generated.thinking,
    fixture: report.fixture,
    registration: report.registration,
    locomoRegistration: report.locomoRegistration,
    locomoSkipped: report.locomoSkipped,
    source: report.source,
    // the plan's cache hit/miss logistics are deliberately absent: a
    // replay that spends nothing must reproduce the identity of the run
    // that bought it, and what the cache happened to hold is spend
    // accounting, not observation
    configIdentities: report.configIdentities,
    strata: report.strata.map((stratum) => ({
      key: stratum.key,
      corpus: stratum.corpus,
      pairing: stratum.pairing,
      rows: stratum.rows.map((row) => ({
        key: row.key,
        questionSet: row.questionSet,
        claims: row.claims,
        answerF1: row.answerF1,
        abstention: row.abstention,
        citations: row.citations,
        citedRecall: row.citedRecall,
        retrievedRecall: row.retrievedRecall,
        suppliedRecall: row.suppliedRecall,
        supply: row.supply,
        results: row.questions.results.map((result) => ({
          id: result.id,
          status: result.status,
          trace: result.trace,
          answer: result.answer,
          rendered: result.rendered,
          citations: result.citations,
          claims: result.claims,
          abstention: result.abstention,
          answerF1: result.answerF1,
          citedRecall: result.citedRecall,
        })),
      })),
    })),
  });
}
