/**
 * The contract handlers — every operation, one place, all seams
 * injected. Handlers return values or `ctx.fail(code)`; the binding
 * owns status codes, validation and the wire shape.
 */

import { stat } from 'node:fs/promises';

import { probeProvider } from '@tangleai/models/providers';
import { probeEmbeddings } from '@tangleai/models/embed';
import type { MemoryStore } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createPipeline, dagToMermaid, numericContrastJudge, PIPELINE_DAG, PIPELINE_NODES } from '@tangleai/pipeline';
import type { RunLog, TangleDb } from '@tangleai/store';
import { asRows, createTrace2SkillDbStore } from '@tangleai/store';
import { activeBundle, skillRootText, type SkillSnapshot, type Trace2SkillStore } from '@tangleai/trace2skill';
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

import type { IdentityRepository } from '@tangleai/store';

import { registryRevisionOf } from '@tangleai/config';

import type { Settings, SettingsStore } from './settings.ts';
import { embedderFor, embedWireConfigured } from './settings.ts';
import type { ChatEngine } from './chat.ts';
import { inspectStack, productionRegistry, type HostStack, type StackOptions } from './ai-host.ts';
import { syncFolder, type DocumentRecord, type SyncCounts, type SyncTrigger } from './ingest.ts';
import { createFrameSink } from './frames.ts';
import type { FeedbackService } from './feedback.ts';
import type { ReportService } from './reports.ts';
import type { FolderWatcher } from './watch.ts';
import { isAdmissionRefusal } from './issues.ts';

export interface HandlerSeams {
  db: TangleDb;
  memoryStore: MemoryStore;
  runLog: RunLog;
  settings: SettingsStore;
  identities: IdentityRepository;
  /** Resolves settings into the identity-bearing stack; injected so tests script it. */
  stackFor: (settings: Settings, options: StackOptions) => Promise<HostStack>;
  /** The controller of every chat run this process is executing, keyed by run id. */
  inflight: Map<string, AbortController>;
  chat: ChatEngine;
  /** The one folder pass a click and the watcher both go through. */
  folderSync: FolderSync;
  /** What the host is watching, and what it has counted; nothing here starts it. */
  watcher: FolderWatcher;
  /** The one lane an evidenced verdict on a reply travels; it owns every outcome write. */
  feedback: FeedbackService;
  /** What this host can measure, and what it kept; a build with no workspace beside it registers nothing. */
  reports: ReportService;
  documentStore: DocumentCorpusStore;
  documentFetcher: SafeStaticFetcher;
  version: string;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
}

/**
 * A directory page as the surface shows it: where it lives and how big it is.
 * Bytes stay behind their address — a read operation shows what a run did, and
 * a whole directory in a list response is a transcript by another name.
 */
const skillFiles = (snapshot: SkillSnapshot): Array<{ path: string, sha256: string, size: number }> =>
  snapshot.files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }));

/** A request a scheduler would not admit, as the issue a surface can show. */
const admissionRefusal = (error: unknown, path = '/text'): { issues: Array<{ code: string, path: string, detail: string }> } =>
  ({ issues: [{ code: 'TDSK1004', path, detail: error instanceof Error ? error.message : String(error) }] });

/** A run the store refused to complete, as the issue a surface can show. */
const finishRefusal = (reason: string): { issues: Array<{ code: string, path: string, detail: string }> } =>
  ({ issues: [{ code: 'TDSK1010', path: '/run', detail: reason }] });

/** How a run-producing handler refuses a bad configuration: the issues, as data. */
const refusalDetail = (stack: { issues: Array<{ code: string, path: string, detail: string }> }): { issues: Array<{ code: string, path: string, detail: string }> } =>
  ({ issues: stack.issues.map(({ code, path, detail }) => ({ code, path, detail })) });

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

/** The seams a run producer needs to say what stack produced it. */
interface StackSeams {
  runLog: RunLog;
  identities: IdentityRepository;
  stackFor: (settings: Settings, options: StackOptions) => Promise<HostStack>;
  fetch?: typeof globalThis.fetch;
}

/**
 * Resolve the current stack for a run producer. A `ready` stack's
 * identity is stored before any work; a `provisional` one finalizes
 * from the first embedding reply — the onFinal hook persists the
 * identity and attaches it to the run BEFORE the vectors reach the
 * pipeline, so nothing is stored under an unproven identity.
 */
