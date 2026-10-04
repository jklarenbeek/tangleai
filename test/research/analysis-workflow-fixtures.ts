import { createResearchBinding, initialResearchFrame, prepareResearchWorkflow, researchExecutionRevisionOf, researchAnalysisRevisionOf,
  createResearchAnalysisTools, createResearchExecutionTools, type ResearchExecutionPolicy, type ResearchAnalysisRuntimePolicy, type ResearchTaskTools, type ResearchExecutor, type ResearchProject } from '@tangleai/research';
import type { MasHostBindings } from '@tangleai/mas';
import type { ResearchStore } from '../../packages/research/src/store.ts';
import { researchExampleIdentity, researchExampleLimits, type ResearchExampleDecisions } from '../../examples/research.ts';
import { researchPairedStatistic } from '../../benchmark/lib/research-statistics.ts';
import { analysisFixture, type AnalysisCase } from './analysis-fixtures.ts';

export async function analysisWorkflowFixture(kind: AnalysisCase = 'success', authored = false) {
  const f = await analysisFixture(kind);
  const policy: ResearchExecutionPolicy = { mode: authored ? 'authored' : 'fixture', imageDigest: f.manifest.imageDigest, dependencyLockHash: f.manifest.dependencyLockHash,
    resources: f.manifest.resources, maxSeeds: 5, maxConditions: 2,
    datasetPaths: f.contract.datasets.map((row, index) => ({ datasetId: row.id, path: f.plan.inputPaths[index] })), codeFiles: authored ? [{ path: 'code/main.mjs', maxBytes: 1024 }] : [] };
  const analysisPolicy: ResearchAnalysisRuntimePolicy = { analystIdentityId: 'research-deterministic-analyst', reviewerIdentityId: 'research-independent-result-reviewers',
    statisticId: 'jaren-paired-bootstrap-nearest-rank' };
  const project: ResearchProject = { id: f.contract.projectId, topic: f.topic.id, question: 'Evaluate registered seed pairs without changing the hypothesis.',
    domainProfile: 'computational', owner: 'fixture', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED',
    budget: { calls: 100, tokens: 100000, ms: 600000, physical: 100 }, createdAt: '2026-01-01T00:00:00.000Z' };
  const binding = await createResearchBinding(f.contract, { identity: await researchExampleIdentity(), promptRevision: f.plan.hypothesisHash,
    toolVersions: [{ name: 'research-execution', version: await researchExecutionRevisionOf(policy) },
      { name: 'research-analysis', version: await researchAnalysisRevisionOf(analysisPolicy) }], evaluator: f.plan.evaluator,
    reservation: { calls: 8, tokens: 1000, ms: 10000, physical: authored ? 18 : 10 } });
  const prepared = await prepareResearchWorkflow(f.contract, { binding, profile: 'research-scripted', limits: researchExampleLimits, execution: policy, analysis: analysisPolicy });
  const frame = await initialResearchFrame(project, f.plan, binding), decisions: ResearchExampleDecisions = [['Stop']];
  return { ...f, policy, analysisPolicy, project, binding, prepared, frame, decisions };
}
export async function analysisWorkflowTools(f: Awaited<ReturnType<typeof analysisWorkflowFixture>>, base: ResearchTaskTools,
  store: ResearchStore, executor: ResearchExecutor = f.executor) {
  const execute = base.execute, verify = base.verify;
  const execution = await createResearchExecutionTools({ ...base,
    async execute(operation, access) {
      const result = await execute(operation, access);
      if (operation.stage === 'create') result.artifacts.push({ bytes: f.fixture.files.get(f.plan.inputPaths[0])!, mediaType: 'application/json' });
      return result;
    },
    verify(operation, result, access) { return verify(operation, operation.stage === 'create' ? { ...result, artifacts: result.artifacts.slice(0, 1) } : result, access); },
  }, { researchStore: store, policy: f.policy, executor, evaluators: [f.evaluator], hiddenLabels: null,
    evaluatorBytes: f.workspace.artifacts.find(row => row.artifactId === f.workspace.manifest.entries.find(row => row.role === 'evaluator')!.artifactId)!.bytes });
  return createResearchAnalysisTools(execution, { researchStore: store, policy: f.analysisPolicy, statistic: researchPairedStatistic });
}
export function analysisReviewClient(critical = false, observe?: () => void): NonNullable<MasHostBindings['clientFor']> {
  return node => ({ endpoint: { provider: 'scripted' }, async complete(request) {
    observe?.();
    const prompt = (request as { messages: Array<{ role: string; content: string }> }).messages.find(row => row.role === 'user')!.content;
    const evidence = JSON.parse(prompt.split('Admitted immutable analysis:\n')[1].split(/\n(?:Prior synthesis \(advisory\):|Review context:)/)[0]) as Array<{ id: string; digest: string }>;
    const citations = evidence.map(row => ({ id: row.id, digest: row.digest }));
    const result = { answer: 'Retain the immutable analysis, uncertainty and every candidate cost.', disposition: 'completed',
      claims: [{ text: 'Analysis and selection are fixed admitted evidence.', citations }], findings: critical && node.id.startsWith('reviewer-')
        ? [{ id: 'critical-' + node.id, origin: node.id, disposition: 'unresolved', critical: true, reason: 'Retained reviewer concern.', citations }] : [] };
    const output = node.id.startsWith('reviewer-') ? { result, assessment: critical ? 'reject' : 'accept', issues: [], strengths: [] } : { result };
    return { message: { role: 'assistant', content: JSON.stringify(output) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
  } });
}
