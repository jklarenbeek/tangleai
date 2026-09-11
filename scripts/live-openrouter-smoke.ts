/** Opt-in real-network document + OpenRouter embedding/chat smoke. */

import { nodeDriver } from '@jarenjs/db/node';
import jaren from '@jarenjs/db/package.json' with { type: 'json' };

import { createDesktop, type Desktop } from '../apps/desktop/src/server.ts';

const apiKey = process.env.OPENROUTER_AI_KEY;
const provider = process.env.TANGLE_AI_PROVIDER;
const chatModel = process.env.TANGLE_AI_MODEL;
const embeddingModel = process.env.TANGLE_AI_EMBEDDING_MODEL;
if (apiKey === undefined || apiKey === '') throw new Error('OPENROUTER_AI_KEY is required');
if (provider !== 'openrouter') throw new Error('TANGLE_AI_PROVIDER must be openrouter for this smoke');
if (chatModel === undefined || chatModel === '') throw new Error('TANGLE_AI_MODEL is required');
if (embeddingModel === undefined || embeddingModel === '') throw new Error('TANGLE_AI_EMBEDDING_MODEL is required');

const target = process.env.TANGLE_AI_LIVE_URL ?? 'https://www.rfc-editor.org/rfc/rfc9110.html';
const question = process.env.TANGLE_AI_LIVE_QUESTION ?? 'What does HTTP define the GET method to request?';

async function call(desktop: Desktop, method: string, url: string, body?: unknown): Promise<{ status: number; value: any }> {
  const response = await desktop.dispatcher.dispatch({
    method,
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = typeof response.body === 'string' ? response.body
    : response.body === null ? '' : new TextDecoder().decode(response.body);
  return { status: response.status, value: text === '' ? null : JSON.parse(text) };
}

const desktop = await createDesktop({
  driver: nodeDriver(),
  presetSettings: {
    chat: { provider: 'openrouter', baseUrl: null, model: chatModel, apiKey },
    embed: { provider: 'openrouter', baseUrl: null, model: embeddingModel, apiKey },
  },
});

try {
  const ingested = await call(desktop, 'POST', '/api/documents/ingest', { url: target });
  if (ingested.status !== 200) throw new Error(`Live ingest failed with HTTP ${ingested.status}: ${JSON.stringify(ingested.value)}`);
  const chat = await call(desktop, 'POST', '/api/chat', { text: question });
  if (chat.status !== 200) throw new Error(`Live chat failed with HTTP ${chat.status}: ${JSON.stringify(chat.value)}`);
  if (!Array.isArray(chat.value.documentCitations) || chat.value.documentCitations.length === 0) {
    throw new Error('Live chat returned no document citations');
  }
  if (typeof chat.value.reply?.text !== 'string' || chat.value.reply.text.trim() === '') {
    throw new Error('Live chat returned an empty answer');
  }
  console.log(JSON.stringify({
    ok: true,
    measuredAt: new Date().toISOString(),
    jaren: jaren.version,
    source: ingested.value.source.canonicalUrl,
    elements: ingested.value.version.metrics.elements,
    chunks: ingested.value.version.metrics.chunks,
    embeddingCalls: ingested.value.version.metrics.embeddingCalls,
    embedder: `${ingested.value.version.embeddedBy.model}/${ingested.value.version.embeddedBy.dims}`,
    chatProvider: chat.value.provider,
    citations: chat.value.documentCitations.length,
  }));
} finally {
  await desktop.close();
}
