/**
 * The diagnostic rows: the method with one part swapped out.
 *
 * Each ablation removes exactly one thing the method insists on and keeps
 * everything else — the same frozen directory, the same evolve trajectories,
 * the same gate, the same held-out split, the same executor identity and the
 * same scripted wire. What moves is therefore attributable to the part that
 * was removed, and what does not move is published as not moving.
 *
 * A stage that is deliberately replaced is reimplemented here rather than
 * imported: an ablation that called the shipped stage would be measuring the
 * stage it claims to have removed. Everything the ablation is NOT ablating —
 * the patch gate, the merge operator, the guarded application, the held-out
 * pass — is the package's own.
 *
 * Every row is keyless. The wire is the committed script, the vectors come
 * from the hash embedder, and no provider is constructed anywhere.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mulberry32 } from '@jarenjs/core/random';
import { kMeans } from '@tangleai/core/clustering';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createStructuredOutput } from '@tangleai/models/structured';
import { createLedger } from '@tangleai/context';
import { createAgent, createToolbox, createBudgetAccount } from '@tangleai/agents';
import { createSharedBudgetClient } from '@tangleai/mas';
import {
  AUTHORED_PATCH_SCHEMA, MERGE_PROMPT_VERSION, MINIMAL_SKILL_PROFILE, consolidate, createMemoryTrace2SkillStore,
  draftsOf, gateAuthoredPatch, mergePatches, renderRolloutEvidence, renderTrace2SkillPrompt,
  meterClient, runHeldOut, sealAuthoredPatch, trace2SkillPrompt,
  type AnalystResult, type EvolutionRun, type EvolutionTask, type FrozenSkill, type SkillChatClient,
  type SkillCandidate, type SkillPatch, type SkillSnapshot, type Trace2SkillStore, type Trace2SkillTaskAdapter,
  type TaskRollout,
} from '@tangleai/trace2skill';
import { analystUnit, createScriptedChatClient, executorUnit, mergeUnit, type ScriptedWire } from './trace2skill-script.ts';
import { isRefusal, operationsOf, type LoadedFixture } from './trace2skill-fixture.ts';
import type { FixtureAdapter } from './trace2skill-adapter.ts';
import type { AblationEntry, AblationCounter, Condition, FixtureIssue, SkillRef, TaskResult } from './trace2skill.types.ts';

/** The three conditions this module fills, in the order the tables carry them. */
export const ABLATION_CONDITIONS: readonly Condition[] =
  Object.freeze(['retrieval-bank', 'single-call-error', 'sequential-merge']) as readonly Condition[];

/** One executed row, shaped exactly as the report's own executed rows are. */
interface AblationRow { tasks: TaskResult[], calls: number, skill: SkillRef }

/** What the method produced, handed in so an ablation is compared against it rather than re-running it. */
export interface AblationMethod {
  run: EvolutionRun;
  snapshot: SkillSnapshot;
  rollouts: readonly TaskRollout[];
  analyses: readonly AnalystResult[];
  /** The leaf patches the method's analysts produced: the pool every ablation starts from. */
  leaves: readonly SkillPatch[];
  candidate: SkillCandidate | null;
  levels: number;
  groups: number;
  discarded: number;
  /** What the method spent on the two stages the ablations replace. */
  errorAnalystCalls: number;
  mergeCalls: number;
}

export interface AblationDeps {
  loaded: LoadedFixture;
  fixtureAdapter: FixtureAdapter;
  adapter: Trace2SkillTaskAdapter;
  wire: ScriptedWire;
  tasks: readonly EvolutionTask[];
  modelIdentity: string;
  forbidden: readonly string[];
  method: AblationMethod;
  /** The report's own rollout-to-row mapping, so an ablation row and a parity row read the same. */
  toResult(taskId: string, rollout: TaskRollout | null): TaskResult;
  now?: () => number;
}

interface AblationOutcome {
  rows: Map<Condition, AblationRow>;
  entries: AblationEntry[];
  issues: FixtureIssue[];
}

const FIXED_CLOCK = (): number => 0;
const counter = (name: string, value: number): AblationCounter => ({ name, value });
/** The bank's records are addressed by their text, never by when they were written. */
const BANK_CLOCK = '2026-01-01T00:00:00.000Z';

/** The ablation's own run record: the method's, re-addressed so no row of the two collides. */
async function ablationRun(method: AblationMethod, condition: Condition, overrides: Partial<EvolutionRun> = {}): Promise<EvolutionRun> {
  const id = await canonicalSha256({ run: method.run.id, ablation: condition });
  return { ...method.run, ...overrides, id, status: 'running' };
}

