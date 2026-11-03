import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRunObservation } from '@jarenjs/app';
import { mountAssistantView } from '@tangleai/assistant/view';
import { nl } from '@tangleai/assistant/messages/nl';
import { createHttpTransport, feedFromObservation, pollRunSummary, projectRunSummary, type RunSummary } from '../../examples/assistant-view.ts';
import { createStubHost, fire, serialize } from './dom.stub.ts';

const QUESTION = [{ role: 'user' as const, content: 'Plan de week' }];
const project = (runId: string) => (summary: RunSummary) => projectRunSummary(summary, { runId, messages: QUESTION, notice: s => s.stopReason === 'budget' ? 'Het budget is op.' : null });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const find = (node: any, predicate: any): any => predicate(node) ? node : (node.childNodes ?? []).map((child: any) => find(child, predicate)).find(Boolean);
function view(t: any, transport: any = { start: () => 'run-1', cancel: () => { throw new Error('a feed never cancels'); } }) {
  const { container } = createStubHost();
  const handle = mountAssistantView(container as any, { open: true, messages: nl, transport, state: { status: 'idle', messages: [] }, schedule: fn => fn(), onError: error => { throw error; } });
  t.after(() => handle.dispose());
  return { container, handle, html: () => serialize(container) };
}
/** A scripted run page source: each read answers the next page; a `wake` resolves when the test says so. */
function pages(script: any[]) {
  const reads: { id: string, after: number }[] = [];
  let release: (() => void) | undefined;
  return {
    reads,
    wakeNow: () => { release?.(); release = undefined; },
    readPage: async ({ id, after }: { id: string, after: number }) => {
      reads.push({ id, after });
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next ?? new Promise(() => {});
    },
    wake: () => new Promise<void>(resolve => { release = resolve; }),
  };
}
const page = (revision: number, summary: RunSummary, extra: object = {}) => ({ state: 'page', status: summary.status, summary, events: [], cursor: revision, revision, ...extra });

it('the observation feed renders each page, starts over on a reset and never cancels', async t => {
  const host = view(t), source = pages([
    page(1, { status: 'running', stage: 'Orders lezen', steps: 1 }),
    page(1, { status: 'running', stage: 'Orders lezen', steps: 1 }),
    // a reset page may repeat a revision already shown: only the reset makes it count
    { ...page(1, { status: 'running', stage: 'Opnieuw beginnen', steps: 1 }), state: 'reset-required' },
    page(3, { status: 'succeeded', answer: '**Klaar.**', proposals: [{ id: 'p-1', label: 'Prijs aanpassen' }], stopReason: 'budget' }),
  ]);
  const observe = createRunObservation({ readPage: source.readPage, wake: source.wake });
  const stop = feedFromObservation({ view: host.handle, observe, runId: 'run-1', attempt: 1, project: project('run-1'), failedText: 'De voortgang kon niet worden gelezen.' });
  await settle();
  assert.match(host.html(), /Stap 1 — Orders lezen/);
  source.wakeNow(); await settle();
  assert.match(host.html(), /Stap 1 — Orders lezen/, 'a lost wake re-reads the same page and nothing moves');
  source.wakeNow(); await settle();
  assert.match(host.html(), /Stap 1 — Opnieuw beginnen/, 'a reset page replaces the report');
  source.wakeNow(); await settle();
  const html = host.html();
  for (const shown of ['De assistent heeft dit verzoek afgerond.', '<strong>Klaar.</strong>', 'Prijs aanpassen', 'Het budget is op.']) assert.ok(html.includes(shown), shown);
  assert.deepEqual(host.handle.read().state.links, [{ id: 'p-1', label: 'Prijs aanpassen' }]);
  stop(); observe.dispose();
  assert.deepEqual(source.reads.map(read => read.after), [0, 1, 1, 1]);
});

