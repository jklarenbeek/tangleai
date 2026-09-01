/**
 * The layered MAS workflow validator — nine gates, stable codes, exact
 * pointers, values not throws.
 *
 * Gates run in a fixed order and the first gate that finds issues
 * refuses with them (sorted by code then pointer), so a registered
 * negative fixture fails at exactly its registered `{ code, path }`:
 *
 *   1. closed-shape schema validation                  → TMAS1001/1002
 *   2. canonical identity and pinned revisions          → TMAS1002/1009
 *   3. references, ports, aggregation and typed wires   → TMAS1003/1004
 *   4. reachability and acyclicity                      → TMAS1005
 *   5. switch scope, defaults and exhaustiveness        → TMAS1006
 *   6. loop bounds, mappings and termination            → TMAS1007
 *   7. registry/CONFIG/tool/context capability requests → TMAS1009
 *   8. state pull/push scope and mappings               → TMAS1010
 *   9. nested caps and budgets                          → TMAS1008
 *
 * then the pure partition/lower plan compiles every emitted Jaren
 * DAG/FSM document as gate 10, adapting a suite compile refusal into
 * `TMAS1011` while retaining the Jaren cause. Content failure never
 * throws; a workflow cannot activate on a path that says "future node".
 */

import { compileJsonQuery } from '@jarenjs/json/query';

import { masIssue, refuse, type MasIssue, type MasValidated } from './errors.ts';
import { masWorkflowVersionIdOf } from './identity.ts';
import { compileEmbeddedSchema, validateWorkflowShape } from './schema.ts';
import { schemaAccepts } from './compatibility.ts';
import type { MasConfigCatalog, MasRegistrySnapshot } from './registry.ts';
import type {
  AgentNode, GraphNode, Invocation, LoopNode, MasWorkflow, SwitchNode, TaskNode,
} from './contracts.gen.ts';

export interface ValidatedMasWorkflow {
  workflow: MasWorkflow;
  versionId: string;
  registryRevision: string;
  configCatalogRevision: string;
  /** Semantic validations of referenced subgraphs, by registry subgraph id. */
  subgraphs: ReadonlyMap<string, ValidatedMasWorkflow>;
}

interface Context {
  workflow: MasWorkflow;
  snapshot: MasRegistrySnapshot;
  catalog: MasConfigCatalog;
  nodes: Map<string, Invocation>;
  nodeIndex: Map<string, number>;
  /** switch id -> branch member ids */
  branchMembers: Map<string, Set<string>>;
  /** member node id -> owning switch id */
  memberOwner: Map<string, string>;
  issues: MasIssue[];
}

const at = (issues: MasIssue[], code: MasIssue['code'], path: string, detail: string): void => {
  issues.push(masIssue(code, path, detail));
};

// -- pointer helpers over embedded JSON Schemas ------------------------------

/** Resolve a `/a/b` pointer through object schema properties; '' is the schema itself. */
function schemaAt(schema: unknown, pointer: string): unknown | undefined {
  if (pointer === '') return schema;
  let current: unknown = schema;
  for (const segment of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined;
    const properties = (current as { properties?: Record<string, unknown> }).properties;
    if (properties === undefined || properties[segment] === undefined) return undefined;
    current = properties[segment];
  }
  return current;
}

function inputMemberSchema(workflow: MasWorkflow, member: string): unknown | undefined {
  return schemaAt(workflow.input.schema, `/${member}`);
}

function outputMemberSchema(workflow: MasWorkflow, member: string): unknown | undefined {
  return schemaAt(workflow.output.schema, `/${member}`);
}

function portSchema(node: Invocation, side: 'input' | 'output', port: string): unknown | undefined {
  return node[side].ports[port]?.schema;
}