/** The method's analyses, re-addressed to the ablation's run so support counts still resolve. */
async function seedAnalyses(store: Trace2SkillStore, run: EvolutionRun, analyses: readonly AnalystResult[]): Promise<FixtureIssue[]> {
  const issues: FixtureIssue[] = [];
  for (const analysis of analyses) {
    const written = await store.putAnalysis({ ...analysis, runId: run.id });
    if (!written.valid) issues.push({ code: written.issues[0].code, path: `ablation/analyses/${analysis.id}`, detail: written.issues[0].detail });
  }
  return issues;
}

/** The one held-out pass an ablation's directory earns its row with. */
async function heldOutRow(
  deps: AblationDeps, run: EvolutionRun, condition: Condition, snapshot: SkillSnapshot | null, store: Trace2SkillStore,
): Promise<{ row: AblationRow | null, issues: FixtureIssue[] }> {
  const account = createBudgetAccount({}, FIXED_CLOCK);
  const held = deps.tasks.filter(task => task.split === 'test');
  const firstInput = new Map(deps.tasks.map(task => [task.id, task.inputs[0]?.path ?? '']));
  const pass = await runHeldOut(run, condition, snapshot, held, {
    store, adapter: deps.adapter, modelIdentity: deps.modelIdentity, now: deps.now ?? FIXED_CLOCK,
    client: (task: EvolutionTask) => createSharedBudgetClient(
      createScriptedChatClient(deps.wire, executorUnit('evaluation', 'deepening', condition, task.id), {
        tokensPerTurn: deps.loaded.labels.tokensPerTurn,
        toolCall: { name: 'read_file', arguments: JSON.stringify({ path: firstInput.get(task.id) ?? '' }) },
      }),
      account),
  });
  if (!pass.valid) {
    return { row: null, issues: pass.issues.map(issue => ({ code: issue.code, path: `ablation/${condition}${issue.path}`, detail: issue.detail })) };
  }
  const skill: SkillRef = snapshot === null ? null : {
    bundleId: snapshot.bundle.id,
    hash: snapshot.bundle.files.find(file => file.path === 'SKILL.md')?.sha256 ?? snapshot.bundle.id,
    mode: 'deepening',
  };
  return {
    row: {
      tasks: pass.value.fanOut.units.map(unit => deps.toResult(unit.taskId, unit.rollout)),
      calls: pass.value.fanOut.counts.calls,
      skill,
    },
    issues: pass.value.fanOut.issues.map(issue => ({ code: issue.code, path: `ablation/${condition}${issue.path}`, detail: issue.detail })),
  };
}

/**
 * One structured call per error trajectory, with no repair sandbox, no
 * evaluator tool and no proof — the only thing removed. The proposal meets
 * the same gate, so what the pool gains or loses is the evaluator's doing.
 */
