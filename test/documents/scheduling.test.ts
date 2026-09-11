import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SafeStaticFetcher } from '@tangleai/documents';

it('cancels queued and already-aborted documents before dispatch, and drains active bodies on close', async () => {
  let start!: () => void;
  const started = { promise: new Promise<void>((resolve) => { start = resolve; }), resolve: () => start() };
  let finish!: () => void;
  const release = { promise: new Promise<void>((resolve) => { finish = resolve; }), resolve: () => finish() };
  const calls: string[] = [];
  const fetcher = new SafeStaticFetcher({
    allowPrivate: true,
    limits: { concurrency: 1, perHostDelayMs: 0, respectRobots: false },
    fetch: async (url) => {
      calls.push(String(url)); started.resolve();
      await release.promise;
      return new Response('content');
    },
  });
  const first = fetcher.fetch('http://127.0.0.1/first');
  await started.promise;
  const abort = new AbortController();
  const second = fetcher.fetch('http://127.0.0.1/second', {}, abort.signal);
  abort.abort();
  await assert.rejects(second, (error: any) => error.code === 'fetch-aborted');
  await assert.rejects(fetcher.fetch('http://127.0.0.1/third', {}, abort.signal), (error: any) => error.code === 'fetch-aborted');
  let closed = false;
  const closing = fetcher.close().then(() => { closed = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false, 'shutdown must wait for admitted work');
  release.resolve();
  assert.equal((await first).status, 'ok');
  await closing;
  assert.deepEqual(calls, ['http://127.0.0.1/first']);
});

it('spaces every robots, document and redirect request by its actual host', async () => {
  let tick = 0;
  const calls: Array<[string, number]> = [];
  const fetcher = new SafeStaticFetcher({
    allowPrivate: true,
    schedule: { now: () => tick, sleep: async (ms, signal) => { if (!signal?.aborted) tick += ms; } },
    limits: { concurrency: 2, perHostDelayMs: 50, respectRobots: true },
    fetch: async (url) => {
      const path = String(url); calls.push([path, tick]);
      if (path.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (path.endsWith('/start')) return new Response(null, { status: 302, headers: { location: '/end' } });
      return new Response('content');
    },
  });
  try {
    assert.equal((await fetcher.fetch('http://127.0.0.1/start')).status, 'ok');
    assert.deepEqual(calls.map(([, at]) => at), [0, 50, 100]);
  } finally { await fetcher.close(); }
});
