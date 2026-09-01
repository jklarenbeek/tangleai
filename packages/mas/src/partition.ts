/**
 * Region partitioning — D4 as an algorithm.
 *
 * A workflow's flat graph is cut into an ordered list of regions: every
 * maximal run of plain invocations (agent/task/graph) becomes one
 * acyclic `dag` region; each switch, loop and interaction becomes its
 * own control region, with switch branch members carved out of the flat
 * ordering into per-branch dag subregions. The order is topological
 * with document-order tie-break, so a later region only ever consumes
 * committed values of earlier ones — a switch does not run every branch
 * with false inputs, a loop is a bounded cycle around one acyclic body,
 * and an interaction is a durable cut between queue segments.
 *
 * This is compile-time structure, not a runtime scheduler: inside a dag
 * region the only readiness authority is `compileDag`.
 */

import type { Invocation, MasWorkflow } from './contracts.gen.ts';

export interface RegionMember {
  invocation: Invocation;
  index: number;
}

export type Region =
  | { kind: 'dag', id: string, members: RegionMember[] }
  | { kind: 'switch', id: string, invocation: Invocation, index: number, branches: Array<{ id: string, members: RegionMember[] }> }
  | { kind: 'loop', id: string, invocation: Invocation, index: number }
  | { kind: 'interaction', id: string, invocation: Invocation, index: number };

/** Topological order over control+message edges, document-order tie-break. */
function topologicalOrder(workflow: MasWorkflow): string[] {
  const ids = workflow.nodes.map((node) => node.id);
  const position = new Map(ids.map((id, index) => [id, index]));
  const dependencies = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const edge of workflow.control) {
    dependencies.get(edge.to)?.add(edge.from);
  }
  for (const edge of workflow.messages) {
    dependencies.get(edge.to.node)?.add(edge.from.node);
  }
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < ids.length) {
    const ready = ids.filter((id) => !done.has(id)
      && [...(dependencies.get(id) ?? [])].every((dep) => done.has(dep)));
    if (ready.length === 0) break; // a cycle was already refused by validation
    ready.sort((a, b) => (position.get(a) as number) - (position.get(b) as number));
    const next = ready[0];
    order.push(next);
    done.add(next);
  }
  return order;
}

export function partitionMasWorkflow(workflow: MasWorkflow): Region[] {
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const indexOf = new Map(workflow.nodes.map((node, index) => [node.id, index]));
  const branchMembers = new Set<string>();
  for (const node of workflow.nodes) {
    if (node.kind !== 'switch') continue;
    for (const branch of node.branches) {
      for (const member of branch.nodes) branchMembers.add(member);
    }
  }

  const regions: Region[] = [];
  let accumulator: RegionMember[] = [];
  let dagCount = 0;
  const flush = (): void => {
    if (accumulator.length === 0) return;
    regions.push({ kind: 'dag', id: `dag${dagCount}`, members: accumulator });
    dagCount += 1;
    accumulator = [];
  };

  for (const id of topologicalOrder(workflow)) {
    if (branchMembers.has(id)) continue; // carved into its switch's branch regions
    const invocation = byId.get(id) as Invocation;
    const index = indexOf.get(id) as number;
    if (invocation.kind === 'switch') {
      flush();
      regions.push({
        kind: 'switch',
        id: `switch:${id}`,
        invocation,
        index,
        branches: invocation.branches.map((branch) => ({
          id: branch.id,
          members: branch.nodes.map((member) => ({
            invocation: byId.get(member) as Invocation,
            index: indexOf.get(member) as number,
          })),
        })),
      });
    } else if (invocation.kind === 'loop') {
      flush();
      regions.push({ kind: 'loop', id: `loop:${id}`, invocation, index });
    } else if (invocation.kind === 'interaction') {
      flush();
      regions.push({ kind: 'interaction', id: `wait:${id}`, invocation, index });
    } else {
      accumulator.push({ invocation, index });
    }
  }
  flush();
  return regions;
}
