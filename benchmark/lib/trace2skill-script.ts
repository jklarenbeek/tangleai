/**
 * The scripted model wire.
 *
 * No provider is constructed anywhere in this instrument, so a "call"
 * is a lookup: a unit descriptor is canonicalised, hashed, and answered
 * from committed data. The key deliberately carries no content digest.
 * Directory identity is bound elsewhere — by the fixture's `s0` hashes
 * and the report's `identity` block — so that a later order can fill a
 * row with a real bundle without renumbering every registered entry.
 *
 * A descriptor with no entry is the interesting case: it is counted as
 * `script-missing` and the unit fails with that stop reason. It never
 * throws, because a crash would hide how much of a run the script
 * actually covers.
 *
 * The wire also answers as a chat client, so the real executor loop runs
 * against it: a registered unit that took three turns takes three turns
 * here, spending two tool rounds before it answers, and a unit registered
 * as budget-stopped never answers at all — the agent's own budget ends it,
 * which is the only honest way to produce a budget stop reason.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { PatchOperation } from '@tangleai/trace2skill';
import type { LabelsDocument, MergeTreeDocument, ScriptDocument, ScriptEntry, ScriptUnit, TaskDocument } from './trace2skill.types.ts';

/** The canonical identity of one scripted unit. */
export function scriptUnitKey(unit: ScriptUnit): Promise<string> {
  return canonicalSha256(unit as unknown as Record<string, unknown>);
}

/** What a lookup produced: an entry, or a counted absence. */
export type ScriptLookup =
  | { found: true, key: string, response: Record<string, unknown> }
  | { found: false, key: string, reason: 'script-missing' | 'key-mismatch' };

export interface ScriptedWire {
  /** Registered entries, by key. */
  readonly size: number;
  lookup(unit: ScriptUnit): Promise<ScriptLookup>;
  /** How many lookups found nothing, over the wire's lifetime. */
  readonly missing: number;
}

/**
 * Build the wire over a script document. An entry whose recorded key is
 * not the canonical digest of its own descriptor is refused at load: a
 * key that does not describe its unit is an identity claim nobody can
 * check.
 */
export async function createScriptedWire(document: ScriptDocument): Promise<ScriptedWire> {
  const byKey = new Map<string, ScriptEntry>();
  for (const entry of document.entries) {
    const key = await scriptUnitKey(entry.unit);
    if (key !== entry.key) throw new Error(`scripted entry ${entry.key} does not describe its own unit (${key})`);
    byKey.set(key, entry);
  }
  let missing = 0;
  return {
    get size() { return byKey.size; },
    get missing() { return missing; },
    async lookup(unit: ScriptUnit): Promise<ScriptLookup> {
      const key = await scriptUnitKey(unit);
      const entry = byKey.get(key);
      if (entry === undefined) {
        missing++;
        return { found: false, key, reason: 'script-missing' };
      }
      return { found: true, key, response: entry.response as Record<string, unknown> };
    },
  };
}

/** One registered response, rendered as the turns an agent loop actually takes. */
export interface ScriptedClientOptions {
  /** Reported usage per call, so the agent and the run account settle the same number. */
  tokensPerTurn: number;
  /** The call a working turn makes while it is not yet answering. */
  toolCall?: { name: string, arguments: string };
  /** The heading a drafted directory is titled with. */
  draftTitle?: string;
  /** Resolves a registered patch id into the edits a role would have authored. */
  patches?: (patchId: string) => AuthoredPatch | null;
}

/** A patch as an analyst writes it: the registered document, in the patch language. */
export interface AuthoredPatch { reasoning: string, operations: unknown[] }

export interface ScriptedChatCompletion {
  message: { role: string, content: string, toolCalls?: Array<{ id: string, name: string, arguments: string }>, reasoning?: string };
  finishReason: string;
  usage: { total_tokens: number };
}

export interface ScriptedChatClient {
  endpoint: { provider: string };
  complete(request: unknown): Promise<ScriptedChatCompletion>;
  /** Calls this client answered, including the one that found nothing. */
  readonly calls: number;
  readonly missing: number;
}

/** The root page a scripted draft returns: headings only, and no task it has never seen. */
export function draftedDirectory(title: string, sections: readonly string[]): string {
  return [
    `# ${title}`,
    '',
    'Answer one question about the files a task names, and reply with the value alone.',
    ...sections.flatMap((section) => ['', `## ${section}`, '', `Follow the ${section.toLowerCase()} rule of this domain.`]),
    '',
  ].join('\n');
}