async function singleCallError(deps: AblationDeps): Promise<{ row: AblationRow | null, entry: AblationEntry, issues: FixtureIssue[] }> {
  const { method } = deps;
  const condition: Condition = 'single-call-error';
  const run = await ablationRun(method, condition);
  const store = createMemoryTrace2SkillStore();
  const issues: FixtureIssue[] = [];
  const written = await store.putRun(run);
  if (!written.valid) issues.push({ code: written.issues[0].code, path: 'ablation/single-call-error/run', detail: written.issues[0].detail });
  await store.putSnapshot(method.snapshot);
  const frozen: FrozenSkill = { bundle: method.snapshot.bundle, files: draftsOf(method.snapshot.files) };
  const artifact = trace2SkillPrompt('error-analyst');
  const account = createBudgetAccount({}, FIXED_CLOCK);
  const documents = new Map(deps.loaded.patches.map(document => [document.id, document]));
  const registered = new Map<string, { outcome?: string, patchId?: string | null }>();
  for (const entry of deps.loaded.script.entries) {
    if (entry.unit.role === 'error-analyst' && entry.unit.condition === condition && entry.unit.taskId !== null) {
      registered.set(entry.unit.taskId, entry.response as { outcome?: string, patchId?: string | null });
    }
  }

  const errors = [...method.rollouts].filter(rollout => rollout.label !== 'success').sort((a, b) => (a.taskId < b.taskId ? -1 : 1));
  const patches: SkillPatch[] = [];
  let calls = 0;
  let tokens = 0;
  let proposed = 0;
  let refusedByGate = 0;
  for (const rollout of errors) {
    const decided = registered.get(rollout.taskId);
    const document = decided?.patchId === undefined || decided.patchId === null ? null : documents.get(decided.patchId) ?? null;
    const unit = analystUnit('error-analyst', 'deepening', condition, rollout.taskId);
    const client = createSharedBudgetClient(
      createScriptedChatClient(deps.wire, unit, {
        tokensPerTurn: deps.loaded.labels.tokensPerTurn,
        patches: (patchId: string) => {
          const found = documents.get(patchId);
          return found === undefined ? null : { reasoning: found.rationale, operations: operationsOf(found) };
        },
      }),
      account) as SkillChatClient;
    // Counted where the call is made, through the package's own meter: a row
    // that published the merge stage's tokens beside every stage's calls would
    // understate what it spent.
    const counted = meterClient(client);
    const gateIssues: Array<{ code: string, path: string, detail: string }> = [];
    const single = createStructuredOutput({
      client: counted.client,
      schema: AUTHORED_PATCH_SCHEMA,
      name: 'authored_patch',
      maxRepairs: 0,
      gate: (value: unknown) => {
        const gated = gateAuthoredPatch(frozen, value as { reasoning: string, operations: [] }, deps.forbidden, MINIMAL_SKILL_PROFILE);
        if (gated.valid) return true;
        gateIssues.push(...gated.issues.map(issue => ({ code: issue.code, path: issue.path, detail: issue.detail })));
        return { valid: false, errors: gated.issues.map(issue => ({ instancePath: issue.path, keyword: issue.code, message: issue.detail })) };
      },
    });
    const rendered = renderTrace2SkillPrompt(artifact, { evidence: renderRolloutEvidence(rollout) });
    if (!rendered.valid) {
      issues.push({ code: rendered.issues[0].code, path: `ablation/single-call-error/${rollout.taskId}`, detail: rendered.issues[0].detail });
      continue;
    }
    const generated = await single.generate([
      { role: 'system', content: rendered.value.system },
      { role: 'user', content: rendered.value.user },
    ]);
    calls += counted.spend().calls;
    tokens += counted.spend().tokens;
    if (document !== null) proposed++;
    if (generated.value === undefined) {
      refusedByGate++;
      continue;
    }
    const sealed = await sealAuthoredPatch(run, rollout, generated.value as { reasoning: string, operations: [] });
    const stored = await store.putPatch(sealed);
    if (!stored.valid) {
      issues.push({ code: stored.issues[0].code, path: `ablation/single-call-error/patches/${sealed.id}`, detail: stored.issues[0].detail });
      continue;
    }
    patches.push(sealed);
  }
  issues.push(...await seedAnalyses(store, run, method.analyses));

  const consolidated = await consolidate(run, patches, {
    store, snapshot: method.snapshot, modelIdentity: deps.modelIdentity, forbidden: deps.forbidden,
    promptVersion: MERGE_PROMPT_VERSION,
    client: (group: { id: string }) => createSharedBudgetClient(
      createScriptedChatClient(deps.wire, mergeUnit('deepening', group.id), { tokensPerTurn: deps.loaded.labels.tokensPerTurn }), account),
  });
  issues.push(...consolidated.issues.map(issue => ({ code: issue.code, path: `ablation/single-call-error${issue.path}`, detail: issue.detail })));
  const held = await heldOutRow(deps, run, condition, consolidated.snapshot, store);
  issues.push(...held.issues);

  // The method proved every patch it kept; this call proved none. The
  // difference is the count of proposals no evaluation ever supported.
  const provenByMethod = method.leaves.length;
  const entry: AblationEntry = {
    condition,
    replaces: 'the evaluator-proven repair loop, by one structured call with no sandbox, no evaluator tool and no proof',
    status: held.row === null ? 'implementation-missing' : 'run',
    candidateId: consolidated.candidate?.id ?? null,
    candidateBundleId: consolidated.candidate?.bundleId ?? null,
    sameDirectoryAsMethod: consolidated.candidate !== null && method.candidate !== null
      && consolidated.candidate.bundleId === method.candidate.bundleId,
    score: null, vsEvolved: null,
    cost: { calls: calls + consolidated.counts.calls, tokens: tokens + consolidated.counts.tokens },
    counters: [
      counter('analyzed', errors.length),
      counter('proposed', proposed),
      counter('refusedByGate', refusedByGate),
      counter('patches', patches.length),
      counter('unprovenPatches', patches.length),
      counter('provenByMethod', provenByMethod),
      // Not `evaluator-disagrees`: no evaluator ran here, which is the point.
      // What is countable is how many of its proposals the proven role never
      // supported with a passing evaluation.
      counter('notProvenByMethod', Math.max(0, proposed - provenByMethod)),
      counter('methodAnalystCalls', method.errorAnalystCalls),
      counter('mergeLevels', consolidated.counts.levels),
      counter('mergeGroups', consolidated.counts.groups),
      counter('withheld', consolidated.counts.discarded),
    ],
  };
  return { row: held.row, entry, issues };
}