function compilesAsQuery(document: unknown): boolean {
  try {
    compileJsonQuery(document as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

// -- gate 2: identity --------------------------------------------------------

async function gateIdentity(context: Context, child: boolean): Promise<void> {
  const { workflow, snapshot, catalog, issues } = context;
  const recomputed = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
  if (recomputed !== workflow.versionId) {
    at(issues, 'TMAS1002', '/versionId', 'the version does not hash to its semantic payload; a mutated workflow cannot keep a stale version');
  }
  const pin = workflow.registry.revision;
  if (pin === null) {
    if (!child) at(issues, 'TMAS1009', '/registry/revision', 'a top-level workflow must pin its registry snapshot revision; only a subgraph-embedded child inherits');
  } else if (pin !== snapshot.revision) {
    at(issues, 'TMAS1009', '/registry/revision', `the workflow pins registry ${pin.slice(0, 12)}… but the supplied snapshot is ${snapshot.revision.slice(0, 12)}…`);
  }
  const configPin = workflow.config.registryRevision;
  if (configPin === null) {
    if (!child) at(issues, 'TMAS1009', '/config/registryRevision', 'a top-level workflow must pin its CONFIG catalog revision');
  } else if (configPin !== catalog.revision) {
    at(issues, 'TMAS1009', '/config/registryRevision', `the workflow pins CONFIG ${configPin.slice(0, 12)}… but the supplied catalog is ${catalog.revision.slice(0, 12)}…`);
  }
}

// -- gate 3: references, ports, aggregation, wires ---------------------------

function sourcePortSchema(node: Invocation, port: string): unknown | undefined {
  // A switch relays its input ports to its branch members; every other
  // node sends only from declared output ports.
  const output = portSchema(node, 'output', port);
  if (output !== undefined) return output;
  if (node.kind === 'switch') return portSchema(node, 'input', port);
  return undefined;
}

function gateWires(context: Context): void {
  const { workflow, nodes, nodeIndex, issues } = context;

  for (const [index, edge] of workflow.control.entries()) {
    if (!nodes.has(edge.from)) at(issues, 'TMAS1003', `/control/${index}/from`, `'${edge.from}' names no invocation`);
    if (!nodes.has(edge.to)) at(issues, 'TMAS1003', `/control/${index}/to`, `'${edge.to}' names no invocation`);
  }

  interface Feed { kind: 'entry' | 'message', index: number, aggregation?: string, adapter?: string }
  const feeds = new Map<string, Feed[]>();
  const feedKey = (node: string, port: string): string => `${node} ${port}`;

  for (const [index, entry] of workflow.entry.entries()) {
    const memberSchema = inputMemberSchema(workflow, entry.port);
    if (memberSchema === undefined) {
      at(issues, 'TMAS1004', `/entry/${index}/port`, `'${entry.port}' names no workflow input member`);
      continue;
    }
    const target = nodes.get(entry.to.node);
    if (target === undefined) {
      at(issues, 'TMAS1003', `/entry/${index}/to/node`, `'${entry.to.node}' names no invocation`);
      continue;
    }
    const schema = portSchema(target, 'input', entry.to.port);
    if (schema === undefined) {
      at(issues, 'TMAS1004', `/entry/${index}/to/port`, `'${entry.to.node}' declares no input port '${entry.to.port}'`);
      continue;
    }
    if (!schemaAccepts(memberSchema, schema)) {
      at(issues, 'TMAS1004', `/entry/${index}/to`, `the workflow input member '${entry.port}' cannot satisfy the '${entry.to.node}.${entry.to.port}' port schema`);
      continue;
    }
    const list = feeds.get(feedKey(entry.to.node, entry.to.port)) ?? [];
    list.push({ kind: 'entry', index });
    feeds.set(feedKey(entry.to.node, entry.to.port), list);
  }

  for (const [index, exit] of workflow.exit.entries()) {
    const memberSchema = outputMemberSchema(workflow, exit.port);
    if (memberSchema === undefined) {
      at(issues, 'TMAS1004', `/exit/${index}/port`, `'${exit.port}' names no workflow output member`);
      continue;
    }
    const source = nodes.get(exit.from.node);
    if (source === undefined) {
      at(issues, 'TMAS1003', `/exit/${index}/from/node`, `'${exit.from.node}' names no invocation`);
      continue;
    }
    const schema = portSchema(source, 'output', exit.from.port);
    if (schema === undefined) {
      at(issues, 'TMAS1004', `/exit/${index}/from/port`, `'${exit.from.node}' declares no output port '${exit.from.port}'`);
      continue;
    }
    if (!schemaAccepts(schema, memberSchema)) {
      at(issues, 'TMAS1004', `/exit/${index}/from`, `the '${exit.from.node}.${exit.from.port}' output cannot satisfy the workflow output member '${exit.port}'`);
    }
  }

  for (const [index, edge] of workflow.messages.entries()) {
    const source = nodes.get(edge.from.node);
    if (source === undefined) {
      at(issues, 'TMAS1003', `/messages/${index}/from/node`, `'${edge.from.node}' names no invocation`);
      continue;
    }
    const target = nodes.get(edge.to.node);
    if (target === undefined) {
      at(issues, 'TMAS1003', `/messages/${index}/to/node`, `'${edge.to.node}' names no invocation`);
      continue;
    }
    const from = sourcePortSchema(source, edge.from.port);
    if (from === undefined) {
      at(issues, 'TMAS1004', `/messages/${index}/from/port`, `'${edge.from.node}' declares no sendable port '${edge.from.port}'`);
      continue;
    }
    const to = portSchema(target, 'input', edge.to.port);
    if (to === undefined) {
      at(issues, 'TMAS1004', `/messages/${index}/to/port`, `'${edge.to.node}' declares no input port '${edge.to.port}'`);
      continue;
    }
    if (edge.select === null) {
      let compatible: boolean;
      let wanted: unknown = to;
      if (edge.aggregation === 'ordered-list') {
        const items = (to as { items?: unknown })?.items;
        compatible = items !== undefined && schemaAccepts(from, items);
        wanted = items;
      } else if (edge.aggregation === 'named-object') {
        const targetSchema = to as { properties?: Record<string, unknown>, additionalProperties?: unknown };
        const member = targetSchema.properties?.[edge.from.node] ?? targetSchema.additionalProperties;
        compatible = member !== undefined && member !== false && (member === true || schemaAccepts(from, member));
      } else {
        compatible = schemaAccepts(from, to);
      }
      if (!compatible) {
        at(issues, 'TMAS1004', `/messages/${index}/to`, `the '${edge.from.node}.${edge.from.port}' value cannot provably satisfy '${edge.to.node}.${edge.to.port}' under ${edge.aggregation} aggregation${wanted === undefined ? ' (the target schema declares no items)' : ''}`);
        continue;
      }
    } else if (!compilesAsQuery(edge.select)) {
      at(issues, 'TMAS1004', `/messages/${index}/select`, 'the select document does not compile as a Jaren query');
      continue;
    }
    const list = feeds.get(feedKey(edge.to.node, edge.to.port)) ?? [];
    list.push({ kind: 'message', index, aggregation: edge.aggregation, adapter: edge.adapter });
    feeds.set(feedKey(edge.to.node, edge.to.port), list);
  }

  // Aggregation discipline per target port, and no unfed declared port.
  for (const [key, list] of feeds) {
    const messages = list.filter((feed) => feed.kind === 'message');
    const entries = list.filter((feed) => feed.kind === 'entry');
    if (entries.length > 0 && messages.length > 0) {
      at(issues, 'TMAS1004', `/messages/${messages[0].index}/to`, `'${key}' is fed by both a workflow entry and a message edge`);
      continue;
    }
    if (entries.length > 1) {
      at(issues, 'TMAS1004', `/entry/${entries[1].index}/to`, `'${key}' is fed by more than one workflow entry`);
      continue;
    }
    if (messages.length > 1) {
      const aggregations = new Set(messages.map((feed) => feed.aggregation));
      const adapters = new Set(messages.map((feed) => feed.adapter));
      if (aggregations.has('one')) {
        at(issues, 'TMAS1004', `/messages/${messages[1].index}`, `'${key}' aggregates 'one' but has ${messages.length} inbound edges`);
      } else if (aggregations.size > 1) {
        at(issues, 'TMAS1004', `/messages/${messages[1].index}/aggregation`, `'${key}' mixes aggregation modes`);
      } else if (adapters.size > 1) {
        at(issues, 'TMAS1004', `/messages/${messages[1].index}/adapter`, `'${key}' mixes message adapters`);
      }
    }
  }
  for (const [nodeId, node] of nodes) {
    for (const port of Object.keys(node.input.ports)) {
      if (!feeds.has(feedKey(nodeId, port))) {
        at(issues, 'TMAS1004', `/nodes/${nodeIndex.get(nodeId)}/input/ports/${port}`, `'${nodeId}.${port}' is declared but never fed by an entry or message edge`);
      }
    }
  }
}

// -- gate 4: reachability and acyclicity -------------------------------------

function gateGraph(context: Context): void {
  const { workflow, nodes, nodeIndex, issues } = context;
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodes.keys()) adjacency.set(id, new Set());

  const reaches = (from: string, to: string): boolean => {
    if (from === to) return true;
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const next of adjacency.get(current) ?? []) {
        if (next === to) return true;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };

  // Control edges first, then message edges, in document order: the first
  // edge that closes a cycle is the registered pointer.
  const edges: Array<{ from: string, to: string, path: string }> = [
    ...workflow.control.map((edge, index) => ({ from: edge.from, to: edge.to, path: `/control/${index}` })),
    ...workflow.messages.map((edge, index) => ({ from: edge.from.node, to: edge.to.node, path: `/messages/${index}` })),
  ];
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    if (reaches(edge.to, edge.from)) {
      at(issues, 'TMAS1005', edge.path, `this edge closes a cycle outside a declared loop (${edge.from} -> ${edge.to} while ${edge.to} already reaches ${edge.from})`);
      return;
    }
    adjacency.get(edge.from)?.add(edge.to);
  }

  const reached = new Set<string>();
  const queue: string[] = [];
  for (const entry of workflow.entry) {
    if (nodes.has(entry.to.node) && !reached.has(entry.to.node)) {
      reached.add(entry.to.node);
      queue.push(entry.to.node);
    }
  }
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  for (const [id] of nodes) {
    if (!reached.has(id)) {
      at(issues, 'TMAS1005', `/nodes/${nodeIndex.get(id)}`, `'${id}' is unreachable from every workflow entry`);
    }
  }
}

// -- gate 5: switches --------------------------------------------------------

function isLiteralTrue(document: unknown): boolean {
  return document === true;
}

function gateSwitches(context: Context): void {
  const { workflow, nodes, issues } = context;
  for (const [index, node] of workflow.nodes.entries()) {
    if (node.kind !== 'switch') continue;
    const sw = node as SwitchNode;
    const base = `/nodes/${index}`;

    const outputPorts = Object.keys(sw.output.ports);
    if (outputPorts.length !== 1) {
      at(issues, 'TMAS1006', `${base}/output`, 'a switch declares exactly one output port; its branches merge into it');
      continue;
    }
    const outputPort = outputPorts[0];
    const inputPorts = new Set(Object.keys(sw.input.ports));
    if (inputPorts.has(outputPort)) {
      at(issues, 'TMAS1006', `${base}/output`, `the output port '${outputPort}' collides with an input port; relay addressing needs disjoint names`);
    }

    const memberSet = context.branchMembers.get(sw.id) as Set<string>;
    for (const [branchIndex, branch] of sw.branches.entries()) {
      const branchBase = `${base}/branches/${branchIndex}`;
      if (!compilesAsQuery(branch.when)) {
        at(issues, 'TMAS1006', `${branchBase}/when`, 'the branch guard does not compile as a Jaren query');
      }
      for (const [memberIndex, member] of branch.nodes.entries()) {
        if (!nodes.has(member)) {
          at(issues, 'TMAS1003', `${branchBase}/nodes/${memberIndex}`, `'${member}' names no invocation`);
          continue;
        }
        if (member === sw.id) {
          at(issues, 'TMAS1006', `${branchBase}/nodes/${memberIndex}`, 'a switch cannot be a member of its own branch');
          continue;
        }
        const owner = context.memberOwner.get(member);
        if (owner !== undefined && owner !== sw.id) {
          at(issues, 'TMAS1006', `${branchBase}/nodes/${memberIndex}`, `'${member}' already belongs to a branch of '${owner}'`);
        }
      }
      const resultNode = nodes.get(branch.result.node);
      if (resultNode === undefined || !branch.nodes.includes(branch.result.node)) {
        at(issues, 'TMAS1006', `${branchBase}/result/node`, `the branch result must come from one of the branch's own members`);
        continue;
      }
      const resultSchema = portSchema(resultNode, 'output', branch.result.port);
      if (resultSchema === undefined) {
        at(issues, 'TMAS1004', `${branchBase}/result/port`, `'${branch.result.node}' declares no output port '${branch.result.port}'`);
        continue;
      }
      const merged = sw.output.ports[outputPort].schema;
      if (sw.mode === 'one-of') {
        if (!schemaAccepts(resultSchema, merged)) {
          at(issues, 'TMAS1004', `${branchBase}/result`, `the branch result cannot satisfy the switch output port '${outputPort}'`);
        }
      } else {
        const items = (merged as { items?: unknown })?.items;
        if (items === undefined || !schemaAccepts(resultSchema, items)) {
          at(issues, 'TMAS1004', `${branchBase}/result`, `a multi-select switch output is an ordered list; the branch result cannot satisfy its items`);
        }
      }
    }

    // Branch containment: relay edges stay inside the switch's branches, a
    // member receives only from the switch or its own branch, and sends
    // only within its branch (its result crosses through the declared
    // result mapping, never through an edge).
    const branchOf = new Map<string, string>();
    for (const branch of sw.branches) {
      for (const member of branch.nodes) branchOf.set(member, branch.id);
    }
    for (const [edgeIndex, edge] of workflow.messages.entries()) {
      const fromMember = branchOf.get(edge.from.node);
      const toMember = branchOf.get(edge.to.node);
      if (edge.from.node === sw.id && inputPorts.has(edge.from.port)) {
        if (toMember === undefined) {
          at(issues, 'TMAS1006', `/messages/${edgeIndex}/to/node`, `a relay from switch '${sw.id}' may only feed its own branch members`);
        }
        continue;
      }
      if (fromMember !== undefined && (toMember === undefined || toMember !== fromMember)) {
        at(issues, 'TMAS1006', `/messages/${edgeIndex}`, `'${edge.from.node}' is a branch member of '${sw.id}'; its value leaves the branch only through the declared result mapping`);
      }
      if (toMember !== undefined && fromMember === undefined && edge.from.node !== sw.id) {
        at(issues, 'TMAS1006', `/messages/${edgeIndex}`, `'${edge.to.node}' is a branch member of '${sw.id}'; it receives only from its switch or its own branch`);
      }
    }

    if (sw.default !== null) {
      if (!sw.branches.some((branch) => branch.id === sw.default)) {
        at(issues, 'TMAS1006', `${base}/default`, `'${sw.default}' names no declared branch`);
      }
    } else if (!sw.branches.some((branch) => isLiteralTrue(branch.when))) {
      at(issues, 'TMAS1006', `${base}/default`, 'the guards are not provably exhaustive and no default branch is declared; declare a default or a literal-true catch-all branch');
    }
    void memberSet;
  }
}

// -- gate 6: loops -----------------------------------------------------------

function gateLoops(context: Context): void {
  const { workflow, snapshot, issues } = context;
  for (const [index, node] of workflow.nodes.entries()) {
    if (node.kind !== 'loop') continue;
    const loop = node as LoopNode;
    const base = `/nodes/${index}`;
    const body = snapshot.subgraphs.get(loop.body);
    if (body === undefined) {
      at(issues, 'TMAS1003', `${base}/body`, `'${loop.body}' names no registry subgraph`);
      continue;
    }
    if (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1) {
      at(issues, 'TMAS1007', `${base}/maxIterations`, `a loop needs a positive iteration cap; ${loop.maxIterations} cannot bound anything`);
      continue;
    }
    if (!compilesAsQuery(loop.termination)) {
      at(issues, 'TMAS1007', `${base}/termination`, 'the termination document does not compile as a Jaren query');
      continue;
    }
    const inputPorts = new Set(Object.keys(loop.input.ports));
    for (const port of Object.keys(loop.output.ports)) {
      if (inputPorts.has(port)) {
        at(issues, 'TMAS1004', `${base}/output`, `the loop output port '${port}' collides with an input port`);
      }
    }
    for (const [mapIndex, mapping] of loop.init.entries()) {
      const port = loop.input.ports[mapping.port];
      if (port === undefined) {
        at(issues, 'TMAS1004', `${base}/init/${mapIndex}/port`, `'${mapping.port}' names no loop input port`);
        continue;
      }
      const target = schemaAt(body.input.schema, mapping.to);
      if (target === undefined) {
        at(issues, 'TMAS1004', `${base}/init/${mapIndex}/to`, `'${mapping.to}' addresses nothing in the body input schema`);
        continue;
      }
      if (!schemaAccepts(port.schema, target)) {
        at(issues, 'TMAS1004', `${base}/init/${mapIndex}`, 'the loop input cannot satisfy the body input at this mapping');
      }
    }
    for (const [mapIndex, mapping] of loop.feedback.entries()) {
      const from = schemaAt(body.output.schema, mapping.from);
      const to = schemaAt(body.input.schema, mapping.to);
      if (from === undefined) {
        at(issues, 'TMAS1004', `${base}/feedback/${mapIndex}/from`, `'${mapping.from}' addresses nothing in the body output schema`);
        continue;
      }
      if (to === undefined) {
        at(issues, 'TMAS1004', `${base}/feedback/${mapIndex}/to`, `'${mapping.to}' addresses nothing in the body input schema`);
        continue;
      }
      if (!schemaAccepts(from, to)) {
        at(issues, 'TMAS1004', `${base}/feedback/${mapIndex}`, 'the body output cannot feed the next iteration at this mapping');
      }
    }
    for (const [mapIndex, mapping] of loop.result.entries()) {
      const port = loop.output.ports[mapping.port];
      if (port === undefined) {
        at(issues, 'TMAS1004', `${base}/result/${mapIndex}/port`, `'${mapping.port}' names no loop output port`);
        continue;
      }
      const from = schemaAt(body.output.schema, mapping.from);
      if (from === undefined) {
        at(issues, 'TMAS1004', `${base}/result/${mapIndex}/from`, `'${mapping.from}' addresses nothing in the body output schema`);
        continue;
      }
      if (!schemaAccepts(from, port.schema)) {
        at(issues, 'TMAS1004', `${base}/result/${mapIndex}`, 'the body output cannot satisfy the loop output port at this mapping');
      }
    }
  }
}

// -- gate 7: registry, CONFIG, tools, adapters -------------------------------

function gateCapabilities(context: Context): void {
  const { workflow, snapshot, catalog, issues } = context;
  const roles = new Map(snapshot.document.roles.map((role) => [role.id, role]));
  const handlers = new Map(snapshot.document.handlers.map((handler) => [handler.id, handler]));
  const tools = new Set(snapshot.document.tools.map((tool) => tool.id));
  const adapters = new Set(snapshot.document.messageAdapters.map((adapter) => adapter.id));
  const contexts = new Set(snapshot.document.contextAdapters.map((adapter) => adapter.id));
  const hostTools = new Set(catalog.tools);
  const hostContexts = new Set(catalog.contexts);

  if (!catalog.profiles.includes(workflow.config.profile)) {
    at(issues, 'TMAS1009', '/config/profile', `'${workflow.config.profile}' names no profile the CONFIG catalog resolves`);
  }

  for (const [index, node] of workflow.nodes.entries()) {
    const base = `/nodes/${index}`;
    if (node.kind === 'agent') {
      const agent = node as AgentNode;
      const role = roles.get(agent.role);
      if (role === undefined) {
        at(issues, 'TMAS1009', `${base}/role`, `'${agent.role}' names no registry role`);
      } else if (role.instructionsRevision !== agent.instructionsRevision) {
        at(issues, 'TMAS1009', `${base}/instructionsRevision`, `the pinned instructions revision does not match role '${agent.role}'`);
      }
      if (!catalog.profiles.includes(agent.profile)) {
        at(issues, 'TMAS1009', `${base}/profile`, `'${agent.profile}' names no profile the CONFIG catalog resolves`);
      }
      for (const [toolIndex, tool] of agent.tools.entries()) {
        if (!tools.has(tool)) {
          at(issues, 'TMAS1009', `${base}/tools/${toolIndex}`, `'${tool}' names no registry tool`);
        } else if (!hostTools.has(tool)) {
          at(issues, 'TMAS1009', `${base}/tools/${toolIndex}`, `'${tool}' is not in the host allowlist; a workflow cannot grant itself a tool`);
        }
      }
      for (const [contextIndex, adapter] of agent.context.entries()) {
        if (!contexts.has(adapter)) {
          at(issues, 'TMAS1009', `${base}/context/${contextIndex}`, `'${adapter}' names no registry context adapter`);
        } else if (!hostContexts.has(adapter)) {
          at(issues, 'TMAS1009', `${base}/context/${contextIndex}`, `'${adapter}' is not in the host context allowlist`);
        }
      }
      if (!adapters.has(agent.messageAdapter)) {
        at(issues, 'TMAS1009', `${base}/messageAdapter`, `'${agent.messageAdapter}' names no registry message adapter`);
      }
    } else if (node.kind === 'task') {
      const task = node as TaskNode;
      const handler = handlers.get(task.handler);
      if (handler === undefined) {
        at(issues, 'TMAS1009', `${base}/handler`, `'${task.handler}' names no registry handler`);
      } else {
        if (handler.effect !== task.effect) {
          at(issues, 'TMAS1009', `${base}/effect`, `the node declares '${task.effect}' but handler '${task.handler}' is registered '${handler.effect}'`);
        }
        if (task.effect === 'effectful' && handler.idempotency !== 'honored') {
          at(issues, 'TMAS1009', `${base}/handler`, `an effectful node needs a handler that honors an idempotency key; '${task.handler}' does not`);
        }
      }
    }
  }
  for (const [index, edge] of workflow.messages.entries()) {
    if (!adapters.has(edge.adapter)) {
      at(issues, 'TMAS1009', `/messages/${index}/adapter`, `'${edge.adapter}' names no registry message adapter`);
    }
  }
}

// -- gate 8: state -----------------------------------------------------------

function gateState(context: Context): void {
  const { workflow, snapshot, issues } = context;
  const stateSchemaCheck = compileEmbeddedSchema(workflow.state.schema);
  if (stateSchemaCheck === null) {
    at(issues, 'TMAS1010', '/state/schema', 'the state schema does not compile');
    return;
  }
  if (!stateSchemaCheck(workflow.state.init).valid) {
    at(issues, 'TMAS1010', '/state/init', 'the initial state does not validate against the state schema');
  }

  for (const [index, node] of workflow.nodes.entries()) {
    const base = `/nodes/${index}`;
    const inputPorts = new Set(Object.keys(node.input.ports));
    for (const [pullIndex, pull] of node.statePull.entries()) {
      if (schemaAt(workflow.state.schema, pull.member) === undefined) {
        at(issues, 'TMAS1010', `${base}/statePull/${pullIndex}/member`, `'${pull.member}' addresses no declared state member; undeclared state is unaddressable`);
      }
      if (inputPorts.has(pull.as)) {
        at(issues, 'TMAS1010', `${base}/statePull/${pullIndex}/as`, `'${pull.as}' collides with an input port`);
      }
    }
    for (const [pushIndex, push] of node.statePush.entries()) {
      const port = node.output.ports[push.from];
      if (port === undefined) {
        at(issues, 'TMAS1010', `${base}/statePush/${pushIndex}/from`, `'${push.from}' names no output port on '${node.id}'`);
        continue;
      }
      const member = schemaAt(workflow.state.schema, push.member);
      if (member === undefined) {
        at(issues, 'TMAS1010', `${base}/statePush/${pushIndex}/member`, `'${push.member}' addresses no declared state member; only declared members can be pushed`);
        continue;
      }
      if (!schemaAccepts(port.schema, member)) {
        at(issues, 'TMAS1010', `${base}/statePush/${pushIndex}`, 'the pushed output cannot satisfy the state member schema');
      }
    }
    if (node.kind === 'graph') {
      const graph = node as GraphNode;
      const child = snapshot.subgraphs.get(graph.subgraph);
      if (child === undefined) continue; // gate 7 reported the reference
      for (const [pullIndex, pull] of graph.pull.entries()) {
        const parentMember = schemaAt(workflow.state.schema, pull.parent);
        const childMember = schemaAt(child.state.schema, pull.child);
        if (parentMember === undefined) {
          at(issues, 'TMAS1010', `${base}/pull/${pullIndex}/parent`, `'${pull.parent}' addresses no declared parent state member`);
          continue;
        }
        if (childMember === undefined) {
          at(issues, 'TMAS1010', `${base}/pull/${pullIndex}/child`, `'${pull.child}' addresses no declared child state member`);
          continue;
        }
        if (!schemaAccepts(parentMember, childMember)) {
          at(issues, 'TMAS1010', `${base}/pull/${pullIndex}`, 'the pulled parent member cannot satisfy the child state member schema');
        }
      }
      for (const [pushIndex, push] of graph.push.entries()) {
        const childMember = schemaAt(child.state.schema, push.child);
        const parentMember = schemaAt(workflow.state.schema, push.parent);
        if (childMember === undefined) {
          at(issues, 'TMAS1010', `${base}/push/${pushIndex}/child`, `'${push.child}' addresses no declared child state member`);
          continue;
        }
        if (parentMember === undefined) {
          at(issues, 'TMAS1010', `${base}/push/${pushIndex}/parent`, `'${push.parent}' addresses no declared parent state member; a child cannot write what the parent never declared`);
          continue;
        }
        if (!schemaAccepts(childMember, parentMember)) {
          at(issues, 'TMAS1010', `${base}/push/${pushIndex}`, 'the pushed child member cannot satisfy the parent state member schema');
        }
      }
    }
  }
}

// -- gate 9: budgets ---------------------------------------------------------

function gateBudgets(context: Context): void {
  const { workflow, catalog, issues } = context;
  const hostLimits = catalog.limits ?? {};
  for (const [member, cap] of Object.entries(hostLimits)) {
    const declared = (workflow.limits as unknown as Record<string, number>)[member];
    if (declared !== undefined && declared > cap) {
      at(issues, 'TMAS1008', `/limits/${member}`, `the workflow asks for ${declared} ${member} but the host caps ${cap}; a child cap cannot exceed its host`);
    }
  }
  for (const [index, node] of workflow.nodes.entries()) {
    const base = `/nodes/${index}`;
    if (node.limits !== null) {
      for (const [member, value] of Object.entries(node.limits)) {
        const parent = (workflow.limits as unknown as Record<string, number>)[member];
        if (parent !== undefined && (value as number) > parent) {
          at(issues, 'TMAS1008', `${base}/limits/${member}`, `the node asks for ${value} ${member} but the workflow caps ${parent}; a child cap cannot exceed its parent`);
        }
      }
    }
    if (node.kind === 'loop' && Number.isInteger(node.maxIterations) && node.maxIterations >= 1 && node.maxIterations > workflow.limits.iterations) {
      at(issues, 'TMAS1008', `${base}/maxIterations`, `the loop asks for ${node.maxIterations} iterations but the workflow caps ${workflow.limits.iterations}`);
    }
  }
  const outDegree = new Map<string, number>();
  for (const edge of workflow.messages) {
    outDegree.set(edge.from.node, (outDegree.get(edge.from.node) ?? 0) + 1);
  }
  for (const [node, degree] of outDegree) {
    if (degree > workflow.limits.fanOut) {
      const index = context.nodeIndex.get(node);
      at(issues, 'TMAS1008', `/nodes/${index}`, `'${node}' fans out to ${degree} edges but the workflow caps ${workflow.limits.fanOut}`);
    }
  }
}

// -- port schema compilability (part of gate 3 preconditions) ----------------

function gatePortSchemas(context: Context): void {
  const { workflow, issues } = context;
  const carriers: Array<[string, unknown]> = [
    ['/input/schema', workflow.input.schema],
    ['/output/schema', workflow.output.schema],
  ];
  for (const [index, node] of workflow.nodes.entries()) {
    for (const side of ['input', 'output'] as const) {
      for (const [port, decl] of Object.entries(node[side].ports)) {
        carriers.push([`/nodes/${index}/${side}/ports/${port}/schema`, decl.schema]);
      }
    }
    if (node.kind === 'interaction') {
      carriers.push([`/nodes/${index}/prompt/schema`, node.prompt.schema]);
      carriers.push([`/nodes/${index}/response/schema`, node.response.schema]);
    }
  }
  for (const [path, schema] of carriers) {
    if (compileEmbeddedSchema(schema) === null) {
      at(issues, 'TMAS1004', path, 'the embedded JSON Schema does not compile');
    }
  }
}

// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** A subgraph-embedded child inherits registry/CONFIG pins as null. */
  child?: boolean;
}

