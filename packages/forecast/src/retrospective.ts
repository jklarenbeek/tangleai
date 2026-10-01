/** Bounded retrospective proposals retain their purchase before outcome evaluation. */
import { createAgent } from '@tangleai/agents';
import { createStructuredOutput, unfence } from '@tangleai/models/structured';
import { equalsJson } from '@jarenjs/core/object';
import { createJSONPatch } from '@jarenjs/json/patch';
import { changedLeafPaths, type ArtifactVersion, type Evaluation, type Head, type Json } from '@tangleai/outcomes';
import { createEditorToolbox } from './editor-toolbox.ts';
import { createHarnessRefiner, forecastGuidanceRef, type HarnessLimits } from './refiner.ts';
import { createForecastMeter, type ForecastBudget, type ForecastChatClient } from './meter.ts';
import { forecastGet, forecastQuery, forecastCommandTransaction } from './store.ts';
import { forecastMust, ForecastRefusal, issue, reject, failure, type ForecastCommandResult } from './errors.ts';
import { forecastOutcomeValue, type ForecastOutcomeHost } from './outcome-host.ts';
import { sealForecastRecord, validateForecastRecord } from './identity.ts';
import { forecastPromptRevisions, RETROSPECTIVE_PROMPT, RETROSPECTIVE_SCHEMA } from './prompts.ts';
import { checkShape, checkTime, forecastBytes } from './schema.ts';
import type { CommittedGuidance, ForecastHarnessVersion, ForecastIssue, HarnessDocument, RetrospectiveCheck, RetrospectiveProposal } from './contracts.gen.ts';

