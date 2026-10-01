/** Measured pre-resolution editing over the durable forecast host and queue. */
import { equalsJson } from '@jarenjs/core/object';
import { openTangleDb, createForecastStore, type TangleDb } from '@tangleai/store';
import type { OutcomeRecord, Evaluation } from '@tangleai/outcomes';
import { fixtureForecastOutcome, fixtureForecastResolution, SCRIPTED_RETROSPECTIVES } from './forecast-lifecycle-fixture.ts';
import { forecastGet, forecastQuery, forecastMust, forecastBytes, combineForecastSpend, forecastPromptRevisions, forecastExecutorToolset, forecastEditorToolset, forecastRevision, visibleHarness, createHarnessRefiner, volatileFactGate, sealForecastRecord, reject, type HarnessRevision, type ForecastHarnessVersion } from '@tangleai/forecast';
import { fixtureForecastHost, type ForecastScriptCounter } from './forecast-host-fixture.ts';
import { measureForecastRevisionResume } from './forecast-resume.ts';
import { scoreForecast } from './forecast-oracle.ts';
import type { ForecastFixtures } from './forecast-fixtures.ts';
import type { Row, Case, Probe } from './forecast.types.ts';

export async function measureEvolvingForecast(fixture: ForecastFixtures, options: { db?: TangleDb } = {}) {
  const db = options.db ?? await openTangleDb({ jobs: {} }), counters: ForecastScriptCounter[] = [];
  let writes = 0, replayed = 0; const probe = (step: string) => { if (step.startsWith('put:')) writes++; };
  const store = createForecastStore(db,{ applyProbe: probe }), outcomeHosts = new Map<string,Awaited<ReturnType<typeof fixtureForecastOutcome>>>();
  const cases: Case[] = [], retained: any[] = [], revisions: HarnessRevision[] = [], versions: ForecastHarnessVersion[] = [], stops: Record<string,number> = {};
  const identity = { configuration: null,toolset: null,promptRevision: null,noteSchemaRevision: null,notePromptRevision: null,noteToolsetRevision: null,scorer: 'forecast-utility/v1',cutoffPolicy: 'available-at-lte-cutoff/v1' } as Row['identity'];
  try {
    for (const [questionIndex,registered] of fixture.questions.entries()) {
      let instant = registered.issuedAt;
      const outcome = await fixtureForecastOutcome({ db,store,fixture,scopeKey: registered.scopeKey,instant: () => instant,applyProbe: probe }); outcomeHosts.set(registered.scopeKey,outcome);
      const priorQuestion = forecastMust(await forecastQuery(store,'questions',{ scopeKey: registered.scopeKey })).find(q => q.prompt === registered.prompt && q.issuedAt === registered.issuedAt);
      const active = priorQuestion ? null : await outcome.checked();
      const f = await fixtureForecastHost({ db,fixture,questionIndex,evolving: true,instant: () => instant,counters,forecastStore: store,outcomeAdmission: outcome,outcomeHost: () => outcome,startedFromCheckedVersionId: priorQuestion ? priorQuestion.startedFromCheckedVersionId : active?.versionId ?? null,policy: { configuration: { kind: 'scripted',revision: await forecastRevision({ registrationId: fixture.manifest.registrationId,retrospectives: SCRIPTED_RETROSPECTIVES }) } } });
      for (const scheduled of registered.checkpoints) {
        instant = scheduled.scheduledAt;
        const tick = await f.host.tick(instant);
        if (tick.failed.length || tick.refused.length || tick.started !== (priorQuestion ? 0 : 1)) throw Error('Evolving fixture did not finish exactly its due checkpoint: ' + JSON.stringify(tick));
        if (priorQuestion) replayed++;
        const checkpoint = forecastMust(await forecastQuery(f.store,'checkpoints',{ questionId: f.question.id,limit: 1000 })).find(c => c.ordinal === scheduled.ordinal)!;
        const get = async (table: 'traces'|'notes'|'predictions'|'harnesses', id: string | null) => id ? forecastMust(await forecastGet(f.store,table,id)) : null;
        const trace = await get('traces',checkpoint.traceId), note = await get('notes',checkpoint.noteId), prediction = checkpoint.predictionId ? forecastMust(await forecastGet(f.store,'predictions',checkpoint.predictionId)) : null, harness = await get('harnesses',checkpoint.inputHarnessVersionId);
        const evidence = await Promise.all(checkpoint.evidenceIds.map(async id => forecastMust(await forecastGet(f.store,'evidence',id))!));
        const revision = forecastMust(await forecastQuery(f.store,'revisions',{ checkpointId: checkpoint.id,limit: 2 }))[0] ?? null;
        const candidate = revision?.candidateVersionId ? forecastMust(await forecastGet(f.store,'harnesses',revision.candidateVersionId)) : null;
        if (candidate && candidate.digest !== (checkpoint.inputHarnessDigest === fixture.manifest.seedHarnessDigest ? fixture.candidates[0].digest : fixture.candidates[1].digest)) reject('TFCT1002','Runtime feedback does not reproduce its registered candidate digest.');
        if (revision) revisions.push(revision);
        stops[checkpoint.stopReason!] = (stops[checkpoint.stopReason!] ?? 0) + 1;
        const tools = await forecastExecutorToolset('evolving-harness');
        retained.push({ fixtureCheckpointId: scheduled.id,question: f.question,harness,checkpoint,evidence,prediction,trace,note,revision,candidate,executorCalls: checkpoint.progress!.execution.calls,noteCalls: checkpoint.progress!.note?.calls ?? [],editorCalls: checkpoint.progress!.revision?.calls ?? [],refusals: evidence.filter(e => !e.admitted).map(e => e.refusal),tools: { names: tools.names,revision: tools.revision } });
        // Outcomes enter only the independent scorer after all runtime writes.
        const resolution = fixture.resolutions.find(r => r.questionId === registered.id), score = resolution && prediction ? scoreForecast(registered.adapter,prediction.normalized,resolution.outcome) : null;
        cases.push({ questionId: registered.id,checkpointId: scheduled.id,ordinal: scheduled.ordinal,scopeKey: registered.scopeKey,cutoffAt: scheduled.cutoffAt,available: !!resolution,status: !resolution ? 'pending' : prediction ? 'scored' : 'failed',failure: checkpoint.failure,prediction: prediction?.normalized ?? null,outcome: resolution?.outcome ?? null,category: score?.category ?? null,utility: score?.utility ?? null,evidenceAdmitted: evidence.filter(e => e.admitted).map(e => e.citationId),evidenceRefused: { postCutoff: evidence.filter(e => e.refusal?.reason === 'post-cutoff').length,undated: evidence.filter(e => e.refusal?.reason === 'undated').length },refused: evidence.filter(e => !e.admitted).map(e => ({ id: e.citationId,reason: e.refusal!.reason as 'post-cutoff'|'undated' })) });
      }
      const resolution = fixture.resolutions.find(r => r.questionId === registered.id);
      if (resolution) { instant = resolution.observedAt; const finished = await fixtureForecastResolution({ db,fixture,host: outcome,masStore: f.masStore,question: f.question,registeredId: registered.id,instant: () => instant,counters }); if (finished?.delivered.duplicate) replayed++; }
      versions.push(...forecastMust(await forecastQuery(f.store,'harnesses',{ questionId: f.question.id,limit: 1000 })));
      versions.push(f.harness);
      const prompts = await forecastPromptRevisions(), tools = await forecastExecutorToolset('evolving-harness');
      Object.assign(identity,{ configuration: f.policy.configuration,toolset: { names: tools.names,revision: tools.revision },promptRevision: prompts.executor,noteSchemaRevision: prompts.noteSchema,notePromptRevision: prompts.note,noteToolsetRevision: await forecastRevision([]) });
    }
    const gateCount = (kind: string) => revisions.reduce((n,r) => n + r.gate.volatileFact.items.filter(item => item === kind).length,0);
    const census = {
      attempted: revisions.length,staged: revisions.filter(r => r.candidateVersionId).length,deferred: revisions.filter(r => r.validation.ok && !r.candidateVersionId).length,refused: revisions.filter(r => !r.validation.ok).length,
      guidanceCommitted: revisions.reduce((n,r) => n + r.committedGuidance.length,0),guidanceDeferred: revisions.reduce((n,r) => n + r.deferredFeedback.length,0),
      gateRefusals: { date: gateCount('date'),'named-entity': gateCount('named-entity'),'exact-outcome': gateCount('exact-outcome'),'number-with-unit': gateCount('number-with-unit'),'copied-evidence': gateCount('copied-evidence'),identifier: gateCount('identifier'),semantic: gateCount('semantic') },
      refusedGuidance: revisions.reduce((n,r) => n + r.gate.volatileFact.refused,0),patchOps: revisions.map(r => ({ revisionId: r.id,operations: r.patch.length })),
      harnessBytes: versions.map(v => ({ versionId: v.id,digest: v.digest,bytes: forecastBytes(v.document) })),traceReads: revisions.reduce((n,r) => n + r.traceReads,0),
      editorCalls: revisions.flatMap(r => r.receipt!.calls).filter((c: any) => c.stage === 'feedback').length,classifierCalls: revisions.flatMap(r => r.receipt!.calls).filter((c: any) => c.stage === 'revision.gate').length,
      usageKnown: revisions.every(r => r.receipt!.spend.usageKnown),editorRefusals: { traceBudget: revisions.reduce((n,r) => n + (r.editorRefusals?.traceBudget ?? 0),0),foreignReads: revisions.reduce((n,r) => n + (r.editorRefusals?.foreignReads ?? 0),0) },
    };
    const resolutions = forecastMust(await forecastQuery(store,'resolutions',{ limit: 10000 })), retrospectives = forecastMust(await forecastQuery(store,'retrospectives',{ limit: 10000 }));
    const outcomeRecords: OutcomeRecord[] = [], checkedHeads = [];
    for (const [scopeKey,host] of outcomeHosts) { outcomeRecords.push(...await host.history()); const active = await host.checked(); checkedHeads.push({ scopeKey,versionId: active?.versionId ?? null,revision: active?.head.revision ?? 0,digest: active ? await forecastRevision(active.payload) : null }); }
    const pairedCandidates = await Promise.all(retrospectives.filter(r => r.reflect?.versionId).map(async r => {
      const version = outcomeRecords.find(o => o.id === r.reflect!.versionId); if (version?.kind !== 'artifactVersion') throw Error('Measured candidate is missing.');
      const evaluation = outcomeRecords.find(o => o.id === r.evaluation?.evaluationId) as Evaluation | undefined, rows = evaluation?.caseResults ?? [];
      const parent = outcomeRecords.find(o => o.id === version.parentVersionId), baselineUtility = rows.length ? rows.reduce((n,c) => n + c.baselineUtility,0) / rows.length : null, candidateUtility = rows.length ? rows.reduce((n,c) => n + c.utility,0) / rows.length : null;
      return { retrospectiveId: r.id,versionId: version.id,parentDigest: await forecastRevision(parent?.kind === 'artifactVersion' ? parent.payload : fixture.seed),candidateDigest: await forecastRevision(version.payload),caseIds: rows.map(c => c.id),baselineUtility,candidateUtility,delta: baselineUtility === null || candidateUtility === null ? null : candidateUtility - baselineUtility,eligible: evaluation?.eligible ?? false,issues: (r.issues ?? []).map(i => ({ ...i })) };
    }));
    const lifecycle = { resolutions: resolutions.filter(r => !r.correctionOf).length,scoredCheckpoints: resolutions.reduce((n,r) => n + r.losses.length,0),postResolutionSkips: resolutions.reduce((n,r) => n + r.skipped.filter(c => c.reason === 'post-resolution').length,0),promoted: retrospectives.filter(r => r.outcome === 'promoted').length,retained: retrospectives.filter(r => r.outcome === 'retained').length,rejected: retrospectives.filter(r => r.outcome === 'rejected').length,ineligible: retrospectives.filter(r => r.outcome === 'ineligible').length,retrospectiveCalls: retrospectives.reduce((n,r) => n + r.receipt!.spend.calls,0),spend: combineForecastSpend(...retrospectives.map(r => r.receipt!.spend)),pairedCandidates,checkedHeads,records: { resolutions,retrospectives,checkedReferences: forecastMust(await forecastQuery(store,'harnesses',{ status: 'checked-ref' })),outcomes: outcomeRecords } };
    return { cases,retained,identity,cost: combineForecastSpend(...retained.map(r => r.checkpoint.spend),lifecycle.spend),stops,logicalCalls: counters.reduce((n,c) => n + c.calls(),0),physicalCalls: counters.reduce((n,c) => n + c.physicalCalls(),0),revisions: census,lifecycle: { ...lifecycle,records: { resolutions: lifecycle.records.resolutions.map(r => ({ ...r })),retrospectives: lifecycle.records.retrospectives.map(r => ({ ...r })),checkedReferences: lifecycle.records.checkedReferences.map(r => ({ ...r })),outcomes: lifecycle.records.outcomes.map(r => ({ ...r })) } },writes,replayed };
  } finally { if (!options.db) await db.close(); }
}
export async function forecastEditingProbes(fixture: ForecastFixtures, measured: Awaited<ReturnType<typeof measureEvolvingForecast>>): Promise<Probe[]> {
  const probes: Probe[] = [], add = (id: string,holds: boolean,detail: string) => { if(!holds) throw Error('Forecast editing probe failed: ' + id); probes.push({ id,holds: true,detail }); };
  const leaks = fixture.leaks as { refuse: string[];allow: string[] }, first = fixture.questions[0];
  const context = { questionPrompt: first.prompt,adapterOptions: first.adapter.id === 'choice/v1' ? first.adapter.options : [],evidenceExcerpts: fixture.snapshots.filter(s => s.questionId === first.id && s.availableAt && s.availableAt <= first.checkpoints[1].cutoffAt).map(s => s.excerpt),toolResultExcerpts: [],questionId: first.id,checkpointIds: first.checkpoints.map(c => c.id) };
  const kinds = ['date','named-entity','exact-outcome','copied-evidence','identifier','number-with-unit','identifier','identifier'];
  const allowed = [...leaks.allow,...Object.values(fixture.seed),...fixture.candidates.flatMap(c => Object.values(c.document))];
  add('volatile-fact-gate',leaks.refuse.every((text,i) => volatileFactGate(text,context).findings.some(f => f.kind === kinds[i])) && allowed.every(text => volatileFactGate(text,context).ok),`${leaks.refuse.length} registered leaks refused by kind; ${allowed.length} reusable and harness strings admitted. These are separate gate probes, not revision purchases.`);
  let visibilityChecks = 0;
  for (const row of measured.retained.filter(r => r.candidate)) for (const foreign of measured.retained.filter(r => r.question.id !== row.question.id)) {
    const result = visibleHarness(foreign.question,row.candidate); if(result.ok || result.issues[0].code !== 'TFCT1003') throw Error('Provisional harness escaped its question.'); visibilityChecks++;
  }
  add('provisional-invisible',visibilityChecks === measured.retained.filter(r => r.candidate).length * 15,`${visibilityChecks} other-question and scope reads refuse question-owned harnesses as TFCT1003.`);
  const tools = await forecastEditorToolset();
  add('editor-toolbox-names',equalsJson(tools.names,['harness_read','notes_read','revisions_read','trace_read']) && measured.retained.filter(r => r.revision).every(r => r.revision.toolsetRevision === tools.revision),'Every measured revision pins exactly four read tools; no web or store write tool.');
  add('revision-digest-agreement',measured.retained.every(r => r.checkpoint.ordinal === 1 ? r.revision === null : r.checkpoint.inputHarnessDigest === fixture.candidates[1].digest ? r.candidate === null && r.revision.validation.ok : r.candidate?.digest === (r.checkpoint.inputHarnessDigest === fixture.manifest.seedHarnessDigest ? fixture.candidates[0].digest : fixture.candidates[1].digest)),`Unrelated questions follow seed → ${fixture.candidates[0].digest} → ${fixture.candidates[1].digest}; a related question starts from the checked generation and its repeated final proposal stages nothing.`);
  let writes = 0;
  const captured = measured.retained[0], refiner = await createHarnessRefiner({ parent: captured.harness,context: { ...context,questionId: captured.question.id,checkpointIds: [captured.checkpoint.id] },sources: ['note:' + captured.note.id],now: () => captured.checkpoint.scheduledAt,commit: async () => { writes++; } });
  const outcome = await refiner.commitGuidance([{ component: 'evidenceHandling',text: captured.harness.document.evidenceHandling,sources: ['note:' + captured.note.id] }]);
  add('no-op-revision-writes-nothing',outcome.ok && equalsJson(outcome.value,{ status: 'deferred',writes: 0 }) && writes === 0,'An unchanged guarded proposal is counted as deferred and invokes no harness publication. A host can still retain the revision and its spent receipt.');
  const recovery = await measureForecastRevisionResume();
  add('revision-resume-identity',recovery.stages.every(s => s.stops === 2 && s.extraCalls === 0 && s.artifactDigest === recovery.artifactDigest),`${recovery.stages.length} atomic revision publication observations, four stops and resumes; ${recovery.logicalCalls} logical calls, zero extra calls, ${recovery.physicalRequests} physical requests. Artifact digest ${recovery.artifactDigest}; executable ${recovery.executableRevision}.`);
  return probes;
}