/**
 * The same pool folded one patch at a time into a running patch, still
 * against the frozen directory, still compiled and gated. The tree is the
 * only thing removed.
 */
async function sequentialMerge(deps: AblationDeps): Promise<{ row: AblationRow | null, entry: AblationEntry, issues: FixtureIssue[] }> {
  const { method } = deps;
  const condition: Condition = 'sequential-merge';
  const run = await ablationRun(method, condition, { bMerge: 2, lMax: 1 });
  const store = createMemoryTrace2SkillStore();
  const issues: FixtureIssue[] = [];
  await store.putRun(run);
  await store.putSnapshot(method.snapshot);
  const account = createBudgetAccount({}, FIXED_CLOCK);
  const pool: SkillPatch[] = [];
  for (const leaf of method.leaves) {
    const carried: SkillPatch = { ...leaf, runId: run.id };
    const sealed = { ...carried, id: await canonicalSha256({
      runId: carried.runId, baseHash: carried.baseHash, sourceRolloutIds: carried.sourceRolloutIds,
      sourcePatchIds: carried.sourcePatchIds, supportCount: carried.supportCount, reasoning: carried.reasoning,
      operations: carried.operations, changelog: carried.changelog, validation: carried.validation,
    }) };
    const stored = await store.putPatch(sealed);
    if (!stored.valid) issues.push({ code: stored.issues[0].code, path: `ablation/sequential-merge/patches/${sealed.id}`, detail: stored.issues[0].detail });
    else pool.push(sealed);
  }
  issues.push(...await seedAnalyses(store, run, method.analyses));

  const mergeDeps = {
    store, snapshot: method.snapshot, modelIdentity: deps.modelIdentity, forbidden: deps.forbidden,
    promptVersion: MERGE_PROMPT_VERSION,
    client: (group: { id: string }) => createSharedBudgetClient(
      createScriptedChatClient(deps.wire, mergeUnit('deepening', group.id), { tokensPerTurn: deps.loaded.labels.tokensPerTurn }), account),
  };
  const ordered = [...pool].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  let running: SkillPatch | null = ordered[0] ?? null;
  let steps = 0;
  let calls = 0;
  let tokens = 0;
  let withheld = 0;
  let refused = 0;
  for (let index = 1; index < ordered.length - 1; index++) {
    if (running === null) break;
    const folded = await mergePatches(run, [running, ordered[index]], mergeDeps);
    steps++;
    calls += folded.counts.calls;
    tokens += folded.counts.tokens;
    withheld += folded.counts.discarded;
    refused += folded.counts.refused;
    issues.push(...folded.issues.map(issue => ({ code: issue.code, path: `ablation/sequential-merge${issue.path}`, detail: issue.detail })));
    if (folded.final === null) { running = null; break; }
    running = folded.final;
  }
  // The last fold is the one the guarded committer applies, exactly once.
  const last = ordered[ordered.length - 1];
  const consolidated = running === null || last === undefined
    ? null
    : await consolidate(run, ordered.length === 1 ? [last] : [running, last], { ...mergeDeps, leaves: ordered });
  if (consolidated !== null) {
    steps++;
    calls += consolidated.counts.calls;
    tokens += consolidated.counts.tokens;
    withheld += consolidated.counts.discarded;
    refused += consolidated.counts.refused;
    issues.push(...consolidated.issues.map(issue => ({ code: issue.code, path: `ablation/sequential-merge${issue.path}`, detail: issue.detail })));
  }
  const held = consolidated === null
    ? { row: null, issues: [] as FixtureIssue[] }
    : await heldOutRow(deps, run, condition, consolidated.snapshot, store);
  issues.push(...held.issues);

  const entry: AblationEntry = {
    condition,
    replaces: 'the hierarchical merge tree, by folding the pool one patch at a time into a running patch',
    status: held.row === null ? 'implementation-missing' : 'run',
    candidateId: consolidated?.candidate?.id ?? null,
    candidateBundleId: consolidated?.candidate?.bundleId ?? null,
    sameDirectoryAsMethod: consolidated?.candidate != null && method.candidate !== null
      && consolidated.candidate.bundleId === method.candidate.bundleId,
    score: null, vsEvolved: null,
    cost: { calls, tokens },
    counters: [
      counter('pool', ordered.length),
      counter('foldSteps', steps),
      counter('methodGroups', method.groups),
      counter('methodLevels', method.levels),
      counter('withheld', withheld),
      counter('methodWithheld', method.discarded),
      counter('methodMergeCalls', method.mergeCalls),
      counter('refused', refused),
      counter('applications', consolidated?.counts.applications ?? 0),
    ],
  };
  return { row: held.row, entry, issues };
}

