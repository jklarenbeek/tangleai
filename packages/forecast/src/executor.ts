/** A single-use bounded createAgent primitive; hosts own scheduling and publication. */
import { createAgent } from '@tangleai/agents';
import { equalsJson } from '@jarenjs/core/object';
import { createForecastMeter, checkedForecastBudget, type ForecastBudget, type ForecastChatClient } from './meter.ts';
import { forecastExecutorPrompt, forecastPromptRevisions } from './prompts.ts';
import { forecastTrace } from './trace.ts';
import { validateForecastRecord, sealForecastRecord } from './identity.ts';
import { forecastMust, ForecastRefusal, reject } from './errors.ts';
import { parseForecastAnswer } from './adapters/index.ts';
import type { ForecastToolbox } from './toolbox.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastHarnessVersion, ForecastPrediction, CheckpointFailure } from './contracts.gen.ts';

export interface ForecastExecutorOptions {
  client: ForecastChatClient; toolbox: ForecastToolbox; harness: ForecastHarnessVersion | null;
  budget: ForecastBudget; now: () => number;
  limits?: { maxToolRounds?: number; maxToolResultChars?: number; maxTraceBytes?: number };
}
export function createForecastExecutor(options: ForecastExecutorOptions) {
  const budget = checkedForecastBudget(options.budget), limits = { maxToolRounds: 25,maxToolResultChars: 8000,maxTraceBytes: 262144,...options.limits };
  if (!Number.isSafeInteger(limits.maxToolRounds) || limits.maxToolRounds < 0 || limits.maxToolRounds > 25 || !Number.isSafeInteger(limits.maxToolResultChars) || limits.maxToolResultChars < 1 || !Number.isSafeInteger(limits.maxTraceBytes) || limits.maxTraceBytes < 64 || limits.maxTraceBytes > 262144) reject('TFCT1001', 'Invalid forecast executor limits.');
  let used = false;
  return Object.freeze({ async run(input: { question: ForecastQuestion; checkpoint: ForecastCheckpoint; signal?: AbortSignal }) {
    if (used) reject('TFCT1004', 'A forecast executor runs one checkpoint once.');
    used = true;
    const question = await validateForecastRecord('questions',input.question), checkpoint = await validateForecastRecord('checkpoints',input.checkpoint);
    const harness = options.harness ? await validateForecastRecord('harnesses',options.harness) : null, revisions = await forecastPromptRevisions(checkpoint.treatment);
    if (checkpoint.questionId !== question.id || options.toolbox.checkpointId !== checkpoint.id) reject('TFCT1003', 'The executor question, checkpoint and toolbox differ.');
    if (checkpoint.status !== 'running') reject('TFCT1004', 'Start the checkpoint before executing it.');
    if (checkpoint.promptRevision !== revisions.executor || checkpoint.noteSchemaRevision !== revisions.noteSchema || checkpoint.toolsetRevision !== options.toolbox.revision || checkpoint.inputHarnessVersionId !== (harness?.id ?? null) || checkpoint.inputHarnessDigest !== (harness?.digest ?? null)) reject('TFCT1002', 'The executor differs from its pinned producer or harness identity.');
    const expectedNames = ['web_search','web_read',...(harness ? ['harness_read'] : []),'evidence_read'];
    if (!equalsJson(options.toolbox.names,expectedNames)) reject('TFCT1002', 'The executor tools differ from its treatment.');
    const meter = createForecastMeter(options.client,budget,options.now), capturedSteps: any[] = [];
    let toolArguments = '';
    const user = { role: 'user',content: JSON.stringify({ questionId: question.id,checkpointId: checkpoint.id,prompt: question.prompt,adapter: question.adapter,cutoffAt: checkpoint.cutoffAt }) };
    let messages: any[] = [user], steps: any[] = [], stopReason = 'host-failure', finalMessage = { role: 'assistant',content: '' }, prediction: ForecastPrediction | null = null, failure: CheckpointFailure | null = null;
    try {
      // The generic loop estimates zero usage when given a token ceiling.
      // This account alone owns token admission, including known zero usage;
      // the loop still enforces turn/time and tool-round limits itself.
      const agentBudget = { turns: budget.turns,ms: budget.ms,spent: { turns: budget.spent?.turns ?? 0,ms: budget.spent?.ms ?? 0 } };
      const agent = createAgent({ client: meter.client,toolbox: options.toolbox,system: forecastExecutorPrompt(harness,checkpoint.treatment),...limits,budget: agentBudget,now: options.now });
      const result = await agent.send([user],{ signal: input.signal,onToolCall: call => { toolArguments = call.arguments; },onToolResult: ({ name,result }) => { capturedSteps.push({ name,arguments: toolArguments,result }); } });
      ({ messages,steps,stopReason } = result); finalMessage = result.message;
      if (stopReason !== 'stop') reject('TFCT1005', 'The executor stopped with ' + stopReason + '.');
      // The agent treats an absent provider finish reason as stop. Require the
      // actual provider marker before declaring a completed prediction.
      if (meter.calls().at(-1)?.finishReason !== 'stop') { stopReason = 'unknown'; reject('TFCT1005', 'The provider did not confirm completion.'); }
      const normalized = forecastMust(parseForecastAnswer(question.adapter,finalMessage.content));
      prediction = await sealForecastRecord('predictions',{ checkpointId: checkpoint.id,raw: finalMessage.content,normalized,adapterId: question.adapter.id,adapterVersion: question.adapter.version,uncertainty: null });
    } catch (error) {
      if (steps.length === 0 && capturedSteps.length) steps = capturedSteps;
      if (stopReason === 'host-failure') {
        messages = meter.partial().messages.length ? meter.partial().messages : messages;
        if (error instanceof ForecastRefusal && error.code === 'TFCT1005' && error.message.startsWith('budget-')) stopReason = error.message;
      }
      failure = { code: error instanceof ForecastRefusal ? error.code : 'TFCT1012',detail: error instanceof Error ? error.message : 'The injected executor failed.' };
    } finally { options.toolbox.close(); }
    const trace = await forecastTrace(checkpoint.id,{ messages,steps: [...steps,...meter.calls()] },limits);
    return { checkpointId: checkpoint.id,trace,messages: trace.messages,steps: trace.steps,stopReason,finalMessage,prediction,failure,evidence: options.toolbox.evidence(),audit: options.toolbox.audit(),spend: meter.spend(),budgetSpent: meter.budgetSpent(),calls: meter.calls() };
  } });
}
export type ForecastExecution = Awaited<ReturnType<ReturnType<typeof createForecastExecutor>['run']>>;
