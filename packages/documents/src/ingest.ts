import { createHash } from 'node:crypto';

import type { Embedder } from '@tangleai/models/embed';
import { mapConcurrent } from '@jarenjs/core/async';
import { estimateTokens } from '@tangleai/core/tokens';
import { equalsJson } from '@jarenjs/core/object';

import { likelyDynamicShell, type BrowserFetcher, UnavailableBrowserFetcher } from './browser.ts';
import { RecursiveDocumentChunker, S2DocumentChunker, SemanticBoundaryChunker, ParentChildChunker } from './chunking.ts';
import {
  EXTRACTION_VERSION,
  DocumentError,
  assertStoredDocumentBundle,
  type PreparedDocumentIdentity,
  type PreparedOutcome,
  type Chunker,
  type DocumentChunk,
  type DocumentParent,
  type DocumentCorpusStore,
  type DocumentElement,
  type DocumentSource,
  type DocumentVersion,
  type FetchMode,
} from './contracts.ts';
import { DEFAULT_EXTRACT_LIMITS, extractDocument, extractHtml, type ExtractLimits } from './extract.ts';
import { SafeStaticFetcher } from './fetch.ts';
import { normalizeUrl } from './url-policy.ts';

export type ChunkerStrategy = 'recursive' | 'semantic-boundary' | 's2' | 'parent-child';
export type IngestStage = 'fetch' | 'extract' | 'chunk' | 'embed' | 'store';

export interface IngestProgress {
  stage: IngestStage;
  status: 'start' | 'ok' | 'error';
  at: string;
  detail?: Record<string, unknown>;
}

export interface IngestUrlInput {
  url: string;
  strategy?: ChunkerStrategy;
  allowBrowser?: boolean;
  force?: boolean;
  maxTokens?: number;
  overlapTokens?: number;
  parentTokens?: number;
  extractLimits?: Partial<ExtractLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: IngestProgress) => void;
}

export interface IngestUrlOutcome {
  status: 'ingested' | 'unchanged';
  source: DocumentSource;
  version: DocumentVersion;
  browserFallback: boolean;
}

