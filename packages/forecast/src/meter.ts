/** One checkpoint account, shared by execution and bounded note repair. */
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { cloneJson } from '@jarenjs/core/object';
import type { ChatRequest } from '@tangleai/models/client';
import { forecastRevision } from './identity.ts';
import { ForecastRefusal, reject } from './errors.ts';
import type { Spend } from './contracts.gen.ts';

export interface ForecastChatClient {
  endpoint: { provider: string };
  requestKey: (request: ChatRequest) => string;
  complete: (request: ChatRequest) => Promise<any>;
}
export interface ForecastBudget {
  turns: number; tokens?: number; ms: number;
  spent?: { turns?: number; tokens?: number; ms?: number };
}
export interface ForecastCall {
  kind: 'model-call'; ordinal: number; requestDigest: string; usage: Record<string, unknown> | null;
  tokens: number | null; replayed: boolean; finishReason: string | null; failure: string | null;
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function tokensOf(usage: any): number | null {
  if (nonnegative(usage?.total_tokens)) return usage.total_tokens;
  return nonnegative(usage?.prompt_tokens) && nonnegative(usage?.completion_tokens) ? usage.prompt_tokens + usage.completion_tokens : null;
}
export function checkedForecastBudget(input: ForecastBudget): ForecastBudget {
  if (!input || Object.keys(input).some(k => !['turns','tokens','ms','spent'].includes(k)) || !nonnegative(input.turns) || !nonnegative(input.ms) || input.tokens !== undefined && !nonnegative(input.tokens) || input.spent && (Object.keys(input.spent).some(k => !['turns','tokens','ms'].includes(k)) || Object.values(input.spent).some(v => !nonnegative(v)))) reject('TFCT1001', 'Forecast budgets require finite nonnegative integer limits and spent counters.');
  return cloneJson(input);
}
export function createForecastMeter(client: ForecastChatClient, input: ForecastBudget, now: () => number) {
  if (typeof client?.complete !== 'function' || typeof client.requestKey !== 'function' || typeof now !== 'function') throw new TypeError('Inject a client with its effective request key and a clock.');
  const budget = checkedForecastBudget(input), account = createBudgetAccount(budget,now), calls: ForecastCall[] = [];
  const started = now();
  let lastMessages: any[] = [], lastReply: any = null;
  const wrapped = { endpoint: client.endpoint, requestKey: client.requestKey, async complete(request: ChatRequest) {
    lastMessages = cloneJson(request.messages); lastReply = null;
    let stop = account.stop(); if (stop) reject('TFCT1005', stop);
    const requestDigest = await forecastRevision(client.requestKey(request));
    stop = account.stop(); if (stop) reject('TFCT1005', stop);
    account.reserve();
    const call: ForecastCall = { kind: 'model-call',ordinal: calls.length + 1,requestDigest,usage: null,tokens: null,replayed: false,finishReason: null,failure: null };
    calls.push(call);
    try {
      const result = await client.complete(request);
      call.tokens = tokensOf(result?.usage);
      call.usage = call.tokens === null ? null : cloneJson(result.usage);
      call.replayed = result?.replayed !== undefined;
      call.finishReason = typeof result?.finishReason === 'string' ? result.finishReason : null;
      lastReply = result?.message ?? null;
      account.settle(call.tokens === null ? null : { total_tokens: call.tokens }, call.tokens === null ? JSON.stringify(request.messages) + JSON.stringify(lastReply) : undefined);
      if (!lastReply || typeof lastReply.content !== 'string') reject('TFCT1001', 'The forecast client returned no text message.');
      return result;
    } catch (error) {
      call.failure = error instanceof ForecastRefusal ? error.code : 'TFCT1012';
      throw error;
    }
  } };
  return { client: wrapped, calls: () => cloneJson(calls), budgetSpent: () => account.spent(),
    partial: () => ({ messages: cloneJson([...lastMessages,...(lastReply ? [lastReply] : [])]) }),
    spend: (): Spend => ({ calls: calls.length, tokens: calls.every(c => c.tokens !== null) ? calls.reduce((n,c) => n + c.tokens!,0) : null, usageKnown: calls.every(c => c.tokens !== null), ms: Math.max(0,now() - started) }),
  };
}
export function combineForecastSpend(...spend: Spend[]): Spend {
  const usageKnown = spend.every(s => s.usageKnown);
  return { calls: spend.reduce((n,s) => n + s.calls,0), tokens: usageKnown ? spend.reduce((n,s) => n + s.tokens!,0) : null, ms: spend.reduce((n,s) => n + s.ms,0), usageKnown };
}
