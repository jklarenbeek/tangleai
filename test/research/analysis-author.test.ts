import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchExecutionResult, researchRawOutputBytes, type ResearchExecutor } from '@tangleai/research';
import { analysisWorkflowFixture, analysisWorkflowTools, analysisReviewClient } from './analysis-workflow-fixtures.ts';
import { workflowHarness } from './workflow-fixtures.ts';

// This executor recognizes only two exact authored fixtures. It never evaluates
// arbitrary source and reports fixture isolation, not a container qualification.
for (const repair of [false, true]) test('authored ' + (repair ? 'repair consumes its admitted diagnosis' : 'replication reuses exact code without reauthoring'), async () => {
  const f = await analysisWorkflowFixture(repair ? 'success' : 'negative', true);
  const initial = repair ? '/* registered missing initializer */' : '/* registered equality control */';
  const fixed = '/* registered corrected initializer */';
  let authorCalls = 0, authors = 0, repairInspected = false;
  const codeIds: string[] = [], reviews = analysisReviewClient();
  const executor: ResearchExecutor = { ...f.executor, async run(manifest, workspace, context) {
    if (!manifest.codeArtifactId) return f.executor.run(manifest, workspace, context);
    assert.ok(manifest.codeArtifactId); codeIds.push(manifest.codeArtifactId);
    const source = new TextDecoder().decode(workspace.artifacts.find(row => row.artifactId === manifest.codeArtifactId)!.bytes);
    assert.ok([initial, fixed].includes(source), 'Only exact registered fixture bytes can execute.');
    const failed = repair && source === initial && manifest.condition === f.contract.successRule.condition;
    const output = failed ? null : { kind: 'clusters' as const, centroids: [[!repair || manifest.condition === f.contract.successRule.baseline ? 20 : manifest.seed]], assignments: [0], iterations: 1 };
    return researchExecutionResult(manifest, { exitStatus: failed ? 1 : 0, stdout: new Uint8Array(), stderr: new Uint8Array(),
      files: output ? [{ path: 'output/raw.json', bytes: researchRawOutputBytes(output) }] : [], output,
      resources: { wallMs: 0, cpuMs: null, peakMemoryBytes: null }, stopReason: 'completed',
      isolation: { kind: 'fixture', verified: false, imageDigest: manifest.imageDigest, setupLogArtifactId: null, completeOutput: true },
      error: failed ? { code: 'TRSH1008', path: '/initializer', detail: 'Registered candidate omitted the initializer.' } : null });
  } };
  const h = await workflowHarness(f, { tools: (base, stores) => analysisWorkflowTools(f, base, stores.researchStore, executor),
    clientFor: (node, ...rest) => node.role !== 'research-code-author' ? reviews(node, ...rest) : {
      endpoint: { provider: 'scripted' }, async complete(request) {
        const call = authorCalls++ % 3;
        if (call === 0) {
          const text = authors++ === 0 ? initial : fixed;
          return { message: { role: 'assistant', content: '', toolCalls: [
            { id: 'plan', name: 'read-plan', arguments: '{}' },
            ...(repair && authors === 2 ? [{ id: 'previous', name: 'read-previous-code', arguments: JSON.stringify({ path: 'code/main.mjs', offset: 0, chars: 2048 }) }] : []),
            { id: 'code', name: 'write-code', arguments: JSON.stringify({ path: 'code/main.mjs', text }) },
          ] }, finishReason: 'tool_calls', usage: { prompt_tokens: 7, completion_tokens: 3 } };
        }
        if (repair && authors === 2 && call === 1) {
          const replies = (request as { messages: Array<{ role: string; content: string }> }).messages.filter(row => row.role === 'tool');
          assert.match(replies[0].content, /Registered candidate omitted the initializer/);
          const previous = JSON.parse(replies[1].content); assert.equal(previous.text, initial); assert.equal(previous.nextOffset, null); repairInspected = true;
        }
        return { message: { role: 'assistant', content: JSON.stringify({ entrypoint: 'code/main.mjs' }) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
      },
    } });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    assert.equal(snapshot.state.status, repair ? 'COMPLETE' : 'STOPPED');
    const branches = snapshot.records.filter(row => row.kind === 'ExperimentBranch').map(row => row.value).sort((a, b) => a.attemptOrdinal - b.attemptOrdinal);
    assert.deepEqual(branches.map(row => row.kind), repair ? ['initial', 'repair'] : ['initial', 'replicate', 'replicate']);
    assert.equal(branches[1].parentId, branches[0].id);
    assert.equal(new Set(branches.map(row => row.hypothesisHash)).size, 1);
    assert.equal(authors, repair ? 2 : 1); assert.equal(authorCalls, authors * 3);
    assert.equal(new Set(codeIds).size, authors);
    assert.equal(snapshot.records.filter(row => row.kind === 'ResearchCodeWrite').length, authors);
    if (repair) assert.ok(repairInspected);
  } finally { await h.close(); }
});
