/**
 * The desktop UI — one @jarenjs/app document over the contract client.
 *
 * Boundary discipline, jarenjs style: the DOCUMENT owns state and
 * actions (pure JSON, `actions.ts`); the HOST owns the view builders
 * (`views.ts`, plain vnodes computed in the viewModel), the effects
 * (each one calls the typed contract client and dispatches `done` or
 * `fail` — outcomes are values, so actions never branch), and the
 * subscriptions: the live run window, and one named run's frames for
 * the Loom and one for the pending chat answer. A frame stream is
 * addressed and resumable — the handler owns the document it applies
 * patches to, remembers the seq it reached, and re-enters there when
 * the stream is lost.
 *
 * A client with no streaming half still works: a subscribe operation
 * answers its snapshot as plain JSON, so a finished run's frames are
 * one read.
 *
 * The client is INJECTED, so the same app runs headless in node tests
 * against `toFetchHandler(serveHttp(...))` — the whole stack, no
 * browser, no socket.
 */

import { createApp } from '@jarenjs/app';
import { applyJSONPatch } from '@jarenjs/json';

import { ACTIONS, INITIAL_STATE } from './actions.ts';
import { rootView } from './views.ts';

type Dispatch = (action: string, payload?: any) => void;

export interface TangleUiOptions {
  client: { invoke: (op: string, input: any, ctx?: any) => Promise<any>, subscribe?: any };
  node?: any;
  document?: any;
  onError?: (report: any) => void;
}

function failText(outcome: any): string {
  const error = outcome?.error;
  return error === undefined ? 'request failed'
    : `${error.code ?? outcome.kind}: ${error.message ?? ''}`.trim();
}

/**
 * Watch one run's frames. Every subscription opens on a snapshot whose
 * event id is the last frame it holds, so the client's own reconnect
 * resumes above it and delivers each frame once; a subscription started
 * after a lost stream re-seeds from a fresh snapshot of the whole run.
 */
function watchRun(
  client: TangleUiOptions['client'],
  props: any,
  publish: (rows: any[]) => void,
  onLost: () => void,
): () => void {
  if (client.subscribe === undefined || typeof props?.runId !== 'string') return () => {};
  let rows: any[] = [];
  // the slot belongs to THIS run from the moment the subscription
  // starts, so a switch can never leave the previous run's frames
  // showing under a new run's id
  publish(rows);
  const subscription = client.subscribe('run.live', { runId: props.runId }, {
    reconnect: { max: 3 },
    onError: onLost,
    onSnapshot: (value: any) => {
      rows = value.rows ?? [];
      publish(rows);
    },
    onPatch: ({ patch }: any) => {
      const added = patch.filter((op: any) => op.op !== 'remove').map((op: any) => op.value);
      if (added.length === 0) return;
      rows = [...rows, ...added];
      publish(rows);
    },
  });
  return () => subscription.stop();
}

