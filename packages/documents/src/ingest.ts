import { createHash } from 'node:crypto';

import type { Embedder } from '@jarenjs/ai/embed';
import { estimateTokens } from '@tangleai/core/tokens';

import { likelyDynamicShell, type BrowserFetcher, UnavailableBrowserFetcher } from './browser.ts';
import { RecursiveDocumentChunker, S2DocumentChunker, SemanticBoundaryChunker } from './chunking.ts';
import {
  EXTRACTION_VERSION,
  DocumentError,
  type Chunker,
  type DocumentChunk,
  type DocumentCorpusStore,
  type DocumentElement,
  type DocumentSource,
  type DocumentVersion,
  type FetchMode,
} from './contracts.ts';
import { DEFAULT_EXTRACT_LIMITS, extractDocument, extractHtml, type ExtractLimits } from './extract.ts';
import { SafeStaticFetcher } from './fetch.ts';
import { normalizeUrl } from './url-policy.ts';

export type ChunkerStrategy = 'recursive' | 'semantic-boundary' | 's2';
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

function sourceId(url: string): string {
  return `src-${hash(url).slice(0, 24)}`;
}

function progress(now: () => string, callback: IngestUrlInput['onProgress'], stage: IngestStage, status: IngestProgress['status'], detail?: Record<string, unknown>): void {
  callback?.({ stage, status, at: now(), detail });
}

function chunkerFor(strategy: ChunkerStrategy, embedder: Embedder, maxTokens: number, overlapTokens: number): Chunker {
  if (strategy === 's2') return new S2DocumentChunker({ embedder, maxTokens, overlapTokens });
  if (strategy === 'semantic-boundary') return new SemanticBoundaryChunker({ embedder, maxTokens, overlapTokens });
  return new RecursiveDocumentChunker({ maxTokens, overlapTokens });
}

function usefulChars(elements: Array<{ text: string }>): number {
  return elements.reduce((sum, element) => sum + element.text.length, 0);
}

export interface DocumentIngester {
  ingest(input: IngestUrlInput): Promise<IngestUrlOutcome>;
  ingestMany(inputs: IngestUrlInput[], options?: { concurrency?: number }): Promise<Array<{ url: string; outcome?: IngestUrlOutcome; error?: { code: string; message: string } }>>;
}

export function createDocumentIngester(options: DocumentIngesterOptions): DocumentIngester {
  const { store, fetcher, embedder } = options;
  const browser = options.browser ?? new UnavailableBrowserFetcher();
  const now = options.now ?? ((): string => new Date().toISOString());
  const batchSize = Math.max(1, options.embedBatchSize ?? 32);

  return {
    async ingest(input) {
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
      const chunker = chunkerFor(strategy, embedder, maxTokens, overlapTokens);
      const chunkerConfig = { maxTokens, overlapTokens };

      try {
        progress(now, input.onProgress, 'fetch', 'start');
        const fetched = await fetcher.fetch(requestedUrl, input.force === true ? {} : {
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
          if (active === undefined) throw new DocumentError('invalid-cache', 'Active document version is missing');
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
        if (input.force !== true && active !== undefined && active.contentHash === contentHash
          && active.chunkerVersion === chunker.version && active.embeddedBy.model === identity.model
          && active.chunkerConfig?.maxTokens === maxTokens && active.chunkerConfig.overlapTokens === overlapTokens
          && (identity.dims === 0 || active.embeddedBy.dims === identity.dims)) {
          const source: DocumentSource = {
            ...(existing as DocumentSource), finalUrl, canonicalUrl, title: extracted.title, mimeType,
            fetchMode, status: 'ready', fetchedAt, etag, lastModified, error: undefined,
          };
          await store.putSource(source);
          progress(now, input.onProgress, 'extract', 'ok', { unchanged: true, elements: extracted.elements.length });
          return { status: 'unchanged', source, version: active, browserFallback };
        }

        const provisionalVersionId = `ver-${hash(`${id}|${contentHash}|${EXTRACTION_VERSION}|${chunker.version}|${maxTokens}|${overlapTokens}|${identity.model}|${identity.dims}`).slice(0, 32)}`;
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
        if (chunked.chunks.some((chunk) => chunk.tokenCount > maxTokens)) {
          throw new DocumentError('chunk-budget', `Chunker emitted a chunk larger than ${maxTokens} tokens`);
        }
        progress(now, input.onProgress, 'chunk', 'ok', { chunks: chunked.chunks.length, ms: chunkingMs, diagnostic: chunked.diagnostic });

        progress(now, input.onProgress, 'embed', 'start');
        const embeddingStarted = performance.now();
        const vectors: number[][] = [];
        let embeddingCalls = strategy === 'recursive' ? 0 : 1;
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
        const chunkIds = chunked.chunks.map((chunk, order) => `chk-${hash(`${provisionalVersionId}|${order}|${chunk.text}`).slice(0, 32)}`);
        const headingElements = new Map<string, string>();
        for (const element of elements) {
          if ((element.role === 'heading' || element.role === 'title') && element.headingPath.length > 0) {
            headingElements.set(element.headingPath.join('\u0000'), element.id);
          }
        }
        const chunks: DocumentChunk[] = chunked.chunks.map((chunk, order) => ({
          ...chunk,
          id: chunkIds[order],
          sourceId: id,
          versionId: provisionalVersionId,
          previousId: order === 0 ? undefined : chunkIds[order - 1],
          nextId: order + 1 === chunkIds.length ? undefined : chunkIds[order + 1],
          parentId: headingElements.get(chunk.headingPath.join('\u0000')),
          embedding: vectors[order],
          embeddedBy,
        }));
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
            extractionMs,
            chunkingMs,
            embeddingMs,
            embeddingCalls,
            estimatedEmbeddingTokens: chunked.chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0),
            partial: warnings.some((warning) => warning.startsWith('partial extraction')),
            warnings,
          },
        };
        const source: DocumentSource = {
          id,
          requestedUrl,
          finalUrl,
          canonicalUrl,
          title: extracted.title,
          mimeType,
          fetchMode,
          status: 'ready',
          fetchedAt,
          etag,
          lastModified,
          activeVersionId: version.id,
        };
        progress(now, input.onProgress, 'store', 'start');
        await store.activate({ source, version, elements, chunks });
        const activeVersion = { ...version, status: 'active' as const, activatedAt: fetchedAt };
        progress(now, input.onProgress, 'store', 'ok', { versionId: version.id });
        return { status: 'ingested', source, version: activeVersion, browserFallback };
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
        await store.recordFailure(source, version);
        for (const stage of ['fetch', 'extract', 'chunk', 'embed', 'store'] as IngestStage[]) {
          progress(now, input.onProgress, stage, 'error', { code, error: reason });
        }
        throw error instanceof DocumentError ? error : new DocumentError(code, reason);
      }
    },

    async ingestMany(inputs, manyOptions = {}) {
      const concurrency = Math.max(1, manyOptions.concurrency ?? 3);
      const results: Array<{ url: string; outcome?: IngestUrlOutcome; error?: { code: string; message: string } }> = new Array(inputs.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
        while (cursor < inputs.length) {
          const index = cursor++;
          const input = inputs[index];
          try {
            results[index] = { url: input.url, outcome: await this.ingest(input) };
          } catch (error) {
            results[index] = {
              url: input.url,
              error: {
                code: error instanceof DocumentError ? error.code : 'ingest-failed',
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        }
      });
      await Promise.all(workers);
      return results;
    },
  };
}
