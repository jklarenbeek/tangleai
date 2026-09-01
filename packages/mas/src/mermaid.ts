/**
 * Topology as a projection — suite JSLT and Mermaid over the canonical
 * and lowered documents, never a hand-drawn or parsed-back source.
 *
 * Dag regions project through the suite's own `dag-to-flowchart`
 * stylesheet; control machines project through `workflow-to-state`
 * (jaren-fsm is the executable superset of the projection shape).
 * The projection is deterministic for one executable revision and moves
 * when topology moves; nested graphs surface as expandable metadata
 * referencing their child plans. Nothing here is runtime source.
 */

import { toMermaid, diagramDocument } from '@jarenjs/mermaid';
import { transformJson } from '@jarenjs/json/jslt';
import dagToFlowchart from '@jarenjs/mermaid/stylesheets/dag-to-flowchart.jslt.json' with { type: 'json' };
import workflowToState from '@jarenjs/mermaid/stylesheets/workflow-to-state.jslt.json' with { type: 'json' };

import type { MasWorkflowPlan } from './lower.ts';

export interface MasRegionDiagram {
  regionId: string;
  kind: 'dag' | 'fsm-switch' | 'fsm-loop' | 'interaction-wait';
  mermaid: string;
  /** Nested graph invocations expandable to child plans. */
  expandable: Array<{ invocation: string, subgraph: string, childExecutableRevision: string }>;
}

export interface MasPlanProjection {
  executableRevision: string;
  regions: MasRegionDiagram[];
  subplans: Record<string, MasPlanProjection>;
}

function dagDiagram(document: unknown): string {
  const ast = transformJson(dagToFlowchart, document);
  return toMermaid(diagramDocument('flowchart', {}, ast, { hash: '0', direction: 'TD', title: null }));
}

function fsmDiagram(document: unknown): string {
  const ast = transformJson(workflowToState, document);
  return toMermaid(diagramDocument('state', {}, ast, { hash: '0', direction: 'TD', title: null }));
}

/** Project one plan (and its subplans, recursively) to Mermaid text. */
export function projectMasPlan(plan: MasWorkflowPlan): MasPlanProjection {
  const regions: MasRegionDiagram[] = [];
  for (const region of plan.regions) {
    if (region.kind === 'subgraph') continue; // carried as expandable metadata on its dag region
    if (region.kind === 'dag') {
      regions.push({
        regionId: region.id,
        kind: 'dag',
        mermaid: dagDiagram(plan.documents[region.documentKey]),
        expandable: region.nested.map((nested) => ({
          invocation: nested.invocation,
          subgraph: nested.subgraph,
          childExecutableRevision: plan.subplans[nested.subgraph]?.executableRevision ?? '',
        })),
      });
    } else if (region.kind === 'fsm-switch') {
      regions.push({
        regionId: region.id,
        kind: 'fsm-switch',
        mermaid: fsmDiagram(plan.documents[region.documentKey]),
        expandable: [],
      });
      for (const branch of region.branches) {
        regions.push({
          regionId: branch.documentKey,
          kind: 'dag',
          mermaid: dagDiagram(plan.documents[branch.documentKey]),
          expandable: branch.nested.map((nested) => ({
            invocation: nested.invocation,
            subgraph: nested.subgraph,
            childExecutableRevision: plan.subplans[nested.subgraph]?.executableRevision ?? '',
          })),
        });
      }
    } else {
      regions.push({
        regionId: region.id,
        kind: region.kind,
        mermaid: fsmDiagram(plan.documents[region.documentKey]),
        expandable: region.kind === 'fsm-loop'
          ? [{ invocation: region.invocation, subgraph: region.body, childExecutableRevision: plan.subplans[region.body]?.executableRevision ?? '' }]
          : [],
      });
    }
  }
  const subplans: Record<string, MasPlanProjection> = {};
  for (const [id, subplan] of Object.entries(plan.subplans)) {
    subplans[id] = projectMasPlan(subplan);
  }
  return { executableRevision: plan.executableRevision, regions, subplans };
}
