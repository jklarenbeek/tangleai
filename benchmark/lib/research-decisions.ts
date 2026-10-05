/** Matched native decision controls preserve negative results and expose every continuation cost. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { createResearchExecutionTools, createResearchAnalysisTools, createFixtureExecutor, researchValue,
  type ResearchAnalysisRuntimePolicy, type ResearchCost, type EvidenceCard, type LiteratureRecord, type Intervention } from '@tangleai/research';
import { researchExecutionFixture } from './research-execution-fixture.ts';
import { runResearchReasoningFixture } from './research-reasoning.ts';
import { researchPairedStatistic } from './research-statistics.ts';
import { requireResearchShape } from './research-validation.ts';
import { researchScore } from './research-oracle.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchFixtureTopic, ResearchReasoningScript, ResearchDecisionRegistration, ResearchAnalysisTopic,
  ResearchAnalysisRow, ResearchDecisionProbe } from './research.types.ts';

const total = (rows: ResearchCost[]): ResearchCost => rows.reduce((sum, row) => ({ calls: sum.calls + row.calls, tokens: sum.tokens + row.tokens,
  ms: sum.ms + row.ms, physical: sum.physical + row.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 });
export function researchDecisionResponse(node: { id: string }, request: unknown) {
  const prompt = (request as { messages: Array<{ role: string; content: string }> }).messages.find(row => row.role === 'user')!.content;
  const evidence = JSON.parse(prompt.split('Admitted immutable analysis:\n')[1].split(/\n(?:Prior synthesis \(advisory\):|Review context:)/)[0]) as Array<{ id: string; digest: string }>;
  const citations = evidence.map(({ id, digest }) => ({ id, digest }));
  const result = { answer: 'Retain the immutable analysis, uncertainty and every candidate cost.', disposition: 'completed',
    claims: [{ text: 'The admitted analysis and selection contain the registered result.', citations }], findings: [] };
  return node.id.startsWith('reviewer-') ? { result, assessment: 'accept', issues: [], strengths: [] } : { result };
}
export async function runResearchDecisionFixture(loaded: LoadedResearchFixture, original: ResearchFixtureTopic,
  registration: ResearchDecisionRegistration, mode: 'control' | 'branching', repair = false, automatic = false) {
  const f = await researchExecutionFixture(loaded, original), topic = structuredClone(original), declared = registration[mode];
  const { contractHash: _contractHash, ...body } = topic.contract;
  body.attemptCap = declared.attemptCap; body.branchSelectionRule = declared.rule;
  body.analysisPolicy = { seedBatchSize: repair ? body.replicatePolicy.seeds.length : Math.min(declared.seedBatchSize, body.replicatePolicy.seeds.length),
    recoverProgramFailure: repair, confoundAction: 'Stop', seedVariationChecks: [] };
  topic.contract = { ...body, contractHash: await canonicalSha256(body) };
  const { planHash: _planHash, ...planBody } = topic.plan; planBody.contractHash = topic.contract.contractHash;
  if (repair) {
    if (topic.id !== registration.repair.topicId) throw Error('Repair registration names a different topic.');
    planBody.conditions[1].programId = registration.repair.programId;
  }
  topic.plan = { ...planBody, planHash: await canonicalSha256(planBody) };
  const script = structuredClone(requireResearchShape<ResearchReasoningScript>('ResearchReasoningScript',
    JSON.parse(new TextDecoder().decode(loaded.files.get('scripts/' + topic.id + '.json')!))));
  script.design.contract.attemptCap = body.attemptCap; script.design.contract.branchSelectionRule = body.branchSelectionRule;
  script.design.contract.analysisPolicy = body.analysisPolicy;
  script.design.plan.conditions = topic.plan.conditions; script.design.plan.design.resources = f.registered.designResources;
  for (const probe of script.cases) if (probe.proposal.contract) Object.assign(probe.proposal.contract as object,
    { analysisPolicy: body.analysisPolicy, branchSelectionRule: body.branchSelectionRule });
  const analysisPolicy: ResearchAnalysisRuntimePolicy = { analystIdentityId: registration.analystIdentityId,
    reviewerIdentityId: registration.reviewerIdentityId, statisticId: registration.statisticId };
  const executor = repair ? createFixtureExecutor({ ...f.programs, [registration.repair.programId]: async () => {
    throw Error(registration.repair.fault);
  } }, { now: () => 0 }) : f.executor;
  let writingEvidence: { cards: EvidenceCard[]; literature: LiteratureRecord[]; interventions: Intervention[]; mode: 'gate-only' | 'full-auto'; runGraph: string; programSourceHash: string } | undefined;
  const result = await runResearchReasoningFixture<ResearchAnalysisTopic>(loaded, topic, 'single-agent', { policy: f.policy, script, decisions: [['Stop']],
    revision: await canonicalSha256({ registration, mode, repair }), analysis: analysisPolicy, reviewResponse: researchDecisionResponse,
    async tools(base, store) {
      const execute = base.execute, verify = base.verify;
      const execution = await createResearchExecutionTools({ ...base, async execute(operation, access) {
        const result = await execute(operation, access);
        if (operation.stage === 'create') result.artifacts.push({ bytes: loaded.files.get(topic.datasetPath)!, mediaType: 'application/json' });
        return result;
      }, verify(operation, result, access) { return verify(operation, operation.stage === 'create' ? { ...result, artifacts: result.artifacts.slice(0, 1) } : result, access); } },
      { researchStore: store, policy: f.policy, executor, evaluators: [f.evaluator], hiddenLabels: f.hiddenLabels, evaluatorBytes: f.evaluatorBytes });
      return createResearchAnalysisTools(execution, { researchStore: store, policy: analysisPolicy, statistic: researchPairedStatistic });
    },
    async collect(store, masStore, reasoning, native) {
      const snapshot = researchValue(await store.snapshot(topic.contract.projectId))!, trace = (await masStore.readTrace(topic.contract.projectId))!;
      if (trace.run.status !== 'completed' || snapshot.state.status !== 'STOPPED')
        throw Error('Decision control did not terminate explicitly: ' + JSON.stringify(trace.run.failure));
      const contract = snapshot.records.find(row => row.kind === 'ResearchContract' && row.value.contractHash === snapshot.state.contractHash)!.value;
      const plan = snapshot.records.find(row => row.kind === 'ExperimentPlan' && row.value.planHash === snapshot.state.planHash)!.value;
      const analyses = snapshot.records.filter(row => row.kind === 'Analysis').map(row => row.value);
      const decisions = snapshot.records.filter(row => row.kind === 'ResearchDecision').map(row => row.value).sort((a, b) => a.details!.attemptOrdinal - b.details!.attemptOrdinal);
      const branches = snapshot.records.filter(row => row.kind === 'ExperimentBranch').map(row => row.value).sort((a, b) => a.attemptOrdinal - b.attemptOrdinal);
      const cost = total(snapshot.attempts.map(row => row.attempt.spend)), runs = snapshot.records.filter(row => row.kind === 'ExperimentRun').map(row => row.value);
      if (cost.calls !== trace.run.budget.spent.turns || cost.tokens !== trace.run.budget.spent.tokens || cost.physical !== cost.calls + runs.length)
        throw Error('Decision control cost differs from native model attempts and experiment receipts.');
      const traceBytes = new TextEncoder().encode(JSON.stringify(trace)).byteLength;
      if (traceBytes > loaded.manifest.caps.traceBytes) throw Error('Decision control exceeded its unchanged trace bound: ' + traceBytes);
      const reviews = await Promise.all(snapshot.artifacts.filter(row => row.artifact.mediaType === 'application/vnd.tangleai.research-result-review+json'
        && snapshot.committedAdmissionIds.includes(row.id)).map(async row => ({ artifactId: row.artifact.id,
        bytes: [...researchValue(await store.readArtifact(topic.contract.projectId, row.id)).bytes] })));
      const final = decisions.at(-1)!;
      if (!final?.details || final.kind !== 'Stop') throw Error('Decision control omitted its final bounded decision.');
      writingEvidence = { cards: snapshot.records.filter(row => row.kind === 'EvidenceCard').map(row => row.value),
        literature: snapshot.records.filter(row => row.kind === 'LiteratureRecord').map(row => row.value),
        interventions: snapshot.records.filter(row => row.kind === 'Intervention').map(row => row.value), mode: snapshot.project.mode, runGraph: native.runGraph,
        programSourceHash: await canonicalSha256(loaded.manifest.programs) };
      return requireResearchShape<ResearchAnalysisTopic>('ResearchAnalysisTopic', { topicId: topic.id, nativeStatus: trace.run.status, state: snapshot.state,
        runIdentityId: reasoning.runIdentityId, workflowVersionId: reasoning.workflowVersionId, contract, plan, cost, branches, analyses, decisions, reviews,
        selections: snapshot.records.filter(row => row.kind === 'ResearchBranchSelection').map(row => row.value),
        attempts: snapshot.attempts.map(row => row.attempt), manifests: snapshot.records.filter(row => row.kind === 'ExecutionManifest').map(row => row.value),
        runs, observations: snapshot.records.filter(row => row.kind === 'MetricObservation').map(row => row.value),
        finalAnalysisId: final.details.analysisId, finalDecisionId: final.id, traceBytes,
        reviewCalls: snapshot.attempts.filter(row => row.attempt.stage === 'DECIDE').reduce((n, row) => n + row.attempt.spend.calls, 0) });
    },
  }, automatic);
  if (!writingEvidence) throw Error('Decision control omitted its admitted writing evidence.');
  return { ...result, writingEvidence };
}
export function aggregateResearchAnalysis(id: ResearchAnalysisRow['id'], topics: ResearchAnalysisTopic[], probes: ResearchDecisionProbe[]): ResearchAnalysisRow {
  const negative = topics.filter(row => row.topicId === 'embedder-width');
  const candidates = topics.flatMap(row => row.selections);
  return { id, topics, cost: total(topics.map(row => row.cost)), confoundDetection: researchScore(probes.filter(row => row.id === 'confound' && row.matched).length, 1),
    negativeResultHandling: researchScore(negative.filter(row => row.analyses.some(analysis => analysis.id === row.finalAnalysisId && analysis.support === 'not-supported')
      && row.decisions.some(decision => decision.id === row.finalDecisionId && decision.kind === 'Stop')).length, negative.length),
    branchSelectionCompliance: researchScore(candidates.filter(selection => selection.candidates.length <= (selection.rule.kind === 'single' ? 1 : selection.rule.n)
      && canonicalizeJson(selection.totalCost) === canonicalizeJson(total(selection.candidates.map(row => row.cost)))).length, candidates.length) };
}
