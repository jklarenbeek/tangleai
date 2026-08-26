/**
 * The contract handlers — every operation, one place, all seams
 * injected. Handlers return values or `ctx.fail(code)`; the binding
 * owns status codes, validation and the wire shape.
 */

import { stat } from 'node:fs/promises';

import { probeProvider } from '@jarenjs/ai';
import { probeEmbeddings } from '@jarenjs/ai/embed';
import type { MemoryStore } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createPipeline, dagToMermaid, numericContrastJudge, PIPELINE_DAG, PIPELINE_NODES } from '@tangleai/pipeline';
import type { RunLog, TangleDb } from '@tangleai/store';
import { asRows } from '@tangleai/store';
import {
  BunWebViewFetcher,
  createDocumentIngester,
  DocumentError,
  RemoteBrowserFetcher,
  searchDocuments,
  UnavailableBrowserFetcher,
  type BrowserFetcher,
  type DocumentCorpusStore,
  type SafeStaticFetcher,
} from '@tangleai/documents';
import { createSearxngClient } from '@tangleai/search';

import type { LiveHub } from './live.ts';
import type { SettingsStore } from './settings.ts';
import { embedderFor, embedWireConfigured } from './settings.ts';
import type { ChatEngine } from './chat.ts';
import { syncFolder, type DocumentRecord } from './ingest.ts';

export interface HandlerSeams {
  db: TangleDb;
  memoryStore: MemoryStore;
  runLog: RunLog;
  settings: SettingsStore;
  live: LiveHub;
  chat: ChatEngine;
  documentStore: DocumentCorpusStore;
  documentFetcher: SafeStaticFetcher;
  version: string;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
}

