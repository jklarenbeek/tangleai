/** Fixed-corpus extraction/chunk/retrieval benchmark. Prints Markdown for review/CI artifacts. */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createOfflineEmbedder } from '@tangleai/pipeline';
import { estimateTokens } from '@tangleai/core/tokens';
import {
  RecursiveDocumentChunker,
  S2DocumentChunker,
  SemanticBoundaryChunker,
  extractHtml,
  extractPdf,
  extractTextDocument,
  type Chunker,
  type DocumentElement,
} from '@tangleai/documents';

const root = process.cwd();
const fixtures = join(root, 'test/fixtures/documents');
const load = (name: string): Promise<string> => readFile(join(fixtures, name), 'utf8');

const base = createOfflineEmbedder();
let calls = 0;
let embeddedTexts = 0;
let embeddedTokens = 0;
const embedder = {
  model: base.model,
  dims: base.dims,
  async embed(texts: string[], options?: { signal?: AbortSignal }) {
    calls++;
    embeddedTexts += texts.length;
    embeddedTokens += texts.reduce((sum, text) => sum + estimateTokens(text), 0);
    return base.embed(texts, options);
  },
};

function elements(sourceId: string, drafts: Array<Omit<DocumentElement, 'id' | 'sourceId' | 'versionId'>>): DocumentElement[] {
  return drafts.map((draft, order) => ({ ...draft, id: `${sourceId}-e${order}`, sourceId, versionId: `${sourceId}-v1`, order }));
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, aa = 0, bb = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]; aa += a[index] * a[index]; bb += b[index] * b[index];
  }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}

const extractionStarted = performance.now();
const staticDoc = extractHtml(await load('static.html'), 'https://docs.example/original', { minUsefulChars: 1 });
const wiki = extractHtml(await load('noisy-wikipedia.html'), 'https://en.wikipedia.org/wiki/Vitamin_E', { minUsefulChars: 1 });
const markdown = extractTextDocument(await load('structured.md'), true);
const multi = await extractPdf(new Uint8Array(Buffer.from((await load('multicolumn.pdf.b64')).trim(), 'base64')));
const table = await extractPdf(new Uint8Array(Buffer.from((await load('table-figure.pdf.b64')).trim(), 'base64')));
const extractionMs = performance.now() - extractionStarted;

const corpus = [
  { id: 'static', title: 'Release guide', elements: elements('static', staticDoc.elements) },
  { id: 'wiki', title: 'Vitamin E', elements: elements('wiki', wiki.elements) },
  { id: 'markdown', title: 'Operations handbook', elements: elements('markdown', markdown.elements) },
  { id: 'multi', title: 'Multi-column PDF', elements: elements('multi', multi.elements) },
  { id: 'table', title: 'Table/figure PDF', elements: elements('table', table.elements) },
];
const questions = JSON.parse(await load('questions.json')) as Array<{ question: string; relevant: string[] }>;

const strategies: Array<{ name: string; make(): Chunker }> = [
  { name: 'heading-recursive', make: () => new RecursiveDocumentChunker({ maxTokens: 64, overlapTokens: 8 }) },
  { name: 'semantic-boundary', make: () => new SemanticBoundaryChunker({ embedder, maxTokens: 64, overlapTokens: 8 }) },
  { name: 'corrected-s2', make: () => new S2DocumentChunker({ embedder, maxTokens: 64, overlapTokens: 8, maxSpectralElements: 32 }) },
];

const rows: Array<Record<string, string | number>> = [];
for (const strategy of strategies) {
  calls = 0;
  embeddedTexts = 0;
  embeddedTokens = 0;
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const chunks: Array<{ source: string; text: string; tokenCount: number; elementIds: string[]; vector: number[] }> = [];
  for (const document of corpus) {
    const result = await strategy.make().chunk(document.elements);
    const vectors = await embedder.embed(result.chunks.map((chunk) => chunk.text));
    result.chunks.forEach((chunk, index) => chunks.push({
      source: document.id,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
      elementIds: chunk.elementIds,
      vector: Array.from(vectors[index]),
    }));
  }
  const queryVectors = await embedder.embed(questions.map((question) => question.question));
  let reciprocalRank = 0;
  let recalled = 0;
  questions.forEach((question, qIndex) => {
    const ranked = chunks.map((chunk) => ({ chunk, score: cosine(queryVectors[qIndex], chunk.vector) }))
      .sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex(({ chunk }) => question.relevant.every((needle) => chunk.text.toLowerCase().includes(needle.toLowerCase()))) + 1;
    if (rank > 0) reciprocalRank += 1 / rank;
    if (rank > 0 && rank <= 5) recalled++;
  });
  const knownIds = new Set(corpus.flatMap((document) => document.elements.map((element) => element.id)));
  const provenance = chunks.every((chunk) => chunk.elementIds.length > 0 && chunk.elementIds.every((id) => knownIds.has(id)));
  const elapsed = performance.now() - started;
  rows.push({
    strategy: strategy.name,
    chunks: chunks.length,
    recall: recalled / questions.length,
    mrr: reciprocalRank / questions.length,
    violations: chunks.filter((chunk) => chunk.tokenCount > 64 || estimateTokens(chunk.text) > 64).length,
    citations: provenance ? '100%' : 'failed',
    ms: elapsed.toFixed(1),
    heap: ((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2),
    calls,
    embeddedTexts,
    embeddedTokens,
  });
}

const wikiText = wiki.elements.map((element) => element.text).join(' ');
const noiseTerms = ['Account tools', 'Reference list boilerplate', 'Privacy policy', 'Contents Uses'];
const noiseHits = noiseTerms.filter((term) => wikiText.includes(term)).length;
const bun = process.versions.bun ?? 'not-running-under-bun';
const generated = new Date().toISOString();

console.log(`# Document ingestion benchmark\n\nGenerated ${generated} with Bun ${bun}; embedder ${embedder.model}/${embedder.dims}.`);
console.log(`\nFixed corpus: ${corpus.length} documents, ${corpus.reduce((sum, document) => sum + document.elements.length, 0)} typed elements, ${questions.length} labelled questions.`);
console.log(`\nExtraction: ${extractionMs.toFixed(1)} ms; known Wikipedia boilerplate hits: ${noiseHits}/${noiseTerms.length}; multi-column order: ${multi.elements.map((element) => element.text).join(' → ')}.`);
console.log('\n| Strategy | Chunks | Recall@5 | MRR | >64-token violations | Resolvable provenance | ms | heap delta MiB | embed calls | embedded texts | est. tokens |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const row of rows) {
  console.log(`| ${row.strategy} | ${row.chunks} | ${(Number(row.recall) * 100).toFixed(1)}% | ${Number(row.mrr).toFixed(3)} | ${row.violations} | ${row.citations} | ${row.ms} | ${row.heap} | ${row.calls} | ${row.embeddedTexts} | ${row.embeddedTokens} |`);
}
console.log('\nThis fixture benchmark is a regression gate, not evidence that the tiny offline hash embedder predicts production semantic quality. Keep recursive chunking as the default until a representative corpus shows a repeatable S2 retrieval gain worth its extra element-embedding work.');
