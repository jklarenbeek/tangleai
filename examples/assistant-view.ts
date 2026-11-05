/**
 * Feed `@tangleai/assistant/view` from a host that runs the assistant on its
 * server: one projection, two feeds and one transport, every capability
 * injected. `projectRunSummary` maps the server's summary of a run onto the
 * view's report; `feedFromObservation` follows the run through Jaren's
 * `createRunObservation`; `pollRunSummary` polls the summary instead;
 * `createHttpTransport` starts and cancels runs over HTTP. Stopping a feed,
 * like disposing the view, never cancels the run.
 *
 * The summary is the shape a host's run server answers on
 * `GET {base}/runs/:id`: `{ status, stage, steps, answer, proposals, usage,
 * stopReason, error }`.
 */
import type { AssistantViewState, AssistantViewTransport } from '@tangleai/assistant/view';

export type RunSummary = {
  status: string, stage?: string | null, steps?: number | null, answer?: string | null,
  proposals?: { id: string, label: string }[] | null, usage?: unknown, stopReason?: string | null, error?: string | null,
};
type Turn = AssistantViewState['messages'][number];
/** The view needs no more than the host's own text for what the summary says in codes. */
export type ProjectionOptions = { runId: string, messages?: Turn[], conversation?: AssistantViewState['conversation'], notice?: (summary: RunSummary) => string | null };

/** The server's statuses onto the view's closed set; a status the host does not know is a failure, never a spinner. */
const STATUS: Record<string, AssistantViewState['status']> = {
  queued: 'running', running: 'running', succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled',
};
const statusOf = (status: string) => Object.hasOwn(STATUS, status) ? STATUS[status]! : null;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/** @param summary @param options */
export function projectRunSummary(summary: RunSummary, { runId, messages = [], conversation = null, notice }: ProjectionOptions): AssistantViewState {
  const status = statusOf(summary.status);
  const step = Number.isSafeInteger(summary.steps) ? summary.steps! : undefined;
  return {
    status: status ?? 'failed', runId, conversation,
    messages: summary.answer ? [...messages, { role: 'assistant', content: summary.answer }] : messages,
    progress: summary.stage || step !== undefined ? { ...(summary.stage ? { stage: summary.stage } : {}), ...(step !== undefined ? { step } : {}) } : null,
    links: (summary.proposals ?? []).map(({ id, label }) => ({ id, label })),
    notice: notice?.(summary) ?? null,
    // an unknown status is shown as the server wrote it, inside the view's own error frame
    error: summary.error ?? (status === null ? String(summary.status) : null),
  };
}

type View = { update(state: AssistantViewState): void };
type Observe = (props: { runId: string, id: number, cursor?: number, update: string, error: string }, dispatch: (name: string, payload: any) => void) => () => void;
/**
 * Follow one run through `createRunObservation`: each page replaces the report,
 * a page for another attempt or an older revision is ignored, a reset page
 * starts over, and the feed stops at the page that ends the run. A failed read
 * shows the host's own text beside the last page and, when `wait` is given,
 * resumes from where the reading stopped once `wait` resolves. Returns the stop.
 * @param options
 */
export function feedFromObservation({ view, observe, runId, attempt, project, failedText, wait }: {
  view: View, observe: Observe, runId: string, attempt: number,
  project: (summary: RunSummary) => AssistantViewState, failedText: string, wait?: (signal: AbortSignal) => Promise<void>,
}) {
  const stopped = new AbortController();
  let revision = -1, last: AssistantViewState | null = null, detach = () => {};
  const stop = () => { stopped.abort(); detach(); };
  const follow = (cursor: number) => {
    detach = observe({ runId, id: attempt, cursor, update: 'run/page', error: 'run/failed' }, (name, payload) => {
      if (stopped.signal.aborted || payload?.id !== attempt || payload.runId !== runId) return;
      if (name === 'run/failed') {
        view.update({ ...(last ?? project({ status: 'running' })), error: failedText });
        wait?.(stopped.signal).then(() => { if (!stopped.signal.aborted) follow(payload.cursor ?? cursor); }, () => {});
        return;
      }
      if (payload.reset) revision = -1;
      if (payload.revision <= revision) return;
      const next = project(payload.summary);
      view.update(next);
      revision = payload.revision; last = next;
      if (TERMINAL.has(next.status)) stop();
    });
  };
  follow(0);
  return stop;
}

/**
 * Poll the summary until the run ends: each answer replaces the report, and
 * `wait` (the host's timer) paces the next request. Resolves with the last
 * summary, or `null` when `signal` stopped it first.
 * @param options
 */
export async function pollRunSummary({ view, fetch, base, runId, project, wait, signal }: {
  view: View, fetch: typeof globalThis.fetch, base: string, runId: string,
  project: (summary: RunSummary) => AssistantViewState, wait: (signal: AbortSignal) => Promise<void>, signal: AbortSignal,
}): Promise<RunSummary | null> {
  const url = `${base}/runs/${segment(runId)}`;
  try {
    while (!signal.aborted) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} reading run ${runId}`);
      const summary = await response.json() as RunSummary;
      if (signal.aborted) break;
      view.update(project(summary));
      if (TERMINAL.has(statusOf(summary.status) ?? 'failed')) return summary;
      await wait(signal);
    }
  } catch (error) { if (!signal.aborted) throw error; }
  return null;
}

/** A run id as one path segment; an id a URL would resolve away (empty, `.`, `..`) is refused. @param id */
function segment(id: unknown) {
  if (typeof id !== 'string' || id === '' || id === '.' || id === '..') throw new TypeError(`not a run id: ${JSON.stringify(id)}`);
  return encodeURIComponent(id);
}

/**
 * Start a run with `POST {base}/runs` (`{ message, conversationId }` → `{ run: { id } }`)
 * and stop one with `DELETE {base}/runs/:id`. Each request gives up after
 * `timeoutMs`; a refused or abandoned request rejects, so the view shows why.
 * @param options
 */
export function createHttpTransport({ fetch, base, timeoutMs = 30_000 }: { fetch: typeof globalThis.fetch, base: string, timeoutMs?: number }): AssistantViewTransport {
  return {
    async start(message, { conversation, signal }) {
      const id = conversation && typeof conversation === 'object' && !Array.isArray(conversation) ? conversation.id : null;
      const conversationId = typeof id === 'string' ? id : null;
      const response = await fetch(`${base}/runs`, {
        method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, conversationId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} starting a run`);
      const { run } = await response.json() as { run?: { id?: unknown } | string };
      const runId = typeof run === 'string' ? run : run?.id;
      segment(runId);
      return runId as string;
    },
    async cancel(runId) {
      const response = await fetch(`${base}/runs/${segment(runId)}`, { method: 'DELETE', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status} cancelling run ${runId}`);
    },
  };
}