export interface DocumentIngesterOptions {
  store: DocumentCorpusStore;
  fetcher: SafeStaticFetcher;
  embedder: Embedder;
  browser?: BrowserFetcher;
  now?: () => string;
  embedBatchSize?: number;
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The sole identity projection used for unchanged and retained-version reuse. */
export function preparedIdentityOf(value: PreparedDocumentIdentity): PreparedDocumentIdentity {
  return { contentHash: value.contentHash, extractionVersion: value.extractionVersion, chunkerVersion: value.chunkerVersion,
    chunkerConfig: { maxTokens: value.chunkerConfig.maxTokens, overlapTokens: value.chunkerConfig.overlapTokens,
      ...(value.chunkerConfig.parentTokens === undefined ? {} : { parentTokens: value.chunkerConfig.parentTokens }) },
    embeddedBy: { model: value.embeddedBy.model, dims: value.embeddedBy.dims } };
}
/** Preserve established known-width addresses while deriving every field from the identity owner. */
function versionIdFor(source: string, value: PreparedDocumentIdentity): string {
  const identity = preparedIdentityOf(value), config = identity.chunkerConfig;
  return `ver-${hash(`${source}|${identity.contentHash}|${identity.extractionVersion}|${identity.chunkerVersion}|${config.maxTokens}|${config.overlapTokens}${config.parentTokens === undefined ? '' : '|' + config.parentTokens}|${identity.embeddedBy.model}|${identity.embeddedBy.dims}`).slice(0, 32)}`;
}

function sourceId(url: string): string {
  return `src-${hash(url).slice(0, 24)}`;
}

function progress(now: () => string, callback: IngestUrlInput['onProgress'], stage: IngestStage, status: IngestProgress['status'], detail?: Record<string, unknown>): void {
  callback?.({ stage, status, at: now(), detail });
}

function chunkerFor(strategy: ChunkerStrategy, embedder: Embedder, maxTokens: number, overlapTokens: number, parentTokens?: number): Chunker {
  if (strategy === 'parent-child') {
    if (parentTokens === undefined) throw new DocumentError('chunk-budget', 'Parent-child ingestion requires an explicit parentTokens budget');
    return new ParentChildChunker({ parentTokens, maxTokens, overlapTokens });
  }
  if (strategy === 's2') return new S2DocumentChunker({ embedder, maxTokens, overlapTokens });
  if (strategy === 'semantic-boundary') return new SemanticBoundaryChunker({ embedder, maxTokens, overlapTokens });
  return new RecursiveDocumentChunker({ maxTokens, overlapTokens });
}

function usefulChars(elements: Array<{ text: string }>): number {
  return elements.reduce((sum, element) => sum + element.text.length, 0);
}

export interface DocumentIngester {
  prepare(input: IngestUrlInput): Promise<PreparedOutcome>;
  ingest(input: IngestUrlInput): Promise<IngestUrlOutcome>;
  ingestMany(inputs: IngestUrlInput[], options?: { concurrency?: number }): Promise<Array<{ url: string; outcome?: IngestUrlOutcome; error?: { code: string; message: string } }>>;
}

export function createDocumentIngester(options: DocumentIngesterOptions): DocumentIngester {
  const { store, fetcher, embedder } = options;
  const browser = options.browser ?? new UnavailableBrowserFetcher();
  const now = options.now ?? ((): string => new Date().toISOString());
  const batchSize = Math.max(1, options.embedBatchSize ?? 32);

  return {
    async prepare(input) {
      const requestedUrl = normalizeUrl(input.url);
      const id = sourceId(requestedUrl);
      const existing = await store.getSource(id);
      let fetchMode: FetchMode = 'static';
      let browserFallback = false;
      let fetchedAt = now();
      let finalUrl = requestedUrl;
      let mimeType = 'text/html';
      let etag: string | undefined;
      let lastModified: string | undefined;
      let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
      let contentHash = '';
      let version: DocumentVersion | undefined;
      const strategy = input.strategy ?? 'recursive';
      const maxTokens = Math.max(16, input.maxTokens ?? 450);
      const overlapTokens = Math.max(0, input.overlapTokens ?? 48);
      let chunkerEmbedCalls = 0;
      const chunkerEmbedder: Embedder = {
        model: embedder.model,
        dims: embedder.dims,
        embed: async (texts, embedOptions) => {
          chunkerEmbedCalls++;
          return embedder.embed(texts, embedOptions);
        },
      };
      const chunker = chunkerFor(strategy, chunkerEmbedder, maxTokens, overlapTokens, input.parentTokens);
      // The chunker clamps what it was asked for; a re-index is only
      // deterministic against the budgets that actually ran.
      const chunkerConfig = { maxTokens: chunker.maxTokens, overlapTokens: chunker.overlapTokens,
        ...(chunker.parentTokens === undefined ? {} : { parentTokens: chunker.parentTokens }) };
      const priorVersion = existing?.activeVersionId === undefined ? undefined : await store.getVersion(existing.activeVersionId);
      const identityFor = (content: string, dims: number): PreparedDocumentIdentity => preparedIdentityOf({ contentHash: content,
        extractionVersion: EXTRACTION_VERSION, chunkerVersion: chunker.version, chunkerConfig, embeddedBy: { model: embedder.model, dims } });
      const compatible = (active: DocumentVersion | undefined): active is DocumentVersion => active !== undefined
        && equalsJson(preparedIdentityOf(active), identityFor(active.contentHash, embedder.dims ?? active.embeddedBy.dims));

      try {
        progress(now, input.onProgress, 'fetch', 'start');
        const fetched = await fetcher.fetch(requestedUrl, input.force === true || !compatible(priorVersion) ? {} : {
          etag: existing?.etag,
          lastModified: existing?.lastModified,
        }, input.signal);
        fetchedAt = fetched.fetchedAt;
        finalUrl = fetched.finalUrl;
        etag = fetched.etag;
        lastModified = fetched.lastModified;
        if (fetched.status === 'not-modified') {
          if (existing?.activeVersionId === undefined) throw new DocumentError('invalid-cache', 'Server returned not-modified but no active document version exists');
          const active = await store.getVersion(existing.activeVersionId);
          if (!compatible(active)) throw new DocumentError('invalid-cache', 'Not-modified response cannot reuse a missing or incompatible document version');
          const source = { ...existing, fetchedAt, finalUrl, etag, lastModified, status: 'ready' as const, error: undefined };
          await store.putSource(source);
          progress(now, input.onProgress, 'fetch', 'ok', { status: 304 });
          return { status: 'unchanged', source, version: active, browserFallback: false };
        }
        bytes = fetched.bytes as Uint8Array;
        mimeType = fetched.mimeType as string;
        contentHash = hash(bytes);
        progress(now, input.onProgress, 'fetch', 'ok', { bytes: bytes.length, mimeType, finalUrl });

        progress(now, input.onProgress, 'extract', 'start');
        const extractionStarted = performance.now();
        const limits = { ...DEFAULT_EXTRACT_LIMITS, ...input.extractLimits };
        let extracted = await extractDocument(bytes, { mimeType, url: finalUrl, limits });
        if (mimeType === 'text/html' && input.allowBrowser === true) {
          const rawHtml = new TextDecoder().decode(bytes);
          if (likelyDynamicShell(rawHtml, usefulChars(extracted.elements), limits.minUsefulChars)) {
            const capability = await browser.capability();
            if (!capability.available) throw new DocumentError('dynamic-unavailable', capability.detail);
            const rendered = await browser.render(finalUrl, { signal: input.signal });
            fetchMode = rendered.mode;
            browserFallback = true;
            finalUrl = rendered.finalUrl;
            bytes = new TextEncoder().encode(rendered.html);
            contentHash = hash(bytes);
            extracted = extractHtml(rendered.html, finalUrl, limits);
            if (extracted.title === null) extracted.title = rendered.title;
          }
        }
        const extractionMs = performance.now() - extractionStarted;
        const canonicalUrl = extracted.canonicalUrl === undefined ? finalUrl : normalizeUrl(extracted.canonicalUrl);
        const identity = { model: embedder.model, dims: embedder.dims ?? 0 };
        const active = existing?.activeVersionId === undefined ? undefined : await store.getVersion(existing.activeVersionId);
        if (input.force !== true && compatible(active) && active.contentHash === contentHash) {
          const source: DocumentSource = {
            ...(existing as DocumentSource), finalUrl, canonicalUrl, title: extracted.title, mimeType,
            fetchMode, status: 'ready', fetchedAt, etag, lastModified, error: undefined,
          };
          await store.putSource(source);
          progress(now, input.onProgress, 'extract', 'ok', { unchanged: true, elements: extracted.elements.length });
          return { status: 'unchanged', source, version: active, browserFallback };
        }

        const sourceFor = (versionId: string): DocumentSource => ({ id, requestedUrl, finalUrl, canonicalUrl, title: extracted.title, mimeType,
          fetchMode, status: 'ready', fetchedAt, etag, lastModified, activeVersionId: versionId });
        if (input.force !== true) {
          const retained = (await store.listVersions(id)).find(row => row.status === 'superseded' && compatible(row)
            && equalsJson(preparedIdentityOf(row), identityFor(contentHash, embedder.dims ?? row.embeddedBy.dims)));
          if (retained) {
            const [elements, chunks, parents] = await Promise.all([store.listElements(retained.id), store.listChunks(retained.id), store.listParents(retained.id)]);
            // A collected version has no complete bundle to reactivate; prepare fresh evidence below.
            if (elements.length === retained.metrics.elements && chunks.length === retained.metrics.chunks && parents.length === (retained.metrics.parents ?? 0)) {
              const metrics = { ...retained.metrics, extractionMs, chunkingMs: 0, embeddingMs: 0, embeddingCalls: 0, estimatedEmbeddingTokens: 0 };
              const { activatedAt: _activated, supersededAt: _superseded, error: _error, ...retainedVersion } = retained;
              const bundle = { source: sourceFor(retained.id), version: { ...retainedVersion, status: 'staging' as const, fetchedAt, metrics }, elements, chunks,
                ...(retained.metrics.parents === undefined ? {} : { parents }) };
              assertStoredDocumentBundle(bundle);
              progress(now, input.onProgress, 'extract', 'ok', { elements: elements.length, ms: extractionMs, reused: true });
              for (const stage of ['chunk', 'embed'] as const) {
                progress(now, input.onProgress, stage, 'start'); progress(now, input.onProgress, stage, 'ok', { chunks: chunks.length, calls: 0, ms: 0, reused: true });
              }
              return { status: 'prepared', bundle, identity: preparedIdentityOf(bundle.version), metrics, browserFallback, reused: true };
            }
          }
        }
        let provisionalVersionId = versionIdFor(id, identityFor(contentHash, identity.dims));
        const elements: DocumentElement[] = extracted.elements.map((element, order) => ({
          ...element,
          id: `el-${hash(`${provisionalVersionId}|${order}|${element.text}`).slice(0, 32)}`,
          sourceId: id,
          versionId: provisionalVersionId,
          order,
        }));
        progress(now, input.onProgress, 'extract', 'ok', { elements: elements.length, pages: extracted.pages, ms: extractionMs });

        progress(now, input.onProgress, 'chunk', 'start');
        const chunkingStarted = performance.now();
        const chunked = await chunker.chunk(elements, { signal: input.signal });
        const chunkingMs = performance.now() - chunkingStarted;
        if (chunked.chunks.some((chunk) => chunk.tokenCount > chunkerConfig.maxTokens)) {
          throw new DocumentError('chunk-budget', `Chunker emitted a chunk larger than ${chunkerConfig.maxTokens} tokens`);
        }
        progress(now, input.onProgress, 'chunk', 'ok', { chunks: chunked.chunks.length, ms: chunkingMs, diagnostic: chunked.diagnostic });

        progress(now, input.onProgress, 'embed', 'start');
        const embeddingStarted = performance.now();
        const vectors: number[][] = [];
        // Counted, never assumed: a chunker that embeds its elements has
        // already spent calls, and how many is its business, not ours.
        let embeddingCalls = chunkerEmbedCalls;
        for (let start = 0; start < chunked.chunks.length; start += batchSize) {
          const batch = chunked.chunks.slice(start, start + batchSize);
          const embedded = await embedder.embed(batch.map((chunk) => chunk.text), { signal: input.signal });
          vectors.push(...embedded.map((vector) => Array.from(vector)));
          embeddingCalls++;
        }
        const dims = embedder.dims ?? vectors[0]?.length;
        if (dims === undefined || vectors.some((vector) => vector.length !== dims)) {
          throw new DocumentError('embedding-width', 'Embedder returned inconsistent vector widths');
        }
        const embeddedBy = { model: embedder.model, dims };
        const resolvedVersionId = versionIdFor(id, identityFor(contentHash, dims));
        if (resolvedVersionId !== provisionalVersionId) {
          const remapped = new Map(elements.map(element => [element.id, `el-${hash(`${resolvedVersionId}|${element.order}|${element.text}`).slice(0, 32)}`]));
          for (const element of elements) { element.id = remapped.get(element.id)!; element.versionId = resolvedVersionId; }
          for (const chunk of chunked.chunks) { chunk.elementIds = chunk.elementIds.map(element => remapped.get(element)!);
            if (chunk.carriedElementIds) chunk.carriedElementIds = chunk.carriedElementIds.map(element => remapped.get(element)!); }
          for (const parent of chunked.parents ?? []) parent.elementIds = parent.elementIds.map(element => remapped.get(element)!);
          provisionalVersionId = resolvedVersionId;
        }
        const chunkIds = chunked.chunks.map((chunk, order) => `chk-${hash(`${provisionalVersionId}|${order}|${chunk.text}`).slice(0, 32)}`);
        const parents: DocumentParent[] = (chunked.parents ?? []).map(({ childIndexes, contentStartOrder: _, ...parent }, order) => ({
          ...parent, id: `par-${hash(`${provisionalVersionId}|${order}|${parent.text}`).slice(0, 32)}`,
          sourceId: id, versionId: provisionalVersionId, childIds: childIndexes.map(index => chunkIds[index]),
        }));
        const parentByChild = new Map(parents.flatMap(parent => parent.childIds.map(childId => [childId, parent] as const)));
        const headings = elements.filter(element => (element.role === 'heading' || element.role === 'title') && element.headingPath.length);
        const byElement = new Map(elements.map(element => [element.id, element]));
        const chunks: DocumentChunk[] = chunked.chunks.map(({ contentStartOrder, ...chunk }, order) => {
          const parent = parentByChild.get(chunkIds[order]);
          const firstOrder = contentStartOrder ?? Math.min(...chunk.elementIds.map(id => byElement.get(id)!.order));
          const heading = [...headings].reverse().find(element => element.order <= firstOrder && element.headingPath.join('\u0000') === chunk.headingPath.join('\u0000'));
          const peers = parent?.childIds ?? chunkIds, position = peers.indexOf(chunkIds[order]);
          return {
            ...chunk, id: chunkIds[order], sourceId: id, versionId: provisionalVersionId,
            previousId: peers[position - 1], nextId: peers[position + 1],
            ...(parent ? { parentChunkId: parent.id } : { parentId: heading?.id }),
            embedding: vectors[order], embeddedBy,
          };
        });
        const embeddingMs = performance.now() - embeddingStarted;
        progress(now, input.onProgress, 'embed', 'ok', { chunks: chunks.length, calls: embeddingCalls, dims, ms: embeddingMs });

        const warnings = [...extracted.warnings, ...chunked.diagnostic.warnings];
        version = {
          id: provisionalVersionId,
          sourceId: id,
          contentHash,
          extractionVersion: EXTRACTION_VERSION,
          chunkerVersion: chunker.version,
          chunkerConfig,
          embeddedBy,
          status: 'staging',
          fetchedAt,
          metrics: {
            bytes: bytes.length,
            pages: extracted.pages,
            elements: elements.length,
            chunks: chunks.length,
            ...(chunked.parents ? { parents: parents.length } : {}),
            extractionMs,
            chunkingMs,
            embeddingMs,
            embeddingCalls,
            estimatedEmbeddingTokens: chunked.chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0),
            partial: warnings.some((warning) => warning.startsWith('partial extraction')),
            warnings,
          },
        };
        const bundle = { source: sourceFor(version.id), version, elements, chunks, ...(chunked.parents ? { parents } : {}) };
        assertStoredDocumentBundle(bundle);
        return { status: 'prepared', bundle, identity: preparedIdentityOf(version), metrics: version.metrics, browserFallback, reused: false };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const code = error instanceof DocumentError ? error.code : 'ingest-failed';
        const status = code === 'dynamic-unavailable' ? 'dynamic-unavailable' as const
          : code.startsWith('blocked') || code === 'robots-denied' ? 'blocked' as const : 'failed' as const;
        const source: DocumentSource = {
          id,
          requestedUrl,
          finalUrl,
          canonicalUrl: existing?.canonicalUrl ?? finalUrl,
          title: existing?.title ?? null,
          mimeType: existing?.mimeType ?? mimeType,
          fetchMode,
          status,
          fetchedAt,
          etag: etag ?? existing?.etag,
          lastModified: lastModified ?? existing?.lastModified,
          activeVersionId: existing?.activeVersionId,
          error: reason,
        };
        if (version !== undefined) version = { ...version, status: 'failed', error: reason };
        for (const stage of ['fetch', 'extract', 'chunk', 'embed', 'store'] as IngestStage[]) {
          progress(now, input.onProgress, stage, 'error', { code, error: reason });
        }
        return { status: 'failed', source, ...(version ? { version } : {}), error: { code, message: reason,
          ...(error instanceof DocumentError && error.details ? { details: error.details } : {}) } };
      }
    },

    async ingest(input) {
      const prepared = await this.prepare(input);
      if (prepared.status === 'unchanged') return prepared;
      if (prepared.status === 'failed') {
        await store.recordFailure(prepared.source, prepared.version);
        throw new DocumentError(prepared.error.code, prepared.error.message, prepared.error.details);
      }
      const { bundle, browserFallback } = prepared;
      const previous = await store.getSource(bundle.source.id);
      try {
        progress(now, input.onProgress, 'store', 'start');
        await store.activate(bundle);
        const version = { ...bundle.version, status: 'active' as const, activatedAt: bundle.source.fetchedAt };
        progress(now, input.onProgress, 'store', 'ok', { versionId: version.id });
        return { status: 'ingested', source: bundle.source, version, browserFallback };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error), code = error instanceof DocumentError ? error.code : 'ingest-failed';
        await store.recordFailure({ ...bundle.source, status: 'failed', activeVersionId: previous?.activeVersionId, error: reason }, { ...bundle.version, status: 'failed', error: reason });
        for (const stage of ['fetch', 'extract', 'chunk', 'embed', 'store'] as IngestStage[]) progress(now, input.onProgress, stage, 'error', { code, error: reason });
        throw error instanceof DocumentError ? error : new DocumentError(code, reason);
      }
    },

    async ingestMany(inputs, manyOptions = {}) {
      // an ordinary fetch/extraction failure is this input's VALUE, so the
      // batch never rejects and every input keeps its slot in input order;
      // bounded dispatch is the suite's, not a local pool
      return mapConcurrent(inputs, Math.max(1, manyOptions.concurrency ?? 3), async (input) => {
        try {
          return { url: input.url, outcome: await this.ingest(input) };
        } catch (error) {
          return {
            url: input.url,
            error: {
              code: error instanceof DocumentError ? error.code : 'ingest-failed',
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      });
    },
  };
}
