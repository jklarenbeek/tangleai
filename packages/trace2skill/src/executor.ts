/**
 * One task, one bounded agent, one directory used directly.
 *
 * The active `SKILL.md` is composed into the system text as data and the rest
 * of the directory is reachable through one read-only tool. Nothing is
 * retrieved — no ledger, no recalled skill bank, no similarity index between
 * the directory and the task — because the whole point of the method is that
 * the directory is small enough to be read. The `no-skill` condition is the same
 * executor with the directory and its tool removed, so the two rows differ in
 * one thing only.
 *
 * What comes back is a complete envelope over the agent's own result: the
 * transcript as returned, the tool steps with the turn that made them, the
 * per-turn reasoning the transcript drops, the stop reason and the spend. A
 * budget stop is a value here, not an exception, and it carries no answer:
 * text a stopped loop emits explains the stop, it does not answer the task.
 */
import { createAgent, createToolbox } from '@tangleai/agents';
import { trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { trace2SkillPrompt } from './artifacts.ts';
import { renderTrace2SkillPrompt } from './prompts.ts';
import { composeSkillSystem, skillReadTool } from './consume.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { PreparedSkillTask, Trace2SkillTaskAdapter } from './adapter.ts';
import type { RolloutMessage, RolloutReasoning, RolloutStep, Spend, Trace2SkillPromptArtifact } from './contracts.gen.ts';

/** The compiled executor pack's revision, which is the prompt version a rollout key names. */
export const EXECUTOR_PROMPT_VERSION = trace2SkillPrompt('executor').revision;

const READ_FILE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['path'],
  additionalProperties: false,
  properties: { path: { type: 'string', minLength: 1, maxLength: 512 } },
});

export interface SkillChatCompletion {
  message: { role?: string, content: string, toolCalls?: Array<{ id: string, name: string, arguments: string }>, reasoning?: string };
  finishReason?: string;
  usage?: unknown;
}

export interface SkillChatClient {
  endpoint?: { provider: string };
  complete(request: unknown): Promise<SkillChatCompletion>;
}

/** A client wrapped in its own counters: calls made and usage the wire reported. */
export interface MeteredSkillClient { client: SkillChatClient & { endpoint: { provider: string } }, spend: () => Spend }

/**
 * Calls and reported usage, counted where the run charges them. One wrapper,
 * because two roles counting spend two ways is two answers to what a unit cost.
 */
export function meterClient(client: SkillChatClient): MeteredSkillClient {
  let calls = 0;
  let tokens = 0;
  return {
    client: {
      endpoint: client.endpoint ?? { provider: 'unknown' },
      async complete(request: unknown): Promise<SkillChatCompletion> {
        calls++;
        const completion = await client.complete(request);
        const usage = completion.usage as { total_tokens?: unknown } | undefined;
        if (typeof usage?.total_tokens === 'number') tokens += usage.total_tokens;
        return completion;
      },
    },
    spend: () => ({ calls, tokens, cost: null }),
  };
}

/** A stop the agent reported rather than an answer it produced. */
export const UNANSWERED_STOPS = Object.freeze(['tool-limit', 'script-missing']) as readonly string[];

export function isUnansweredStop(stopReason: string): boolean {
  return stopReason.startsWith('budget-') || UNANSWERED_STOPS.includes(stopReason);
}

export interface SkillExecutionResult {
  finalAnswer: string;
  stopReason: string;
  messages: RolloutMessage[];
  reasoning: RolloutReasoning[];
  steps: RolloutStep[];
  spend: Spend;
  /** The system text the request actually carried, so a row can prove what the model saw. */
  system: string;
}

export interface SkillExecutorOptions {
  client: SkillChatClient;
  adapter: Trace2SkillTaskAdapter;
  task: PreparedSkillTask;
  /** The frozen directory, or null for the no-skill condition. */
  snapshot?: SkillSnapshot | null;
  budget: { turns: number, tokens: number, ms: number };
  maxToolRounds?: number;
  /** The compiled pack this request renders through; the default is the published one. */
  prompt?: Trace2SkillPromptArtifact;
  promptVersion?: string;
  now?: () => number;
  /** The tool registry, injected so a host can widen the executor's surface. */
  toolbox?: ReturnType<typeof createToolbox>;
}