function configuredBrowser(current: Awaited<ReturnType<SettingsStore['read']>>, fetchImpl?: typeof globalThis.fetch): BrowserFetcher {
  if (current.browser.mode === 'webview') {
    return new BunWebViewFetcher({ allowUnsafeLocalBrowser: current.browser.allowUnsafeLocal });
  }
  if (current.browser.mode === 'remote' && current.browser.endpoint !== null) {
    try {
      return new RemoteBrowserFetcher({ endpoint: current.browser.endpoint, token: current.browser.token ?? undefined, fetch: fetchImpl });
    } catch (error) {
      return new UnavailableBrowserFetcher(`Invalid remote renderer endpoint: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return new UnavailableBrowserFetcher('Dynamic rendering is disabled in Settings');
}

function memorySummary(unit: MemoryUnit): any {
  const { embedding, relations, ...rest } = unit;
  return { ...rest, hasEmbedding: embedding !== undefined };
}

export function createHandlers(seams: HandlerSeams): Record<string, any> {
  const { db, memoryStore, runLog, settings, live, chat, documentStore, documentFetcher } = seams;
  const now = seams.now ?? ((): string => new Date().toISOString());
  let syncing = false;

  return {
    'status.get': async () => {
      const current = await settings.read();
      const all = await memoryStore.list();
      const documents = asRows(await db.collection<DocumentRecord>('documents')
        .execute<DocumentRecord>({ $for: { d: '$[*]' }, $return: '$d' }));
      const runs = await runLog.listRuns(500);
      const sources = await documentStore.listSources();
      const documentChunks = await documentStore.listChunks();
      return {
        version: seams.version,
        folder: current.folder,
        chatConfigured: current.chat.provider !== null && current.chat.model !== null,
        embedProvider: current.embed.provider,
        counts: {
          memories: all.length,
          live: all.filter((u) => u.supersededBy === undefined).length,
          runs: runs.length,
          documents: documents.length,
          sources: sources.length,
          documentChunks: documentChunks.length,
        },
      };
    },

    'settings.get': () => settings.read(),

    'settings.set': async (input: { settings: any }) => settings.write(input.settings),

    'folder.sync': async (_input: unknown, ctx: any) => {
      const current = await settings.read();
      if (current.folder === null) return ctx.fail('no-folder');
      try {
        const info = await stat(current.folder);
        if (!info.isDirectory()) return ctx.fail('bad-folder');
      } catch {
        return ctx.fail('bad-folder');
      }
      if (syncing) return ctx.fail('bad-folder', {}, { reason: 'a sync is already running' });

      syncing = true;
      const run = await runLog.startRun('sync');
      live.start(run);
      try {
        const pipeline = createPipeline({
          store: memoryStore,
          embedder: embedderFor(current, seams.fetch),
          judge: numericContrastJudge(),
          now,
        });
        const outcome = await syncFolder({
          folder: current.folder,
          db,
          pipeline,
          now,
          runId: run.id,
          onNode: (record) => {
            live.node(record);
            void runLog.recordEvent(run.id, record);
          },
        });
        await runLog.finishRun(run.id, 'ok', { files: outcome.files, report: outcome.report });
        live.finish('ok');
        return { runId: run.id, files: outcome.files, report: outcome.report };
      } catch (error) {
        await runLog.finishRun(run.id, 'error', {
          error: error instanceof Error ? error.message : String(error),
        });
        live.finish('error');
        throw error; // the binding answers JC2008; onError sees the cause
      } finally {
        syncing = false;
      }
    },

    'documents.ingest': async (input: {
      url: string; strategy?: 'recursive' | 'semantic-boundary' | 's2'; allowBrowser?: boolean;
      force?: boolean; maxTokens?: number; overlapTokens?: number;
    }, ctx: any) => {
      const current = await settings.read();
      const run = await runLog.startRun('document');
      live.start(run);
      const started = new Map<string, number>();
      const eventWrites: Promise<unknown>[] = [];
      try {
        const ingester = createDocumentIngester({
          store: documentStore,
          fetcher: documentFetcher,
          embedder: embedderFor(current, seams.fetch),
          browser: configuredBrowser(current, seams.fetch),
          now,
        });
        const outcome = await ingester.ingest({
          ...input,
          strategy: input.strategy ?? current.documents.chunker,
          maxTokens: input.maxTokens ?? current.documents.maxTokens,
          overlapTokens: input.overlapTokens ?? current.documents.overlapTokens,
          onProgress: (event) => {
            if (event.status === 'start') started.set(event.stage, performance.now());
            if (event.status === 'ok') {
              const record = { id: event.stage, status: 'ok' as const, ms: Math.max(0, performance.now() - (started.get(event.stage) ?? performance.now())) };
              started.delete(event.stage);
              live.node(record);
              eventWrites.push(runLog.recordEvent(run.id, record));
            }
            if (event.status === 'error' && started.has(event.stage)) {
              const record = { id: event.stage, status: 'error' as const, ms: Math.max(0, performance.now() - (started.get(event.stage) as number)) };
              started.delete(event.stage);
              live.node(record);
              eventWrites.push(runLog.recordEvent(run.id, record));
            }
          },
        });
        await Promise.all(eventWrites);
        await runLog.finishRun(run.id, 'ok', {
          status: outcome.status,
          sourceId: outcome.source.id,
          versionId: outcome.version.id,
          metrics: outcome.version.metrics,
        });
        live.finish('ok');
        return outcome;
      } catch (error) {
        await Promise.allSettled(eventWrites);
        const reason = error instanceof Error ? error.message : String(error);
        const code = error instanceof DocumentError ? error.code : 'ingest-failed';
        await runLog.finishRun(run.id, 'error', { code, error: reason });
        live.finish('error');
        return ctx.fail('ingest-failed', {}, { code, reason });
      }
    },

    'documents.ingestbatch': async (input: {
      urls: string[]; strategy?: 'recursive' | 'semantic-boundary' | 's2'; allowBrowser?: boolean;
    }) => {
      const current = await settings.read();
      const run = await runLog.startRun('documents');
      live.start(run);
      const started = new Map<string, number>();
      const eventWrites: Promise<unknown>[] = [];
      try {
        const ingester = createDocumentIngester({
          store: documentStore,
          fetcher: documentFetcher,
          embedder: embedderFor(current, seams.fetch),
          browser: configuredBrowser(current, seams.fetch),
          now,
        });
        const results = await ingester.ingestMany(input.urls.map((url) => {
          const onProgress = (event: { stage: string; status: string }): void => {
            const key = `${url}\u0000${event.stage}`;
            if (event.status === 'start') started.set(key, performance.now());
            if ((event.status === 'ok' || event.status === 'error') && started.has(key)) {
              const record = {
                id: event.stage,
                status: event.status as 'ok' | 'error',
                ms: Math.max(0, performance.now() - (started.get(key) as number)),
              };
              started.delete(key);
              live.node(record);
              eventWrites.push(runLog.recordEvent(run.id, record));
            }
          };
          return {
            url,
            strategy: input.strategy ?? current.documents.chunker,
            allowBrowser: input.allowBrowser,
            maxTokens: current.documents.maxTokens,
            overlapTokens: current.documents.overlapTokens,
            onProgress,
          };
        }));
        await Promise.all(eventWrites);
        const succeeded = results.filter((result) => result.outcome !== undefined).length;
        await runLog.finishRun(run.id, 'ok', { requested: results.length, succeeded, failed: results.length - succeeded });
        live.finish('ok');
        return results;
      } catch (error) {
        await Promise.allSettled(eventWrites);
        await runLog.finishRun(run.id, 'error', { error: error instanceof Error ? error.message : String(error) });
        live.finish('error');
        throw error;
      }
    },

    'documents.list': () => documentStore.listSources(),

    'documents.search': async (input: { q: string; limit?: number }) => {
      const current = await settings.read();
      const recalled = await searchDocuments(documentStore, embedderFor(current, seams.fetch), input.q, { k: input.limit ?? 8 });
      return {
        skipped: recalled.skipped,
        ranked: recalled.ranked.map((item) => {
          const { embedding: _embedding, ...chunk } = item.chunk;
          return {
            chunk,
            source: item.source,
            score: item.score,
            context: item.context.map(({ embedding: _contextEmbedding, ...context }) => context),
            citation: item.citation,
          };
        }),
      };
    },

    'browser.status': async () => configuredBrowser(await settings.read(), seams.fetch).capability(),

    'web.search': async (input: { q: string; limit?: number }, ctx: any) => {
      const current = await settings.read();
      if (current.search.searxngUrl === null) return ctx.fail('search-unconfigured');
      const outcome = await createSearxngClient({ baseUrl: current.search.searxngUrl, fetch: seams.fetch }).search(input.q);
      return { ...outcome, results: outcome.results.slice(0, input.limit ?? 10) };
    },

    'runs.list': async (input: { limit?: number }) => runLog.listRuns(input.limit ?? 50),

    'runs.get': async (input: { id: string }, ctx: any) => {
      const detail = await runLog.getRun(input.id);
      return detail ?? ctx.fail('not-found');
    },

    'dag.get': () => ({
      doc: PIPELINE_DAG,
      mermaid: dagToMermaid(),
      nodes: [...PIPELINE_NODES],
    }),

    'dag.live': () => live.subscription(),

    'memories.list': async (input: { q?: string, tag?: string, limit?: number, superseded?: boolean }) => {
      const wantSuperseded = input.superseded ?? false;
      const needle = input.q?.toLowerCase();
      let units = await memoryStore.list();
      if (!wantSuperseded) units = units.filter((u) => u.supersededBy === undefined);
      if (input.tag !== undefined) units = units.filter((u) => u.tags.includes(input.tag as string));
      if (needle !== undefined && needle.length > 0) {
        units = units.filter((u) =>
          u.text.toLowerCase().includes(needle) || u.evidence.toLowerCase().includes(needle));
      }
      units.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return units.slice(0, input.limit ?? 200).map(memorySummary);
    },

    'memories.get': async (input: { id: string }, ctx: any) => {
      const unit = await memoryStore.get(input.id);
      return unit === undefined ? ctx.fail('not-found') : memorySummary(unit);
    },

    'chat.history': (input: { limit?: number }) => chat.history(input.limit ?? 200),

    'chat.send': async (input: { text: string }) => {
      const outcome = await chat.send(input.text);
      return {
        reply: outcome.reply,
        citations: outcome.citations.map(memorySummary),
        documentCitations: outcome.documentCitations.map((item) => {
          const { embedding: _embedding, ...chunk } = item.chunk;
          return { chunk, source: item.source, score: item.score, citation: item.citation };
        }),
        provider: outcome.provider,
      };
    },

    'provider.probe': async () => {
      const current = await settings.read();
      if (current.chat.provider === null) {
        return { ok: false, error: 'no chat provider configured' };
      }
      const outcome = await probeProvider({
        provider: current.chat.provider,
        baseUrl: current.chat.baseUrl ?? undefined,
        apiKey: current.chat.apiKey ?? undefined,
        fetch: seams.fetch,
        timeoutMs: 4000,
      });
      return outcome.ok
        ? { ok: true, models: outcome.models ?? [] }
        : { ok: false, status: outcome.status, error: outcome.error ?? 'unreachable' };
    },

    /** Can the configured embedder embed, and at what width? The
     * built-in answers without a network; a wire is probed with one
     * attempt through @jarenjs/ai's `probeEmbeddings`. Never an error. */
    'embed.probe': async () => {
      const current = await settings.read();
      if (!embedWireConfigured(current.embed)) {
        const builtin = embedderFor(current);
        return { ok: true, model: builtin.model, dims: builtin.dims };
      }
      const outcome = await probeEmbeddings({
        provider: current.embed.provider,
        baseUrl: current.embed.baseUrl ?? undefined,
        model: current.embed.model ?? undefined,
        apiKey: current.embed.apiKey ?? undefined,
        fetch: seams.fetch,
        timeoutMs: 4000,
      });
      return outcome.ok
        ? { ok: true, model: outcome.model, dims: outcome.dims }
        : { ok: false, status: outcome.status, error: outcome.error };
    },
  };
}
