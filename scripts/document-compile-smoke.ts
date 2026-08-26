/** Standalone executable smoke: HTML + PDF -> chunks -> SQLite -> identity-gated recall. */

import { createOfflineEmbedder } from '@tangleai/pipeline';
import { createDocumentStore, openTangleDb } from '@tangleai/store';
import { SafeStaticFetcher, createDocumentIngester, searchDocuments } from '@tangleai/documents';

const BunGlobal = (globalThis as any).Bun;
if (BunGlobal === undefined) throw new Error('This smoke test requires Bun');
const [major, minor] = String(BunGlobal.version).split('.').map(Number);
if (major < 1 || (major === 1 && minor < 4)) throw new Error(`Bun 1.4+ required, found ${BunGlobal.version}`);
if (process.env.TANGLE_EXPECT_STANDALONE === '1' && BunGlobal.isStandaloneExecutable !== true) {
  throw new Error('Expected a Bun standalone executable');
}

const pdfBase64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMjI2ID4+CnN0cmVhbQpCVAovRjEgMTIgVGYKMSAwIDAgMSA1MCA3NTAgVG0KKFF1YXJ0ZXJseSByZXN1bHRzKSBUagoxIDAgMCAxIDUwIDcyMCBUbQooUmVnaW9uKSBUagoxIDAgMCAxIDE4MCA3MjAgVG0KKFJldmVudWUpIFRqCjEgMCAwIDEgNTAgNzAwIFRtCihOb3J0aCkgVGoKMSAwIDAgMSAxODAgNzAwIFRtCigxMjApIFRqCjEgMCAwIDEgNTAgNjYwIFRtCihGaWd1cmUgMTogUmV2ZW51ZSBieSByZWdpb24pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1ODgKJSVFT0YK';
const html = '<!doctype html><html><body><main><h1>Compiled handbook</h1><p>The compiled document pipeline listens for the cobalt signal on channel 7443.</p></main></body></html>';
const pdf = new Uint8Array(Buffer.from(pdfBase64, 'base64'));
const fetcher = new SafeStaticFetcher({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  limits: { respectRobots: false, perHostDelayMs: 0 },
  fetch: (async (url: any) => String(url).endsWith('.pdf')
    ? new Response(pdf, { headers: { 'content-type': 'application/pdf' } })
    : new Response(html, { headers: { 'content-type': 'text/html' } })) as any,
});
const db = await openTangleDb();
try {
  const store = createDocumentStore(db);
  const embedder = createOfflineEmbedder();
  const ingester = createDocumentIngester({ store, fetcher, embedder });
  await ingester.ingest({ url: 'https://fixtures.example/handbook' });
  await ingester.ingest({ url: 'https://fixtures.example/layout.pdf' });
  const recall = await searchDocuments(store, embedder, 'cobalt channel 7443');
  if (!recall.ranked.some((item) => item.chunk.text.includes('7443'))) throw new Error('Compiled recall missed the HTML fixture');
  const sources = await store.listSources();
  const chunks = await store.listChunks();
  if (sources.length !== 2 || chunks.length < 2) throw new Error('Compiled persistence smoke did not store both documents');
  if (!chunks.some((chunk) => chunk.text.includes('Revenue by region'))) throw new Error('Compiled PDF extraction failed');
  console.log(JSON.stringify({ ok: true, bun: BunGlobal.version, standalone: BunGlobal.isStandaloneExecutable, sources: sources.length, chunks: chunks.length }));
} finally {
  await db.close();
}
