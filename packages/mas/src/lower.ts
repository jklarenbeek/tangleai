/**
 * Lowering — the region plan written through `@jarenjs/linq/flow` and
 * proven by the suite compilers.
 *
 * Every acyclic region becomes a `jaren-dag` document authored with the
 * published pen (`defineDag`/`task().checkpoint()`/`edge`), every
 * control region a `jaren-fsm` document (`defineFsm`/`state`/`on`/
 * `effect`), and `planMasWorkflow` compiles each one against inert
 * placeholder handlers to prove semantics before any activation — a
 * placeholder is a compile-only seam and is never exported as a
 * runnable handler. A Jaren compile refusal is adapted into `TMAS1011`
 * retaining the cause's own `code`, `docPath` and message as data.
 *
 * The lowered scope contract: a dag region's input is one object
 * `{ input, nodes }` — the validated workflow input plus every earlier
 * invocation's committed ported output under `nodes[<invocation>]` —
 * and its output is `{ [invocation]: portedOutput }` for every member,
 * exposed through ported edges so Jaren edge order stays the one
 * authoritative aggregation order.
 */

import { compileDag, compileFsm } from '@jarenjs/flow';
import { defineDag, defineFsm, edge, effect, input, on, output, state, task, type AnyNode, type EdgeDeclaration } from '@jarenjs/linq/flow';
import { deepFreeze } from '@jarenjs/core/object';
import flowPackage from '@jarenjs/flow/package.json' with { type: 'json' };
import aiPackage from '@jarenjs/ai/package.json' with { type: 'json' };
import type {} from './jaren-flow.d.ts';

import { masIssue, refuse, type MasValidated } from './errors.ts';
import { masRevisionOf } from './identity.ts';
import { partitionMasWorkflow } from './partition.ts';
import type { ValidatedMasWorkflow } from './validate.ts';
import type { Invocation, MasWorkflow } from './contracts.gen.ts';

export type MasRegionDescriptor =
  | {
    kind: 'dag',
    id: string,
    documentKey: string,
    invocations: string[],
    /** Invocation ids that are graph nodes, executing their subplan in place. */
    nested: Array<{ invocation: string, subgraph: string }>,
  }
  | {
    kind: 'fsm-switch',
    id: string,
    documentKey: string,
    invocation: string,
    mode: 'one-of' | 'multi-select',
    inputPorts: string[],
    outputPort: string,
    branches: Array<{
      id: string,
      when: unknown,
      documentKey: string,
      invocations: string[],
      nested: Array<{ invocation: string, subgraph: string }>,
      result: { node: string, port: string },
    }>,
    default: string | null,
  }
  | {
    kind: 'fsm-loop',
    id: string,
    documentKey: string,
    invocation: string,
    body: string,
    maxIterations: number,
    termination: unknown,
    init: Array<{ port: string, to: string }>,
    feedback: Array<{ from: string, to: string }>,
    result: Array<{ port: string, from: string }>,
  }
  | {
    kind: 'interaction-wait',
    id: string,
    documentKey: string,
    invocation: string,
    prompt: unknown,
    response: unknown,
    expiry: { afterMs: number } | null,
  }
  | {
    kind: 'subgraph',
    id: string,
    invocation: string,
    subgraph: string,
    childExecutableRevision: string,
  };

export interface MasWorkflowPlan {
  workflowVersionId: string;
  registryRevision: string;
  configCatalogRevision: string;
  executableRevision: string;
  regions: MasRegionDescriptor[];
  /** Lowered jaren-dag / jaren-fsm documents by key. */
  documents: Record<string, unknown>;
  /** Child plans for graph invocations and loop bodies, by registry subgraph id. */
  subplans: Record<string, MasWorkflowPlan>;
}

/** JSONPath member access in bracket form, safe for hyphenated names. */
const member = (root: string, ...names: string[]): string =>
  `${root}${names.map((name) => `['${name}']`).join('')}`;

/** Bump the host ABI when lifecycle semantics change. Suite and registry
 * upgrades also change the declared handler identity and executable revision. */
export function masTaskVersionOf(registryRevision: string): string {
  return `tangle-mas/2:flow/${flowPackage.version}:ai/${aiPackage.version}:${registryRevision}`;
}

