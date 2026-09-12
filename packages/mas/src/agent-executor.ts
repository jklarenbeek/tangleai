/**
 * The agent executor — always `createAgent`, never a private loop.
 *
 * An agent node's primary result is the suite's own full transcript,
 * tool steps, final message, stop reason and spend. Its inbound
 * messages render through the node's declared adapter; bounded context
 * units join the system prompt with their addresses; the model client
 * is the ONE shared-budget-wrapped client, so agent turns and — for a
 * `json-schema` output — the ONE explicit, separately counted
 * normalization through `createStructuredOutput` (at most one repair)
 * reserve and settle on the same account. A permanently invalid
 * normalized result fails the node and stays attached to the attempt;
 * nothing here parses or repairs a reply locally.
 */

import { createAgent } from '@tangleai/agents/agent';
import { createStructuredOutput } from '@tangleai/models/structured';

import { masIssue, type MasIssue } from './errors.ts';
import { compileEmbeddedSchema } from './schema.ts';
import { schemaAccepts } from './compatibility.ts';
import { classifyToolSteps } from './tools.ts';
import type { MasChatClient } from './budget.ts';
import type { AgentNode, BoundedView, ContextRead, MasRegistry, ToolStep, UsageCounts } from './contracts.gen.ts';
import type { MasContextOutcome } from './context.ts';
import type { MasMessageAdapter, MasRenderableInput } from './messages.ts';

export interface AgentRunResult {
  output: Record<string, unknown>;
  transcript: BoundedView;
  toolSteps: ToolStep[];
  contextReads: ContextRead[];
  usage: UsageCounts;
  stopReason: string | null;
  normalizationRaw: string | null;
}

export type AgentRunOutcome =
  | { ok: true, value: AgentRunResult }
  | { ok: false, issue: MasIssue, partial: Pick<AgentRunResult, 'transcript' | 'toolSteps' | 'contextReads' | 'usage' | 'stopReason'> };

export interface RunAgentOptions {
  node: AgentNode;
  role: MasRegistry['roles'][number];
  client: MasChatClient;
  toolbox: { toFunctionTools: () => unknown[], execute: (name: string, args: unknown) => unknown } | null;
  adapter: MasMessageAdapter;
  input: MasRenderableInput;
  contextReads: Array<{ adapter: string, outcome: MasContextOutcome }>;
  signal: AbortSignal;
  /** Node-local budget, seeded from the durable attempt on resume. */
  localBudget: { turns?: number, tokens?: number, ms?: number, spent?: { turns: number, tokens: number, ms: number } };
  maxToolRounds: number;
  transcriptChars: number;
  callCounter: { calls: number, promptTokens: number, completionTokens: number };
}

function renderContext(reads: RunAgentOptions['contextReads']): string {
  const sections: string[] = [];
  for (const read of reads) {
    if (read.outcome.outcome !== 'ok') continue;
    for (const unit of read.outcome.units) {
      sections.push(`[${unit.address}]\n${unit.text}`);
    }
  }
  return sections.length === 0 ? '' : `\n\n# Context\n\n${sections.join('\n\n')}`;
}

function contextReadRecords(reads: RunAgentOptions['contextReads']): ContextRead[] {
  return reads.map((read) => read.outcome.outcome === 'ok'
    ? {
      adapter: read.adapter,
      outcome: 'ok' as const,
      units: read.outcome.units.length,
      addresses: read.outcome.units.map((unit) => unit.address),
      chars: read.outcome.units.reduce((sum, unit) => sum + unit.text.length, 0),
    }
    : {
      adapter: read.adapter,
      outcome: read.outcome.outcome,
      units: 0,
      addresses: [],
      chars: 0,
    });
}

function boundedTranscript(messages: unknown[], maxChars: number): BoundedView {
  const text = JSON.stringify(messages);
  return {
    state: text.length > maxChars ? 'truncated' : 'retained',
    text: text.slice(0, maxChars),
    size: text.length,
    artifact: null,
  };
}

