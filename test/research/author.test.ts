import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executionWorkflowFixture, executionWorkflowTools } from './execution-workflow-fixtures.ts';
import { workflowHarness } from './workflow-fixtures.ts';
import { researchCodeStaticIssues } from '../../packages/research/src/stages/author.ts';

test('native author uses the shared budget and immutable capped toolbox; fixture execution refuses its code', async () => {
  const f = await executionWorkflowFixture(true); let calls = 0, inspected = false;
  const source = 'console.log("raw output only");';
  const h = await workflowHarness(f, { tools: (tools, stores) => executionWorkflowTools(f, tools, stores.researchStore),
    clientFor: node => { assert.equal(node.role, 'research-code-author'); return { endpoint: { provider: 'scripted' }, complete: async request => {
      calls++;
      if (calls === 1) return { message: { role: 'assistant', content: '', toolCalls: [
        { id: 'plan', name: 'read-plan', arguments: '{}' },
        { id: 'data', name: 'read-workspace', arguments: JSON.stringify({ path: f.plan.inputPaths[0] }) },
        { id: 'write', name: 'write-code', arguments: JSON.stringify({ path: 'code/main.mjs', text: source }) },
        { id: 'overwrite', name: 'write-code', arguments: JSON.stringify({ path: 'code/main.mjs', text: 'different content' }) },
        { id: 'oversized', name: 'write-code', arguments: JSON.stringify({ path: 'code/main.mjs', text: 'é'.repeat(513) }) },
        { id: 'unknown-slot', name: 'write-code', arguments: JSON.stringify({ path: 'code/extra.mjs', text: source }) },
        { id: 'evaluator-read', name: 'read-workspace', arguments: JSON.stringify({ path: 'evaluation/registry.json' }) },
      ] }, finishReason: 'tool_calls', usage: { prompt_tokens: 7, completion_tokens: 3 } };
      if (calls === 2) {
      const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
      const replies = messages.filter(row => row.role === 'tool').map(row => row.content);
      assert.equal(replies.length, 7); assert.match(replies[0], /allowedCode/); assert.match(replies[1], /points/);
      assert.match(replies[2], /recordId/); assert.match(replies[3], /TRSH1002/); inspected = true;
      assert.match(replies[4], /TRSH1010/); assert.match(replies[5], /TRSH1010/); assert.match(replies[6], /TRSH1005/);
      }
      return { message: { role: 'assistant', content: JSON.stringify({ entrypoint: 'code/main.mjs' }) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } }; } });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(inspected, true); assert.equal(calls, 3); assert.equal(trace.run.budget.spent.turns, 3);
    assert.equal(trace.run.status, 'failed'); assert.equal(snapshot.state.status, 'STOPPED');
    const writes = snapshot.records.filter(row => row.kind === 'ResearchCodeWrite');
    assert.equal(writes.length, 1); assert.equal(writes[0].value.text, source);
    const attempt = snapshot.attempts.find(row => row.attempt.stage === 'EXECUTE')!;
    assert.equal(attempt.attempt.spend.calls, 3); assert.equal(attempt.attempt.spend.tokens, 30); assert.equal(attempt.attempt.spend.physical, 5);
    assert.equal(attempt.attempt.error!.code, 'TRSH1003');
    assert.ok(snapshot.artifacts.some(row => snapshot.committedAdmissionIds.includes(row.id) && row.artifact.id === writes[0].value.artifactId));
    await assert.rejects(async () => h.host.bindings.toolBindings['write-code'].handler({ path: 'code/main.mjs', text: source }, {
      signal: new AbortController().signal, idempotencyKey: null, invocation: { runId: f.project.id, node: 'author', path: 'invented/author' },
    }), /TRSH1005/);
  } finally { await h.close(); }
});
test('static checks report hidden reads and network imports without claiming sandbox isolation', () => {
  assert.equal(researchCodeStaticIssues('import fs from "node:fs";').length, 0);
  assert.equal(researchCodeStaticIssues('read("hidden/labels.json")')[0].code, 'TRSH1010');
  assert.equal(researchCodeStaticIssues('import net from "node:net";')[0].code, 'TRSH1010');
  assert.equal(researchCodeStaticIssues('fetch("https://example.invalid")')[0].code, 'TRSH1010');
});
