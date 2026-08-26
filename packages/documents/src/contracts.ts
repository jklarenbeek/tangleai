/** Plain, storage-safe contracts for the document corpus lane. */

import type { EmbeddedBy } from '@tangleai/core/schemas/memory';

/** The corpus lane ranks against the SAME identity the memory lane does —
 * one definition per repo, not one per lane. */
export type { EmbeddedBy };

export const EXTRACTION_VERSION = 'tangle-extract/1';
export const RECURSIVE_CHUNKER_VERSION = 'heading-recursive/1';
export const S2_CHUNKER_VERSION = 's2-contiguous/1';

export type FetchMode = 'static' | 'bun-webview' | 'remote-playwright';
export type SourceStatus = 'ready' | 'failed' | 'blocked' | 'dynamic-unavailable';
export type VersionStatus = 'staging' | 'active' | 'failed' | 'superseded';
export type ElementRole =
  | 'title' | 'heading' | 'paragraph' | 'list-item' | 'code' | 'quote'
  | 'table' | 'figure-caption' | 'navigation' | 'toc' | 'reference-list'
  | 'footer' | 'related' | 'unknown';

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DocumentSource {
  id: string;
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  title: string | null;
  mimeType: string;
  fetchMode: FetchMode;
  status: SourceStatus;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  activeVersionId?: string;
  error?: string;
}

export interface DocumentVersionMetrics {
  bytes: number;
  pages?: number;
  elements: number;
  chunks: number;
  extractionMs: number;
  chunkingMs: number;
  embeddingMs: number;
  embeddingCalls: number;
  estimatedEmbeddingTokens: number;
  partial: boolean;
  warnings: string[];
}

export interface DocumentVersion {
  id: string;
  sourceId: string;
  contentHash: string;
  extractionVersion: string;
  chunkerVersion: string;
  chunkerConfig: { maxTokens: number; overlapTokens: number };
  embeddedBy: EmbeddedBy;
  status: VersionStatus;
  fetchedAt: string;
  activatedAt?: string;
  supersededAt?: string;
  error?: string;
  metrics: DocumentVersionMetrics;
}

export interface DocumentLink {
  text: string;
  url: string;
}

export interface DocumentElement {
  id: string;
  sourceId: string;
  versionId: string;
  text: string;
  role: ElementRole;
  order: number;
  headingPath: string[];
  page?: number;
  bbox?: BoundingBox;
  centroid?: { x: number; y: number };
  links?: DocumentLink[];
}

export interface DocumentChunk {
  id: string;
  sourceId: string;
  versionId: string;
  elementIds: string[];
  text: string;
  tokenCount: number;
  order: number;
  headingPath: string[];
  pageStart?: number;
  pageEnd?: number;
  bbox?: BoundingBox;
  parentId?: string;
  previousId?: string;
  nextId?: string;
  embedding: number[];
  embeddedBy: EmbeddedBy;
}

export interface ExtractedDocument {
  title: string | null;
  canonicalUrl?: string;
  elements: Omit<DocumentElement, 'id' | 'sourceId' | 'versionId'>[];
  pages?: number;
  warnings: string[];
}

export interface ChunkDiagnostic {
  algorithm: string;
  fallback?: string;
  partitions?: number;
  spectralRuns?: number;
  converged?: boolean;
  rotations?: number;
  warnings: string[];
}

export interface ChunkDraft {
  elementIds: string[];
  text: string;
  tokenCount: number;
  order: number;
  headingPath: string[];
  pageStart?: number;
  pageEnd?: number;
  bbox?: BoundingBox;
  parentId?: string;
  previousId?: string;
  nextId?: string;
}

export interface ChunkResult {
  chunks: ChunkDraft[];
  diagnostic: ChunkDiagnostic;
}

export interface Chunker {
  readonly version: string;
  /** The EFFECTIVE budgets, after clamping — what a re-index must repeat
   * to be deterministic, which is not always what the caller asked for. */
  readonly maxTokens: number;
  readonly overlapTokens: number;
  chunk(elements: DocumentElement[], options?: { signal?: AbortSignal }): Promise<ChunkResult>;
}

