import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createOfflineEmbedder } from '@tangleai/pipeline';
import { estimateTokens } from '@tangleai/core/tokens';
import {
  RecursiveDocumentChunker,
  S2DocumentChunker,
  SemanticBoundaryChunker,
  extractTextDocument,
  extractPdf,
  type DocumentElement,
} from '@tangleai/documents';

const fixture = (name: string): URL => new URL(`../fixtures/documents/${name}`, import.meta.url);

async function oversizedElements(): Promise<DocumentElement[]> {
  const text = await readFile(fixture('oversized.txt'), 'utf8');
  return extractTextDocument(text, false).elements.map((element, order) => ({
    ...element, id: `e-${order}`, sourceId: 'source', versionId: 'version', order,
  }));
}

describe('document chunkers', () => {
  it('guarantees the hard token bound even for one oversized atomic element', async () => {
    const chunker = new RecursiveDocumentChunker({ maxTokens: 32, overlapTokens: 4 });
    const result = await chunker.chunk(await oversizedElements());
    assert.ok(result.chunks.length > 4);
    assert.ok(result.chunks.every((chunk) => chunk.tokenCount <= 32));
    assert.ok(result.chunks.every((chunk) => estimateTokens(chunk.text) <= 32));
    assert.ok(result.chunks.every((chunk) => chunk.elementIds[0] === 'e-0'));
  });

  it('runs deterministic, capped S2 clustering and preserves contiguous reading order', async () => {
    const elements = Array.from({ length: 12 }, (_, order): DocumentElement => ({
      id: `e-${order}`, sourceId: 's', versionId: 'v', order,
      text: `${order < 6 ? 'alpha deployment' : 'beta finance'} section ${order} with supporting detail`,
      role: order === 0 || order === 6 ? 'heading' : 'paragraph',
      headingPath: [order < 6 ? 'Alpha' : 'Beta'],
      centroid: { x: order < 6 ? 0 : 1, y: order },
    }));
    const embedder = createOfflineEmbedder();
    const first = await new S2DocumentChunker({ embedder, maxTokens: 30, overlapTokens: 0, maxSpectralElements: 8 }).chunk(elements);
    const second = await new S2DocumentChunker({ embedder, maxTokens: 30, overlapTokens: 0, maxSpectralElements: 8 }).chunk(elements);
    assert.deepEqual(first.chunks.map((chunk) => chunk.text), second.chunks.map((chunk) => chunk.text));
    assert.equal(first.diagnostic.partitions, 2);
    assert.ok(first.chunks.every((chunk) => chunk.tokenCount <= 30));
    for (const chunk of first.chunks) {
      const orders = chunk.elementIds.map((id) => Number(id.slice(2)));
      assert.ok(orders.every((value, index) => index === 0 || value >= orders[index - 1]));
    }
  });

  it('keeps a semantic-boundary comparison baseline behind the same contract', async () => {
    const elements = await oversizedElements();
    const result = await new SemanticBoundaryChunker({ embedder: createOfflineEmbedder(), maxTokens: 40 }).chunk(elements);
    assert.equal(result.diagnostic.algorithm, 'semantic-boundary/1');
    assert.ok(result.chunks.every((chunk) => chunk.tokenCount <= 40));
  });

  it('keeps in-budget table rows atomic and reports chunks that cross a page boundary', async () => {
    const encoded = (await readFile(fixture('table-figure.pdf.b64'), 'utf8')).trim();
    const parsed = await extractPdf(new Uint8Array(Buffer.from(encoded, 'base64')));
    const tableElements = parsed.elements.map((element, order): DocumentElement => ({
      ...element, id: `table-${order}`, sourceId: 'table', versionId: 'v', order,
    }));
    const tableChunks = (await new RecursiveDocumentChunker({ maxTokens: 64, overlapTokens: 0 }).chunk(tableElements)).chunks;
    for (const row of parsed.elements.filter((element) => element.role === 'table')) {
      assert.ok(tableChunks.some((chunk) => chunk.text.includes(row.text)), `table row stayed intact: ${row.text}`);
    }

    const pages: DocumentElement[] = [
      { id: 'p1', sourceId: 's', versionId: 'v', text: 'end of page one', role: 'paragraph', order: 0, headingPath: [], page: 1 },
      { id: 'p2', sourceId: 's', versionId: 'v', text: 'start of page two', role: 'paragraph', order: 1, headingPath: [], page: 2 },
    ];
    const [crossPage] = (await new RecursiveDocumentChunker({ maxTokens: 64, overlapTokens: 0 }).chunk(pages)).chunks;
    assert.equal(crossPage.pageStart, 1);
    assert.equal(crossPage.pageEnd, 2);
    assert.equal(crossPage.bbox, undefined, 'page-local boxes are not unioned across pages');
  });
});