export async function runAgentNode(options: RunAgentOptions): Promise<AgentRunOutcome> {
  const ports = Object.keys(options.node.output.ports);
  const port = ports[0];
  const portSchema = options.node.output.ports[port].schema;

  const system = `${options.role.instructions}${renderContext(options.contextReads)}`;
  const user = options.adapter.render(options.input);
  const agent = createAgent({
    client: options.client as { complete: (request: unknown) => Promise<unknown> },
    toolbox: options.toolbox,
    system,
    maxToolRounds: options.maxToolRounds,
    budget: options.localBudget,
  });

  const partialOf = (messages: unknown[], steps: Array<{ name: string, arguments: string, result: unknown }>, stopReason: string | null) => ({
    transcript: boundedTranscript(messages, options.transcriptChars),
    toolSteps: classifyToolSteps(steps),
    contextReads: contextReadRecords(options.contextReads),
    usage: {
      calls: options.callCounter.calls,
      toolCalls: steps.length,
      contextReads: options.contextReads.length,
      promptTokens: options.callCounter.promptTokens,
      completionTokens: options.callCounter.completionTokens,
    },
    stopReason,
  });

  let result: { message: { content: string }, messages: unknown[], steps: Array<{ name: string, arguments: string, result: unknown }>, stopReason: string };
  try {
    result = await agent.send([{ role: 'user', content: user }], { signal: options.signal }) as typeof result;
  } catch (error) {
    return {
      ok: false,
      issue: masIssue('TMAS2004', '/agent', `the agent loop failed: ${(error as Error).message}`),
      partial: partialOf([], [], null),
    };
  }

  if (result.stopReason.startsWith('budget-')) {
    return {
      ok: false,
      issue: masIssue('TMAS2004', '/agent/budget', `the node budget stopped the agent (${result.stopReason}) before a final answer`),
      partial: partialOf(result.messages, result.steps, result.stopReason),
    };
  }

  const check = compileEmbeddedSchema(portSchema);
  if (check === null) {
    return {
      ok: false,
      issue: masIssue('TMAS2004', '/agent/output', 'the output port schema does not compile'),
      partial: partialOf(result.messages, result.steps, result.stopReason),
    };
  }

  // A plain-text output port takes the final message directly with no extra
  // model call; a structured port normalizes through the suite, separately
  // counted. The decision is the OUTPUT schema's, not the inbound adapter's.
  const plainTextOutput = schemaAccepts({ type: 'string' }, portSchema);
  if (plainTextOutput) {
    const content = result.message.content;
    if (!check(content).valid) {
      return {
        ok: false,
        issue: masIssue('TMAS2004', '/agent/output', `the final message does not validate against the '${port}' port schema`),
        partial: partialOf(result.messages, result.steps, result.stopReason),
      };
    }
    return {
      ok: true,
      value: {
        output: { [port]: content },
        ...partialOf(result.messages, result.steps, result.stopReason),
        normalizationRaw: null,
      },
    };
  }

  // json-schema output: ONE explicit, separately counted normalization over
  // the final transcript, at most one repair, on the same shared account.
  const structured = createStructuredOutput({
    client: options.client as { endpoint: { provider: string }, complete: (request: unknown) => Promise<unknown> },
    schema: portSchema as Record<string, unknown>,
    name: port,
    maxRepairs: 1,
  });
  const normalized = await structured.generate(result.messages as never, { signal: options.signal });
  if (!('value' in normalized)) {
    return {
      ok: false,
      issue: masIssue('TMAS2004', '/agent/normalization', `the normalized output is permanently invalid after one repair: ${JSON.stringify(normalized.errors.slice(0, 2))}`),
      partial: partialOf(result.messages, result.steps, result.stopReason),
    };
  }
  return {
    ok: true,
    value: {
      output: { [port]: normalized.value },
      ...partialOf(result.messages, result.steps, result.stopReason),
      normalizationRaw: normalized.raw,
    },
  };
}
