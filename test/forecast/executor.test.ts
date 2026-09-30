import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createForecastExecutor, forecastMust, forecastCheckpointFail, forecastQuery, forecastGet, forecastBytes } from '@tangleai/forecast';
import { runtimeFixture, scriptedClient } from './runtime-fixture.ts';

const reply = (content: string,finishReason = 'stop',usage: any = { total_tokens: 7 }) => ({ message: { role: 'assistant',content },finishReason,usage });
describe('bounded forecast execution', () => {
  it('parses a stopped prediction and records exact usage and replay identity', async () => {
    const f = await runtimeFixture(), client = scriptedClient(async () => ({ ...reply('\\boxed{APPROVE}'),replayed: { ms: 12 } }));
    const executor = createForecastExecutor({ client,...f,budget: { turns: 4,ms: 1000 },now: () => 0 });
    const result = await executor.run(f);
    assert.equal(result.prediction?.normalized,'approve'); assert.equal(result.failure,null);
    assert.deepEqual(result.spend,{ calls: 1,tokens: 7,ms: 0,usageKnown: true });
    assert.equal(result.calls[0].replayed,true); assert.match(result.calls[0].requestDigest,/^[a-f0-9]{64}$/);
    assert.ok(result.trace.messages.length); assert.ok(result.trace.steps.length);
    await assert.rejects(executor.run(f),/once/);
  });
  it('retains failed traces for length, tool-limit, budget-turns and malformed boxes', async () => {
    for (const mode of ['length','tool-limit','budget-turns','malformed','unknown'] as const) {
      const f = await runtimeFixture(); let calls = 0;
      const client = scriptedClient(async () => { calls++; return mode === 'tool-limit' ? { ...reply('\\boxed{approve}'),message: { role: 'assistant',content: '\\boxed{approve}',toolCalls: [{ id: 'call',name: 'web_search',arguments: '{"query":"Tidewater"}' }] } } : reply(mode === 'malformed' ? 'not boxed' : '\\boxed{approve}',mode === 'length' ? 'length' : mode === 'unknown' ? undefined as any : 'stop'); });
      // Explicit null is what a client with no provider finish marker returns.
      const complete = client.complete;
      if (mode === 'unknown') client.complete = async request => ({ ...await complete(request),finishReason: null });
      const result = await createForecastExecutor({ client,...f,budget: { turns: mode === 'budget-turns' ? 0 : 4,ms: 1000 },now: () => 0,limits: { maxToolRounds: 0 } }).run(f);
      assert.equal(result.prediction,null); assert.equal(result.failure?.code,mode === 'malformed' ? 'TFCT1009' : 'TFCT1005');
      assert.equal(result.stopReason,mode === 'malformed' ? 'stop' : mode); assert.equal(calls,mode === 'budget-turns' ? 0 : 1);
      const retained = forecastMust(await forecastCheckpointFail(f.store,{ checkpointId: f.checkpoint.id,at: f.checkpoint.scheduledAt,trace: result.trace,evidence: result.evidence,spend: result.spend,stopReason: result.stopReason,failure: result.failure! }));
      assert.equal(retained.status,'failed'); assert.equal(forecastMust(await forecastQuery(f.store,'traces')).length,1);
      assert.equal(forecastMust(await forecastGet(f.store,'traces',result.trace.id))?.id,result.trace.id);
    }
  });
  it('unknown, partial, zero and failed usage are never silently measured as free', async () => {
    for (const [usage,expected] of [[null,null],[{},null],[{ prompt_tokens: 4 },null],[{ total_tokens: 0 },0],[{ prompt_tokens: 2,completion_tokens: 3 },5]] as const) {
      const f = await runtimeFixture(), result = await createForecastExecutor({ ...f,client: scriptedClient(async () => reply('\\boxed{approve}','stop',usage)),budget: { turns: 3,tokens: 1000,ms: 1000 },now: () => 0 }).run(f);
      assert.equal(result.spend.tokens,expected); assert.equal(result.spend.usageKnown,expected !== null);
    }
    const f = await runtimeFixture(), failed = await createForecastExecutor({ ...f,client: scriptedClient(async () => { throw Error('injected provider failure'); }),budget: { turns: 3,ms: 1000 },now: () => 0 }).run(f);
    assert.equal(failed.failure?.code,'TFCT1012'); assert.equal(failed.spend.calls,1); assert.equal(failed.spend.tokens,null); assert.equal(failed.calls[0].failure,'TFCT1012');
  });
  it('bounds native tool results and the retained trace with counted truncation', async () => {
    const f = await runtimeFixture(); let calls = 0;
    const client = scriptedClient(async () => ++calls === 1 ? { ...reply(''),message: { role: 'assistant',content: '',toolCalls: [{ id: 'h',name: 'harness_read',arguments: '{}' }] } } : reply('x'.repeat(20000) + '\\boxed{approve}'));
    const result = await createForecastExecutor({ ...f,client,budget: { turns: 3,ms: 1000 },now: () => 0,limits: { maxToolResultChars: 100,maxTraceBytes: 512 } }).run(f);
    assert.equal(result.prediction?.normalized,'approve'); assert.ok(result.trace.bytes <= 512); assert.ok(result.trace.truncated.chars > 0); assert.ok(result.trace.truncated.steps > 0);
    assert.equal(result.trace.bytes,forecastBytes({ messages: result.trace.messages,steps: result.trace.steps }));
  });
  it('token and elapsed limits prevent another client call after a tool response', async () => {
    for (const dimension of ['tokens','ms'] as const) {
      const f = await runtimeFixture(); let calls = 0, clock = 0;
      const client = scriptedClient(async () => { calls++; clock = 2; return { ...reply('', 'tool_calls',{ total_tokens: 10 }),message: { role: 'assistant',content: '',toolCalls: [{ id: 'h',name: 'harness_read',arguments: '{}' }] } }; });
      const result = await createForecastExecutor({ ...f,client,budget: { turns: 10,ms: dimension === 'ms' ? 1 : 1000,...(dimension === 'tokens' ? { tokens: 1 } : {}) },now: () => clock }).run(f);
      assert.equal(calls,1); assert.equal(result.failure?.code,'TFCT1005'); assert.equal(result.stopReason,'budget-' + dimension); assert.equal(result.spend.tokens,10);
    }
  });
  it('provider-reported zero usage does not spend estimated tokens between tool rounds', async () => {
    const f = await runtimeFixture(); let calls = 0;
    const client = scriptedClient(async () => ++calls === 1 ? { ...reply('', 'tool_calls',{ total_tokens: 0 }),message: { role: 'assistant',content: '',toolCalls: [{ id: 'h',name: 'harness_read',arguments: '{}' }] } } : reply('\\boxed{approve}','stop',{ total_tokens: 0 }));
    const result = await createForecastExecutor({ ...f,client,budget: { turns: 3,tokens: 1,ms: 1000 },now: () => 0 }).run(f);
    assert.equal(result.failure,null); assert.equal(calls,2); assert.equal(result.prediction?.normalized,'approve');
    assert.equal(result.spend.tokens,0); assert.equal(result.budgetSpent.tokens,0);
  });
});