function createStackResolver(seams: StackSeams) {
  return async function stackForRun(current: Settings): Promise<{ stack: HostStack, setRunId: (id: string) => void }> {
    let runId: string | null = null;
    const stack = await seams.stackFor(current, {
      fetch: seams.fetch,
      onFinal: async (identity) => {
        await seams.identities.put(identity);
        if (runId !== null) await seams.runLog.attachIdentity(runId, identity.identityId);
      },
    });
    if (stack.state === 'ready') await seams.identities.put(stack.identity);
    return { stack, setRunId: (id) => { runId = id; } };
  };
}

/** The bounded admission every folder pass — clicked or watched — goes through. */
export const FOLDER_SCOPE = 'folder';

/** What a refused pass says instead of a number. */
export type FolderSyncRefusal =
  | 'no-folder' | 'bad-folder' | 'config-refused'
  | 'queue-full' | 'closed' | 'cancelled' | 'deadline' | 'failed';

export type FolderSyncOutcome =
  | { ok: true, runId: string, files: SyncCounts, trigger: SyncTrigger, report: unknown }
  | {
      ok: false,
      refused: FolderSyncRefusal,
      runId: string | null,
      issues: Array<{ code: string, path: string, detail: string }>,
      /** The fault a caller may want to re-raise rather than count. */
      cause?: unknown,
    };

export interface FolderSync {
  /**
   * Run one pass, or answer why none ran. Never throws: every outcome is
   * a value. `onAdmitted` fires the moment the pass opens its run, so a
   * caller that publishes counters has moved them before the run's own
   * frames reach anyone.
   */
  scan(trigger: SyncTrigger, onAdmitted?: (runId: string) => void): Promise<FolderSyncOutcome>;
}

export interface FolderSyncSeams extends StackSeams {
  db: TangleDb;
  memoryStore: MemoryStore;
  settings: SettingsStore;
  /** Bounded admission, scope `folder`: one pass runs, one waits, a third is refused. */
  scheduler: { run<T>(worker: () => T | Promise<T>, context?: { scope?: string, signal?: AbortSignal }): Promise<T> };
  now?: () => string;
}

/** A click during a watcher pass waits; the request behind that one is refused. */
const FOLDER_BUSY_DETAIL = 'a folder sync is already running and one more is queued';

/**
 * One folder pass, one owner. The clicked command and every watcher
 * window ask this for a scan, so the bound is repo-wide rather than
 * per-caller, and a refusal is the same value whoever asked.
 */