export interface Feed {
  port: string;
  jarenPort: string;
  source: { kind: 'entry', member: string } | { kind: 'node', node: string, port: string };
  sameRegion: boolean;
}

/** Every inbound feed of one invocation, in aggregation (document) order. */
export function nodeFeeds(workflow: MasWorkflow, invocation: Invocation, regionMembers: Set<string>): Feed[] {
  const feeds: Feed[] = [];
  const perPortCounts = new Map<string, number>();
  for (const port of Object.keys(invocation.input.ports)) {
    perPortCounts.set(port, workflow.messages.filter((edgeDoc) => edgeDoc.to.node === invocation.id && edgeDoc.to.port === port).length);
  }
  for (const entry of workflow.entry) {
    if (entry.to.node !== invocation.id) continue;
    feeds.push({
      port: entry.to.port,
      jarenPort: entry.to.port,
      source: { kind: 'entry', member: entry.port },
      sameRegion: false,
    });
  }
  const seen = new Map<string, number>();
  for (const edgeDoc of workflow.messages) {
    if (edgeDoc.to.node !== invocation.id) continue;
    const count = perPortCounts.get(edgeDoc.to.port) ?? 0;
    const index = seen.get(edgeDoc.to.port) ?? 0;
    seen.set(edgeDoc.to.port, index + 1);
    feeds.push({
      port: edgeDoc.to.port,
      jarenPort: count > 1 ? `${edgeDoc.to.port}~${index}` : edgeDoc.to.port,
      source: { kind: 'node', node: edgeDoc.from.node, port: edgeDoc.from.port },
      sameRegion: regionMembers.has(edgeDoc.from.node),
    });
  }
  return feeds;
}

/** One dag region document, authored through the pen. */
function lowerDagRegion(workflow: MasWorkflow, members: Invocation[], version: string): unknown {
  const memberIds = new Set(members.map((invocation) => invocation.id));
  // Lowered node keys carry a prefix so an invocation named 'scope' or
  // 'expose' can never collide with the region's input/output nodes; the
  // task RUN name stays the bare invocation id the host registry binds.
  const key = (id: string): string => `t:${id}`;
  const nodes: Record<string, AnyNode> = { scope: input() };
  const edges: Array<EdgeDeclaration<string, string>> = [];
  for (const invocation of members) {
    nodes[key(invocation.id)] = task(invocation.id, undefined, { version }).checkpoint();
  }
  for (const invocation of members) {
    for (const feed of nodeFeeds(workflow, invocation, memberIds)) {
      if (feed.source.kind === 'entry') {
        edges.push(edge('scope', key(invocation.id), { port: feed.jarenPort, select: member('$.input', feed.source.member) }));
      } else if (feed.sameRegion) {
        edges.push(edge(key(feed.source.node), key(invocation.id), { port: feed.jarenPort, select: member('$', feed.source.port) }));
      } else {
        edges.push(edge('scope', key(invocation.id), { port: feed.jarenPort, select: member('$.nodes', feed.source.node, feed.source.port) }));
      }
    }
    edges.push(edge(key(invocation.id), 'expose', { port: invocation.id }));
  }
  nodes.expose = output();
  return defineDag<Record<string, AnyNode>, Array<EdgeDeclaration<string, string>>>({ nodes, edges });
}

/** The one-of / multi-select switch control machine. */
function lowerSwitchFsm(invocation: Invocation & { kind: 'switch' }): unknown {
  if (invocation.mode === 'one-of') {
    const runStates = invocation.branches.map((branch) => `run-${branch.id}`);
    const transitions = [
      ...invocation.branches.map((branch) => on('ready', 'select')
        .when({ $eq: ['$.payload.selected', branch.id] })
        .to(`run-${branch.id}`)
        .effects([effect('run-branch', { branch: branch.id })])),
      ...(invocation.default !== null
        ? [on('ready', 'select').to(`run-${invocation.default}`).effects([effect('run-branch', { branch: invocation.default })])]
        : []),
      ...invocation.branches.flatMap((branch) => [
        on(`run-${branch.id}`, 'branch-committed').to('merged'),
        on(`run-${branch.id}`, 'branch-failed').to('failed'),
      ]),
    ];
    return defineFsm({
      initial: 'ready',
      states: ['ready', ...runStates, state('merged', { final: true }), state('failed', { final: true })],
      transitions,
    });
  }
  return defineFsm({
    initial: 'ready',
    states: ['ready', 'running', state('merged', { final: true }), state('failed', { final: true })],
    transitions: [
      on('ready', 'select').to('running').effects([effect('run-branches')]),
      on('running', 'branches-committed').to('merged'),
      on('running', 'branch-failed').to('failed'),
    ],
  });
}