/** The most recent result of one named tool, as the agent wrote it into the transcript. */
function lastToolResult(request: unknown, name: string): Record<string, unknown> | null {
  const messages = (request as { messages?: Array<Record<string, unknown>> }).messages ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'tool' || message.name !== name) continue;
    try {
      const parsed: unknown = JSON.parse(String(message.content ?? 'null'));
      return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    }
    catch { return null; }
  }
  return null;
}

/** The last request message a role wrote, parsed as the JSON evidence it carries. */
function lastUserPayload(request: unknown): Record<string, unknown> | null {
  const messages = (request as { messages?: Array<Record<string, unknown>> }).messages ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role !== 'user') continue;
    try {
      const parsed: unknown = JSON.parse(String(messages[index].content ?? 'null'));
      return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    }
    catch { return null; }
  }
  return null;
}

/** The diagnosis a scripted repair carries. Registered text only: no answer and no task id. */
function scriptedDiagnosis(cited: boolean): Record<string, unknown> {
  return {
    failingStepIndexes: cited ? [0] : [],
    mismatch: 'the answer did not match the registered one',
    repair: 'the overlay was rewritten under the domain rule this patch records',
    evaluation: 1,
    generalization: 'the same rule decides every task of this convention in the domain',
  };
}

/**
 * A registered analyst decision, rendered as the turns that role actually
 * takes. A success is one structured answer. A repair is the loop the method
 * requires — read the registered answer, rewrite the overlay, run the real
 * evaluator, and only then propose — so the proof the run stores is produced
 * here rather than asserted: the answer travels through the sanctioned tool
 * at run time and never sits in the committed script.
 */
function analysisTurn(
  unit: ScriptUnit,
  response: { outcome?: string, patchId?: string | null, exclusion?: string | null },
  turn: number,
  request: unknown,
  options: ScriptedClientOptions,
): { content: string, tool?: { name: string, arguments: string } } {
  const authored = typeof response.patchId === 'string' ? options.patches?.(response.patchId) ?? null : null;
  // A single call has one turn to answer with, and no sandbox to prove
  // anything in: what it returns is the proposal itself.
  if (unit.condition === 'single-call-error') {
    return { content: JSON.stringify(authored ?? { reasoning: 'the trajectory named no repair this call could state', operations: [] }) };
  }
  if (unit.role === 'success-analyst') {
    return {
      content: JSON.stringify({
        patterns: [{ behavior: 'the domain convention this task follows was applied before answering', evidenceStepIndexes: [0] }],
        patch: response.outcome === 'patch' ? authored : null,
        reasoning: response.outcome === 'patch'
          ? 'the trajectory used a rule the directory does not yet state'
          : 'the directory already says everything this trajectory used',
      }),
    };
  }
  const wanted = response.outcome === 'patch' ? 'patch' : response.exclusion ?? 'exhausted';
  // A proposing program needs a patch to propose; without one the honest
  // rendering is a loop that runs out rather than an invented edit.
  const proposing = authored !== null && (wanted === 'patch' || wanted === 'no-causal-explanation' || wanted === 'evaluator-disagrees');
  if (wanted === 'already-correct') {
    return turn === 1 ? { content: '', tool: { name: 'evaluate', arguments: '{}' } } : { content: '' };
  }
  if (!proposing) return { content: '', tool: { name: 'trace_read', arguments: JSON.stringify({ from: 0, to: 8 }) } };
  if (turn === 1) return { content: '', tool: { name: 'truth_read', arguments: '{}' } };
  if (turn === 2) {
    const answer = String(lastToolResult(request, 'truth_read')?.answer ?? '');
    return { content: '', tool: { name: 'output_edit', arguments: JSON.stringify({ answer: wanted === 'evaluator-disagrees' ? `${answer} (unrepaired)` : answer }) } };
  }
  if (turn === 3) return { content: '', tool: { name: 'evaluate', arguments: '{}' } };
  if (turn === 4) {
    return { content: '', tool: { name: 'propose', arguments: JSON.stringify({ patch: authored, diagnosis: scriptedDiagnosis(wanted !== 'no-causal-explanation') }) } };
  }
  return { content: '' };
}

/** One merge input as the operator reads it out of its own request. */
export interface MergeInputPatch { id: string, operations: PatchOperation[] }

/** The text an operation writes, which is what two proposals of one insight disagree about. */
function operationText(operation: PatchOperation): string {
  return operation.op === 'delete_section' ? '' : (operation.content ?? '');
}

/** The site and the authored group an operation belongs to: one insight, one cluster. */
function operationSite(operation: PatchOperation): string {
  const at = operation.op === 'create_file' ? ''
    : 'from' in operation ? operation.from : operation.anchor;
  return [operation.path, operation.op, at, operation.group].join('\u0000');
}