export interface SkillExecutor {
  /** Exactly what the request's system slot carries. */
  system: string;
  tools: string[];
  promptVersion: string;
  run(): Promise<Trace2SkillOutcome<SkillExecutionResult>>;
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : content === null || content === undefined ? '' : JSON.stringify(content);

/** The one executor factory: the same loop under every skill condition. */
export function createSkillExecutor(options: SkillExecutorOptions): Trace2SkillOutcome<SkillExecutor> {
  const snapshot = options.snapshot ?? null;
  const artifact = options.prompt ?? trace2SkillPrompt('executor');
  const rendered = renderTrace2SkillPrompt(artifact, {
    task: options.task.prompt,
    inputs: options.task.inputs.map(input => `- ${input.path}`).join('\n'),
  });
  if (!rendered.valid) return trace2SkillRefusal<SkillExecutor>(rendered.issues);
  const composed = composeSkillSystem(rendered.value.system, snapshot);
  if (!composed.valid) return trace2SkillRefusal<SkillExecutor>(composed.issues);
  const system = composed.value;
  const question = rendered.value.user;

  const toolbox = options.toolbox ?? createToolbox();
  const tools = options.adapter.executorTools(options.task.taskId);
  toolbox.add({
    name: 'read_file',
    description: 'Read one UTF-8 file listed in this task. A path outside the task inputs is refused.',
    inputSchema: READ_FILE_SCHEMA,
    execute: ({ path }: { path: string }) => {
      const outcome = tools.read_file(path);
      return outcome.valid ? { path, content: outcome.value } : { error: outcome.issues[0].detail, code: outcome.issues[0].code };
    },
  });
  if (snapshot !== null) toolbox.add(skillReadTool(snapshot));

  async function run(): Promise<Trace2SkillOutcome<SkillExecutionResult>> {
    // The turn a hook is reporting from. Committed only after the call
    // returns, so a request refused before dispatch counts no turn.
    let turns = 0;
    let active = 0;
    const counting: SkillChatClient = {
      ...(options.client.endpoint !== undefined ? { endpoint: options.client.endpoint } : {}),
      async complete(request: unknown): Promise<SkillChatCompletion> {
        active = turns + 1;
        const completion = await options.client.complete(request);
        turns = active;
        return completion;
      },
    };

    const thinking = new Map<number, string>();
    const stepTurns: number[] = [];
    const agent = createAgent({
      client: counting,
      toolbox,
      system,
      maxToolRounds: options.maxToolRounds ?? options.budget.turns,
      budget: { turns: options.budget.turns, tokens: options.budget.tokens, ms: options.budget.ms },
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    const result = await agent.send([{ role: 'user', content: question }], {
      onReasoning: (text: string) => { if (text !== '') thinking.set(active, (thinking.get(active) ?? '') + text); },
      onToolCall: () => { stepTurns.push(active); },
    });

    const spent = agent.spend();
    const stopReason = String(result.stopReason);
    return {
      valid: true,
      value: {
        // A loop that stopped produced no answer; its closing text says why it
        // stopped, and reading that as an answer would score the stop.
        finalAnswer: isUnansweredStop(stopReason) ? '' : textOf(result.message?.content).trim(),
        stopReason,
        messages: (result.messages as Array<{ role?: unknown, content?: unknown }>)
          .map(message => ({ role: typeof message.role === 'string' ? message.role : 'assistant', content: textOf(message.content) })),
        reasoning: [...thinking.entries()].sort((a, b) => a[0] - b[0]).map(([turn, text]): RolloutReasoning => ({ turn, text })),
        steps: (result.steps as Array<{ name?: unknown, arguments?: unknown, result?: unknown }>)
          .map((step, index): RolloutStep => ({
            turn: stepTurns[index] ?? 0,
            name: typeof step.name === 'string' ? step.name : 'unknown',
            arguments: textOf(step.arguments),
            result: textOf(step.result),
          })),
        spend: { calls: spent.turns, tokens: spent.tokens, cost: null },
        system,
      },
    };
  }

  return {
    valid: true,
    value: { system, tools: toolbox.list().map((tool: { name: string }) => tool.name), promptVersion: options.promptVersion ?? artifact.revision, run },
  };
}