/** One bank skill, in the archived design's own artifact shape. */
interface BankSkill { name: string, when: string, instructions: string, tools: string[] }

/**
 * The salvaged cluster-then-retrieve baseline, which is the paper's retrieval
 * memory and not its method: the same patch pool embedded and clustered into
 * small skill records, recalled by similarity to the task, and injected by the
 * agent's own retrieval slot. No directory is preloaded and nothing is merged
 * into one page.
 */
async function retrievalBank(deps: AblationDeps): Promise<{ row: AblationRow | null, entry: AblationEntry, issues: FixtureIssue[] }> {
  const { method, loaded } = deps;
  const condition: Condition = 'retrieval-bank';
  const issues: FixtureIssue[] = [];
  const parameters = loaded.fixture.ablation.parameters;
  const embedder = createHashEmbedder();
  const reasoning = method.leaves.map(patch => patch.reasoning);
  const vectors = (await embedder.embed(reasoning)).map(vector => [...vector]);
  const clustered = kMeans(vectors, parameters.k, { maxIterations: 50, random: mulberry32(loaded.fixture.seed) });
  const groups = new Map<number, SkillPatch[]>();
  clustered.assignments.forEach((group, index) => {
    const members = groups.get(group) ?? [];
    members.push(method.leaves[index]);
    groups.set(group, members);
  });

  // The legacy merger's artifact shape, derived from the cluster it belongs to
  // rather than re-authored: no model call is made to build this bank, and the
  // row's cost therefore covers the executor alone.
  const ledger = createLedger({ embedder, embedOnWrite: true, now: () => BANK_CLOCK });
  const bank: BankSkill[] = [];
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    const members = groups.get(group) as SkillPatch[];
    for (const patch of members.slice(0, parameters.maxSkillsPerCluster)) {
      const targets = [...new Set(patch.operations.map(operation => operation.path))].sort();
      const skill: BankSkill = {
        name: `cluster-${group + 1}-${patch.id.slice(0, 8)}`,
        when: `a task of this domain reaches ${targets.join(', ')}`,
        instructions: patch.reasoning,
        tools: ['read_file'],
      };
      bank.push(skill);
      const added = await ledger.addSkill(skill) as { error?: string };
      if (typeof added.error === 'string') {
        issues.push({ code: 'TT2S1001', path: `ablation/retrieval-bank/${skill.name}`, detail: added.error });
      }
    }
  }

  const account = createBudgetAccount({}, FIXED_CLOCK);
  const held = deps.tasks.filter(task => task.split === 'test');
  const tasks: TaskResult[] = [];
  let calls = 0;
  let retrievedTotal = 0;
  let emptyRetrievals = 0;
  for (const task of [...held].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const prepared = deps.adapter.prepare(task.id);
    if (!prepared.valid) {
      issues.push({ code: prepared.issues[0].code, path: `ablation/retrieval-bank/${task.id}`, detail: prepared.issues[0].detail });
      tasks.push({ taskId: task.id, label: 'failed', score: 0, stopReason: 'refused', turns: 0, tokens: 0 });
      continue;
    }
    const query = { near: prepared.value.prompt, limit: parameters.topK, minScore: parameters.minSimilarity };
    const recalled = await ledger.recallSkills(query) as { skills?: unknown[] };
    const found = Array.isArray(recalled.skills) ? recalled.skills.length : 0;
    retrievedTotal += found;
    if (found === 0) emptyRetrievals++;

    const tools = deps.adapter.executorTools(task.id);
    const toolbox = createToolbox();
    toolbox.add({
      name: 'read_file',
      description: 'Read one UTF-8 file listed in this task. A path outside the task inputs is refused.',
      inputSchema: { type: 'object', required: ['path'], additionalProperties: false, properties: { path: { type: 'string', minLength: 1, maxLength: 512 } } },
      execute: ({ path }: { path: string }) => {
        const outcome = tools.read_file(path);
        return outcome.valid ? { path, content: outcome.value } : { error: outcome.issues[0].detail, code: outcome.issues[0].code };
      },
    });
    const client = createSharedBudgetClient(
      createScriptedChatClient(deps.wire, executorUnit('evaluation', 'deepening', condition, task.id), {
        tokensPerTurn: loaded.labels.tokensPerTurn,
        toolCall: { name: 'read_file', arguments: JSON.stringify({ path: task.inputs[0]?.path ?? '' }) },
      }),
      account) as { complete(request: unknown): Promise<unknown> };
    const agent = createAgent({
      client, toolbox, ledger,
      system: 'Answer one question about the files a task names, and reply with the value alone.',
      maxToolRounds: loaded.fixture.budgets.turns,
      budget: { turns: loaded.fixture.budgets.turns, tokens: loaded.fixture.budgets.tokens, ms: loaded.fixture.budgets.ms },
      now: deps.now ?? FIXED_CLOCK,
      // The suite's published retrieval slot accepts `near` and `minScore` at
      // runtime and types neither; this row is the one place either is used.
      retrieval: { skills: query as unknown as { limit?: number } },
    });
    const result = await agent.send([{ role: 'user', content: prepared.value.prompt }]);
    const spent = agent.spend();
    calls += spent.turns;
    const stopReason = String(result.stopReason);
    const stopped = stopReason.startsWith('budget-') || stopReason === 'tool-limit' || stopReason === 'script-missing';
    const answer = stopped ? '' : String((result.message as { content?: unknown } | null)?.content ?? '').trim();
    const verdict = deps.fixtureAdapter.evaluate(task.id, answer);
    if (isRefusal(verdict)) {
      issues.push({ code: verdict.code, path: `ablation/retrieval-bank/${task.id}`, detail: verdict.error });
      tasks.push({ taskId: task.id, label: 'failed', score: 0, stopReason: 'refused', turns: spent.turns, tokens: spent.tokens });
      continue;
    }
    tasks.push({
      taskId: task.id,
      label: stopped ? 'unanswered' : verdict.label,
      score: stopped ? 0 : verdict.score,
      stopReason: stopReason === 'script-missing' ? 'script-missing' : stopped ? 'budget' : 'complete',
      turns: spent.turns,
      tokens: spent.tokens,
    });
  }

  const entry: AblationEntry = {
    condition,
    replaces: 'the one preloaded directory, by a bank of clustered lesson records recalled by similarity at test time',
    status: tasks.length === 0 ? 'implementation-missing' : 'run',
    candidateId: null,
    candidateBundleId: null,
    sameDirectoryAsMethod: false,
    score: null, vsEvolved: null,
    cost: { calls, tokens: tasks.reduce((total, task) => total + task.tokens, 0) },
    counters: [
      counter('clusters', new Set(clustered.assignments).size),
      counter('iterations', clustered.iterations),
      counter('bankSkills', bank.length),
      counter('k', parameters.k),
      counter('maxSkillsPerCluster', parameters.maxSkillsPerCluster),
      counter('topK', parameters.topK),
      counter('retrieved', retrievedTotal),
      counter('emptyRetrievals', emptyRetrievals),
      counter('bankBuildCalls', 0),
    ],
  };
  return { row: tasks.length === 0 ? null : { tasks, calls, skill: null }, entry, issues };
}

/** Every ablation, in registration order, over one already-executed method run. */
export async function runTrace2SkillAblations(deps: AblationDeps): Promise<AblationOutcome> {
  const rows = new Map<Condition, AblationRow>();
  const entries: AblationEntry[] = [];
  const issues: FixtureIssue[] = [];
  const produced = [
    await retrievalBank(deps),
    await singleCallError(deps),
    await sequentialMerge(deps),
  ];
  for (const outcome of produced) {
    if (outcome.row !== null) rows.set(outcome.entry.condition, outcome.row);
    entries.push(outcome.entry);
    issues.push(...outcome.issues);
  }
  return { rows, entries, issues };
}