export function createFolderSync(seams: FolderSyncSeams): FolderSync {
  const { db, memoryStore, runLog, settings, scheduler } = seams;
  const now = seams.now ?? ((): string => new Date().toISOString());
  const stackForRun = createStackResolver(seams);

  async function pass(trigger: SyncTrigger, current: Settings, folder: string, onAdmitted?: (runId: string) => void): Promise<FolderSyncOutcome> {
    const { stack, setRunId } = await stackForRun(current);
    if (stack.state === 'refused') {
      return { ok: false, refused: 'config-refused', runId: null, issues: refusalDetail(stack).issues };
    }
    const run = await runLog.startRun('sync', stack.state === 'ready' ? { identityId: stack.identity.identityId } : {});
    setRunId(run.id);
    onAdmitted?.(run.id);
    const frames = createFrameSink(runLog, run.id);
    try {
      const pipeline = createPipeline({
        store: memoryStore,
        embedder: stack.embedder,
        judge: numericContrastJudge(),
        now,
      });
      const outcome = await syncFolder({
        folder,
        db,
        pipeline,
        memoryStore,
        now,
        runId: run.id,
        trigger,
        onNode: (record) => frames.push('node', { node: record.id, status: record.status, ms: record.ms }),
      });
      // what the pass counted is part of the run's record, not only of
      // this reply: a watched pass has no reply to read
      await frames.append('sync', { trigger: outcome.trigger, ...outcome.files });
      // every node of this run is committed before the run closes: a
      // write still in flight when the row says "ok" is a record the
      // reader silently never sees
      const drained = await frames.drain();
      const finished = await runLog.finishRun(run.id, 'ok', {
        files: outcome.files, trigger: outcome.trigger, report: outcome.report, frameRefusals: drained.refused,
      });
      if (!finished.ok) {
        return { ok: false, refused: 'config-refused', runId: run.id, issues: finishRefusal(finished.reason).issues };
      }
      return { ok: true, runId: run.id, files: outcome.files, trigger: outcome.trigger, report: outcome.report };
    } catch (error) {
      await frames.drain();
      const detail = error instanceof Error ? error.message : String(error);
      await runLog.finishRun(run.id, 'error', { error: detail });
      // a fault is not a refusal anybody declared: the caller re-raises it
      // or counts it, and no issue code is borrowed to label it
      return { ok: false, refused: 'failed', runId: run.id, cause: error, issues: [] };
    }
  }

  return {
    async scan(trigger: SyncTrigger, onAdmitted?: (runId: string) => void): Promise<FolderSyncOutcome> {
      const current = await settings.read();
      if (current.folder === null) {
        return { ok: false, refused: 'no-folder', runId: null, issues: [] };
      }
      const folder = current.folder;
      // `bad-folder` is its own declared reason; no issue code means
      // something else is borrowed to say it
      const badFolder: FolderSyncOutcome = { ok: false, refused: 'bad-folder', runId: null, issues: [] };
      let info;
      try {
        info = await stat(folder);
      } catch {
        return badFolder;
      }
      if (!info.isDirectory()) return badFolder;

      try {
        return await scheduler.run(() => pass(trigger, current, folder, onAdmitted), { scope: FOLDER_SCOPE });
      } catch (error) {
        if (!isAdmissionRefusal(error)) {
          return { ok: false, refused: 'failed', runId: null, cause: error, issues: [] };
        }
        const reason = (error as Error).message as Extract<FolderSyncRefusal, 'queue-full' | 'closed' | 'cancelled' | 'deadline'>;
        const detail = reason === 'queue-full' ? FOLDER_BUSY_DETAIL : reason;
        return { ok: false, refused: reason, runId: null, issues: [{ code: 'TDSK1004', path: '/folder', detail }] };
      }
    },
  };
}

