/** Registered control topology and scripts, distinct from scientific decision claims. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { prepareResearchWorkflow } from '@tangleai/research';
import { researchExampleData, researchExampleBinding, researchExampleLimits } from '../../examples/research.ts';

export async function createResearchLifecycleFixture() {
  const data = await researchExampleData('lifecycle-fixture'), binding = await researchExampleBinding(data.contract);
  const p = await prepareResearchWorkflow(data.contract, { binding, profile: 'research-scripted', limits: researchExampleLimits });
  const cases = [
    { id: 'complete', action: 'run', decisions: [['Proceed']], responses: [], expected: { nativeStatus: 'completed', lifecycleStatus: 'COMPLETE', executions: 1, approvals: 3 } },
    { id: 'stop', action: 'run', decisions: [['Stop']], responses: [], expected: { nativeStatus: 'completed', lifecycleStatus: 'STOPPED', executions: 1, approvals: 2 } },
    { id: 'refine-twice', action: 'run', decisions: [['Refine', 'Refine', 'Proceed']], responses: [], expected: { nativeStatus: 'completed', lifecycleStatus: 'COMPLETE', executions: 3, approvals: 3 } },
    { id: 'pivot-once', action: 'run', decisions: [['Pivot'], ['Proceed']], responses: [], expected: { nativeStatus: 'completed', lifecycleStatus: 'COMPLETE', executions: 2, approvals: 4 } },
    { id: 'refine-cap', action: 'run', decisions: [['Refine', 'Refine', 'Refine']], responses: [], expected: { nativeStatus: 'completed', lifecycleStatus: 'STOPPED', executions: 3, approvals: 2 } },
    { id: 'pivot-cap', action: 'run', decisions: [['Pivot'], ['Pivot']], responses: [], expected: { nativeStatus: 'completed', lifecycleStatus: 'STOPPED', executions: 2, approvals: 3 } },
    { id: 'review-cap', action: 'run', decisions: [['Proceed']], responses: ['approve', 'approve', 'reject', 'reject'], expected: { nativeStatus: 'completed', lifecycleStatus: 'STOPPED', executions: 1, approvals: 2 } },
    { id: 'stale-approval', action: 'stale-approval', decisions: [['Proceed']], responses: [], expected: { nativeStatus: 'waiting_for_input', lifecycleStatus: 'LITERATURE_GATE', executions: 0, approvals: 0 } },
    { id: 'overdue-pause', action: 'overdue-pause', decisions: [['Proceed']], responses: [], expected: { nativeStatus: 'waiting_for_input', lifecycleStatus: 'LITERATURE_GATE', executions: 0, approvals: 0 } },
    { id: 'overdue-stop', action: 'overdue-stop', decisions: [['Proceed']], responses: [], expected: { nativeStatus: 'failed', lifecycleStatus: 'STOPPED', executions: 0, approvals: 0 } },
  ];
  return { id: 'research-lifecycle-v1', ...data, workflow: p.workflow, registry: p.snapshot.document, catalog: p.catalog,
    executableRevision: p.plan.executableRevision, projectionJson: canonicalizeJson(p.mermaid), cases };
}
