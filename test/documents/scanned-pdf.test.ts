import { it } from 'node:test';
import assert from 'node:assert/strict';

import { extractPdf } from '../../packages/documents/src/extract.ts';
import { createDocumentIngester } from '../../packages/documents/src/ingest.ts';

/** A valid PDF of `pages` pages that carry no text: what a scan without a text layer looks like to an extractor. */
function blankPdf(pages: number): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>')];
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

it('a PDF whose pages carry no text warns image-only instead of answering nothing', async () => {
  const extracted = await extractPdf(blankPdf(2));
  assert.equal(extracted.pages, 2);
  assert.deepEqual(extracted.elements, []);
  assert.ok(extracted.warnings.some((warning) => warning.startsWith('image-only: 2 page(s)')), extracted.warnings.join('; '));
});

it('a host OCR reads each page without text, and its text becomes elements', async () => {
  const asked: any[] = [];
  const extracted = await extractPdf(blankPdf(2), {}, {
    ocr: {
      version: 'stub/1',
      read: async ({ page, width, height, pdf }) => {
        asked.push({ page, width, height, pdf: pdf.length > 0 });
        return page === 1 ? 'Pakbon 4711\nKoffie 12 zakken' : [{ text: 'Thee 4 dozen', bbox: { x: 10, y: 20, w: 100, h: 12 } }];
      },
    },
  });
  assert.deepEqual(asked, [{ page: 1, width: 300, height: 400, pdf: true }, { page: 2, width: 300, height: 400, pdf: true }]);
  assert.deepEqual(extracted.elements.map((element) => [element.page, element.text]), [[1, 'Pakbon 4711'], [1, 'Koffie 12 zakken'], [2, 'Thee 4 dozen']]);
  assert.deepEqual(extracted.elements[2].bbox, { x: 10, y: 20, w: 100, h: 12 });
  assert.ok(extracted.warnings.some((warning) => warning === "ocr: 2 page(s) without text read by the host's OCR (stub/1): 1, 2"), extracted.warnings.join('; '));
  assert.ok(!extracted.warnings.some((warning) => warning.startsWith('image-only')));
  await assert.rejects(extractPdf(blankPdf(1), {}, { ocr: { version: 'bad', read: async () => 42 as any } }), /neither text nor lines/);
});

it('an ingester with OCR refuses one without a version', () => {
  assert.throws(() => createDocumentIngester({ store: {} as any, fetcher: {} as any, embedder: {} as any, ocr: { version: '', read: async () => '' } }), /version/);
});