export async function captureForecastRetrospective(host: ForecastOutcomeHost,resolutionId: string,limits?: Partial<HarnessLimits>) {
  const resolution = forecastMust(await forecastGet(host.store,'resolutions',resolutionId));
  if (!resolution || resolution.correctionOf || resolution.scoringStatus !== 'complete') reject('TFCT1004','Retrospective editing requires a completely scored original resolution.');
  const question = await host.question(resolution.questionId);
  if (question.status !== 'resolved') reject('TFCT1004','A retrospective requires a resolved, undisputed question.');
  const checkpoints = forecastMust(await forecastQuery(host.store,'checkpoints',{ questionId: question.id })).filter(c => c.status === 'finalized').sort((a,b) => a.ordinal - b.ordinal), checkpoint = checkpoints.at(-1);
  if (!checkpoint) reject('TFCT1004','A retrospective requires a finalized checkpoint.');
  const versions = forecastMust(await forecastQuery(host.store,'harnesses',{ scopeKey: question.scopeKey,limit: 10000 })), active = await host.checked();
  const parent = active ? versions.find(v => v.status === 'checked-ref' && v.checkedVersionId === active.versionId) : versions.filter(v => v.provenance.seed && v.recordedAt <= question.issuedAt).sort((a,b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))[0];
  if (!parent || active && !equalsJson(parent.document,active.payload)) reject('TFCT1002','The outcome parent has no matching retained forecast harness.');
  const latest = versions.filter(v => v.questionId === question.id && v.status === 'archived').sort((a,b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)).at(-1) ?? parent;
  const toolbox = await createEditorToolbox({ store: host.store,question,checkpoint,limits,retrospective: { resolutionId,harnessId: latest.id } });
  const guidance = await Promise.all(toolbox.revisions.flatMap(revision => revision.committedGuidance.map(async item => ({ ...item,guidanceRef: await forecastGuidanceRef(revision.id,item) }))));
  const context = () => ({ ...toolbox.context(),adapterOptions: [...toolbox.context().adapterOptions,String(resolution.outcome)],evidenceExcerpts: [...toolbox.context().evidenceExcerpts,...resolution.evidence.map(e => e.excerpt)] });
  return { resolution,question,checkpoint,parent,latest,head: active?.head ?? { versionId: null,revision: 0 },toolbox,guidance,context };
}
export async function prepareRetrospectiveProposal(captured: Awaited<ReturnType<typeof captureForecastRetrospective>>,raw: unknown,at: string,limits?: Partial<HarnessLimits>) {
  const proposal = checkShape<RetrospectiveProposal>('retrospectiveProposal',raw), { guidance,toolbox } = captured;
  if (proposal.verdicts.length !== guidance.length || new Set(proposal.verdicts.map(v => v.guidanceRef)).size !== guidance.length || proposal.verdicts.some(v => !guidance.some(g => g.guidanceRef === v.guidanceRef))) reject('TFCT1007','Retrospective verdicts must cover every committed guidance item exactly once.');
  forecastMust(await toolbox.validateSources(proposal.verdicts.flatMap(v => v.sources)));
  const items: CommittedGuidance[] = [];
  for (const verdict of proposal.verdicts) {
    if ((verdict.verdict === 'refine') !== (verdict.refinedText !== null)) reject('TFCT1007','Only a refine verdict supplies replacement procedural text.');
    if (verdict.verdict !== 'reject') { const old = guidance.find(g => g.guidanceRef === verdict.guidanceRef)!; items.push({ component: old.component,text: verdict.refinedText ?? old.text,sources: verdict.sources }); }
  }
  const refiner = await createHarnessRefiner({ parent: captured.parent,context: captured.context(),sources: toolbox.sourceIds,limits,now: () => at }), prepared = await refiner.prepareGuidance(items);
  if (!prepared.valid) throw new ForecastRefusal(prepared.errors.map((e: any) => issue(e.code ?? 'TFCT1007',e.detail ?? e.message ?? 'Retrospective guidance refused.',e.path ?? e.docPath ?? '')));
  const hasRefine = proposal.verdicts.some(v => v.verdict === 'refine');
  if (!equalsJson(proposal.candidate,hasRefine ? prepared.plan.document : null)) reject('TFCT1007','The retrospective candidate differs from its guarded, cited procedures.');
  return { proposal,plan: prepared.plan };
}
export function createRetrospectiveEditor(options: { host: ForecastOutcomeHost;client: ForecastChatClient;now: () => string;clock: () => number;limits?: Partial<HarnessLimits> }) {
  let used = false;
  return { async run(resolutionId: string,budget: ForecastBudget,signal?: AbortSignal): Promise<RetrospectiveCheck> {
    if (used) reject('TFCT1004','A retrospective editor runs once.'); used = true;
    const captured = await captureForecastRetrospective(options.host,resolutionId,options.limits), at = checkTime(options.now()), { toolbox } = captured;
    if (at < captured.resolution.receivedAt) reject('TFCT1004','Retrospective editing cannot precede the received outcome.');
    const meter = createForecastMeter(options.client,budget,options.clock), prompts = await forecastPromptRevisions();
    let prepared: Awaited<ReturnType<typeof prepareRetrospectiveProposal>> | null = null, problems: ForecastIssue[] = [], candidateProblems: ForecastIssue[] = [];
    try {
      const client = { endpoint: meter.client.endpoint,async complete(request: any) {
        const agentClient = { ...meter.client,complete: (next: any) => meter.client.complete({ ...next,...(request.responseFormat ? { responseFormat: request.responseFormat } : {}) }) };
        const spent = meter.budgetSpent(), agent = createAgent({ client: agentClient,toolbox,maxToolRounds: 25,maxToolResultChars: 8000,budget: { turns: budget.turns,ms: budget.ms,spent: { turns: spent.turns,ms: spent.ms } },now: options.clock });
        const answer = await agent.send(request.messages,{ signal });
        if (answer.stopReason !== 'stop' || meter.calls().at(-1)?.finishReason !== 'stop' || answer.message.toolCalls?.length) reject('TFCT1001','The retrospective provider did not finish a structured answer.');
        prepared = null; candidateProblems = [];
        try { prepared = await prepareRetrospectiveProposal(captured,JSON.parse(unfence(answer.message.content)),at,options.limits); }
        catch (error) { candidateProblems = error instanceof ForecastRefusal ? error.issues : [issue('TFCT1001','Invalid retrospective proposal.')]; }
        return { message: answer.message,finishReason: 'stop' };
      } };
      const generated = await createStructuredOutput({ client,schema: RETROSPECTIVE_SCHEMA,name: 'forecast_retrospective',maxRepairs: 1,gate: () => prepared ? { valid: true } : { valid: false,errors: candidateProblems.map(i => ({ ...i,docPath: i.path,message: i.detail })) } }).generate([{ role: 'system',content: RETROSPECTIVE_PROMPT },{ role: 'user',content: JSON.stringify({ question: captured.question,resolution: captured.resolution,latestHarness: captured.latest,checkedParent: captured.parent,guidance: captured.guidance,notes: toolbox.notes,revisions: toolbox.revisions }) }],{ signal });
      if (generated.errors || !prepared) throw new ForecastRefusal(candidateProblems.length ? candidateProblems : [issue('TFCT1001','Retrospective structured repair failed.')]);
    } catch (error) { problems = error instanceof ForecastRefusal ? error.issues : [issue('TFCT1012','The retrospective provider failed.')]; prepared = null; }
    finally { toolbox.close(); }
    const proposal = (prepared as Awaited<ReturnType<typeof prepareRetrospectiveProposal>> | null)?.proposal;
    return sealForecastRecord('retrospectives',{ questionId: captured.question.id,resolutionId,revisionIds: toolbox.revisions.map(r => r.id),noteIds: toolbox.notes.map(n => n.id),verdicts: proposal?.verdicts ?? [],candidateVersionId: null,candidateDocument: proposal?.candidate ?? null,parentHead: captured.head,parentHarnessId: captured.parent.id,recordedAt: at,receipt: checkShape('forecastStageReceipt',{ spend: meter.spend(),budgetSpent: meter.budgetSpent(),calls: meter.calls() }),traceReads: toolbox.audit().traceReads,reflect: null,evaluation: null,promotion: null,approvalId: null,outcome: problems.length ? 'ineligible' : 'pending',issues: problems,configuration: captured.checkpoint.configuration,promptRevision: prompts.retrospective,toolsetRevision: toolbox.revision,noteSchemaRevision: prompts.retrospectiveSchema });
  } };
}
export async function forecastRetrospectiveRecord(host: ForecastOutcomeHost,input: RetrospectiveCheck) {
  try {
    const record = await validateForecastRecord('retrospectives',input), prompts = await forecastPromptRevisions();
    const previous = forecastMust(await forecastQuery(host.store,'retrospectives',{ questionId: record.questionId }))[0];
    if (previous) {
      if (previous.id !== record.id) reject('TFCT1010','Another retrospective already owns this question.');
      return { ok: true as const,value: previous,writes: 0 };
    }
    const captured = await captureForecastRetrospective(host,record.resolutionId);
    try {
      // A concurrent head move cannot erase an already purchased proposal. Retain
      // its captured, previously checked parent; the outcome CAS judges staleness.
      if (record.parentHarnessId !== captured.parent.id || !equalsJson(record.parentHead,captured.head)) {
        const parent = record.parentHarnessId ? forecastMust(await forecastGet(host.store,'harnesses',record.parentHarnessId)) : null;
        if (!parent || parent.scopeKey !== captured.question.scopeKey || !record.parentHead) reject('TFCT1002','The captured retrospective parent is missing.');
        const historical = parent.provenance.seed ? record.parentHead.versionId === null && record.parentHead.revision === 0 : parent.status === 'checked-ref' && parent.checkedVersionId === record.parentHead.versionId && (await host.history()).some(r => r.kind === 'activationEvent' && equalsJson(r.nextHead,record.parentHead));
        if (!historical) reject('TFCT1002','The captured retrospective parent was never checked.');
        captured.parent = parent; captured.head = record.parentHead;
      }
      if (record.questionId !== captured.question.id || record.promptRevision !== prompts.retrospective || record.noteSchemaRevision !== prompts.retrospectiveSchema || record.toolsetRevision !== captured.toolbox.revision || !equalsJson(record.configuration,captured.checkpoint.configuration) || !equalsJson(record.parentHead,captured.head) || record.parentHarnessId !== captured.parent.id || !equalsJson(record.noteIds,captured.toolbox.notes.map(n => n.id)) || !equalsJson(record.revisionIds,captured.toolbox.revisions.map(r => r.id))) reject('TFCT1002','Retrospective producer or captured inputs differ.');
      if (!record.recordedAt || record.recordedAt < captured.resolution.receivedAt || !record.receipt || record.receipt.calls.length !== record.receipt.spend.calls) reject('TFCT1002','Retrospective purchase receipt is missing or differs.');
      if (record.reflect || record.evaluation || record.promotion || record.approvalId || record.candidateVersionId) reject('TFCT1004','A new retrospective cannot claim outcome lifecycle results.');
      if (!record.issues?.length) await prepareRetrospectiveProposal(captured,{ verdicts: record.verdicts,candidate: record.candidateDocument },record.recordedAt);
      else if (record.outcome !== 'ineligible' || record.candidateDocument !== null || record.verdicts.length) reject('TFCT1007','A refused editor cannot retain an executable candidate.');
      return await forecastCommandTransaction(host.store,async tx => {
        const peers = await tx.query('retrospectives',{ questionId: record.questionId });
        if (peers.length) { if (peers[0].id !== record.id) reject('TFCT1010','Concurrent retrospective publication differs.'); return peers[0]; }
        if ((await tx.get('questions',record.questionId))?.status !== 'resolved') reject('TFCT1004','The question changed before retrospective publication.');
        await tx.put('retrospectives',record); return record;
      });
    } finally { captured.toolbox.close(); }
  } catch (error) { return failure(error); }
}
export async function forecastPromoteOrRetain(host: ForecastOutcomeHost,id: string): Promise<ForecastCommandResult<RetrospectiveCheck>> {
  let writes = 0;
  try {
    let record = forecastMust(await forecastGet(host.store,'retrospectives',id));
    if (!record) reject('TFCT1002','The retained retrospective is missing.');
    if ((await host.question(record.questionId)).status !== 'resolved') reject('TFCT1004','A disputed question cannot promote.');
    if (record.outcome !== 'pending') return { ok: true,value: record,writes: 0 };
    const at = record.recordedAt!, update = async (patch: Partial<RetrospectiveCheck>) => {
      const result = await forecastCommandTransaction(host.store,async tx => {
        const current = await tx.get('retrospectives',id); if (!current || !equalsJson(current,record)) reject('TFCT1010','Retrospective lifecycle changed during publication.');
        const next = { ...current,...patch }; await tx.replace('retrospectives',current,next); return next;
      });
      record = forecastMust(result); if (result.ok) writes += result.writes;
    };
    if (record.verdicts.every(v => v.verdict === 'validate')) await update({ outcome: 'retained' });
    else if (record.verdicts.every(v => v.verdict === 'reject')) await update({ outcome: 'rejected' });
    else if (!record.verdicts.some(v => v.verdict === 'refine')) await update({ outcome: 'retained' });
    else {
      const resolution = forecastMust(await forecastGet(host.store,'resolutions',record.resolutionId))!, parent = forecastMust(await forecastGet(host.store,'harnesses',record.parentHarnessId!));
      if (!parent || !record.candidateDocument) reject('TFCT1002','The retrospective parent or candidate is missing.');
      const patch = createJSONPatch(parent.document,record.candidateDocument), changed = changedLeafPaths(parent.document as unknown as Json,record.candidateDocument as unknown as Json);
      if (equalsJson(parent.document,record.candidateDocument)) { await update({ outcome: 'retained' }); return { ok: true,value: record,writes }; }
      if (patch.length > 32 || changed.length > 32 || forecastBytes(record.candidateDocument) > 32768) reject('TFCT1007','The retrospective patch exceeds outcome policy bounds.');
      const scoreIds = resolution.losses.map(loss => loss.scoreId).sort();
      if (!scoreIds.length) reject('TFCT1011','No independently scored checkpoints can train this candidate.');
      const text = record.verdicts.map(v => v.verdict + ': ' + v.reason).join('\n');
      if (new TextEncoder().encode(text).length > 8192) reject('TFCT1007','Retrospective summary exceeds its outcome bound.');
      const step = async <T>(result: import('@tangleai/outcomes').Result): Promise<T> => { const value = forecastOutcomeValue<T>(result); if (result.ok) writes += result.writes; return value; };
      if (!record.reflect) {
        const reflected = await step<NonNullable<RetrospectiveCheck['reflect']>>(await host.service.reflect(host.command('reflect:' + id,{ mode: record.parentHead!.versionId === null ? 'create' : 'evolve',parentVersionId: record.parentHead!.versionId,scoreIds,citations: scoreIds,text,payload: record.parentHead!.versionId === null ? record.candidateDocument : null,patch: record.parentHead!.versionId === null ? [] : patch,configuration: { kind: 'scripted',revision: record.id } },at)));
        await update({ reflect: { reflectionId: reflected.reflectionId,versionId: reflected.versionId,noOp: reflected.noOp } });
      }
      if (record.reflect!.noOp) await update({ outcome: 'retained' });
      else {
        if (!record.evaluation) {
          // Validate the host registration first so its precise no-case cause survives the outcome boundary.
          await host.host.evaluationSlot!('retro:' + id,record.reflect!.versionId!,host.host.scope);
          const evaluated = await step<{ evaluationId: string;eligible: boolean }>(await host.service.evaluate(host.command('evaluate:' + id,{ versionId: record.reflect!.versionId,slotId: 'retro:' + id },at)));
          const evaluation = await host.inspect<Evaluation>(evaluated.evaluationId);
          await update({ evaluation: { evaluationId: evaluation.id,eligible: evaluation.eligible,issues: evaluation.issues.map(i => ({ ...i })) },...(!evaluation.eligible ? { outcome: 'ineligible',issues: [{ ...issue('TFCT1011','The candidate failed its paired held-out gate.'),cause: evaluation.issues.map(i => ({ ...i })) }] } : {}) });
        }
        if (record.evaluation!.eligible) {
          if (!record.approvalId) {
            const approval = await step<{ approvalId: string }>(await host.service.approve(host.command('approve:' + id,{ action: 'promote',versionId: record.reflect!.versionId,evaluationId: record.evaluation!.evaluationId,expectedHead: record.parentHead,reason: 'Strictly improving, independently scored paired forecast evidence.' },at)));
            await update({ approvalId: approval.approvalId });
          }
          if (!record.promotion) {
            const promotion = await step<{ activationEventId: string;head: Head }>(await host.service.promote(host.command('promote:' + id,{ approvalId: record.approvalId },at)));
            await update({ promotion: { ...promotion,approvalId: record.approvalId! } });
          }
          const published = await host.publishChecked(id), version = forecastMust(published); if (published.ok) writes += published.writes;
          await update({ candidateVersionId: version.id,outcome: 'promoted' });
        }
      }
    }
    return { ok: true,value: record,writes };
  } catch (error) {
    const refused = failure(error), current = forecastMust(await forecastGet(host.store,'retrospectives',id));
    if (!refused.ok && current?.outcome === 'pending' && !current.promotion && refused.issues.every(i => !i.retryable)) {
      const saved = await forecastCommandTransaction(host.store,async tx => {
        const retained = await tx.get('retrospectives',id); if (!equalsJson(retained,current)) reject('TFCT1010','Retrospective changed while retaining a refusal.');
        const next: RetrospectiveCheck = { ...current,outcome: 'ineligible',issues: refused.issues }; await tx.replace('retrospectives',current,next); return next;
      });
      return saved.ok ? { ...saved,writes: writes + saved.writes } : saved;
    }
    return refused;
  }
}