/** The bounded loop control machine: ready → body → evaluate, host-owned cap. */
function lowerLoopFsm(): unknown {
  return defineFsm({
    initial: 'ready',
    states: ['ready', 'body', 'evaluate', state('done', { final: true }), state('failed', { final: true })],
    transitions: [
      on('ready', 'dispatch').to('body').effects([effect('run-body')]),
      on('body', 'committed').to('evaluate'),
      on('body', 'failed').to('failed'),
      on('evaluate', 'again').to('body').effects([effect('run-body')]),
      on('evaluate', 'terminate').to('done'),
      on('evaluate', 'capped').to('failed'),
    ],
  });
}

/** The persisted interaction wait machine. */
function lowerInteractionFsm(): unknown {
  return defineFsm({
    initial: 'ready',
    states: ['ready', 'waiting', state('done', { final: true }), state('failed', { final: true })],
    transitions: [
      on('ready', 'request').to('waiting').effects([effect('await-response')]),
      on('waiting', 'respond').to('done'),
      on('waiting', 'cancel').to('failed'),
      on('waiting', 'expire').to('failed'),
    ],
  });
}

/** Compile-only placeholder registry for a lowered dag document — never exported as runnable. */
function placeholderTasks(document: unknown): Record<string, { run: () => never, version: string }> {
  const tasks: Record<string, { run: () => never, version: string }> = {};
  const nodes = (document as { nodes: Record<string, { kind: string, run?: string, version: string }> }).nodes;
  for (const declaration of Object.values(nodes)) {
    if (declaration.kind === 'task' && declaration.run !== undefined) {
      tasks[declaration.run] = { version: declaration.version, run: () => {
        throw new Error('a placeholder handler is a compile-only seam and can never run');
      } };
    }
  }
  return tasks;
}