/**
 * What a merge operator answers for one group: every distinct insight kept
 * once. Proposals that edit the same site under the same authored group are
 * one insight — the fullest statement of it survives, a proposal it already
 * contains is folded into that one, and a proposal that says something else
 * at the same site is discarded rather than stacked beside it. Deterministic
 * by construction, because a scripted wire that answered differently on a
 * second build would make the report unreproducible.
 */
export function mergeAuthoredOutput(inputs: readonly MergeInputPatch[]): {
  reasoning: string,
  operations: PatchOperation[],
  changelog: Array<{ action: 'kept' | 'merged' | 'routed-to-references' | 'discarded', detail: string, sourcePatchIds: string[] }>,
} {
  const clusters = new Map<string, Array<{ id: string, operation: PatchOperation }>>();
  for (const input of inputs) {
    for (const operation of input.operations) {
      const site = operationSite(operation);
      const found = clusters.get(site) ?? [];
      found.push({ id: input.id, operation });
      clusters.set(site, found);
    }
  }
  const operations: PatchOperation[] = [];
  const changelog: Array<{ action: 'kept' | 'merged' | 'routed-to-references' | 'discarded', detail: string, sourcePatchIds: string[] }> = [];
  for (const members of clusters.values()) {
    const best = members.reduce((winner, member) => {
      const left = operationText(member.operation);
      const right = operationText(winner.operation);
      return left.length > right.length || (left.length === right.length && left < right) ? member : winner;
    }, members[0]);
    const winning = operationText(best.operation);
    operations.push(best.operation);
    const folded = members.filter((member) => member !== best && winning.includes(operationText(member.operation)));
    const dropped = members.filter((member) => member !== best && !winning.includes(operationText(member.operation)));
    changelog.push(folded.length === 0
      ? { action: 'kept', detail: `${members.length - dropped.length} proposal(s) state this edit`, sourcePatchIds: [best.id] }
      : {
        action: 'merged',
        detail: `${folded.length + 1} proposal(s) of one insight folded into the fullest statement of it`,
        sourcePatchIds: [best.id, ...folded.map((member) => member.id)],
      });
    for (const member of dropped) {
      changelog.push({
        action: 'discarded',
        detail: 'a second proposal at this site disagreed with the one that was kept',
        sourcePatchIds: [member.id],
      });
    }
  }
  return {
    // Prose only: a count here can collide with a registered answer and the
    // leak boundary would refuse the merge for saying how many it merged.
    reasoning: 'every distinct insight the group supports is kept once, against the frozen directory',
    operations, changelog,
  };
}

/**
 * A chat client backed by one registered unit. It is a lookup with a turn
 * counter, not a provider: no request body reaches a network, and the number
 * of turns a unit takes is the registered number rather than whatever a model
 * would have chosen.
 */
export function createScriptedChatClient(wire: ScriptedWire, unit: ScriptUnit, options: ScriptedClientOptions): ScriptedChatClient {
  const toolCall = options.toolCall ?? { name: 'read_file', arguments: '{}' };
  let calls = 0;
  let missing = 0;
  let turn = 0;
  return {
    endpoint: { provider: 'scripted' },
    get calls() { return calls; },
    get missing() { return missing; },
    async complete(request: unknown): Promise<ScriptedChatCompletion> {
      calls++;
      turn++;
      const found = await wire.lookup(unit);
      if (!found.found) {
        missing++;
        return { message: { role: 'assistant', content: '' }, finishReason: 'script-missing', usage: { total_tokens: 0 } };
      }
      const response = found.response as { kind: string, answer?: string, stopReason?: string, turns?: number, root?: string, sections?: string[] };
      const usage = { total_tokens: options.tokensPerTurn };
      if (response.kind === 'draft') {
        const files = [{ path: response.root ?? 'SKILL.md', content: draftedDirectory(options.draftTitle ?? 'Skill', response.sections ?? []) }];
        return { message: { role: 'assistant', content: JSON.stringify({ files }) }, finishReason: 'stop', usage };
      }
      if (response.kind === 'analysis') {
        const rendered = analysisTurn(unit, response as { outcome?: string, patchId?: string | null, exclusion?: string | null }, turn, request, options);
        if (rendered.tool === undefined) return { message: { role: 'assistant', content: rendered.content }, finishReason: 'stop', usage };
        return {
          message: { role: 'assistant', content: rendered.content, toolCalls: [{ id: `call-${turn}`, name: rendered.tool.name, arguments: rendered.tool.arguments }] },
          finishReason: 'tool_calls',
          usage,
        };
      }
      if (response.kind === 'merge') {
        // The group's own request carries the patches it was given, so the
        // committed script registers the decision and never the corpus.
        const evidence = lastUserPayload(request) as { patches?: MergeInputPatch[] } | null;
        return {
          message: { role: 'assistant', content: JSON.stringify(mergeAuthoredOutput(evidence?.patches ?? [])) },
          finishReason: 'stop', usage,
        };
      }
      if (response.kind !== 'executor') {
        return { message: { role: 'assistant', content: JSON.stringify(response) }, finishReason: 'stop', usage };
      }
      const registered = response.turns ?? 1;
      const answering = response.stopReason !== 'budget' && turn >= registered;
      if (answering) return { message: { role: 'assistant', content: response.answer ?? '' }, finishReason: 'stop', usage };
      // A working turn: the thinking a transcript never keeps, then one call.
      (request as { onReasoning?: (text: string) => void }).onReasoning?.(`turn ${turn}: reading the named file before answering`);
      return {
        message: { role: 'assistant', content: '', toolCalls: [{ id: `call-${turn}`, name: toolCall.name, arguments: toolCall.arguments }] },
        finishReason: 'tool_calls',
        usage,
      };
    },
  };
}

