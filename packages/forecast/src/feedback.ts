/** Question-local feedback uses the existing agent loop and synchronous guarded editor. */
import { createAgent } from '@tangleai/agents';
import { createStructuredOutput, unfence } from '@tangleai/models/structured';
import { equalsJson } from '@jarenjs/core/object';
import { createEditorToolbox, FORECAST_EDITOR_TOOL_NAMES, type EditorToolbox } from './editor-toolbox.ts';
import { createHarnessRefiner, checkedHarnessLimits, type HarnessLimits, type SealedHarnessPlan } from './refiner.ts';
import { volatileFactGate, forecastSemanticStage, type createVolatileFactClassifier } from './gate.ts';
import { createForecastMeter, combineForecastSpend, checkedForecastBudget, type ForecastChatClient, type ForecastBudget } from './meter.ts';
import { forecastGet, type ForecastStore } from './store.ts';
import { forecastMust, ForecastRefusal, issue, reject } from './errors.ts';
import { sealForecastRecord, validateForecastRecord } from './identity.ts';
import { checkShape, checkTime } from './schema.ts';
import { FEEDBACK_PROMPT, FEEDBACK_SCHEMA, forecastPromptRevisions } from './prompts.ts';
import type { ForecastQuestion, ForecastCheckpoint, Feedback, HarnessRevision, ForecastHarnessVersion, ForecastIssue, DeferredGuidance, ForecastStageReceipt } from './contracts.gen.ts';