it('the observation feed ignores another attempt and an older revision, and shows the host text when a read fails', async t => {
  const host = view(t);
  const calls: ((name: string, payload: any) => void)[] = [];
  const stop = feedFromObservation({
    view: host.handle, runId: 'run-1', attempt: 2, project: project('run-1'), failedText: 'De voortgang kon niet worden gelezen.',
    observe: (_props, dispatch) => { calls.push(dispatch); return () => {}; },
  });
  const [dispatch] = calls;
  dispatch!('run/page', { id: 2, runId: 'run-1', revision: 5, summary: { status: 'running', stage: 'Nieuw', steps: 2 } });
  dispatch!('run/page', { id: 1, runId: 'run-1', revision: 9, summary: { status: 'failed', error: 'oud' } });
  dispatch!('run/page', { id: 2, runId: 'run-0', revision: 9, summary: { status: 'failed', error: 'ander' } });
  dispatch!('run/page', { id: 2, runId: 'run-1', revision: 3, summary: { status: 'running', stage: 'Ouder', steps: 1 } });
  assert.match(host.html(), /Stap 2 — Nieuw/);
  assert.doesNotMatch(host.html(), /oud|ander|Ouder/);
  dispatch!('run/failed', { id: 2, runId: 'run-1', error: { code: 'run-observation-failed' } });
  assert.match(host.html(), /Fout: De voortgang kon niet worden gelezen\./);
  assert.match(host.html(), /Stap 2 — Nieuw/, 'the last page stays beside the failure');
  stop();
  const failing = view(t), source = pages([new Error('offline')]);
  const observe = createRunObservation({ readPage: source.readPage, wake: source.wake });
  feedFromObservation({ view: failing.handle, observe, runId: 'run-2', attempt: 1, project: project('run-2'), failedText: 'De voortgang kon niet worden gelezen.' });
  await settle();
  assert.match(failing.html(), /Fout: De voortgang kon niet worden gelezen\./);
  observe.dispose();
});

it('the poll feed stops at the end of the run and when its signal aborts', async t => {
  const host = view(t), summaries: RunSummary[] = [
    { status: 'queued' }, { status: 'running', stage: 'Voorstel maken', steps: 3 }, { status: 'failed', error: 'Upstream timeout' },
  ];
  const requests: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    requests.push(`${init.method ?? 'GET'} ${url}`);
    return Response.json(summaries.shift());
  }) as unknown as typeof globalThis.fetch;
  const waits: number[] = [];
  const last = await pollRunSummary({ view: host.handle, fetch, base: '/api/assistant', runId: 'run 1', project: project('run 1'), wait: async () => { waits.push(waits.length); }, signal: new AbortController().signal });
  assert.equal(last?.status, 'failed');
  assert.deepEqual(requests, ['GET /api/assistant/runs/run%201', 'GET /api/assistant/runs/run%201', 'GET /api/assistant/runs/run%201']);
  assert.equal(waits.length, 2);
  assert.match(host.html(), /Fout: Upstream timeout/);
  const stopped = new AbortController();
  const aborted = await pollRunSummary({ view: host.handle, fetch: (async () => { stopped.abort(); return Response.json({ status: 'running' }); }) as any,
    base: '/api', runId: 'run-2', project: project('run-2'), wait: async () => {}, signal: stopped.signal });
  assert.equal(aborted, null, 'an aborted poll ends without another update');
  assert.equal(projectRunSummary({ status: 'paused' }, { runId: 'run-3' }).status, 'failed', 'a status the host does not know is a failure');
});