/** The ablation condition whose analyst answers in one call rather than a repair loop. */
const SINGLE_CALL = 'single-call-error';

/** One executor unit descriptor, spelled once so every caller agrees. */
export function executorUnit(
  stage: 'rollout' | 'evaluation',
  mode: ScriptUnit['mode'],
  condition: ScriptUnit['condition'],
  taskId: string,
): ScriptUnit {
  return { role: 'executor', stage, mode, condition, taskId, groupId: null, turn: 1 };
}

/** One analyst unit descriptor. */
export function analystUnit(
  role: 'success-analyst' | 'error-analyst',
  mode: ScriptUnit['mode'],
  condition: ScriptUnit['condition'],
  taskId: string,
): ScriptUnit {
  return { role, stage: 'analysis', mode, condition, taskId, groupId: null, turn: 1 };
}

/** One merge-group unit descriptor. */
export function mergeUnit(mode: ScriptUnit['mode'], groupId: string): ScriptUnit {
  return { role: 'merge', stage: 'merge', mode, condition: null, taskId: null, groupId, turn: 1 };
}

/** The one trajectory-blind draft descriptor creation mode starts from. */
export function draftUnit(): ScriptUnit {
  return { role: 'draft', stage: 'draft', mode: 'creation', condition: null, taskId: null, groupId: null, turn: 1 };
}

/**
 * Every unit a complete run would ask the wire for, in one place, so
 * the generator that writes the script and the census that measures its
 * coverage cannot disagree about what a complete run consists of.
 *
 * The evolve half produces rollouts and therefore analysts; the
 * held-out half produces one evaluation per condition. Merges and the
 * draft are per run, not per task.
 */
export function registeredUnits(
  tasks: readonly TaskDocument[],
  labels: LabelsDocument,
  tree: MergeTreeDocument,
): ScriptUnit[] {
  const evolve = tasks.filter((task) => task.split === 'evolve').map((task) => task.id);
  const test = tasks.filter((task) => task.split === 'test').map((task) => task.id);
  const units: ScriptUnit[] = [];
  for (const [mode, modeLabels] of Object.entries(labels.modes) as Array<[ScriptUnit['mode'], LabelsDocument['modes']['deepening'] | LabelsDocument['modes']['creation']]>) {
    const rollout = modeLabels.rolloutCondition as ScriptUnit['condition'];
    for (const taskId of evolve) units.push(executorUnit('rollout', mode, rollout, taskId));
    for (const condition of Object.keys(modeLabels.conditions)) {
      for (const taskId of test) units.push(executorUnit('evaluation', mode, condition as ScriptUnit['condition'], taskId));
    }
    const conditions = modeLabels.conditions as Record<string, { incorrect: string[] }>;
    const failing = new Set(conditions[modeLabels.rolloutCondition].incorrect);
    for (const taskId of evolve) {
      units.push(analystUnit(failing.has(taskId) ? 'error-analyst' : 'success-analyst', mode, rollout, taskId));
    }
    // The single-call diagnosis sees the same failing trajectories and
    // answers in one turn, so it is the same role under its own condition.
    if (SINGLE_CALL in conditions) {
      for (const taskId of evolve) {
        if (failing.has(taskId)) units.push(analystUnit('error-analyst', mode, SINGLE_CALL, taskId));
      }
    }
  }
  for (const level of tree.levels) for (const group of level.groups) units.push(mergeUnit('deepening', group.id));
  units.push(draftUnit());
  return units;
}