export interface StoredDocumentBundle {
  source: DocumentSource;
  version: DocumentVersion;
  elements: DocumentElement[];
  chunks: DocumentChunk[];
}

export interface DocumentCorpusStore {
  getSource(id: string): Promise<DocumentSource | undefined>;
  listSources(): Promise<DocumentSource[]>;
  getVersion(id: string): Promise<DocumentVersion | undefined>;
  listVersions(sourceId?: string): Promise<DocumentVersion[]>;
  listElements(versionId: string): Promise<DocumentElement[]>;
  listChunks(versionId?: string): Promise<DocumentChunk[]>;
  putSource(source: DocumentSource): Promise<void>;
  activate(bundle: StoredDocumentBundle): Promise<void>;
  recordFailure(source: DocumentSource, version?: DocumentVersion): Promise<void>;
}

export class DocumentError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
    this.details = details;
  }
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DocumentError('invalid-record', `${name} must be an object`);
  }
}

function nonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocumentError('invalid-record', `${name} must be a non-empty string`);
  }
}

function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DocumentError('invalid-record', `${name} must be finite`);
  }
}

function integer(value: unknown, name: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new DocumentError('invalid-record', `${name} must be an integer >= ${minimum}`);
  }
}

function optionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new DocumentError('invalid-record', `${name} must be a string when present`);
  }
}

function oneOf(value: unknown, choices: readonly string[], name: string): void {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new DocumentError('invalid-record', `${name} is not an allowed value`);
  }
}

function assertBox(value: unknown, name: string): void {
  object(value, name);
  for (const key of ['x', 'y', 'w', 'h']) finite(value[key], `${name}.${key}`);
  if ((value.w as number) < 0 || (value.h as number) < 0) {
    throw new DocumentError('invalid-record', `${name} width and height cannot be negative`);
  }
}

function strings(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DocumentError('invalid-record', `${name} must be a string array`);
  }
}

export function assertDocumentSource(value: unknown): asserts value is DocumentSource {
  object(value, 'DocumentSource');
  for (const key of ['id', 'requestedUrl', 'finalUrl', 'canonicalUrl', 'mimeType', 'fetchMode', 'status', 'fetchedAt']) {
    nonEmpty(value[key], `DocumentSource.${key}`);
  }
  for (const key of ['requestedUrl', 'finalUrl', 'canonicalUrl']) {
    try {
      const parsed = new URL(value[key] as string);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    } catch {
      throw new DocumentError('invalid-record', `DocumentSource.${key} must be a valid HTTP(S) URL`);
    }
  }
  if (value.title !== null && typeof value.title !== 'string') throw new DocumentError('invalid-record', 'DocumentSource.title must be a string or null');
  oneOf(value.fetchMode, ['static', 'bun-webview', 'remote-playwright'], 'DocumentSource.fetchMode');
  oneOf(value.status, ['ready', 'failed', 'blocked', 'dynamic-unavailable'], 'DocumentSource.status');
  for (const key of ['etag', 'lastModified', 'activeVersionId', 'error']) optionalString(value[key], `DocumentSource.${key}`);
}

export function assertDocumentVersion(value: unknown): asserts value is DocumentVersion {
  object(value, 'DocumentVersion');
  for (const key of ['id', 'sourceId', 'contentHash', 'extractionVersion', 'chunkerVersion', 'status', 'fetchedAt']) {
    nonEmpty(value[key], `DocumentVersion.${key}`);
  }
  object(value.embeddedBy, 'DocumentVersion.embeddedBy');
  nonEmpty(value.embeddedBy.model, 'DocumentVersion.embeddedBy.model');
  integer(value.embeddedBy.dims, 'DocumentVersion.embeddedBy.dims', 1);
  object(value.chunkerConfig, 'DocumentVersion.chunkerConfig');
  integer(value.chunkerConfig.maxTokens, 'DocumentVersion.chunkerConfig.maxTokens', 1);
  integer(value.chunkerConfig.overlapTokens, 'DocumentVersion.chunkerConfig.overlapTokens');
  oneOf(value.status, ['staging', 'active', 'failed', 'superseded'], 'DocumentVersion.status');
  object(value.metrics, 'DocumentVersion.metrics');
  for (const key of ['bytes', 'elements', 'chunks', 'extractionMs', 'chunkingMs', 'embeddingMs', 'embeddingCalls', 'estimatedEmbeddingTokens']) {
    finite(value.metrics[key], `DocumentVersion.metrics.${key}`);
    if ((value.metrics[key] as number) < 0) throw new DocumentError('invalid-record', `DocumentVersion.metrics.${key} cannot be negative`);
  }
  if (value.metrics.pages !== undefined) integer(value.metrics.pages, 'DocumentVersion.metrics.pages');
  if (typeof value.metrics.partial !== 'boolean') throw new DocumentError('invalid-record', 'DocumentVersion.metrics.partial must be boolean');
  strings(value.metrics.warnings, 'DocumentVersion.metrics.warnings');
  for (const key of ['activatedAt', 'supersededAt', 'error']) optionalString(value[key], `DocumentVersion.${key}`);
}