it('the HTTP transport starts with POST and stops with DELETE; a refusal reaches the view', async t => {
  const requests: { method: string, url: string, body: unknown }[] = [];
  let refuse = false;
  const fetch = (async (url: string, init: RequestInit) => {
    requests.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : null });
    if (refuse) return new Response('no', { status: 409 });
    return init.method === 'POST' ? Response.json({ run: { id: 'run-7' } }) : new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const transport = createHttpTransport({ fetch, base: '/api/assistant' });
  const host = view(t, transport);
  host.handle.update({ status: 'idle', messages: [], conversation: { id: 'c-9' } });
  const area = find(host.container, (n: any) => n.tagName === 'textarea');
  area.value = 'Plan de week'; fire(area, 'input');
  fire(find(host.container, (n: any) => n.tagName === 'form'), 'submit'); await settle();
  assert.deepEqual(requests[0], { method: 'POST', url: '/api/assistant/runs', body: { message: 'Plan de week', conversationId: 'c-9' } });
  host.handle.update({ status: 'running', runId: 'run-7', messages: QUESTION });
  refuse = true;
  fire(find(host.container, (n: any) => n.tagName === 'button' && serialize(n).includes('Annuleren')), 'click'); await settle();
  assert.deepEqual(requests[1], { method: 'DELETE', url: '/api/assistant/runs/run-7', body: null });
  assert.match(host.html(), /Het verzoek kon niet worden geannuleerd: HTTP 409 cancelling run run-7/);
  await host.handle.dispose();
  assert.equal(requests.length, 2, 'disposing the view sends no DELETE');
});

it('the observation feed resumes after a failed read and stops at the page that ends the run', async t => {
  const host = view(t), source = pages([new Error('offline'), page(1, { status: 'running', stage: 'Orders lezen', steps: 1 }), page(2, { status: 'succeeded', answer: 'Klaar.' })]);
  const observe = createRunObservation({ readPage: source.readPage, wake: source.wake });
  let retry!: () => void;
  const stop = feedFromObservation({ view: host.handle, observe, runId: 'run-1', attempt: 1, project: project('run-1'),
    failedText: 'De voortgang kon niet worden gelezen.', wait: () => new Promise<void>(resolve => { retry = resolve; }) });
  await settle();
  assert.match(host.html(), /Fout: De voortgang kon niet worden gelezen\./);
  assert.match(host.html(), /role="status">Bezig…<\/p>/, 'the run goes on as far as the host knows');
  retry(); await settle();
  assert.match(host.html(), /Stap 1 — Orders lezen/);
  assert.doesNotMatch(host.html(), /Fout:/, 'the next page replaces the failure');
  source.wakeNow(); await settle();
  assert.match(host.html(), /De assistent heeft dit verzoek afgerond\./);
  source.wakeNow(); await settle();
  assert.deepEqual(source.reads.map(read => read.after), [0, 0, 1], 'nothing is read after the page that ends the run');
  stop(); observe.dispose();
});

it('a poll whose fetch honours the abort ends with null, and an inherited status is unknown', async t => {
  const host = view(t), stopped = new AbortController();
  const fetch = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
    queueMicrotask(() => stopped.abort());
  })) as unknown as typeof globalThis.fetch;
  assert.equal(await pollRunSummary({ view: host.handle, fetch, base: '/api', runId: 'run-1', project: project('run-1'), wait: async () => {}, signal: stopped.signal }), null);
  const inherited = projectRunSummary({ status: 'toString' }, { runId: 'run-1' });
  assert.deepEqual([inherited.status, inherited.error], ['failed', 'toString']);
});

it('the HTTP transport refuses a run id a URL would resolve away', async () => {
  const requests: string[] = [];
  const answer = (body: unknown) => (async (url: string, init: RequestInit) => { requests.push(`${init.method} ${url}`); return Response.json(body); }) as unknown as typeof globalThis.fetch;
  const context = { conversation: null, signal: new AbortController().signal };
  for (const body of [{ run: {} }, { run: { id: 7 } }, { run: '' }, { run: '..' }])
    await assert.rejects(async () => createHttpTransport({ fetch: answer(body), base: '/api' }).start('Plan', context), TypeError, JSON.stringify(body));
  for (const runId of ['', '.', '..'])
    await assert.rejects(async () => createHttpTransport({ fetch: answer(null), base: '/api' }).cancel(runId), TypeError, runId);
  assert.deepEqual(requests, ['POST /api/runs', 'POST /api/runs', 'POST /api/runs', 'POST /api/runs'], 'no DELETE left for a refused id');
  assert.equal(await createHttpTransport({ fetch: answer({ run: { id: 'a/b' } }), base: '/api' }).start('Plan', context), 'a/b');
});
