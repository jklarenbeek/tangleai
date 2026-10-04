import { createResearchBinding, initialResearchFrame, prepareResearchWorkflow, researchExecutionRevisionOf, createResearchExecutionTools,
  type ResearchExecutionPolicy, type ResearchProject, type ResearchTaskTools, type ResearchExecutor } from '@tangleai/research';
import { researchExampleIdentity, researchExampleLimits, type ResearchExampleDecisions } from '../../examples/research.ts';
import { executionFixture } from './execution-fixtures.ts';
import type { ResearchStore } from '../../packages/research/src/store.ts';

export async function executionWorkflowFixture(authored = false) {
  const f = await executionFixture();
  const policy: ResearchExecutionPolicy = { mode: authored ? 'authored' : 'fixture', imageDigest: f.manifest.imageDigest, dependencyLockHash: f.manifest.dependencyLockHash,
    resources: f.manifest.resources, maxSeeds: 5, maxConditions: 2,
    datasetPaths: f.contract.datasets.map((row, index) => ({ datasetId: row.id, path: f.plan.inputPaths[index] })), codeFiles: authored ? [{ path: 'code/main.mjs', maxBytes: 1024 }] : [] };
  const project: ResearchProject = { id: f.contract.projectId, topic: f.topic.id, question: 'Reproduce every registered experiment from immutable raw receipts.',
    domainProfile: 'computational', owner: 'fixture', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED',
    budget: { calls: 100, tokens: 100000, ms: 600000, physical: 100 }, createdAt: '2026-01-01T00:00:00.000Z' };
  const binding = await createResearchBinding(f.contract, { identity: await researchExampleIdentity(), promptRevision: f.plan.hypothesisHash,
    toolVersions: [{ name: 'research-execution', version: await researchExecutionRevisionOf(policy) }], evaluator: f.plan.evaluator,
    reservation: { calls: authored ? 8 : 0, tokens: authored ? 1000 : 0, ms: 10000, physical: authored ? 18 : 10 } });
  const prepared = await prepareResearchWorkflow(f.contract, { binding, profile: 'research-scripted', limits: researchExampleLimits, execution: policy });
  const frame = await initialResearchFrame(project, f.plan, binding), decisions: ResearchExampleDecisions = [['Stop']];
  return { ...f, project, policy, binding, prepared, frame, decisions };
}
export async function executionWorkflowTools(f: Awaited<ReturnType<typeof executionWorkflowFixture>>, base: ResearchTaskTools,
  store: ResearchStore, executor: ResearchExecutor = f.executor) {
  const execute = base.execute, verify = base.verify;
  const withInputs: ResearchTaskTools = { ...base,
    async execute(operation, access) {
      const result = await execute(operation, access);
      if (operation.stage === 'create') result.artifacts.push({ bytes: f.fixture.files.get(f.plan.inputPaths[0])!, mediaType: 'application/json' });
      return result;
    },
    verify(operation, result, access) { return verify(operation, operation.stage === 'create' ? { ...result, artifacts: result.artifacts.slice(0, 1) } : result, access); },
  };
  return createResearchExecutionTools(withInputs, { researchStore: store, policy: f.policy, executor,
    evaluators: [f.evaluator], hiddenLabels: f.hiddenLabels, evaluatorBytes: f.workspace.artifacts.find(row => row.artifactId === f.workspace.manifest.entries.find(row => row.role === 'evaluator')!.artifactId)!.bytes });
}