export function assertDocumentElement(value: unknown): asserts value is DocumentElement {
  object(value, 'DocumentElement');
  for (const key of ['id', 'sourceId', 'versionId', 'text', 'role']) nonEmpty(value[key], `DocumentElement.${key}`);
  integer(value.order, 'DocumentElement.order');
  oneOf(value.role, ['title', 'heading', 'paragraph', 'list-item', 'code', 'quote', 'table', 'figure-caption', 'navigation', 'toc', 'reference-list', 'footer', 'related', 'unknown'], 'DocumentElement.role');
  strings(value.headingPath, 'DocumentElement.headingPath');
  if (value.page !== undefined) integer(value.page, 'DocumentElement.page', 1);
  if (value.bbox !== undefined) assertBox(value.bbox, 'DocumentElement.bbox');
  if (value.centroid !== undefined) {
    object(value.centroid, 'DocumentElement.centroid');
    finite(value.centroid.x, 'DocumentElement.centroid.x');
    finite(value.centroid.y, 'DocumentElement.centroid.y');
  }
  if (value.links !== undefined) {
    if (!Array.isArray(value.links)) throw new DocumentError('invalid-record', 'DocumentElement.links must be an array');
    for (const link of value.links) {
      object(link, 'DocumentElement.link');
      if (typeof link.text !== 'string') throw new DocumentError('invalid-record', 'DocumentElement.link.text must be a string');
      nonEmpty(link.url, 'DocumentElement.link.url');
    }
  }
}

export function assertDocumentChunk(value: unknown): asserts value is DocumentChunk {
  object(value, 'DocumentChunk');
  for (const key of ['id', 'sourceId', 'versionId', 'text']) nonEmpty(value[key], `DocumentChunk.${key}`);
  strings(value.elementIds, 'DocumentChunk.elementIds');
  if (value.elementIds.length === 0) throw new DocumentError('invalid-record', 'DocumentChunk.elementIds cannot be empty');
  strings(value.headingPath, 'DocumentChunk.headingPath');
  integer(value.order, 'DocumentChunk.order');
  integer(value.tokenCount, 'DocumentChunk.tokenCount', 1);
  if (!Array.isArray(value.embedding) || value.embedding.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new DocumentError('invalid-record', 'DocumentChunk.embedding must be a finite number array');
  }
  object(value.embeddedBy, 'DocumentChunk.embeddedBy');
  nonEmpty(value.embeddedBy.model, 'DocumentChunk.embeddedBy.model');
  integer(value.embeddedBy.dims, 'DocumentChunk.embeddedBy.dims', 1);
  if (value.embedding.length !== value.embeddedBy.dims) {
    throw new DocumentError('invalid-record', 'DocumentChunk embedding width does not match embeddedBy.dims');
  }
  if (value.pageStart !== undefined) integer(value.pageStart, 'DocumentChunk.pageStart', 1);
  if (value.pageEnd !== undefined) integer(value.pageEnd, 'DocumentChunk.pageEnd', 1);
  if (value.bbox !== undefined) assertBox(value.bbox, 'DocumentChunk.bbox');
  for (const key of ['parentId', 'previousId', 'nextId']) optionalString(value[key], `DocumentChunk.${key}`);
}