export function createTangleUi(options: TangleUiOptions): any {
  const client = options.client;

  const effects = {
    /** Generic operation call: { op, input, done, fail }. */
    invoke: (props: any, dispatch: Dispatch): void => {
      void client.invoke(props.op, props.input ?? {}).then((outcome: any) => {
        if (outcome.ok) dispatch(props.done, outcome.value);
        else dispatch(props.fail, failText(outcome));
      });
    },

    /**
     * Ask for a folder pass. A refused slot is not a failure: a pass is
     * already running and will do the work this click asked for, so it
     * renders as a note beside the button rather than as an error.
     */
    syncFolder: (_props: any, dispatch: Dispatch): void => {
      void client.invoke('folder.sync', {}).then((outcome: any) => {
        if (outcome.ok) { dispatch('sync/done', outcome.value); return; }
        if (outcome?.error?.code === 'sync-busy') {
          const issue = outcome.error?.details?.issues?.[0];
          dispatch('sync/busy', typeof issue?.detail === 'string' ? issue.detail : 'a folder sync is already running');
          return;
        }
        dispatch('sync/fail', failText(outcome));
      });
    },

    /**
     * A run's own follow-ups. The run detail names its candidate and evaluation
     * by address, so the surface reads exactly what that run produced instead of
     * guessing an id or listing someone else's.
     */
    skillDetail: (props: any, dispatch: Dispatch): void => {
      const detail = props.detail ?? {};
      const candidateId = (detail.candidateIds ?? [])[0];
      const evaluationId = (detail.evaluationIds ?? [])[0];
      const scopeKey = detail.run?.scopeKey;
      if (typeof candidateId === 'string') {
        void client.invoke('skills.candidates.get', { id: candidateId }).then((outcome: any) => {
          if (outcome.ok) dispatch('skills/candidate', outcome.value);
        });
      }
      if (typeof evaluationId === 'string') {
        void client.invoke('skills.evaluations.get', { id: evaluationId }).then((outcome: any) => {
          if (outcome.ok) dispatch('skills/evaluation', outcome.value);
        });
      }
      if (typeof scopeKey === 'string') {
        void client.invoke('skills.head.get', { scopeKey }).then((outcome: any) => {
          if (outcome.ok) dispatch('skills/head', outcome.value);
        });
      }
    },

    /**
     * Ask. With a streaming client the answer is a RUN the surface
     * watches; without one the same engine answers the request, so a
     * question is never left with nowhere to arrive.
     */
    chatSend: (props: any, dispatch: Dispatch): void => {
      if (client.subscribe === undefined) {
        void client.invoke('chat.send', { text: props.text }).then((outcome: any) => {
          if (outcome.ok) dispatch('chat/done', outcome.value);
          else dispatch('chat/fail', failText(outcome));
        });
        return;
      }
      void client.invoke('chat.start', { text: props.text }).then((outcome: any) => {
        if (outcome.ok) dispatch('chat/started', outcome.value);
        else dispatch('chat/fail', failText(outcome));
      });
    },

    /**
     * One run's frames as a plain read — what a client with no streaming
     * half can have, and all a finished run needs.
     */
    runFrames: (props: any, dispatch: Dispatch): void => {
      if (client.subscribe !== undefined || typeof props.runId !== 'string') return;
      void client.invoke('run.live', { runId: props.runId }).then((outcome: any) => {
        if (!outcome.ok) return;
        dispatch('loom/frames', { runId: props.runId, rows: outcome.value.rows ?? [] });
      });
    },

    /** What a verdict on this reply may say, and what it can be about. */
    feedbackOpen: (props: any, dispatch: Dispatch): void => {
      void client.invoke('feedback.open', { messageId: props.messageId }).then((outcome: any) => {
        if (outcome.ok) dispatch('feedback/form', outcome.value);
        else dispatch('feedback/fail', failText(outcome));
      });
    },

    /** Ticking a source is a set operation, so the branch lives here and the document takes the answer. */
    feedbackToggle: (props: any, dispatch: Dispatch): void => {
      const refs: string[] = props.refs ?? [];
      dispatch('feedback/refs', refs.includes(props.ref) ? refs.filter((ref) => ref !== props.ref) : [...refs, props.ref]);
    },

    /**
     * Record the verdict. The server re-checks every bound the form
     * published, and a refusal arrives as the issues it counted — shown
     * as they are, never flattened into "something went wrong".
     */
    feedbackSubmit: (props: any, dispatch: Dispatch): void => {
      const options: any[] = props.options ?? [];
      const refs: string[] = props.refs ?? [];
      const note = String(props.note ?? '').trim();
      const evidence = options
        .filter((option) => refs.includes(option.ref))
        .map((option) => ({ kind: option.kind, ref: option.ref }));
      if (note !== '') evidence.push({ kind: 'note', ref: 'note' });
      void client.invoke('feedback.submit', {
        messageId: props.messageId,
        verdict: props.verdict,
        reason: props.reason,
        evidence,
        note: note === '' ? null : note,
      }).then((outcome: any) => {
        if (outcome.ok) { dispatch('feedback/recorded', outcome.value); return; }
        const issues = outcome?.error?.details?.issues ?? [];
        dispatch('feedback/fail', issues.length > 0
          ? issues.map((issue: any) => `${issue.code}: ${issue.detail}`).join(' · ')
          : failText(outcome));
      });
    },

    /**
     * Ask for a measurement. The request blocks until the instrument
     * exits, and what comes back is an exit code and an identity —
     * never a verdict. The run's own progress arrives meanwhile on the
     * run window's frame subscription, so this opens no second stream.
     */
    runReport: (props: any, dispatch: Dispatch): void => {
      void client.invoke('reports.run', { id: props.id }).then((outcome: any) => {
        if (outcome.ok) { dispatch('reports/done', outcome.value); return; }
        const issues = outcome?.error?.details?.issues ?? [];
        dispatch('reports/fail', issues.length > 0
          ? issues.map((issue: any) => `${issue.code}: ${issue.detail}`).join(' · ')
          : failText(outcome));
      });
    },

    search: (props: any, dispatch: Dispatch): void => {
      const input: any = { limit: 200, superseded: props.superseded === true };
      if (typeof props.q === 'string' && props.q !== '') input.q = props.q;
      void client.invoke('memories.list', input).then((outcome: any) => {
        if (outcome.ok) dispatch('memory/done', outcome.value);
      });
    },

    documentSearch: (props: any, dispatch: Dispatch): void => {
      if (typeof props.q !== 'string' || props.q.trim() === '') {
        dispatch('documents/searchDone', { ranked: [], skipped: 0 });
        return;
      }
      void client.invoke('documents.search', { q: props.q, limit: 12 }).then((outcome: any) => {
        if (outcome.ok) dispatch('documents/searchDone', outcome.value);
      });
    },

    documentIngest: (props: any, dispatch: Dispatch): void => {
      void client.invoke('documents.ingest', { url: props.url, allowBrowser: true }).then((outcome: any) => {
        if (outcome.ok) dispatch('documents/ingested', outcome.value);
        else dispatch('documents/fail', failText(outcome));
      });
    },

    documentBatchIngest: (props: any, dispatch: Dispatch): void => {
      void client.invoke('documents.ingestbatch', { urls: props.urls, allowBrowser: true }).then((outcome: any) => {
        if (outcome.ok) dispatch('documents/webIngested', outcome.value);
        else dispatch('documents/fail', failText(outcome));
      });
    },

    webDiscover: (props: any, dispatch: Dispatch): void => {
      void client.invoke('web.search', { q: props.q, limit: 10 }).then((outcome: any) => {
        if (outcome.ok) dispatch('documents/webDone', outcome.value);
        else dispatch('documents/webFail', failText(outcome));
      });
    },

    /**
     * Resolve a selected-but-unsaved profile through the read-only
     * inspection. Nothing is written: the operator sees the issues a save
     * would produce, and clearing the selection clears the preview.
     */
    previewProfile: (props: any, dispatch: Dispatch): void => {
      const profile = props.profile === '' || props.profile === null || props.profile === undefined
        ? null : String(props.profile);
      if (profile === null) {
        dispatch('config/preview', null);
        return;
      }
      void client.invoke('config.inspect', { profile }).then((outcome: any) => {
        dispatch('config/preview', outcome.ok ? outcome.value.preview ?? null : null);
      });
    },

    saveSettings: (props: any, dispatch: Dispatch): void => {
      const settings = {
        ...props.settings,
        // "(none)" is the absence of a selection, not a profile named ''
        profile: props.settings.profile === '' || props.settings.profile === undefined
          ? null : props.settings.profile,
        chat: {
          ...props.settings.chat,
          ...(props.settings.chat.maxTokens === undefined ? {} : {
            maxTokens: props.settings.chat.maxTokens === '' || props.settings.chat.maxTokens === null
              ? null : Number(props.settings.chat.maxTokens),
          }),
        },
        documents: {
          ...props.settings.documents,
          maxTokens: Number(props.settings.documents.maxTokens),
          overlapTokens: Number(props.settings.documents.overlapTokens),
        },
      };
      const clear = props.clear ?? {};
      void client.invoke('settings.set', {
        settings,
        ...(clear.chatKey === true ? { clearChatKey: true } : {}),
        ...(clear.embedKey === true ? { clearEmbedKey: true } : {}),
        ...(clear.browserToken === true ? { clearBrowserToken: true } : {}),
      }).then((outcome: any) => {
        if (outcome.ok) dispatch('settings/saved', outcome.value);
      });
    },
  };

  const subs = {
    /**
     * The run window. Patches apply to the document the server
     * maintains, so what the surface holds is what the subscription
     * holds; the Loom follows whichever run is running.
     */
    runs: (_props: any, dispatch: Dispatch): (() => void) => {
      if (client.subscribe === undefined) return () => {};
      let document: any = { rows: [] };
      let following: string | null = null;
      const settled = new Set<string>();
      let seeded = false;
      const publish = (): void => {
        dispatch('loom/runs', document);
        // a run in flight is what a watcher wants shown; with nothing
        // running the newest stored run is what the Loom last did, which
        // a watched folder makes the common case
        const target = document.rows.find((row: any) => row.status === 'running') ?? document.rows[0];
        if (target !== undefined && target.id !== following) {
          following = target.id;
          dispatch('loom/follow', target.id);
        }
        // a run reaching a terminal state is what moved the counts the
        // other pages show; the first snapshot is history, not news
        let reached = false;
        for (const row of document.rows) {
          if (row.status === 'running') continue;
          if (!settled.has(row.id)) { settled.add(row.id); reached = true; }
        }
        if (reached && seeded) dispatch('runs/refresh');
        seeded = true;
      };
      const subscription = client.subscribe('runs.live', { limit: 50 }, {
        reconnect: { max: 3 },
        onError: () => dispatch('runs/refresh'),
        onSnapshot: (value: any) => { document = value; publish(); },
        onPatch: ({ patch }: any) => { document = applyJSONPatch(document, patch); publish(); },
      });
      return () => subscription.stop();
    },

    /** The Loom's watched run, addressed and resumable. */
    frames: (props: any, dispatch: Dispatch): (() => void) => {
      let counted = 0;
      return watchRun(client, props, (rows) => {
        dispatch('loom/frames', { runId: props.runId, rows });
        // a pass that reported its counts is a pass the watcher's own
        // numbers have moved for
        const passes = rows.filter((row) => row.kind === 'sync').length;
        if (passes > counted) { counted = passes; dispatch('watch/refresh'); }
      }, () => dispatch('loom/frameLost', (props.attempt ?? 0) + 1));
    },

    /** The run answering the pending question: its progress, its degradations, its end. */
    chatFrames: (props: any, dispatch: Dispatch): (() => void) =>
      watchRun(client, props, (rows) => {
        const terminal = rows.find((row) => row.kind === 'status');
        dispatch('chat/streamed', {
          runId: props.runId,
          messageId: props.messageId,
          chars: rows.reduce((total, row) => total + (row.kind === 'delta' ? Number(row.body.chars) : 0), 0),
          degraded: rows.filter((row) => row.kind === 'degraded').map((row) => row.body),
          status: terminal === undefined ? 'running' : String(terminal.body.status),
        });
        if (rows.some((row) => row.kind === 'answer') || terminal !== undefined) dispatch('chat/answered');
      }, () => dispatch('chat/fail', 'the answer stream was lost')),
  };

  const app = createApp({
    $app: '0.1',
    state: INITIAL_STATE,
    view: [{ match: '$', body: '$.ui' }],
    actions: ACTIONS,
    subs: [
      { run: 'runs' },
      {
        run: 'frames',
        when: '$.loom.watch',
        key: { runId: '$.loom.watch', attempt: '$.loom.frameAttempt' },
        withQuery: { runId: '$.loom.watch', attempt: '$.loom.frameAttempt' },
      },
      {
        run: 'chatFrames',
        when: '$.chat.run.runId',
        key: { runId: '$.chat.run.runId' },
        withQuery: { runId: '$.chat.run.runId', messageId: '$.chat.run.messageId' },
      },
    ],
  }, {
    node: options.node,
    document: options.document,
    effects,
    subs,
    viewModel: (state: any) => ({ ...state, ui: rootView(state) }),
    onError: options.onError ?? ((report: any) => console.error('[tangle-ui]', report)),
  });
  app.dispatch('boot');
  return app;
}