export interface InternalFeedbackOptions {
  client: ForecastChatClient; store: ForecastStore; toolbox?: EditorToolbox;
  gate?: typeof volatileFactGate; classifier?: ReturnType<typeof createVolatileFactClassifier>;
  limits?: Partial<HarnessLimits>; now: () => string; clock: () => number;
}
export interface ForecastFeedbackResult { revision: HarnessRevision; candidate: ForecastHarnessVersion | null; status: 'staged' | 'deferred' | 'refused'; }
export function createInternalFeedbackEditor(options: InternalFeedbackOptions) {
  const limits = checkedHarnessLimits(options.limits), screen: typeof volatileFactGate = (text,context) => (options.gate ?? volatileFactGate)(text,context,limits.shingle);
  let used = false;
  return Object.freeze({ async run(input: { question: ForecastQuestion; checkpoint: ForecastCheckpoint }, inputBudget: ForecastBudget, signal?: AbortSignal): Promise<ForecastFeedbackResult> {
    if (used) reject('TFCT1004','An internal feedback editor runs once.'); used = true;
    const question = await validateForecastRecord('questions',input.question), checkpoint = await validateForecastRecord('checkpoints',input.checkpoint);
    if (question.id !== checkpoint.questionId) reject('TFCT1003','Feedback cannot cross question ownership.');
    const retainedQuestion = forecastMust(await forecastGet(options.store,'questions',question.id)), retainedCheckpoint = forecastMust(await forecastGet(options.store,'checkpoints',checkpoint.id));
    if (checkpoint.ordinal < 2 || question.status !== 'open' || retainedQuestion?.status !== 'open') reject('TFCT1004','Feedback requires checkpoint two or later of an unresolved question.');
    if (!equalsJson(retainedQuestion,question) || !equalsJson(retainedCheckpoint,checkpoint)) reject('TFCT1002','Feedback inputs differ from retained records.');
    if (checkpoint.status !== 'running' || !checkpoint.noteId || !checkpoint.progress?.note || checkpoint.progress.revision) reject('TFCT1004','Feedback requires a running checkpoint with its retained note and no revision receipt.');
    const budget = checkedForecastBudget(inputBudget);
    if (!equalsJson(budget.spent,checkpoint.progress.note.budgetSpent)) reject('TFCT1002','The editor must continue the retained checkpoint budget.');
    const at = checkTime(options.now());
    if (at < checkpoint.startedAt!) reject('TFCT1004','Feedback cannot predate its checkpoint.');
    const toolbox = options.toolbox ?? await createEditorToolbox({ store: options.store,question,checkpoint,limits });
    if (toolbox.questionId !== question.id || toolbox.checkpointId !== checkpoint.id) reject('TFCT1003','The editor toolbox belongs to another checkpoint.');
    if (!equalsJson(toolbox.names,FORECAST_EDITOR_TOOL_NAMES) || !equalsJson(toolbox.list().map(t => t.name).sort(),[...FORECAST_EDITOR_TOOL_NAMES])) reject('TFCT1003','The editor toolbox must contain exactly its four read tools.');
    const meter = createForecastMeter(options.client,budget,options.clock), prompts = await forecastPromptRevisions();
    const deferred: DeferredGuidance[] = [], kinds: string[] = [], refused = new Set<string>();
    let feedback: Feedback = { provisionalDiagnoses: [],committedGuidance: [],deferredFeedback: [] }, plan: SealedHarnessPlan | null = null;
    let issues: ForecastIssue[] = [], semantic = await forecastSemanticStage({ result: 'not-run' });
    let classifierReceipt: ForecastStageReceipt | null = null, editorReceipt: ForecastStageReceipt | null = null;
    const remember = (item: Feedback['committedGuidance'][number], reasons: string[]) => {
      const key = JSON.stringify(item);
      if (refused.has(key)) return; refused.add(key); kinds.push(...new Set(reasons));
      deferred.push({ ...item,reason: 'TFCT1008:' + [...new Set(reasons)].join(',') });
    };
    let refiner = await createHarnessRefiner({ parent: toolbox.harness,context: toolbox.context(),sources: toolbox.sourceIds,limits,now: () => at,gate: screen,semantic });
    let sourceIssues: ForecastIssue[] = [];
    const validate = (value: Feedback) => {
      if (sourceIssues.length) return { valid: false,errors: sourceIssues.map(e => ({ ...e,docPath: e.path,message: e.detail })) };
      for (const [key,items] of Object.entries(value) as [string,Feedback['provisionalDiagnoses']][]) {
        if (items.length > limits.maxItems || items.some(item => new TextEncoder().encode(item.text).length > limits.maxItemBytes)) return { valid: false,errors: [{ code: 'TFCT1007',docPath: '/' + key,message: 'Feedback exceeds its item or UTF-8 byte bound.' }] };
      }
      for (const item of value.committedGuidance) { const outcome = screen(item.text,toolbox.context()); if (!outcome.ok) remember(item,outcome.findings.map(f => f.kind)); }
      return refiner.dryRunGuidance(value.committedGuidance);
    };
    try {
      const client = { endpoint: meter.client.endpoint,async complete(request: any) {
        // Structured decoding owns bounded repair; the suite's agent owns tools.
        // All purchases still pass through the single checkpoint meter.
        const spent = meter.budgetSpent();
        const agentClient = { ...meter.client,complete: (next: any) => meter.client.complete({ ...next,...(request.responseFormat ? { responseFormat: request.responseFormat } : {}) }) };
        const agent = createAgent({ client: agentClient,toolbox,maxToolRounds: 25,maxToolResultChars: 8000,budget: { turns: budget.turns,ms: budget.ms,spent: { turns: spent.turns,ms: spent.ms } },now: options.clock });
        const answer = await agent.send(request.messages,{ signal });
        if (answer.stopReason !== 'stop' || meter.calls().at(-1)?.finishReason !== 'stop' || answer.message.toolCalls?.length) reject('TFCT1001','The feedback provider did not finish a structured answer.');
        sourceIssues = [];
        let shaped: Feedback | null = null;
        try { shaped = checkShape('feedback',JSON.parse(unfence(answer.message.content))); } catch { /* The structured driver repairs shape failures. */ }
        if (shaped) {
          const result = await toolbox.validateSources((Object.values(shaped) as Feedback['provisionalDiagnoses'][]).flatMap(items => items.flatMap(item => item.sources)));
          if (!result.ok) sourceIssues = result.issues;
        }
        refiner = await createHarnessRefiner({ parent: toolbox.harness,context: toolbox.context(),sources: toolbox.sourceIds,limits,now: () => at,gate: screen,semantic });
        return { message: answer.message,finishReason: 'stop' };
      } };
      const data = { question: { id: question.id,prompt: question.prompt,adapter: question.adapter },checkpoint: { id: checkpoint.id,ordinal: checkpoint.ordinal },harness: toolbox.harness,notes: toolbox.notes,revisions: toolbox.revisions };
      const generated = await createStructuredOutput({ client,schema: FEEDBACK_SCHEMA,name: 'internal_feedback',maxRepairs: 1,gate: validate }).generate([{ role: 'system',content: FEEDBACK_PROMPT },{ role: 'user',content: JSON.stringify(data) }],{ signal });
      if (generated.errors) {
        const code = sourceIssues[0]?.code ?? (refused.size ? 'TFCT1008' : 'TFCT1001');
        throw new ForecastRefusal(sourceIssues.length ? sourceIssues : [issue(code,'Feedback did not pass bounded structured and guarded repair.')]);
      }
      feedback = checkShape('feedback',generated.value);
      const preliminary = await refiner.prepareGuidance(feedback.committedGuidance);
      if (!preliminary.valid) reject('TFCT1007','The feedback differs from its guarded generation.');
      feedback = { ...feedback,committedGuidance: preliminary.plan.acceptedGuidance,deferredFeedback: [...feedback.deferredFeedback,...preliminary.plan.deferredGuidance] };
      editorReceipt = checkShape('forecastStageReceipt',{ spend: meter.spend(),budgetSpent: meter.budgetSpent(),calls: meter.calls() });
      if (options.classifier) {
        const classified = await options.classifier.classify(feedback.committedGuidance,toolbox.context(),{ ...budget,spent: meter.budgetSpent() },signal);
        semantic = classified.semantic; classifierReceipt = checkShape('forecastStageReceipt',{ spend: classified.spend,budgetSpent: classified.budgetSpent,calls: classified.calls });
        if (classified.failure) reject('TFCT1008','The semantic classifier failed to produce a complete verdict.');
        const result = checkShape<{ verdicts: { index: number;verdict: string }[] }>('volatileFactVerdict',semantic.result);
        for (const verdict of result.verdicts) if (verdict.verdict === 'question-specific') remember(feedback.committedGuidance[verdict.index],['semantic']);
      }
      // Classification is a completed, recorded stage; the validator only reads it.
      const finalRefiner = await createHarnessRefiner({ parent: toolbox.harness,context: toolbox.context(),sources: toolbox.sourceIds,limits,now: () => at,gate: screen,semantic });
      const prepared = await finalRefiner.prepareGuidance(feedback.committedGuidance);
      if (!prepared.valid) throw new ForecastRefusal(prepared.errors.map((e: any) => issue(e.code ?? 'TFCT1007',e.detail ?? e.message ?? 'Guarded feedback refused.',e.path ?? e.docPath ?? '')));
      plan = prepared.plan;
    } catch (error) {
      issues = error instanceof ForecastRefusal ? error.issues : [issue('TFCT1012','The injected feedback operation failed before publication.')];
      for (const item of feedback.committedGuidance) if (!deferred.some(d => equalsJson(d.sources,item.sources) && d.text === item.text && d.component === item.component)) deferred.push({ ...item,reason: issues[0].code + ':revision-refused' });
    } finally { toolbox.close(); }
    editorReceipt ??= checkShape('forecastStageReceipt',{ spend: meter.spend(),budgetSpent: meter.budgetSpent(),calls: meter.calls() });
    const receipt = checkShape<ForecastStageReceipt>('forecastStageReceipt',{ spend: combineForecastSpend(editorReceipt!.spend,...(classifierReceipt ? [classifierReceipt.spend] : [])),budgetSpent: classifierReceipt?.budgetSpent ?? editorReceipt!.budgetSpent,calls: [...editorReceipt!.calls.map(call => ({ ...call as object,stage: 'feedback' })),...(classifierReceipt?.calls ?? []).map(call => ({ ...call as object,stage: 'revision.gate' }))] });
    const audit = toolbox.audit();
    let revision = await sealForecastRecord('revisions',{ questionId: question.id,checkpointId: checkpoint.id,comparedNoteIds: toolbox.notes.map(n => n.id),provisionalDiagnoses: feedback.provisionalDiagnoses,committedGuidance: plan?.acceptedGuidance ?? [],deferredFeedback: [...feedback.deferredFeedback,...deferred,...(plan?.deferredGuidance ?? [])],patch: plan?.patch ?? [],candidateVersionId: null,gate: { volatileFact: { refused: refused.size,items: kinds },semantic },validation: { ok: issues.length === 0,issues },traceReads: audit.traceReads,editorRefusals: { traceBudget: audit.traceBudget,foreignReads: audit.foreignReads },configuration: checkpoint.configuration,promptRevision: prompts.feedback,toolsetRevision: toolbox.revision,noteSchemaRevision: prompts.feedbackSchema,receipt });
    const candidate = plan && !plan.noOp ? await sealForecastRecord('harnesses',{ scopeKey: question.scopeKey,questionId: question.id,parentVersionId: toolbox.harness.id,document: plan.document,digest: plan.digest,status: 'staged',checkedVersionId: null,provenance: { seed: false,revisionId: revision.id,retrospectiveId: null },recordedAt: at }) : null;
    if (candidate) revision = await sealForecastRecord('revisions',{ ...revision,candidateVersionId: candidate.id });
    return { revision,candidate,status: issues.length ? 'refused' : candidate ? 'staged' : 'deferred' };
  } });
}
