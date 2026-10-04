/** Scoped evidence produces deterministic analysis; native reviewers retain advisory findings. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { validateGmplEvidence, mergeGmplFindings, type GmplInput } from '@tangleai/gmpl';
import type { ResearchTaskTools, ResearchStageOperation, ResearchStageAccess, ResearchStageResult } from './handlers.ts';
import type { ResearchStore } from './store.ts';
import type { ResearchRecordWrite } from './records.ts';
import type { Analysis, ExperimentBranch, ResearchCost } from './contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf, researchArtifactIdOf } from './identity.ts';
import { ResearchFailure, researchFail, researchValue } from './workflow-contract.ts';
import { researchIssue, researchRefuse } from './errors.ts';
import { createResearchAnalysis, type ResearchAnalysisInput } from './stages/analyze.ts';
import { selectBranch, researchCostTotal } from './selection.ts';
import { planResearchDecision } from './stages/decide.ts';
import type { ResearchPairedStatistic } from './statistics.ts';
import { readResearchAnalysisInputs, RESEARCH_ANALYSIS_RECORDS_MEDIA } from './analysis-records.ts';
import { researchAnalysisRevisionOf, type ResearchAnalysisRuntimePolicy, type ResearchAnalysisRuntime } from './analysis-contract.ts';

const bytes = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const zero: ResearchCost = { calls: 0, tokens: 0, ms: 0, physical: 0 };
export async function createResearchAnalysisTools(base: ResearchTaskTools, options: {
  researchStore: ResearchStore; policy: ResearchAnalysisRuntimePolicy; statistic: ResearchPairedStatistic;
}): Promise<ResearchTaskTools> {
  const store = options.researchStore, policy = immutableResearchJson(options.policy), statistic = options.statistic;
  const revision = await researchAnalysisRevisionOf(policy);
  if (!base.binding.toolVersions.some(row => row.name === 'research-analysis' && row.version === revision))
    researchFail('TRSH1007', '/analysis', 'Analysis must bind its exact statistic and independent review policy.');
  async function scoped(operation: ResearchStageOperation, access: ResearchStageAccess) {
    const input = await readResearchAnalysisInputs(operation, access);
    const contract = input.of('ResearchContract').find(row => row.contractHash === operation.expectedState.contractHash);
    const plan = input.of('ExperimentPlan').find(row => row.planHash === operation.expectedState.planHash);
    if (!contract?.analysisPolicy || !contract.branchSelectionRule || !plan)
      researchFail('TRSH1009', '/preregistration', 'Analysis requires its admitted frozen analysis and selection policies.');
    const branches = input.of('ExperimentBranch').filter(row => row.contractHash === contract.contractHash && row.planHash === plan.planHash)
      .sort((a, b) => a.attemptOrdinal - b.attemptOrdinal || a.id.localeCompare(b.id));
    if (!branches.length || branches.at(-1)!.attemptOrdinal !== operation.frame.attempt)
      researchFail('TRSH1005', '/branches', 'Analysis requires the current committed execution branch.');
    const tips = branches.filter(row => !branches.some(next => next.kind === 'replicate' && next.parentId === row.id));
    const candidates = [];
    for (const branch of tips) {
      const lineage: ExperimentBranch[] = [branch]; let current = branch;
      while (current.kind === 'replicate') {
        const parent = branches.find(row => row.id === current.parentId);
        if (!parent || lineage.some(row => row.id === parent.id)) researchFail('TRSH1002', '/branches', 'Replication ancestry is missing or cyclic.');
        lineage.unshift(parent); current = parent;
      }
      const branchIds = lineage.map(row => row.id), runIds = lineage.flatMap(row => row.runIds);
      const data: ResearchAnalysisInput = { contract, plan, branch, ancestors: lineage.slice(0, -1),
        runs: input.of('ExperimentRun').filter(row => runIds.includes(row.id)),
        manifests: input.of('ExecutionManifest').filter(row => branchIds.includes(row.branchId)),
        observations: input.of('MetricObservation').filter(row => runIds.includes(row.experimentRunId)),
        exploratoryObservationIds: operation.expectedState.exploratoryObservationIds, analystIdentityId: policy.analystIdentityId };
      candidates.push({ analysis: researchValue(await createResearchAnalysis(data, statistic)), branches: lineage });
    }
    const selection = researchValue(await selectBranch(candidates, contract));
    const analysis = candidates.find(row => row.analysis.branchId === selection.selectedBranchId)!.analysis;
    return { input, contract, plan, branches, candidates, selection, analysis };
  }
  async function analyze(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<ResearchStageResult> {
    const current = await scoped(operation, access), records: ResearchRecordWrite[] = [
      ...current.candidates.map(row => ({ kind: 'Analysis' as const, value: row.analysis })), { kind: 'ResearchBranchSelection', value: current.selection }];
    return { artifacts: [{ bytes: bytes({ kind: 'analysis-records', value: records }), mediaType: RESEARCH_ANALYSIS_RECORDS_MEDIA }], records, spend: zero };
  }
  async function reviewInput(operation: ResearchStageOperation, access: ResearchStageAccess) {
    const current = await scoped(operation, access);
    if (!current.input.of('Analysis').some(row => equalsJson(row, current.analysis))
      || !current.input.of('ResearchBranchSelection').some(row => equalsJson(row, current.selection)))
      researchFail('TRSH1002', '/analysis', 'Review must consume the independently recomputed committed analysis and selection.');
    // The immutable record retains every address. Reviewers receive its scientific
    // projection, so nested native rounds do not copy the raw provenance inventory.
    const a = current.analysis, s = current.selection;
    const analysisView = { execution: a.execution, metrics: a.metrics.map(({ values, ...metric }) => ({ ...metric,
      values: values.map(({ seed, value }) => ({ seed, value })) })), movement: a.movement, evidence: a.evidence,
      practical: a.practical, support: a.support, diagnostics: a.diagnostics };
    const selectionView = { rule: s.rule, selectedBranchId: s.selectedBranchId, totalCost: s.totalCost,
      candidates: s.candidates.map(({ branchId, cost, estimate, variance, eligible }) => ({ branchId, cost, estimate, variance, eligible })) };
    const input: GmplInput = { caseId: operation.attemptId, query: 'Review the frozen comparison, replication policy, uncertainty, diagnostics and complete candidate costs. Preserve negative results.',
      evidence: [{ id: a.id, digest: await researchRevisionOf(a), text: canonicalizeJson(analysisView) },
        { id: s.id, digest: await researchRevisionOf(s), text: canonicalizeJson(selectionView) }],
      payload: { analysisId: current.analysis.id, analystIdentityId: policy.analystIdentityId, reviewerIdentityId: policy.reviewerIdentityId } };
    return { ...current, input };
  }
  const analysis: ResearchAnalysisRuntime = { policy,
    async prepare(operation, access) { return { input: (await reviewInput(operation, access)).input }; },
    async complete(operation, access, proposal, spend) {
      const current = await reviewInput(operation, access), reviewed = validateGmplEvidence(proposal, current.input.evidence);
      if (!reviewed.valid) throw new ResearchFailure(researchIssue('TRSH1005', reviewed.issues[0].path, 'Native result review cited evidence outside the admitted analysis.', reviewed.issues[0]));
      const merged = mergeGmplFindings([reviewed.value.findings]);
      if (!merged.valid) throw new ResearchFailure(researchIssue('TRSH1005', merged.issues[0].path, 'Result review lost or conflicted with retained findings.', merged.issues[0]));
      const findings = [...merged.value];
      if (reviewed.value.disposition !== 'completed') findings.push({ id: 'result-review-incomplete', origin: policy.reviewerIdentityId,
        disposition: 'unresolved', critical: true, reason: 'The native peer review did not reach a completed disposition.',
        citations: [{ id: current.analysis.id, digest: await researchRevisionOf(current.analysis) }] });
      const reviewBytes = bytes({ kind: 'research-result-review', analystIdentityId: policy.analystIdentityId,
        reviewerIdentityId: policy.reviewerIdentityId, analysisId: current.analysis.id, result: reviewed.value });
      const snapshot = researchValue(await store.snapshot(operation.frame.projectId))!;
      const spent = researchCostTotal([...snapshot.attempts.map(row => row.attempt.spend), spend]);
      const remaining = { calls: snapshot.project.budget.calls - spent.calls, tokens: snapshot.project.budget.tokens - spent.tokens,
        ms: snapshot.project.budget.ms - spent.ms, physical: snapshot.project.budget.physical - spent.physical };
      // Reserve the entire next path, including its analysis/review admissions.
      // A continuation must not consume its last grant before it can decide to stop.
      const reserve = (stages: number): ResearchCost => ({ calls: base.binding.reservation.calls * stages,
        tokens: base.binding.reservation.tokens * stages, ms: base.binding.reservation.ms * stages, physical: base.binding.reservation.physical * stages });
      const decision = researchValue(await planResearchDecision(current.analysis, current.contract,
        { attempt: operation.frame.attempt, pivot: operation.frame.pivot, selection: current.selection },
        { remaining, nextAttempt: reserve(3), nextPivot: reserve(6), nextWrite: reserve(2) },
        { reviewerIdentityId: policy.reviewerIdentityId, findings, artifactIds: [await researchArtifactIdOf(reviewBytes)] }));
      const records: ResearchRecordWrite[] = [{ kind: 'ResearchDecision', value: decision }];
      return { artifacts: [{ bytes: reviewBytes, mediaType: 'application/vnd.tangleai.research-result-review+json' },
        { bytes: bytes({ kind: 'analysis-records', value: records }), mediaType: RESEARCH_ANALYSIS_RECORDS_MEDIA }], records, spend, decision: decision.kind };
    },
  };
  return { ...base, analysis,
    execute: (operation, access) => operation.stage === 'analyze' ? analyze(operation, access) : base.execute(operation, access),
    async verify(operation, result, access) {
      if (operation.stage !== 'analyze' && operation.stage !== 'decide') return base.verify(operation, result, access);
      try {
        let expected: ResearchStageResult;
        if (operation.stage === 'analyze') expected = await analyze(operation, access);
        else {
          const review = result.artifacts.find(row => row.mediaType === 'application/vnd.tangleai.research-result-review+json');
          if (!review) researchFail('TRSH1005', '/review', 'Decision omitted its native review evidence.');
          expected = await analysis.complete(operation, access, JSON.parse(new TextDecoder().decode(review.bytes)).result, result.spend);
        }
        const comparable = (value: ResearchStageResult) => ({ ...value, artifacts: value.artifacts.map(row => ({ ...row, bytes: [...row.bytes] })) });
        if (!equalsJson(comparable(result), comparable(expected))) researchFail('TRSH1002', '/analysis', 'Analysis or decision differs from independent verification.');
        return { valid: true, value: null };
      } catch (cause) { return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
        : researchRefuse('TRSH1002', '/analysis', 'Analysis verification failed.', cause); }
    },
  };
}
