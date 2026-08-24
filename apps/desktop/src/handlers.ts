/**
 * The contract handlers — every operation, one place, all seams
 * injected. Handlers return values or `ctx.fail(code)`; the binding
 * owns status codes, validation and the wire shape.
 */

import { stat } from 'node:fs/promises';

import { probeProvider } from '@jarenjs/ai';
import type { MemoryStore } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createPipeline, dagToMermaid, numericContrastJudge, PIPELINE_DAG, PIPELINE_NODES } from '@tangleai/pipeline';
import type { RunLog, TangleDb } from '@tangleai/store';
import { asRows } from '@tangleai/store';

import type { LiveHub } from './live.ts';
import type { SettingsStore } from './settings.ts';
import { embedderFor } from './settings.ts';
import type { ChatEngine } from './chat.ts';
import { syncFolder } from './ingest.ts';

export interface HandlerSeams {
  db: TangleDb;
  memoryStore: MemoryStore;
  runLog: RunLog;
  settings: SettingsStore;
  live: LiveHub;
  chat: ChatEngine;
  version: string;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
}

function memorySummary(unit: MemoryUnit): any {
  const { embedding, relations, ...rest } = unit;
  return { ...rest, hasEmbedding: embedding !== undefined };
}

export function createHandlers(seams: HandlerSeams): Record<string, any> {
  const { db, memoryStore, runLog, settings, live, chat } = seams;
  const now = seams.now ?? ((): string => new Date().toISOString());
  let syncing = false;

  return {
    'status.get': async () => {
      const current = await settings.read();
      const all = await memoryStore.list();
      const documents = asRows(await db.collection('documents').execute({ $for: { d: '$[*]' }, $return: '$d' }));
      const runs = await runLog.listRuns(500);
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
  };
}
