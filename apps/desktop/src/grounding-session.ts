/** Desktop composition of the public grounding host and native SQLite MAS queue. */
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createGroundingHost, createGroundingReader, evaluateProfileRules, groundingRevisionOf, loadGroundingProfile,
  type GroundingHostOptions, type GroundingIssue, type GroundingProfile } from '@tangleai/grounding';
import { createGroundingStore, createGroundingSegmentHost, type TangleDb, type IdentityRepository } from '@tangleai/store';
import type { DocumentCorpusStore } from '@tangleai/documents';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import profileDocument from '../../../packages/grounding/profiles/priha-hk.json' with { type: 'json' };
import { settingsStack } from './ai-host.ts';
import type { SettingsStore } from './settings.ts';

type Bindings = Pick<GroundingHostOptions, 'embedder' | 'clientFor' | 'transport' | 'factVocabulary' | 'observer' | 'ranker' | 'selection' | 'policy'>;
export interface DesktopGroundingOptions {
  /** Explicitly registered host profiles; their complete revisions remain in the store. */
  profiles?: readonly GroundingProfile[];
  /** Scripted/embedded hosts bind the same public workflow, store and queue. */
  bindings?: (context: { db: TangleDb; profile: GroundingProfile; corpus: DocumentCorpusStore }) => Promise<Bindings>;
}
export async function createDesktopGrounding(options: {
  db: TangleDb; corpus: DocumentCorpusStore; settings: SettingsStore; identities: IdentityRepository;
  now(): string; clock(): number; fetch?: typeof globalThis.fetch; grounding?: DesktopGroundingOptions;
}) {
  const store = createGroundingStore(options.db);
  const segments = createGroundingSegmentHost(options.db, { now: options.now, jobClock: options.clock,
    deadlineFor: ms => new Date(Date.parse(options.now()) + ms).toISOString() });
  const replays = new Map<string, number>();
  const reader = createGroundingReader({ store, mas: segments.store, replayed: id => replays.get(id) ?? 0 });
  async function observed(reply: Awaited<ReturnType<ReturnType<typeof createGroundingReader>['get']>>) {
    replays.set(reply.identities.runId, (replays.get(reply.identities.runId) ?? 0) + reply.trace.replayed);
    return reader.get(reply.sessionId);
  }
  const profiles: GroundingProfile[] = [];
  for (const document of options.grounding?.profiles ?? [profileDocument]) {
    const checked = await loadGroundingProfile(document);
    if (!checked.valid) throw Object.assign(new Error(checked.issues[0]!.detail), { issue: checked.issues[0] });
    profiles.push(checked.value);
  }
  if (!profiles.length || new Set(profiles.map(row => row.id)).size !== profiles.length) throw Error('Register distinct grounding profiles.');
  const tasks = new Set<Promise<unknown>>();
  let closed = false;
  const issue = (detail: string, path = '/host'): GroundingIssue => ({ code: 'TGRD1009', path, detail });
  function refuse(code: GroundingIssue['code'], path: string, detail: string): never { throw Object.assign(new Error(detail), { issue: { code, path, detail } }); }
  async function compose(profile: GroundingProfile) {
    let bindings: Bindings, failure: GroundingIssue | undefined;
    if (options.grounding?.bindings) bindings = await options.grounding.bindings({ db: options.db, profile, corpus: options.corpus });
    else {
      const settings = await options.settings.read(), stack = await settingsStack(settings, { fetch: options.fetch });
      if (stack.state === 'ready') await options.identities.put(stack.identity);
      failure = stack.state === 'refused' ? issue('The configured stack was refused: ' + stack.issues.map(row => row.code).join(', '), '/config')
        : stack.state === 'provisional' ? issue('The embedding width is unverified. Configure a verified embedding profile before starting a session.', '/embedder')
        : stack.chat === null ? issue('No grounding model is configured. Select a chat provider and model in Settings.', '/model') : undefined;
      const base = settings.search.searxngUrl;
      bindings = { embedder: stack.state === 'refused' ? createOfflineEmbedder() : stack.embedder,
        clientFor: () => ({ identity: stack.state === 'ready' ? stack.identity : null,
          client: stack.state !== 'refused' && stack.chat ? stack.chat : { async complete() { throw Error('The configured grounding model is unavailable.'); } } }),
        factVocabulary: [], transport: { searxBase: base ?? 'https://search.harbour.example',
          revision: await groundingRevisionOf({ kind: 'desktop-live/1', searchBase: base }),
          lookup: async hostname => lookup(hostname, { all: true }),
          fetch: async (input, init) => {
            if (base === null) throw Error('No search endpoint is configured for this grounding session.');
            return (options.fetch ?? globalThis.fetch)(input, init);
          } } };
    }
    const host = await createGroundingHost({ ...bindings, profile, store, corpus: options.corpus, segments, now: options.now, clock: options.clock });
    return { host, failure };
  }
  async function forSession(id: string) {
    const session = await store.getSession(id);
    if (!session?.execution) refuse('TGRD1004', '/sessionId', 'The grounding session does not exist.');
    const profile = await store.getProfile(session.profileId, session.profileRevision);
    if (!profile) refuse('TGRD1009', '/profile', 'The retained grounding profile is unavailable.');
    return { session, ...(await compose(profile)) };
  }
  function tracked<T>(work: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(Error('The grounding host is closed.'));
    const task = work(); tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(() => {});
    return task;
  }
  return { ...reader,
    start(input: { text: string; profileId?: string }) { return tracked(async () => {
      const profile = profiles.find(row => row.id === (input.profileId ?? profiles[0]!.id));
      if (!profile) refuse('TGRD1004', '/profileId', 'The host has not registered that grounding profile.');
      const { host, failure } = await compose(profile);
      const rules = evaluateProfileRules(profile, { text: input.text });
      return observed(await host.start({ text: input.text, conversationId: 'desktop:' + randomUUID(),
        ...(failure && !rules.emergency && !rules.outOfScope ? { failure } : {}) }));
    }); },
    reply(input: { sessionId: string; interactionId: string; response: unknown }) { return tracked(async () => {
      const { host, failure } = await forSession(input.sessionId);
      if (failure) throw Object.assign(new Error(failure.detail), { issue: failure });
      return observed(await host.respond(input.sessionId, input.interactionId, input.response));
    }); },
    refresh(input: { sessionId: string; reason: string }) { return tracked(async () => {
      const { host, failure } = await forSession(input.sessionId);
      if (failure) throw Object.assign(new Error(failure.detail), { issue: failure });
      return observed(await host.refresh(input.sessionId, input.reason));
    }); },
    /** Startup only resumes already-authorized, nonterminal native executions. */
    async recover() {
      for (let offset = 0; ; offset += 200) {
        const sessions = await store.listSessions(200, offset);
        for (const session of sessions) {
        if (!session.execution || session.status === 'awaiting_clarification' || session.status === 'failed') continue;
        const native = await segments.store.getRun(session.execution.runId);
        if (native && ['completed', 'failed', 'waiting_for_input'].includes(native.status)) continue;
        void tracked(async () => {
          try {
            const { host, failure } = await forSession(session.id);
            if (failure) throw Object.assign(new Error(failure.detail), { issue: failure });
            return await observed(await host.enqueue(session.id));
          } catch (cause: any) {
            const current = await store.getSession(session.id);
            if (current && !['answered', 'refused', 'failed'].includes(current.status)) {
              const failure = cause?.issue ?? issue('The retained execution could not resume under the current host configuration.');
              await store.transitionSession(current.id, { kind: 'fail', reason: failure.detail, issue: failure }, current.revision);
            }
          }
        });
        }
        if (sessions.length < 200) break;
      }
    },
    async close() { closed = true; await Promise.allSettled([...tasks]); },
  };
}
export type DesktopGrounding = Awaited<ReturnType<typeof createDesktopGrounding>>;
