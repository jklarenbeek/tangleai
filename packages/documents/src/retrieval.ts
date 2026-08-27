import type { Embedder } from '@jarenjs/ai/embed';
import { cosineSimilarity, type Vector } from '@jarenjs/core/vector';
import { sameIdentity } from '@jarenjs/ai';

import type { DocumentChunk, DocumentCorpusStore, DocumentSource, EmbeddedBy } from './contracts.ts';

export interface DocumentCitation {
  chunkId: string;
  sourceId: string;
  url: string;
  title: string | null;
  page?: number;
  headingPath: string[];
  elementIds: string[];
}

export interface RankedDocumentChunk {
  chunk: DocumentChunk;
  source: DocumentSource;
  score: number;
  context: DocumentChunk[];
  citation: DocumentCitation;
}

export interface DocumentRecall {
  ranked: RankedDocumentChunk[];
  skipped: number;
}

export interface DocumentSearchOptions {
  k?: number;
  minScore?: number;
  maxPerSource?: number;
  neighbours?: number;
}

export async function recallDocumentChunks(
  store: DocumentCorpusStore,
  query: Vector,
  identity: EmbeddedBy,
  options: DocumentSearchOptions = {},
): Promise<DocumentRecall> {
  const sources = (await store.listSources()).filter((source) => source.status === 'ready' && source.activeVersionId !== undefined);
  const sourceByVersion = new Map(sources.map((source) => [source.activeVersionId as string, source]));
  const chunks = (await store.listChunks()).filter((chunk) => sourceByVersion.has(chunk.versionId));
  let skipped = 0;
  const scored: Array<{ chunk: DocumentChunk; source: DocumentSource; score: number }> = [];
  for (const chunk of chunks) {
    if (!sameIdentity(chunk.embeddedBy, identity) || chunk.embedding.length !== query.length) {
      skipped++;
      continue;
    }
    scored.push({ chunk, source: sourceByVersion.get(chunk.versionId) as DocumentSource, score: cosineSimilarity(chunk.embedding, query) });
  }
  scored.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  const k = Math.max(1, options.k ?? 8);
  const maxPerSource = Math.max(1, options.maxPerSource ?? 3);
  const counts = new Map<string, number>();
  const selected = scored.filter((item) => {
    if (item.score < (options.minScore ?? 0)) return false;
    const count = counts.get(item.source.id) ?? 0;
    if (count >= maxPerSource) return false;
    counts.set(item.source.id, count + 1);
    return true;
  }).slice(0, k);
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const byElement = new Map<string, DocumentChunk>();
  for (const chunk of chunks) for (const elementId of chunk.elementIds) byElement.set(elementId, chunk);
  const neighbours = Math.max(0, options.neighbours ?? 1);
  const ranked = selected.map<RankedDocumentChunk>((item) => {
    const context: DocumentChunk[] = [item.chunk];
    if (item.chunk.parentId !== undefined) {
      const parent = byElement.get(item.chunk.parentId);
      if (parent !== undefined && parent.versionId === item.chunk.versionId && parent.id !== item.chunk.id) context.unshift(parent);
    }
    let prior = item.chunk;
    let next = item.chunk;
    for (let distance = 0; distance < neighbours; distance++) {
      if (prior.previousId !== undefined) {
        const found = byId.get(prior.previousId);
        if (found !== undefined && found.versionId === item.chunk.versionId) {
          if (!context.some((chunk) => chunk.id === found.id)) context.unshift(found);
          prior = found;
        }
      }
      if (next.nextId !== undefined) {
        const found = byId.get(next.nextId);
        if (found !== undefined && found.versionId === item.chunk.versionId) {
          if (!context.some((chunk) => chunk.id === found.id)) context.push(found);
          next = found;
        }
      }
    }
    return {
      ...item,
      context,
      citation: {
        chunkId: item.chunk.id,
        sourceId: item.source.id,
        url: item.source.canonicalUrl,
        title: item.source.title,
        page: item.chunk.pageStart,
        headingPath: item.chunk.headingPath,
        elementIds: item.chunk.elementIds,
      },
    };
  });
  return { ranked, skipped };
}

export async function searchDocuments(
  store: DocumentCorpusStore,
  embedder: Embedder,
  text: string,
  options: DocumentSearchOptions = {},
): Promise<DocumentRecall> {
  const [query] = await embedder.embed([text]);
  const identity = { model: embedder.model, dims: embedder.dims ?? query.length };
  return recallDocumentChunks(store, query, identity, options);
}
