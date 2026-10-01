/** Revision-pinned content owners share the native attempt, client, tools and budget. */
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { createSharedBudgetClient, MasBudgetStop } from './budget.ts';
import { masIssue } from './errors.ts';
import { classifyToolSteps } from './tools.ts';
import type { RunAgentOptions, AgentRunOutcome } from './agent-executor.ts';

export interface MasAgentComponentInput extends Omit<RunAgentOptions, 'callCounter'> {
  runId: string;
  path: string;
  idempotencyKey: string;
}
export interface MasAgentComponent {
  id: string;
  version: string;
  /** Return ported JSON. The native lifecycle validates and commits it. */
  execute(input: MasAgentComponentInput): Promise<Record<string, unknown>>;
}

export async function runAgentComponent(component: MasAgentComponent, options: RunAgentOptions,
  meta: { runId: string; path: string; idempotencyKey: string }, clock: () => number): Promise<AgentRunOutcome> {
  const messages: unknown[] = [], steps: Array<{ name: string; arguments: string; result: unknown }> = [];
  const account = createBudgetAccount(options.localBudget, clock);
  const bounded = createSharedBudgetClient(options.client, account);
  const { callCounter, ...input } = options;
  const partial = (stopReason: string | null) => {
    const text = JSON.stringify(messages);
    return { transcript: { state: text.length > options.transcriptChars ? 'truncated' as const : 'retained' as const,
      text: text.slice(0, options.transcriptChars), size: text.length, artifact: null },
      toolSteps: classifyToolSteps(steps), contextReads: options.contextReads.map(row => ({ adapter: row.adapter,
        outcome: row.outcome.outcome, units: row.outcome.outcome === 'ok' ? row.outcome.units.length : 0,
        addresses: row.outcome.outcome === 'ok' ? row.outcome.units.map(unit => unit.address) : [],
        chars: row.outcome.outcome === 'ok' ? row.outcome.units.reduce((n, unit) => n + unit.text.length, 0) : 0 })),
      usage: { ...callCounter, toolCalls: steps.length, contextReads: options.contextReads.length }, stopReason };
  };
  try {
    const output = await component.execute({ ...input, ...meta, client: { ...bounded,
      async complete(request) {
        options.signal.throwIfAborted();
        const value = request as { messages?: unknown; signal?: AbortSignal };
        messages.push({ request: value.messages ?? null });
        const completion = await bounded.complete({ ...value,
          signal: value.signal ? AbortSignal.any([options.signal, value.signal]) : options.signal });
        messages.push({ response: completion.message });
        const spent = account.spent();
        if (options.localBudget.tokens !== undefined && spent.tokens > options.localBudget.tokens) throw new MasBudgetStop('budget-tokens');
        if (options.localBudget.ms !== undefined && spent.ms > options.localBudget.ms) throw new MasBudgetStop('budget-ms');
        return completion;
      } }, toolbox: options.toolbox ? { toFunctionTools: options.toolbox.toFunctionTools,
        async execute(name, args) {
          const result = await options.toolbox!.execute(name, args);
          steps.push({ name, arguments: typeof args === 'string' ? args : JSON.stringify(args), result });
          return result;
        } } : null });
    options.signal.throwIfAborted();
    return { ok: true, value: { output, ...partial('completed'), normalizationRaw: null } };
  } catch (cause) {
    const budget = cause instanceof MasBudgetStop;
    return { ok: false, issue: masIssue('TMAS2004', budget ? '/agent/budget' : '/agent/component',
      cause instanceof Error ? cause.message : String(cause)), partial: partial(budget ? cause.reason : 'component-failed') };
  }
}