export async function planMasWorkflow(validated: ValidatedMasWorkflow): Promise<MasValidated<MasWorkflowPlan>> {
  const { workflow } = validated;
  const taskVersion = masTaskVersionOf(validated.registryRevision);
  const regions = partitionMasWorkflow(workflow);
  const documents: Record<string, unknown> = {};
  const descriptors: MasRegionDescriptor[] = [];
  const subplans: Record<string, MasWorkflowPlan> = {};

  const planSubgraph = async (subgraphId: string): Promise<MasValidated<MasWorkflowPlan>> => {
    if (subplans[subgraphId] !== undefined) return { valid: true, value: subplans[subgraphId] };
    const child = validated.subgraphs.get(subgraphId);
    if (child === undefined) {
      return refuse([masIssue('TMAS1003', '', `subgraph '${subgraphId}' was not validated with this workflow`)]);
    }
    const childPlan = await planMasWorkflow(child);
    if (!childPlan.valid) return childPlan;
    subplans[subgraphId] = childPlan.value;
    return childPlan;
  };

  const nestedOf = async (members: Invocation[]): Promise<MasValidated<Array<{ invocation: string, subgraph: string }>>> => {
    const nested: Array<{ invocation: string, subgraph: string }> = [];
    for (const invocation of members) {
      if (invocation.kind !== 'graph') continue;
      const childPlan = await planSubgraph(invocation.subgraph);
      if (!childPlan.valid) return childPlan;
      nested.push({ invocation: invocation.id, subgraph: invocation.subgraph });
      descriptors.push({
        kind: 'subgraph',
        id: `sub:${invocation.id}`,
        invocation: invocation.id,
        subgraph: invocation.subgraph,
        childExecutableRevision: childPlan.value.executableRevision,
      });
    }
    return { valid: true, value: nested };
  };

  for (const region of regions) {
    if (region.kind === 'dag') {
      const members = region.members.map((entry) => entry.invocation);
      const documentKey = region.id;
      documents[documentKey] = lowerDagRegion(workflow, members, taskVersion);
      const nested = await nestedOf(members);
      if (!nested.valid) return nested;
      descriptors.push({
        kind: 'dag',
        id: region.id,
        documentKey,
        invocations: members.map((invocation) => invocation.id),
        nested: nested.value,
      });
    } else if (region.kind === 'switch') {
      const invocation = region.invocation as Invocation & { kind: 'switch' };
      const documentKey = region.id;
      documents[documentKey] = lowerSwitchFsm(invocation);
      const branches = [];
      for (const [branchIndex, branch] of region.branches.entries()) {
        const members = branch.members.map((entry) => entry.invocation);
        const branchKey = `${region.id}/branch:${branch.id}`;
        documents[branchKey] = lowerDagRegion(workflow, members, taskVersion);
        const nested = await nestedOf(members);
        if (!nested.valid) return nested;
        branches.push({
          id: branch.id,
          when: invocation.branches[branchIndex].when,
          documentKey: branchKey,
          invocations: members.map((memberInvocation) => memberInvocation.id),
          nested: nested.value,
          result: {
            node: invocation.branches[branchIndex].result.node,
            port: invocation.branches[branchIndex].result.port,
          },
        });
      }
      descriptors.push({
        kind: 'fsm-switch',
        id: region.id,
        documentKey,
        invocation: invocation.id,
        mode: invocation.mode,
        inputPorts: Object.keys(invocation.input.ports),
        outputPort: Object.keys(invocation.output.ports)[0],
        branches,
        default: invocation.default,
      });
    } else if (region.kind === 'loop') {
      const invocation = region.invocation as Invocation & { kind: 'loop' };
      const documentKey = region.id;
      documents[documentKey] = lowerLoopFsm();
      const childPlan = await planSubgraph(invocation.body);
      if (!childPlan.valid) return childPlan;
      descriptors.push({
        kind: 'fsm-loop',
        id: region.id,
        documentKey,
        invocation: invocation.id,
        body: invocation.body,
        maxIterations: invocation.maxIterations,
        termination: invocation.termination,
        init: invocation.init.map((mapping) => ({ port: mapping.port, to: mapping.to })),
        feedback: invocation.feedback.map((mapping) => ({ from: mapping.from, to: mapping.to })),
        result: invocation.result.map((mapping) => ({ port: mapping.port, from: mapping.from })),
      });
    } else {
      const invocation = region.invocation as Invocation & { kind: 'interaction' };
      const documentKey = region.id;
      documents[documentKey] = lowerInteractionFsm();
      descriptors.push({
        kind: 'interaction-wait',
        id: region.id,
        documentKey,
        invocation: invocation.id,
        prompt: invocation.prompt.schema,
        response: invocation.response.schema,
        expiry: invocation.expiry === null ? null : { afterMs: invocation.expiry.afterMs },
      });
    }
  }

  // Gate: every emitted document must compile through the suite.
  for (const [key, document] of Object.entries(documents)) {
    try {
      if ((document as { $dag?: string }).$dag !== undefined) {
        compileDag(document, { tasks: placeholderTasks(document) });
      } else {
        compileFsm(document);
      }
    } catch (error) {
      const cause = error as { code?: string, docPath?: string, message?: string };
      return refuse([{
        code: 'TMAS1011',
        path: `/${key}`,
        detail: `the lowered document does not compile: ${cause.code ?? 'unknown'} at ${cause.docPath ?? ''}`,
        cause: {
          code: cause.code ?? 'unknown',
          docPath: cause.docPath ?? '',
          message: cause.message ?? String(error),
        },
      }]);
    }
  }

  const subplanRevisions: Record<string, string> = {};
  for (const [id, plan] of Object.entries(subplans)) {
    subplanRevisions[id] = plan.executableRevision;
  }
  const executableRevision = await masRevisionOf({
    workflowVersionId: validated.versionId,
    taskVersion,
    configCatalogRevision: validated.configCatalogRevision,
    regions: descriptors,
    documents,
    subplans: subplanRevisions,
  });

  return {
    valid: true,
    value: deepFreeze({
      workflowVersionId: validated.versionId,
      registryRevision: validated.registryRevision,
      configCatalogRevision: validated.configCatalogRevision,
      executableRevision,
      regions: descriptors,
      documents,
      subplans,
    }) as MasWorkflowPlan,
  };
}
