/**
 * The desktop UI — one @jarenjs/app document over the contract client.
 *
 * Boundary discipline, jarenjs style: the DOCUMENT owns state and
 * actions (pure JSON, `actions.ts`); the HOST owns the view builders
 * (`views.ts`, plain vnodes computed in the viewModel), the effects
 * (each one calls the typed contract client and dispatches `done` or
 * `fail` — outcomes are values, so actions never branch), and one
 * subscription: the `dag.live` SSE stream, which repaints the Loom as
 * the server runs the pipeline and refreshes the lists when a run
 * settles.
 *
 * The client is INJECTED, so the same app runs headless in node tests
 * against `toFetchHandler(serveHttp(...))` — the whole stack, no
 * browser, no socket.
 */

import { createApp } from '@jarenjs/app';

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

    chatSend: (props: any, dispatch: Dispatch): void => {
      void client.invoke('chat.send', { text: props.text }).then((outcome: any) => {
        if (outcome.ok) dispatch('chat/done', outcome.value);
        else dispatch('chat/fail', failText(outcome));
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

    saveSettings: (props: any, dispatch: Dispatch): void => {
      const settings = {
        ...props.settings,
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
    /** The live DAG stream. Emissions are root-replace patches; the
     * value IS the state. When a run settles, the lists refresh. */
    live: (_props: any, dispatch: Dispatch): (() => void) => {
      if (client.subscribe === undefined) return () => {};
      let lastStatus: string | null = null;
      const push = (value: any, snapshot = false): void => {
        dispatch(snapshot ? 'loom/snapshot' : 'loom/live', value);
        const status = value?.run?.status ?? null;
        if (lastStatus === 'running' && (status === 'ok' || status === 'error')) {
          dispatch('runs/refresh');
        }
        lastStatus = status;
      };
      const subscription = client.subscribe('dag.live', {}, {
        reconnect: { max: 3 },
        onError: () => dispatch('loom/refresh'),
        onSnapshot: (value: any) => push(value, true),
        onPatch: ({ patch }: any) => {
          const root = patch.find((op: any) => op.path === '');
          if (root !== undefined) push(root.value);
        },
      });
      return () => subscription.stop();
    },
  };

  const app = createApp({
    $app: '0.1',
    state: INITIAL_STATE,
    view: [{ match: '$', body: '$.ui' }],
    actions: ACTIONS,
    subs: [{ run: 'live' }],
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