export function createHandlers(seams: HandlerSeams): Record<string, any> {
  const { db, memoryStore, runLog, settings, identities, stackFor, inflight, chat, folderSync, watcher, feedback, reports, documentStore, documentFetcher } = seams;
  const now = seams.now ?? ((): string => new Date().toISOString());

  // The skill-evolution rows are read-only here: this surface shows what a run
  // did, and every write — drafting, evolving, activating — stays a host action.
  const skills: Trace2SkillStore = createTrace2SkillDbStore(db);
  const skillRun = (run: Awaited<ReturnType<Trace2SkillStore['listBy']>>[number] & Record<string, any>): any => ({
    id: run.id, scopeKey: run.scopeKey, mode: run.mode, s0Id: run.s0Id, status: run.status,
    seed: run.seed, bMerge: run.bMerge, lMax: run.lMax, supportThreshold: run.supportThreshold,
    spend: { calls: run.spend.calls, tokens: run.spend.tokens },
  });
  /** The scope keys one collection carries rows for; rows are addressed by scope. */
  const skillScopes = (collection: 'runs' | 'candidates' | 'evaluations'): Promise<string[]> => skills.scopes(collection);
  const skillRunById = async (id: string): Promise<any> => {
    for (const scope of await skillScopes('runs')) {
      const found = (await skills.listBy(scope, 'runs')).find((row) => row.id === id);
      if (found !== undefined) return found;
    }
    return null;
  };

  const stackForRun = createStackResolver(seams);

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

    'settings.get': async () => {
      const view = await settings.readPublic();
      return { ...view.settings, slots: view.slots, issues: view.issues };
    },

    'settings.set': async (input: { settings: any, clearChatKey?: boolean, clearEmbedKey?: boolean, clearBrowserToken?: boolean }) => {
      const before = (await settings.read()).folder;
      await settings.write(input.settings, {
        clearChatKey: input.clearChatKey,
        clearEmbedKey: input.clearEmbedKey,
        clearBrowserToken: input.clearBrowserToken,
      });
      const view = await settings.readPublic();
      // the watched folder IS this setting; a save that moved it stops the
      // old watch and starts the new one with its restart-safe full scan
      if (view.settings.folder !== before) await watcher.retarget(view.settings.folder);
      return { ...view.settings, slots: view.slots, issues: view.issues };
    },

    /**
     * Read-only: the pure resolver over the current settings — no probe,
     * no client, no secret. A named profile in the input previews that
     * selection through the SAME resolution a save would run, so the
     * issues shown before saving are the issues saving would produce;
     * nothing is written either way.
     */
    'config.inspect': async (input: { profile?: string }) => {
      const { settings: current } = await settings.readValidated();
      const inspection = await inspectStack(current);
      const previewed = input.profile === undefined ? null : await inspectStack({ ...current, profile: input.profile });
      const registry = productionRegistry as { capabilities: any[], profiles: any[] };
      return {
        registry: {
          revision: await registryRevisionOf(productionRegistry as never),
          tags: registry.capabilities.map((capability) => ({
            tag: capability.tag,
            intent: capability.intent,
            candidates: capability.candidates.length,
            limitations: capability.limitations,
          })),
          profiles: registry.profiles.map((profile) => ({ id: profile.id, kind: profile.kind, description: profile.description ?? '' })),
        },
        request: inspection.request,
        resolution: { state: inspection.state, issues: inspection.issues },
        identity: inspection.identity,
        preview: previewed === null
          ? null
          : { profile: input.profile as string, state: previewed.state, issues: previewed.issues, identity: previewed.identity },
        slots: {
          chatKey: current.chat.apiKey !== null,
          embedKey: current.embed.apiKey !== null,
          browserToken: current.browser.token !== null,
        },
        hostObservation: null,
      };
    },

    /** A clicked pass: the same admission, the same counts, the same run the watcher records. */
    'folder.sync': async (_input: unknown, ctx: any) => {
      const outcome = await folderSync.scan('manual');
      if (outcome.ok) {
        return { runId: outcome.runId, files: outcome.files, trigger: outcome.trigger, report: outcome.report };
      }
      if (outcome.refused === 'no-folder') return ctx.fail('no-folder');
      if (outcome.refused === 'bad-folder') return ctx.fail('bad-folder');
      if (outcome.refused === 'config-refused') return ctx.fail('config-refused', {}, { issues: outcome.issues });
      // a genuine fault is not a busy slot: the binding answers JC2008 and onError sees the cause
      if (outcome.refused === 'failed') throw outcome.cause;
      return ctx.fail('sync-busy', {}, { issues: outcome.issues });
    },

    /** What the watcher has observed since it started — counts, named states, no verdict. */
    'folder.watch.get': (): unknown => watcher.state(),

    'documents.ingest': async (input: {
      url: string; strategy?: 'recursive' | 'semantic-boundary' | 's2'; allowBrowser?: boolean;
      force?: boolean; maxTokens?: number; overlapTokens?: number;
    }, ctx: any) => {
      const current = await settings.read();
      const { stack, setRunId } = await stackForRun(current);
      if (stack.state === 'refused') return ctx.fail('config-refused', {}, refusalDetail(stack));
      const run = await runLog.startRun('document', stack.state === 'ready' ? { identityId: stack.identity.identityId } : {});
      setRunId(run.id);
      const frames = createFrameSink(runLog, run.id);
      const started = new Map<string, number>();
      try {
        const ingester = createDocumentIngester({
          store: documentStore,
          fetcher: documentFetcher,
          embedder: stack.embedder,
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
              const ms = Math.max(0, performance.now() - (started.get(event.stage) ?? performance.now()));
              started.delete(event.stage);
              frames.push('node', { node: event.stage, status: 'ok', ms });
            }
            if (event.status === 'error' && started.has(event.stage)) {
              const ms = Math.max(0, performance.now() - (started.get(event.stage) as number));
              started.delete(event.stage);
              frames.push('node', { node: event.stage, status: 'error', ms });
            }
          },
        });
        const drained = await frames.drain();
        const finished = await runLog.finishRun(run.id, 'ok', {
          status: outcome.status,
          sourceId: outcome.source.id,
          versionId: outcome.version.id,
          metrics: outcome.version.metrics,
          frameRefusals: drained.refused,
        });
        if (!finished.ok) return ctx.fail('config-refused', {}, finishRefusal(finished.reason));
        return outcome;
      } catch (error) {
        await frames.drain();
        const reason = error instanceof Error ? error.message : String(error);
        const code = error instanceof DocumentError ? error.code : 'ingest-failed';
        await runLog.finishRun(run.id, 'error', { code, error: reason });
        return ctx.fail('ingest-failed', {}, { code, reason });
      }
    },

    'documents.ingestbatch': async (input: {
      urls: string[]; strategy?: 'recursive' | 'semantic-boundary' | 's2'; allowBrowser?: boolean;
    }, ctx: any) => {
      const current = await settings.read();
      const { stack, setRunId } = await stackForRun(current);
      if (stack.state === 'refused') return ctx.fail('config-refused', {}, refusalDetail(stack));
      const run = await runLog.startRun('documents', stack.state === 'ready' ? { identityId: stack.identity.identityId } : {});
      setRunId(run.id);
      const frames = createFrameSink(runLog, run.id);
      const started = new Map<string, number>();
      try {
        const ingester = createDocumentIngester({
          store: documentStore,
          fetcher: documentFetcher,
          embedder: stack.embedder,
          browser: configuredBrowser(current, seams.fetch),
          now,
        });
        const results = await ingester.ingestMany(input.urls.map((url) => {
          const onProgress = (event: { stage: string; status: string }): void => {
            const key = `${url}\u0000${event.stage}`;
            if (event.status === 'start') started.set(key, performance.now());
            if ((event.status === 'ok' || event.status === 'error') && started.has(key)) {
              const ms = Math.max(0, performance.now() - (started.get(key) as number));
              started.delete(key);
              frames.push('node', { node: event.stage, status: event.status, ms });
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
        const drained = await frames.drain();
        const succeeded = results.filter((result) => result.outcome !== undefined).length;
        const finished = await runLog.finishRun(run.id, 'ok', {
          requested: results.length, succeeded, failed: results.length - succeeded, frameRefusals: drained.refused,
        });
        if (!finished.ok) return ctx.fail('config-refused', {}, finishRefusal(finished.reason));
        return results;
      } catch (error) {
        await frames.drain();
        await runLog.finishRun(run.id, 'error', { error: error instanceof Error ? error.message : String(error) });
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

    /**
     * One run, with the configuration it resolved read by reference: the
     * identity lives once in the identity table, and a row that names one
     * shows what it named. A row written before identities were recorded
     * says so through its status and carries none.
     */
    'runs.get': async (input: { id: string }, ctx: any) => {
      const detail = await runLog.getRun(input.id);
      if (detail === undefined) return ctx.fail('not-found');
      const identityId = detail.run.identityId;
      const identity = identityId === undefined ? null : (await identities.get(identityId)) ?? null;
      return { ...detail, identity };
    },

    'runs.live': (input: { limit?: number }) => runLog.subscribeRuns({ limit: input.limit ?? 50 }),

    /** One named run's frames. An unknown id is a declared failure, never an empty stream that looks like a quiet run. */
    'run.live': async (input: { runId: string }, ctx: any) => {
      if ((await runLog.getRun(input.runId)) === undefined) {
        return ctx.fail('not-found', {}, { issues: [{ code: 'TDSK1001', path: '/runId', detail: `no run '${input.runId}'` }] });
      }
      return runLog.subscribeRun(input.runId);
    },

    /**
     * End a run early. The worker observes its own signal and writes the
     * terminal frame; a run left running by a stopped process has no
     * worker to ask, so it is closed here. A run that already finished
     * answers its state as a value — asking twice is not an error.
     */
    'runs.cancel': async (input: { runId: string }, ctx: any) => {
      const detail = await runLog.getRun(input.runId);
      if (detail === undefined) {
        return ctx.fail('not-found', {}, { issues: [{ code: 'TDSK1001', path: '/runId', detail: `no run '${input.runId}'` }] });
      }
      if (detail.run.status !== 'running') {
        return {
          runId: input.runId,
          status: detail.run.status,
          cancelled: false,
          issues: [{ code: 'TDSK1002', path: '/runId', detail: `the run already finished as '${detail.run.status}'` }],
        };
      }
      const controller = inflight.get(input.runId);
      if (controller !== undefined) {
        controller.abort();
        return { runId: input.runId, status: 'running', cancelled: true, issues: [] };
      }
      const finished = await runLog.finishRun(input.runId, 'cancelled', { reason: 'no worker in this process' });
      return {
        runId: input.runId,
        status: 'cancelled',
        cancelled: true,
        issues: finished.ok ? [] : [{ code: 'TDSK1002', path: '/runId', detail: finished.reason }],
      };
    },

    /** What this host can run — and, when it can run nothing, why. */
    'reports.instruments': () => reports.instruments(),

    /**
     * Run one instrument. An exit code is a value this answers; a
     * refusal — no such instrument, no slot, a budget nobody accepts —
     * is a declared error carrying the issue that names it.
     */
    'reports.run': async (input: { id: string, budget?: unknown }, ctx: any) => {
      const outcome = await reports.run(input);
      if (outcome.ok) return outcome.receipt;
      return ctx.fail(outcome.refused, {}, { issues: outcome.issues });
    },

    'reports.list': (input: { instrument?: string, limit?: number }) => reports.list(input),

    'reports.get': async (input: { reportId: string }, ctx: any) => {
      const detail = await reports.get(input.reportId);
      if (detail === null) {
        return ctx.fail('not-found', {}, { issues: [{ code: 'TDSK1008', path: '/reportId', detail: `no stored report '${input.reportId}'` }] });
      }
      return detail;
    },

    'skills.runs.list': async (input: { scopeKey?: string, limit?: number }) => {
      const scopes = input.scopeKey === undefined ? await skillScopes('runs') : [input.scopeKey];
      const runs = [];
      for (const scope of scopes) runs.push(...await skills.listBy(scope, 'runs'));
      return runs.slice(0, input.limit ?? 50).map(skillRun);
    },

    'skills.runs.get': async (input: { id: string }, ctx: any) => {
      const run = await skillRunById(input.id);
      if (run === null) return ctx.fail('not-found');
      const [rollouts, analyses, patches, merges] = await Promise.all([
        skills.listBy(run.id, 'rollouts'), skills.listBy(run.id, 'analyses'),
        skills.listBy(run.id, 'patches'), skills.listBy(run.id, 'merges'),
      ]);
      const candidates = (await skills.listBy(run.scopeKey, 'candidates')).filter((row) => row.runId === run.id);
      const evaluations = (await skills.listBy(run.scopeKey, 'evaluations'))
        .filter((row) => 'candidateBundleId' in row && (row as any).runId === run.id);
      return {
        run: skillRun(run),
        counts: {
          rollouts: rollouts.length, analyses: analyses.length, patches: patches.length,
          merges: merges.length, candidates: candidates.length, evaluations: evaluations.length,
        },
        candidateIds: candidates.map((row) => row.id),
        evaluationIds: evaluations.map((row) => row.id),
      };
    },

    'skills.candidates.get': async (input: { id: string }, ctx: any) => {
      for (const scope of await skillScopes('candidates')) {
        const found = (await skills.listBy(scope, 'candidates')).find((row) => row.id === input.id);
        if (found === undefined) continue;
        const snapshot = await skills.getSnapshot(found.bundleId);
        return {
          candidate: {
            id: found.id, runId: found.runId, scopeKey: found.scopeKey, bundleId: found.bundleId,
            parentId: found.parentId, finalPatchId: found.finalPatchId, churn: found.churn,
            diffSummary: found.diffSummary, structural: found.structural, semantic: found.semantic,
          },
          files: snapshot.valid ? skillFiles(snapshot.value) : [],
        };
      }
      return ctx.fail('not-found');
    },

    'skills.merges.get': async (input: { runId: string }, ctx: any) => {
      const run = await skillRunById(input.runId);
      if (run === null) return ctx.fail('not-found');
      const nodes = [...await skills.listBy(run.id, 'merges')]
        .sort((left, right) => left.level - right.level || left.groupIndex - right.groupIndex);
      return {
        levels: nodes.reduce((deepest, node) => Math.max(deepest, node.level), 0),
        groups: nodes.length,
        withheld: nodes.reduce((total, node) => total + node.report.withheld, 0),
        nodes: nodes.map((node) => ({
          id: node.id, level: node.level, groupIndex: node.groupIndex,
          inputPatchIds: node.inputPatchIds, outputPatchId: node.outputPatchId,
          supportCount: node.supportCount, unique: node.report.unique,
          duplicates: node.report.duplicates, withheld: node.report.withheld,
        })),
      };
    },

    'skills.evaluations.get': async (input: { id: string }, ctx: any) => {
      for (const scope of await skillScopes('evaluations')) {
        const found = (await skills.listBy(scope, 'evaluations'))
          .find((row) => row.id === input.id && 'candidateBundleId' in row) as any;
        if (found === undefined) continue;
        return {
          id: found.id, runId: found.runId, scopeKey: found.scopeKey,
          baselineBundleId: found.baselineBundleId, candidateBundleId: found.candidateBundleId,
          meanDelta: found.meanDelta, costDelta: found.costDelta, eligible: found.eligible,
          policyVersion: found.policyVersion, failures: found.failures, skips: found.skips,
          leakage: found.leakage, results: found.results, issues: found.issues,
        };
      }
      return ctx.fail('not-found');
    },

    'skills.head.get': async (input: { scopeKey: string }, ctx: any) => {
      const head = await skills.head(input.scopeKey);
      if (head.versionId === null) return ctx.fail('not-found');
      // The active directory is read through the package's own head reader, so
      // the surface and a host consuming the skill see the same bytes.
      const snapshot = await activeBundle(skills, input.scopeKey);
      if (!snapshot.valid) return ctx.fail('not-found');
      const root = skillRootText(snapshot.value);
      const bundle = snapshot.value.bundle;
      return {
        scopeKey: input.scopeKey,
        versionId: head.versionId,
        revision: head.revision,
        bundle: { id: bundle.id, mode: bundle.mode, origin: bundle.origin, status: bundle.status, parentId: bundle.parentId },
        files: skillFiles(snapshot.value),
        root: root.valid ? root.value : null,
      };
    },

    'dag.get': () => ({
      doc: PIPELINE_DAG,
      mermaid: dagToMermaid(),
      nodes: [...PIPELINE_NODES],
    }),


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

    /** Open a chat run and answer its addresses; the run streams the rest. */
    'chat.start': async (input: { text: string }, ctx: any) => {
      try {
        const started = await chat.start(input.text);
        // the outcome belongs to the run, not to this request; a
        // rejection reaches the run's own terminal frame
        started.done.catch(() => {});
        return { runId: started.runId, messageId: started.messageId };
      } catch (error) {
        if (!isAdmissionRefusal(error)) throw error;
        return ctx.fail('busy', {}, admissionRefusal(error));
      }
    },

    'chat.send': async (input: { text: string }, ctx: any) => {
      let outcome;
      try {
        outcome = await chat.send(input.text);
      } catch (error) {
        if (!isAdmissionRefusal(error)) throw error;
        return ctx.fail('busy', {}, admissionRefusal(error));
      }
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

    /** What a verdict on this reply may say, and what it can be about. */
    'feedback.open': async (input: { messageId: string }, ctx: any) => {
      const form = await feedback.open(input.messageId);
      if (form === null) {
        return ctx.fail('not-found', {}, { issues: [{ code: 'TDSK1001', path: '/messageId', detail: 'no message with this id' }] });
      }
      return form;
    },

    /**
     * A thumb opens the form; this records what the form collected. A
     * bare, short or uncited submission is refused before any outcome
     * write, and the lifecycle's own refusals pass through verbatim.
     */
    'feedback.submit': async (input: {
      messageId: string; verdict?: string; reason?: string;
      evidence?: Array<{ kind: string, ref: string }>; note?: string | null;
    }, ctx: any) => {
      const outcome = await feedback.submit({
        messageId: input.messageId,
        verdict: input.verdict ?? '',
        reason: input.reason ?? '',
        evidence: input.evidence ?? [],
        note: input.note ?? null,
      });
      if (outcome.ok) return outcome.receipt;
      return ctx.fail(outcome.refused, {}, { issues: outcome.issues });
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
     * attempt through @tangleai/models's `probeEmbeddings`. Never an error. */
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
