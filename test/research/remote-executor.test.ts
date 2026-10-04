import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sleep } from '@jarenjs/core/retry';
import { createRemoteResearchExecutor, researchExecutionResponse, researchExecutionResult, decodeResearchExecutionRequest,
  researchExecutionRequest, researchRefuse, type ResearchExecutionResult } from '@tangleai/research';
import { executionFixture } from './execution-fixtures.ts';
import { checked } from './fixtures.ts';

test('bounded remote round trip validates the frozen archive and every receipted output byte', async () => {
  const f = await executionFixture(); let calls = 0;
  const fetch: typeof globalThis.fetch = async (url, request) => {
    calls++; assert.equal(new URL(String(url)).pathname, '/run'); assert.equal(request?.redirect, 'error');
    assert.equal(new Headers(request?.headers).get('authorization'), 'Bearer test-token');
    const body = JSON.parse(String(request?.body)); assert.equal(JSON.stringify(body).includes('test-token'), false);
    const decoded = checked(await decodeResearchExecutionRequest(body));
    assert.equal(decoded.manifest.executionManifestHash, f.manifest.executionManifestHash);
    const fixture = checked(await f.executor.run(decoded.manifest, decoded.workspace, f.context)), run = fixture.run;
    const bytes = (id: string) => fixture.artifacts.find(row => row.artifactId === id)!.bytes;
    // Protocol stand-in only; local engine qualification is a separate smoke.
    const result = checked(await researchExecutionResult(decoded.manifest, { exitStatus: run.exitStatus!, output: run.output,
      stdout: bytes(run.stdoutArtifactId!), stderr: bytes(run.stderrArtifactId!),
      files: run.outputInventory!.map(row => ({ path: row.path, bytes: bytes(row.artifactId) })), resources: run.resources!,
      stopReason: run.stopReason!, isolation: { ...run.isolation!, kind: 'container', verified: true }, error: run.error }));
    return Response.json(researchExecutionResponse(decoded.manifest.executionManifestHash, { valid: true, value: result }));
  };
  const remote = createRemoteResearchExecutor({ endpoint: 'http://127.0.0.1:8020', token: 'test-token', fetch, now: Date.now, sleep, requestMs: 5000 });
  try {
    const result = checked(await remote.run(f.manifest, f.workspace, f.context));
    assert.equal(result.run.isolation!.kind, 'container'); assert.equal(result.run.status, 'ok'); assert.equal(calls, 1);
  } finally { await remote.close(); }
});
for (const mode of ['transport', 'http', 'invalid-json', 'cancel-after-dispatch', 'wrong-receipt'] as const)
  test(mode + ' remains unresolved after exactly one remote dispatch', async () => {
    const f = await executionFixture(), controller = new AbortController(); let calls = 0;
    const remote = createRemoteResearchExecutor({ endpoint: 'http://127.0.0.1:8020', now: Date.now, sleep, requestMs: 5000,
      fetch: async () => {
        calls++;
        if (mode === 'transport') throw Error('connection lost');
        if (mode === 'http') return new Response('not settled', { status: 503 });
        if (mode === 'cancel-after-dispatch') controller.abort();
        if (mode === 'wrong-receipt') return Response.json(researchExecutionResponse('f'.repeat(64), researchRefuse<ResearchExecutionResult>('TRSH1010', '/image', 'Refused before dispatch.')));
        return new Response('incomplete body');
      } });
    try {
      const result = await remote.run(f.manifest, f.workspace, { ...f.context, signal: controller.signal });
      assert.equal(result.valid, false); if (!result.valid) { assert.equal(result.issues[0].cause?.state, 'unresolved'); assert.equal(result.issues[0].cause?.attempts, 1); }
      assert.equal(calls, 1);
    } finally { await remote.close(); }
  });
test('pre-dispatch cancellation, isolation refusal and missing engine stay distinguishable', async () => {
  const f = await executionFixture(); let calls = 0;
  const remote = createRemoteResearchExecutor({ endpoint: 'http://127.0.0.1:8020', now: Date.now, sleep, requestMs: 5000,
    fetch: async () => { calls++; return Response.json({ available: false, kind: 'container', engine: null, version: null, imageDigests: [], reason: 'No container engine answered.' }); } });
  try {
    const controller = new AbortController(); controller.abort();
    const cancelled = await remote.run(f.manifest, f.workspace, { ...f.context, signal: controller.signal });
    assert.equal(cancelled.valid, false); if (!cancelled.valid) assert.equal(cancelled.issues[0].cause?.attempts, 0);
    assert.equal((await remote.run({ ...f.manifest, network: { setup: 'off', measured: 'on' } } as never, f.workspace, f.context)).valid, false);
    assert.equal(calls, 0);
    const capability = checked(await remote.capability({ signal: f.context.signal }));
    assert.equal(capability.available, false); assert.match(capability.reason!, /No container engine/); assert.equal(calls, 1);
  } finally { await remote.close(); }
});
test('closed request archive rejects caller-supplied host mounts and non-byte content', async () => {
  const f = await executionFixture(), wire = checked(await researchExecutionRequest(f.manifest, f.workspace, f.context));
  const mounted = await decodeResearchExecutionRequest({ ...wire, mounts: ['/repository'] });
  assert.equal(mounted.valid, false); if (!mounted.valid) assert.equal(mounted.issues[0].code, 'TRSH1010');
  const changed = structuredClone(wire); changed.workspace.artifacts[0].bytes[0] = 256;
  assert.equal((await decodeResearchExecutionRequest(changed)).valid, false);
});
