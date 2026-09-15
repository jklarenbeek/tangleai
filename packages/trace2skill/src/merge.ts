/**
 * Hierarchical consolidation of a whole patch population into one patch.
 *
 * The population is ordered by patch id and cut into contiguous groups of at
 * most `bMerge`; every group of a level is merged concurrently against the
 * FROZEN directory and never against a directory some peer has already
 * edited, and the outputs of a level become the inputs of the next until one
 * patch remains. The planner computes the level count by the same division
 * the groups perform, refuses a plan deeper than the run allows and never
 * truncates the pool to fit: a merge that quietly drops trajectories is not a
 * consolidation of them.
 *
 * Group membership comes from the sorted order rather than from whoever
 * finished first, so the topology, the node identities and the conflict
 * decisions are the same whatever the wire's latencies do. Every decision a
 * group makes is a logged line naming the patches it acted on, and a log that
 * names a patch outside its own group is refused: support is a receipt the
 * run computes from what it dispatched, never a number a role reports about
 * itself.
 */
import { mapConcurrent } from '@jarenjs/core/async';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createStructuredOutput } from '@tangleai/models/structured';
import { MasBudgetStop } from '@tangleai/mas';
import { trace2SkillIssue, trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { byPath, idempotencyKeyOf } from './identity.ts';
import { draftsOf } from './bundle.ts';
import { gateAuthoredPatch } from './analysts.ts';
import { MINIMAL_SKILL_PROFILE, type SkillFormatProfile } from './format.ts';
import { MERGE_CHANGELOG_ACTIONS, MERGE_OUTPUT_SCHEMA, changelogActionOf, changelogLine } from './schemas/merge.ts';
import { trace2SkillPrompt } from './artifacts.ts';
import { renderTrace2SkillPrompt } from './prompts.ts';
import type { FrozenSkill } from './patch.ts';
import { meterClient } from './executor.ts';
import type { SkillChatClient } from './executor.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { Trace2SkillStore } from './store.ts';
import type {
  AnalystResult, EvolutionRun, MergeChangelogAction, MergeChangelogEntry, MergeNode, MergeOutput,
  SkillPatch, Spend, Trace2SkillIssue, Trace2SkillPromptArtifact,
} from './contracts.gen.ts';

/** The stage a merge group's idempotency key is scoped to. */
export const MERGE_STAGE = 'merge';
/** The compiled merge pack's revision, which is the prompt version a group's key names. */
export const MERGE_PROMPT_VERSION = trace2SkillPrompt('merge').revision;

/** One group of one level: its members, and the address every unit of the run agrees on. */
export interface MergeGroup {
  id: string;
  level: number;
  groupIndex: number;
  /** Patch ids at the first level; the group ids of the preceding level above it. */
  members: string[];
}

export interface MergeLevel { level: number, groups: MergeGroup[] }

export type MergeTerminal = 'empty' | 'single' | 'hierarchical';

export interface MergePlan {
  bMerge: number;
  lMax: number;
  pool: string[];
  levels: MergeLevel[];
  levelCount: number;
  groupCount: number;
  terminal: MergeTerminal;
  /** The group whose output is the run's one applicable patch, or null at a terminal. */
  finalGroupId: string | null;
  /** The only patch of a single-patch pool, which is final once it compiles. */
  finalPatchId: string | null;
}

/**
 * The tree a pool of patches is consolidated through. Sorted contiguous
 * groups of at most `bMerge`, as many levels as that division needs, and a
 * refusal rather than a truncation when the run does not allow that depth.
 */
export function planMergeTree(patchIds: readonly string[], options: { bMerge: number, lMax: number }): Trace2SkillOutcome<MergePlan> {
  const { bMerge, lMax } = options;
  if (!Number.isInteger(bMerge) || bMerge < 2)
    return trace2SkillRefuse<MergePlan>('TT2S1008', '/bMerge', `a merge group holds at least two patches, not ${bMerge}`);
  if (!Number.isInteger(lMax) || lMax < 1)
    return trace2SkillRefuse<MergePlan>('TT2S1008', '/lMax', `a merge plan allows at least one level, not ${lMax}`);
  const pool = [...patchIds].sort(byPath);
  for (let index = 1; index < pool.length; index++) {
    if (pool[index] === pool[index - 1])
      return trace2SkillRefuse<MergePlan>('TT2S1008', '/pool', `the pool names ${pool[index].slice(0, 12)}… twice`);
  }
  const empty: Omit<MergePlan, 'terminal' | 'finalPatchId'> = {
    bMerge, lMax, pool, levels: [], levelCount: 0, groupCount: 0, finalGroupId: null,
  };
  if (pool.length === 0) return { valid: true, value: { ...empty, terminal: 'empty', finalPatchId: null } };
  if (pool.length === 1) return { valid: true, value: { ...empty, terminal: 'single', finalPatchId: pool[0] } };

  // Counted by the same division the groups perform, so the number a refusal
  // reports is the number of levels this pool would actually take.
  let remaining = pool.length;
  let levelCount = 0;
  while (remaining > 1) { remaining = Math.ceil(remaining / bMerge); levelCount++; }
  if (levelCount > lMax) {
    return trace2SkillRefuse<MergePlan>('TT2S1008', '/levels',
      `${pool.length} patches need ${levelCount} levels at a group size of ${bMerge} and the run allows ${lMax}`);
  }

  const levels: MergeLevel[] = [];
  let members = pool;
  for (let level = 1; level <= levelCount; level++) {
    const groups: MergeGroup[] = [];
    for (let start = 0; start < members.length; start += bMerge) {
      groups.push({ id: `merge-${level}-${groups.length + 1}`, level, groupIndex: groups.length + 1, members: members.slice(start, start + bMerge) });
    }
    levels.push({ level, groups });
    members = groups.map(group => group.id);
  }
  return {
    valid: true,
    value: {
      bMerge, lMax, pool, levels, levelCount,
      groupCount: levels.reduce((total, level) => total + level.groups.length, 0),
      terminal: 'hierarchical', finalGroupId: members[0], finalPatchId: null,
    },
  };
}

/** One group as it is dispatched: the plan's membership, resolved into patches. */
export interface MergeDispatch extends MergeGroup { inputs: SkillPatch[] }

export interface MergeDeps {
  store: Trace2SkillStore;
  /** The run's client, already wrapped by its shared budget account, or one bound per group. */
  client: SkillChatClient | ((group: MergeDispatch) => SkillChatClient);
  /** The frozen directory every group merges against and none of them edits. */
  snapshot: SkillSnapshot;
  /** Task ids, input paths and registered answers reusable guidance may not carry. */
  forbidden?: readonly string[];
  /** What the answer depends on besides the prompt: the resolved model configuration. */
  modelIdentity: string;
  attempt?: number;
  maxRepairs?: number;
  profile?: SkillFormatProfile;
  /** The compiled pack this group renders through; the default is the published one. */
  prompt?: Trace2SkillPromptArtifact;
  promptVersion?: string;
  /** The run's orchestration log; one coarse entry per group. */
  trajectory?: { add(entry: unknown): unknown };
}

export interface MergeUnit {
  groupId: string;
  level: number;
  groupIndex: number;
  inputPatchIds: string[];
  idempotencyKey: string;
  node: MergeNode | null;
  patch: SkillPatch | null;
  /** True when the stored node answered and no call was made. */
  reused: boolean;
  calls: number;
  issues: Trace2SkillIssue[];
}

export interface MergeCounts {
  levels: number;
  groups: number;
  merged: number;
  unique: number;
  duplicates: number;
  /** Proposals a group withheld because a peer of the same insight was kept instead. */
  discarded: number;
  changelog: Record<MergeChangelogAction, number>;
  successSupport: number;
  errorSupport: number;
  refused: number;
  reused: number;
  written: number;
  calls: number;
  tokens: number;
}

export interface MergeFanOut {
  plan: MergePlan;
  terminal: MergeTerminal;
  units: MergeUnit[];
  nodes: MergeNode[];
  /** Every patch this stage produced, in level then group order. */
  patches: SkillPatch[];
  /** The one patch the run may apply, or null where the pool produced none. */
  final: SkillPatch | null;
  counts: MergeCounts;
  issues: Trace2SkillIssue[];
}

const NO_SPEND: Spend = Object.freeze({ calls: 0, tokens: 0, cost: null });

const emptyChangelog = (): Record<MergeChangelogAction, number> =>
  Object.fromEntries(MERGE_CHANGELOG_ACTIONS.map(action => [action, 0])) as Record<MergeChangelogAction, number>;

const emptyCounts = (): MergeCounts => ({
  levels: 0, groups: 0, merged: 0, unique: 0, duplicates: 0, discarded: 0, changelog: emptyChangelog(),
  successSupport: 0, errorSupport: 0, refused: 0, reused: 0, written: 0, calls: 0, tokens: 0,
});

/** How many distinct trajectories of each analyst role stand behind a patch. */
export function supportOf(patch: SkillPatch, roles: ReadonlyMap<string, AnalystResult['role']>): { successSupport: number, errorSupport: number } {
  let successSupport = 0;
  let errorSupport = 0;
  for (const rolloutId of new Set(patch.sourceRolloutIds)) {
    const role = roles.get(rolloutId);
    if (role === 'success') successSupport++;
    else if (role === 'error') errorSupport++;
  }
  return { successSupport, errorSupport };
}

/**
 * The group's evidence: the frozen directory in full and every input patch as
 * it is stored. No partially edited directory and no peer's decision reaches
 * a group — the whole point of merging against `S0` is that every group reads
 * the same starting text.
 */
export function renderMergeEvidence(
  frozen: FrozenSkill,
  inputs: readonly SkillPatch[],
  roles: ReadonlyMap<string, AnalystResult['role']>,
  supportThreshold: number,
): string {
  return JSON.stringify({
    skill: {
      bundleId: frozen.bundle.id,
      files: frozen.files.map(file => ({ path: file.path, content: file.content })),
    },
    supportThreshold,
    patches: inputs.map(patch => ({
      id: patch.id,
      sourceRolloutIds: patch.sourceRolloutIds,
      supportCount: patch.supportCount,
      ...supportOf(patch, roles),
      reasoning: patch.reasoning,
      operations: patch.operations,
    })),
  }, null, 2);
}

/** A decision may only name patches its own group was given. */
function changelogClosure(changelog: readonly MergeChangelogEntry[], inputPatchIds: readonly string[]): Trace2SkillOutcome<null> {
  const known = new Set(inputPatchIds);
  for (const entry of changelog) {
    for (const id of entry.sourcePatchIds) {
      if (!known.has(id)) {
        return trace2SkillRefuse<null>('TT2S1007', '/changelog',
          `the decision names ${id.slice(0, 12)}…, which is not a patch of this group`);
      }
    }
  }
  return { valid: true, value: null };
}

/** Identity, run, frozen base and provenance are receipts the run computes from the group. */
async function sealMerged(run: EvolutionRun, group: MergeGroup, inputs: readonly SkillPatch[], output: MergeOutput): Promise<SkillPatch> {
  const sourceRolloutIds = [...new Set(inputs.flatMap(patch => patch.sourceRolloutIds))].sort(byPath);
  const payload = {
    runId: run.id, baseHash: run.s0Hash, sourceRolloutIds,
    sourcePatchIds: inputs.map(patch => patch.id),
    supportCount: sourceRolloutIds.length,
    reasoning: output.reasoning,
    operations: [...output.operations],
    changelog: output.changelog.map(changelogLine),
    validation: { state: 'compiled' as const, issues: [] },
  };
  return { id: await canonicalSha256(payload), ...payload };
}

/**
 * The one merge fan-out: every group of a level concurrently, ordered by the
 * plan rather than by completion, each addressed by a key over the run, the
 * group and every input that changes its answer so a resumed run reuses
 * exactly the groups it already paid for.
 */
export async function mergePatches(run: EvolutionRun, pool: readonly SkillPatch[], deps: MergeDeps): Promise<MergeFanOut> {
  const attempt = deps.attempt ?? 1;
  const profile = deps.profile ?? MINIMAL_SKILL_PROFILE;
  const artifact = deps.prompt ?? trace2SkillPrompt('merge');
  const promptVersion = deps.promptVersion ?? artifact.revision;
  const frozen: FrozenSkill = { bundle: deps.snapshot.bundle, files: draftsOf(deps.snapshot.files) };
  const forbidden = deps.forbidden ?? [];
  const counts = emptyCounts();
  const issues: Trace2SkillIssue[] = [];
  const ordered = [...pool].sort((left, right) => byPath(left.id, right.id));
  const planned = planMergeTree(ordered.map(patch => patch.id), { bMerge: run.bMerge, lMax: run.lMax });
  if (!planned.valid) {
    return {
      plan: { bMerge: run.bMerge, lMax: run.lMax, pool: ordered.map(patch => patch.id), levels: [], levelCount: 0, groupCount: 0, terminal: 'hierarchical', finalGroupId: null, finalPatchId: null },
      terminal: 'hierarchical', units: [], nodes: [], patches: [], final: null,
      counts: { ...counts, refused: 1 }, issues: [...planned.issues],
    };
  }
  const plan = planned.value;
  counts.levels = plan.levelCount;
  counts.groups = plan.groupCount;

  const analyses = await deps.store.listBy(run.id, 'analyses');
  const roles = new Map<string, AnalystResult['role']>(analyses.map(analysis => [analysis.rolloutId, analysis.role]));
  const byId = new Map(ordered.map(patch => [patch.id, patch]));
  const storedPatches = new Map((await deps.store.listBy(run.id, 'patches')).map(patch => [patch.id, patch]));
  const storedNodes = new Map((await deps.store.listBy(run.id, 'merges')).map(node => [node.idempotencyKey, node]));

  if (plan.terminal !== 'hierarchical') {
    const single = plan.finalPatchId === null ? null : byId.get(plan.finalPatchId) ?? null;
    if (plan.terminal === 'single' && single !== null) {
      // A pool of one has nothing to consolidate; the patch is final once the
      // committer's own compile accepts it against the frozen directory.
      const support = supportOf(single, roles);
      counts.successSupport = support.successSupport;
      counts.errorSupport = support.errorSupport;
    }
    return { plan, terminal: plan.terminal, units: [], nodes: [], patches: [], final: single, counts, issues };
  }

  const outputs = new Map<string, SkillPatch>();
  const units: MergeUnit[] = [];

  const worker = async (group: MergeGroup): Promise<MergeUnit> => {
    const unitIssues: Trace2SkillIssue[] = [];
    const inputs: SkillPatch[] = [];
    for (const member of group.members) {
      const resolved = group.level === 1 ? byId.get(member) : outputs.get(member);
      if (resolved === undefined) {
        unitIssues.push(trace2SkillIssue('TT2S1008', `/merges/${group.id}`, `${member} produced no patch for this group to merge`));
        continue;
      }
      inputs.push(resolved);
    }
    const inputPatchIds = inputs.map(patch => patch.id);
    const key = await idempotencyKeyOf({
      runId: run.id, stage: MERGE_STAGE, unit: group.id, attempt,
      inputHashes: [run.s0Hash, ...inputPatchIds], identityId: deps.modelIdentity, promptVersion,
    });
    const unit: MergeUnit = {
      groupId: group.id, level: group.level, groupIndex: group.groupIndex, inputPatchIds,
      idempotencyKey: key, node: null, patch: null, reused: false, calls: 0, issues: unitIssues,
    };
    if (unitIssues.length > 0 || inputs.length === 0) return unit;

    const replay = storedNodes.get(key);
    if (replay !== undefined) {
      const stored = replay.outputPatchId === null ? null : storedPatches.get(replay.outputPatchId) ?? null;
      deps.trajectory?.add({ kind: 'merge', groupId: group.id, level: group.level, nodeId: replay.id, spend: replay.spend, reused: true });
      return { ...unit, node: replay, patch: stored, reused: true };
    }

    const rendered = renderTrace2SkillPrompt(artifact, { evidence: renderMergeEvidence(frozen, inputs, roles, run.supportThreshold) });
    if (!rendered.valid) {
      unitIssues.push(...rendered.issues);
      return unit;
    }
    const wire = meterClient(typeof deps.client === 'function' ? deps.client({ ...group, inputs }) : deps.client);
    const gateIssues: Trace2SkillIssue[] = [];
    const operator = createStructuredOutput({
      client: wire.client,
      schema: MERGE_OUTPUT_SCHEMA,
      name: 'merge_output',
      maxRepairs: deps.maxRepairs ?? 1,
      // Synchronous by construction: the same compiler, format validator and
      // leak check every analyst patch met, plus the provenance closure a
      // merged patch alone can break.
      gate: (value: unknown) => {
        const output = value as MergeOutput;
        const gated = gateAuthoredPatch(frozen, { reasoning: output.reasoning, operations: output.operations }, forbidden, profile);
        const closure = gated.valid ? changelogClosure(output.changelog, inputPatchIds) : gated;
        if (closure.valid) return true;
        gateIssues.push(...closure.issues);
        return { valid: false, errors: closure.issues.map(issue => ({ instancePath: issue.path, keyword: issue.code, message: issue.detail })) };
      },
    });

    let generated;
    try {
      generated = await operator.generate([
        { role: 'system', content: rendered.value.system },
        { role: 'user', content: rendered.value.user },
      ]);
    }
    catch (cause) {
      if (!(cause instanceof MasBudgetStop)) throw cause;
      const spent = wire.spend();
      unit.calls = spent.calls;
      unitIssues.push(trace2SkillIssue('TT2S1009', `/merges/${group.id}`, `the run budget stopped this group (${cause.reason})`, cause));
      deps.trajectory?.add({ kind: 'merge', groupId: group.id, level: group.level, nodeId: null, spend: spent, reused: false });
      return unit;
    }
    const spend = wire.spend();
    unit.calls = spend.calls;
    if (generated.value === undefined) {
      unitIssues.push(gateIssues.length > 0
        ? gateIssues[gateIssues.length - 1]
        : trace2SkillIssue('TT2S1008', `/merges/${group.id}`,
          `${generated.attempts} attempt(s) produced no patch this group could store`));
      return unit;
    }
    const output = generated.value as MergeOutput;
    const merged = await sealMerged(run, group, inputs, output);
    const written = await deps.store.putPatch(merged);
    if (!written.valid) {
      unitIssues.push(trace2SkillIssue('TT2S1002', `/patches/${merged.id}`, 'the merged patch met an immutable address holding other bytes', written.issues[0]));
      return unit;
    }
    const support = supportOf(merged, roles);
    const inputOperations = inputs.reduce((total, patch) => total + patch.operations.length, 0);
    const node: MergeNode = {
      id: key, runId: run.id, level: group.level, groupIndex: group.groupIndex,
      inputPatchIds, outputPatchId: merged.id, baseHash: run.s0Hash, supportCount: merged.supportCount,
      report: {
        unique: output.operations.length,
        duplicates: Math.max(0, inputOperations - output.operations.length),
        withheld: output.changelog.filter(entry => entry.action === 'discarded').length,
        successSupport: support.successSupport, errorSupport: support.errorSupport,
        issues: [...gateIssues],
      },
      spend, idempotencyKey: key,
    };
    const stored = await deps.store.putMerge(node);
    if (!stored.valid) {
      unitIssues.push(trace2SkillIssue('TT2S1012', `/merges/${key}`, 'a second node was written for one idempotency key', stored.issues[0]));
      return unit;
    }
    deps.trajectory?.add({ kind: 'merge', groupId: group.id, level: group.level, nodeId: node.id, spend, reused: false });
    return { ...unit, node: stored.value, patch: merged };
  };

  for (const level of plan.levels) {
    const done = await mapConcurrent(level.groups, run.concurrency, worker);
    for (const [index, unit] of done.entries()) {
      units.push(unit);
      if (unit.patch !== null) outputs.set(level.groups[index].id, unit.patch);
    }
  }

  const nodes: MergeNode[] = [];
  const patches: SkillPatch[] = [];
  for (const unit of units) {
    counts.calls += unit.calls;
    issues.push(...unit.issues);
    if (unit.node === null) { counts.refused++; continue; }
    nodes.push(unit.node);
    if (unit.patch !== null) patches.push(unit.patch);
    if (unit.reused) counts.reused++; else counts.written++;
    counts.merged++;
    counts.tokens += unit.node.spend.tokens;
    counts.unique += unit.node.report.unique;
    counts.duplicates += unit.node.report.duplicates;
    counts.discarded += unit.node.report.withheld;
    for (const line of unit.patch?.changelog ?? []) {
      const action = changelogActionOf(line);
      if (action !== null) counts.changelog[action]++;
    }
  }
  const final = plan.finalGroupId === null ? null : outputs.get(plan.finalGroupId) ?? null;
  if (final !== null) {
    const support = supportOf(final, roles);
    counts.successSupport = support.successSupport;
    counts.errorSupport = support.errorSupport;
  }
  return { plan, terminal: plan.terminal, units, nodes, patches, final, counts, issues };
}