export async function validateMasWorkflow(
  value: unknown,
  snapshot: MasRegistrySnapshot,
  catalog: MasConfigCatalog,
  options: ValidateOptions = {},
): Promise<MasValidated<ValidatedMasWorkflow>> {
  const shape = validateWorkflowShape(value);
  if (!shape.valid) return shape;
  const workflow = shape.value;

  const context: Context = {
    workflow,
    snapshot,
    catalog,
    nodes: new Map(workflow.nodes.map((node) => [node.id, node])),
    nodeIndex: new Map(workflow.nodes.map((node, index) => [node.id, index])),
    branchMembers: new Map(),
    memberOwner: new Map(),
    issues: [],
  };
  for (const node of workflow.nodes) {
    if (node.kind !== 'switch') continue;
    const members = new Set<string>();
    for (const branch of node.branches) {
      for (const member of branch.nodes) {
        members.add(member);
        if (!context.memberOwner.has(member)) context.memberOwner.set(member, node.id);
      }
    }
    context.branchMembers.set(node.id, members);
  }

  const gates: Array<() => void | Promise<void>> = [
    () => gateIdentity(context, options.child === true),
    () => gatePortSchemas(context),
    () => gateWires(context),
    () => gateGraph(context),
    () => gateSwitches(context),
    () => gateLoops(context),
    () => gateCapabilities(context),
    () => gateState(context),
    () => gateBudgets(context),
  ];
  for (const gate of gates) {
    await gate();
    if (context.issues.length > 0) return refuse(context.issues);
  }

  // Referenced subgraphs validate semantically with the same snapshot and
  // catalog; a child failing is an invalid workflow reference here.
  const subgraphs = new Map<string, ValidatedMasWorkflow>();
  for (const [index, node] of workflow.nodes.entries()) {
    const references: string[] = [];
    if (node.kind === 'graph') references.push(node.subgraph);
    if (node.kind === 'loop') references.push(node.body);
    for (const reference of references) {
      if (subgraphs.has(reference)) continue;
      const child = snapshot.subgraphs.get(reference);
      if (child === undefined) continue; // earlier gates reported it
      const validated = await validateMasWorkflow(child, snapshot, catalog, { child: true });
      if (!validated.valid) {
        const detail = validated.issues.map((issue) => `${issue.code} ${issue.path}`).slice(0, 3).join('; ');
        return refuse([masIssue('TMAS1003', `/nodes/${index}/${node.kind === 'graph' ? 'subgraph' : 'body'}`, `subgraph '${reference}' does not validate: ${detail}`)]);
      }
      subgraphs.set(reference, validated.value);
    }
  }

  return {
    valid: true,
    value: {
      workflow,
      versionId: workflow.versionId,
      registryRevision: snapshot.revision,
      configCatalogRevision: catalog.revision,
      subgraphs,
    },
  };
}
