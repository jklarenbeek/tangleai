/** Revision, provisional head and purchase receipt share one atomic publication. */
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { forecastCommandTransaction, forecastGet, type ForecastStore } from './store.ts';
import { validateForecastRecord } from './identity.ts';
import { forecastMust, reject, failure } from './errors.ts';
import { forecastPromptRevisions } from './prompts.ts';
import { forecastEditorToolset } from './editor-toolbox.ts';
import { createHarnessRefiner } from './refiner.ts';
import { combineForecastSpend } from './meter.ts';
import { planHarnessTransition } from './transitions.ts';
import type { ForecastFeedbackResult } from './feedback.ts';
import type { ForecastCheckpoint } from './contracts.gen.ts';

export async function forecastRevisionCommit(store: ForecastStore, input: ForecastFeedbackResult) {
  try {
  // Read-only preflight has no publication seam. The transaction below checks
  // these immutable inputs and the mutable checkpoint again before any write.
  const checkpoint = forecastMust(await forecastGet(store,'checkpoints',input.revision.checkpointId));
  const question = checkpoint ? forecastMust(await forecastGet(store,'questions',checkpoint.questionId)) : null;
  if (!checkpoint || !question) reject('TFCT1002','The revision checkpoint or question is missing.');
  const prompts = await forecastPromptRevisions(), toolset = await forecastEditorToolset();
  return await forecastCommandTransaction(store,async tx => {
    const revision = await validateForecastRecord('revisions',input.revision), candidate = input.candidate ? await validateForecastRecord('harnesses',input.candidate) : null;
    const current = await tx.get('checkpoints',checkpoint.id), owner = await tx.get('questions',question.id);
    if (!current || !owner || revision.questionId !== owner.id) reject('TFCT1003','A revision requires its retained question owner.');
    if (!revision.receipt || revision.promptRevision !== prompts.feedback || revision.noteSchemaRevision !== prompts.feedbackSchema || revision.toolsetRevision !== toolset.revision || !equalsJson(revision.configuration,current.configuration)) reject('TFCT1002','The revision differs from its editor producer or checkpoint receipt.');
    const status = !revision.validation.ok ? 'refused' : candidate ? 'staged' : 'deferred';
    if (input.status !== status || revision.candidateVersionId !== (candidate?.id ?? null)) reject('TFCT1002','Revision output and candidate identity disagree.');
    const earlier = (await tx.query('revisions',{ checkpointId: current.id,limit: 2 }));
    if (earlier.length || current.progress?.revision) {
      if (earlier.length !== 1 || !equalsJson(earlier[0],revision) || !equalsJson(current.progress?.revision,revision.receipt)) reject('TFCT1010','This checkpoint already owns another or incomplete revision publication.');
      if (candidate) {
        const retained = await tx.get('harnesses',candidate.id);
        if (!retained || !equalsJson({ ...retained,status: candidate.status,checkedVersionId: candidate.checkedVersionId },candidate)) reject('TFCT1010','The retained revision candidate differs.');
      }
      return { revision,candidate: candidate ? (await tx.get('harnesses',candidate.id))! : null,status,checkpoint: current };
    }
    if (!equalsJson(current,checkpoint) || !equalsJson(owner,question)) reject('TFCT1004','Revision inputs changed after preparation.');
    if (owner.status !== 'open' || current.ordinal < 2 || current.status !== 'running' || !current.noteId || !current.progress?.note) reject('TFCT1004','Publish feedback only for a running, noted checkpoint of an unresolved question after ordinal one.');
    if (!current.inputHarnessVersionId || owner.latestProvisionalVersionId && owner.latestProvisionalVersionId !== current.inputHarnessVersionId) reject('TFCT1004','The provisional parent is stale.');
    const parent = await tx.get('harnesses',current.inputHarnessVersionId);
    if (!parent || parent.digest !== current.inputHarnessDigest) reject('TFCT1002','The immutable input harness is missing.');
    const checkpoints = (await tx.query('checkpoints',{ questionId: owner.id,limit: 1000 })).filter(c => c.ordinal <= current.ordinal).sort((a,b) => a.ordinal - b.ordinal);
    const notes = checkpoints.filter(c => c.noteId).map(c => c.noteId!);
    if (!equalsJson(revision.comparedNoteIds,notes)) reject('TFCT1003','The revision must compare only its accumulated retained notes in ordinal order.');
    const previous = await tx.query('revisions',{ questionId: owner.id,limit: 1000 });
    const sources = [...notes.map(id => 'note:' + id),...checkpoints.filter(c => c.traceId).map(c => 'trace:' + c.traceId),...previous.filter(r => checkpoints.some(c => c.id === r.checkpointId && c.ordinal < current.ordinal)).map(r => 'revision:' + r.id)];
    for (const item of [...revision.provisionalDiagnoses,...revision.committedGuidance,...revision.deferredFeedback]) if (item.sources.some(source => !sources.includes(source))) reject('TFCT1007','A revision cites a source outside its captured question input.','/sources');
    if (candidate) {
      if (!revision.validation.ok || revision.validation.issues.length || candidate.status !== 'staged' || candidate.questionId !== owner.id || candidate.scopeKey !== owner.scopeKey || candidate.parentVersionId !== parent.id || candidate.provenance.seed || candidate.provenance.revisionId !== revision.id || candidate.provenance.retrospectiveId || candidate.recordedAt < current.startedAt!) reject('TFCT1003','The candidate is not this question\'s guarded provisional revision.');
      const evidence = (await Promise.all(checkpoints.flatMap(c => c.evidenceIds).map(id => tx.get('evidence',id)))).filter(e => e?.admitted);
      const traces = await Promise.all(checkpoints.filter(c => c.traceId).map(c => tx.get('traces',c.traceId!)));
      const refiner = await createHarnessRefiner({ parent,context: { questionPrompt: owner.prompt,adapterOptions: owner.adapter.id === 'choice/v1' ? owner.adapter.options : [],evidenceExcerpts: evidence.map(e => e!.excerpt),toolResultExcerpts: traces.filter(t => t !== undefined).map(t => canonicalizeJson(t)),questionId: owner.id,checkpointIds: checkpoints.map(c => c.id) },sources,semantic: revision.gate.semantic,now: () => candidate.recordedAt });
      const prepared = await refiner.prepareGuidance(revision.committedGuidance);
      if (!prepared.valid) reject('TFCT1007','The retained guidance does not pass guarded publication.');
      if (prepared.plan.noOp || !equalsJson(prepared.plan.document,candidate.document) || !equalsJson(prepared.plan.patch,revision.patch) || !equalsJson(prepared.plan.acceptedGuidance,revision.committedGuidance)) reject('TFCT1007','The candidate changes bytes not attributable to its committed guidance.');
    } else if (revision.patch.length || revision.committedGuidance.length) reject('TFCT1007','A deferred or refused revision cannot retain a patch or committed guidance.');
    const next: ForecastCheckpoint = { ...current,progress: { ...current.progress,revision: revision.receipt },spend: combineForecastSpend(current.progress.execution.spend,current.progress.note.spend,revision.receipt.spend) };
    // Validation precedes every write; a failed adapter publication rolls back
    // the entire revision, candidate, head and spend receipt together.
    await validateForecastRecord('checkpoints',next);
    await tx.put('revisions',revision);
    let provisional = candidate;
    if (candidate) {
      await tx.put('harnesses',candidate);
      provisional = forecastMust(planHarnessTransition(candidate,{ type: 'harness.provisional' })).after;
      await tx.replace('harnesses',candidate,provisional);
      await tx.replace('questions',owner,{ ...owner,latestProvisionalVersionId: candidate.id });
    }
    await tx.replace('checkpoints',current,next);
    return { revision,candidate: provisional,status,checkpoint: next };
  });
  } catch (error) { return failure(error); }
}
