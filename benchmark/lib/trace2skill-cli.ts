/**
 * The non-interactive driver for one skill-evolution run.
 *
 * It drives the package's own run — `runTrace2Skill` through
 * `executeSkillMode` — and never re-assembles the stages, because a second
 * assembly of a thirteen-stage graph is a second answer to what a run is. Its
 * business is what a terminal can carry: ids, counts, codes and bounded
 * excerpts. A trajectory is addressed, never printed, and a credential is
 * never printed at all — the live path names the variable a key would come
 * from and stops at a plan.
 *
 * Every refusal is a line and an exit status of 1, never a thrown stack.
 * Nothing here writes a committed artifact: the instrument owns the report,
 * this owns the session.
 */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import {
  DEFAULT_EVALUATION_POLICY, activateCandidate, createMemoryTrace2SkillStore, listActivations,
  plannedStageOrder, trace2SkillGraph, trace2SkillPrompt, TRACE2SKILL_PROMPT_ROLES,
  type SkillHead, type SkillPromotionRegistration, type Trace2SkillStore,
} from '@tangleai/trace2skill';
import { parseArgs } from './args.ts';
import { readAiEnv, chatSettingsOf, AI_ENV, type AiEnv } from './ai-env.ts';
import { loadTrace2SkillFixture, ROOT, type LoadedFixture } from './trace2skill-fixture.ts';
import { executeSkillMode, type ModeExecution } from './trace2skill-report.ts';

export const TRACE2SKILL_COMMANDS = Object.freeze(['plan', 'run', 'resume', 'inspect', 'evaluate', 'diff', 'activate']);

const SPEC = {
  flags: ['live'],
  values: ['fixture', 'mode', 'interrupt', 'authorize', 'expected-head', 'actor'],
} as const;

export interface CliHost {
  /** Where a line goes. A test collects them; the entry writes them out. */
  write(line: string): void;
  env?: Record<string, string | undefined>;
}

export interface CliResult { code: number, lines: string[] }

const EXCERPT = 96;
/** A bounded view of stored text. The address is what a reader follows, not this. */
const excerpt = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT)}…`;
};

function usage(): string[] {
  return [
    `usage: trace2skill <${TRACE2SKILL_COMMANDS.join('|')}> [--fixture <dir>] [--mode deepening|creation]`,
    '       [--interrupt <calls>] [--expected-head <versionId>:<revision>] [--actor <name>] [--live [--authorize <plan-id>]]',
  ];
}

type Mode = 'deepening' | 'creation';

function modeOf(values: ReadonlyMap<string, string>): Mode {
  const mode = values.get('mode') ?? 'deepening';
  if (mode !== 'deepening' && mode !== 'creation') throw new Error(`--mode is deepening or creation, not '${mode}'`);
  return mode;
}

/** The frozen live plan, as its one builder returns it. */
interface LivePlanBody {
  id: string;
  lines: string[];
  /** One `[role, revision]` pair per compiled pack a live run would render through. */
  promptVersions: Array<[string, string]>;
  stages: string[];
}

/**
 * The frozen live plan. It names what a run WOULD spend and where a key would
 * be read from; it carries no key, no base URL userinfo and no request, and
 * its id is the canonical hash of that credential-free description.
 */
export async function livePlanOf(env: AiEnv, mode: Mode, fixture: LoadedFixture): Promise<LivePlanBody> {
  const settings = chatSettingsOf(env);
  const stages = plannedStageOrder((await trace2SkillGraph()).plan);
  const plan = {
    instrument: 'trace2skill',
    mode,
    fixtureId: fixture.fixtureId,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    keySource: env.keySource ?? AI_ENV.key,
    maxCalls: env.maxCalls,
    maxConcurrency: env.maxConcurrency,
    promptVersions: TRACE2SKILL_PROMPT_ROLES.map((role): [string, string] => [role, trace2SkillPrompt(role).revision]),
    stages,
  };
  const id = await canonicalSha256(plan as unknown as Record<string, unknown>);
  return {
    id,
    promptVersions: plan.promptVersions,
    stages: plan.stages,
    lines: [
      `live plan ${id}`,
      `  provider ${plan.provider}; model ${String(plan.model)}; base ${String(plan.baseUrl)}`,
      `  key would be read from ${plan.keySource}; ceilings ${plan.maxCalls} calls, ${plan.maxConcurrency} concurrent`,
      `  fixture ${plan.fixtureId.slice(0, 12)}; ${plan.stages.length} stages; ${plan.promptVersions.length} prompt packs`,
    ],
  };
}

/** The stage graph, the split and the registrations — nothing is executed. */
async function planCommand(loaded: LoadedFixture, mode: Mode, lines: string[]): Promise<number> {
  const stages = plannedStageOrder((await trace2SkillGraph()).plan);
  lines.push(`fixture ${loaded.fixtureId}`);
  lines.push(`mode ${mode}; ${stages.length} stages: ${stages.join(' -> ')}`);
  lines.push(`splits: ${loaded.splits.evolve.length} evolve, ${loaded.splits.test.length} held out, disjoint ${loaded.splits.disjoint}`);
  lines.push(`merge: bMerge ${loaded.fixture.merge.bMerge}, lMax ${loaded.fixture.merge.lMax}; registered tree ${loaded.tree.levels.length} level(s)`);
  for (const role of TRACE2SKILL_PROMPT_ROLES) lines.push(`prompt ${role} ${trace2SkillPrompt(role).revision}`);
  lines.push(`legacy packs kept as fixtures: ${loaded.fixture.legacyPacks.join(', ')}`);
  return 0;
}

function summarize(execution: ModeExecution, mode: Mode, lines: string[]): number {
  const result = execution.run;
  lines.push(`run ${result.run.id} (${mode}); starting condition ${mode === 'deepening' ? 'frozen-s0' : 'draft-s0'}`);
  for (const receipt of result.stages) {
    lines.push(`  ${receipt.stage}: ${receipt.executed ? 'ran' : 'idle'} calls ${receipt.calls} written ${receipt.written} reused ${receipt.reused} refused ${receipt.refused}`);
  }
  lines.push(`rollouts ${execution.rollouts.length}; labels success ${execution.labels.success}, failure ${execution.labels.failure}, unanswered ${execution.labels.unanswered}`);
  lines.push(`analyses ${execution.analysts?.units.length ?? 0}; patches ${execution.analysts?.patches.length ?? 0}`);
  lines.push(`merge nodes ${execution.consolidation?.fanOut.nodes.length ?? 0}; applications ${execution.consolidation?.counts.applications ?? 0}`);
  const candidate = execution.consolidation?.candidate ?? null;
  lines.push(candidate === null ? 'candidate none' : `candidate ${candidate.id}`);
  lines.push(candidate === null ? 'directory none' : `directory ${candidate.bundleId}`);
  const verdict = execution.evaluation?.evaluation ?? null;
  lines.push(verdict === null
    ? 'evaluation none'
    : `evaluation ${verdict.id}; meanDelta ${verdict.meanDelta.toFixed(3)}; eligible ${verdict.eligible}`);
  for (const issue of execution.issues) lines.push(`issue ${issue.code} ${issue.path}: ${issue.detail}`);
  return execution.issues.length === 0 ? 0 : 1;
}

/** Every result of the run, by id, with bounded excerpts and no transcript. */
async function inspectCommand(execution: ModeExecution, mode: Mode, lines: string[]): Promise<number> {
  const candidate = execution.consolidation?.candidate ?? null;
  const bundle = execution.snapshot.bundle;
  lines.push(`run ${execution.run.run.id}`);
  lines.push(`starting directory ${bundle.id} condition ${mode === 'deepening' ? 'frozen-s0' : 'draft-s0'} origin ${bundle.origin} mode ${bundle.mode}`);
  for (const rollout of execution.rollouts) {
    lines.push(`rollout ${rollout.id} task ${rollout.taskId} ${rollout.label} steps ${rollout.steps.length} turns ${rollout.spend.calls}`);
    lines.push(`  whole trajectory at rollouts/${rollout.id}; reasoning ${rollout.reasoning.length} turn(s)`);
  }
  for (const unit of execution.analysts?.units ?? []) {
    const result = unit.result;
    lines.push(`analysis ${result === null ? 'none' : result.id} rollout ${unit.rolloutId} role ${unit.role} status ${result?.status ?? 'refused'}`);
    if (result !== null && result.diagnosis !== '') lines.push(`  ${excerpt(result.diagnosis)}`);
  }
  for (const node of execution.consolidation?.fanOut.nodes ?? []) {
    lines.push(`merge ${node.id} level ${node.level} group ${node.groupIndex} inputs ${node.inputPatchIds.length} support ${node.supportCount}`);
  }
  lines.push(candidate === null ? 'candidate none' : `candidate ${candidate.id} directory ${candidate.bundleId} parent ${String(candidate.parentId)}`);
  const verdict = execution.evaluation?.evaluation ?? null;
  lines.push(verdict === null
    ? 'evaluation none'
    : `evaluation ${verdict.id} eligible ${verdict.eligible} clauses ${verdict.issues.map(issue => issue.path).join(',') || 'none'}`);
  const head = await execution.store.head(bundle.scopeKey);
  lines.push(`head ${String(head.versionId)}:${head.revision}`);
  return 0;
}

function diffCommand(execution: ModeExecution, lines: string[]): number {
  const candidate = execution.consolidation?.candidate ?? null;
  if (candidate === null) { lines.push('candidate none'); return 1; }
  const diff = candidate.diffSummary;
  lines.push(`candidate ${candidate.id}`);
  lines.push(`directory ${candidate.bundleId} from ${String(candidate.parentId)}`);
  lines.push(`files added ${diff.filesAdded}; files changed ${diff.filesChanged}; lines +${diff.linesAdded} -${diff.linesRemoved}`);
  for (const [name, check] of [['structural', candidate.structural], ['semantic', candidate.semantic]] as const) {
    lines.push(`check ${name} ${check.valid ? 'valid' : 'refused'}${check.issues.map(issue => ` ${issue.code} ${issue.path}`).join('')}`);
  }
  lines.push(`churn ${candidate.churn}; final patch ${candidate.finalPatchId}`);
  return 0;
}

function evaluateCommand(execution: ModeExecution, lines: string[]): number {
  const verdict = execution.evaluation?.evaluation ?? null;
  if (verdict === null) { lines.push('evaluation none'); return 1; }
  lines.push(`evaluation ${verdict.id}`);
  lines.push(`candidate ${verdict.candidateBundleId} against ${verdict.baselineBundleId}`);
  const answered = verdict.results.filter(result => result.label !== 'unanswered').length;
  lines.push(`tasks ${verdict.results.length}; answered ${answered}; meanDelta ${verdict.meanDelta.toFixed(3)}; costDelta ${verdict.costDelta}`);
  lines.push(`failures ${verdict.failures}; skips ${verdict.skips}; leakage ${verdict.leakage}`);
  lines.push(`policy ${verdict.policyVersion}; eligible ${verdict.eligible}`);
  for (const issue of verdict.issues) lines.push(`clause ${issue.path}: ${issue.detail}`);
  for (const result of verdict.results) {
    if (result.candidateScore < result.baselineScore) lines.push(`regression ${result.taskId} ${result.baselineScore} -> ${result.candidateScore}`);
  }
  return verdict.eligible ? 0 : 1;
}

function headOf(value: string | undefined): SkillHead {
  if (value === undefined) throw new Error('activate needs --expected-head <versionId>:<revision>');
  const cut = value.lastIndexOf(':');
  if (cut <= 0) throw new Error(`--expected-head is <versionId>:<revision>, not '${value}'`);
  const revision = Number(value.slice(cut + 1));
  if (!Number.isInteger(revision) || revision < 0) throw new Error(`--expected-head revision is a non-negative integer, not '${value.slice(cut + 1)}'`);
  const versionId = value.slice(0, cut);
  return { versionId: versionId === 'none' ? null : versionId, revision };
}

async function activateCommand(
  execution: ModeExecution, store: Trace2SkillStore, expected: SkillHead, actor: string, lines: string[],
): Promise<number> {
  const candidate = execution.consolidation?.candidate ?? null;
  const verdict = execution.evaluation?.evaluation ?? null;
  if (candidate === null || verdict === null) { lines.push('candidate none'); return 1; }
  const registration: SkillPromotionRegistration = {
    scopeKey: verdict.scopeKey,
    executorIdentityId: verdict.executorIdentityId,
    policyVersion: verdict.policyVersion,
    testHash: verdict.testHash,
    expectedHead: expected,
  };
  const result = await activateCandidate(store, {
    scopeKey: verdict.scopeKey, candidateId: candidate.id, evaluationId: verdict.id, registration, actor,
  });
  lines.push(`activation ${result.outcome}; head ${String(result.head.versionId)}:${result.head.revision}`);
  for (const issue of result.issues) lines.push(`refused ${issue.code} ${issue.path}: ${issue.detail}`);
  const attempts = await listActivations(store, verdict.scopeKey);
  lines.push(`attempts ${attempts.length}; policy ${DEFAULT_EVALUATION_POLICY.primaryMetric}`);
  return result.outcome === 'activated' ? 0 : 1;
}

/** One invocation. Never throws for a refusal: a refusal is a code and an exit status. */
export async function runTrace2SkillCli(argv: readonly string[], host: CliHost): Promise<CliResult> {
  const lines: string[] = [];
  const emit = (line: string): void => { lines.push(line); host.write(line); };
  const flush = (code: number, produced: string[]): CliResult => {
    for (const line of produced) emit(line);
    return { code, lines };
  };
  let parsed;
  let command: string;
  try {
    const [first, ...rest] = argv;
    if (first === undefined || !TRACE2SKILL_COMMANDS.includes(first)) throw new Error(`unknown command '${String(first)}'`);
    command = first;
    parsed = parseArgs(rest, SPEC);
    if (parsed.rest.length > 0) throw new Error(`unexpected argument '${parsed.rest[0]}'`);
  }
  catch (cause) {
    return flush(1, [`error: ${cause instanceof Error ? cause.message : String(cause)}`, ...usage()]);
  }

  try {
    const mode = modeOf(parsed.values);
    const loaded = await loadTrace2SkillFixture({ root: parsed.values.get('fixture') ?? ROOT });
    for (const issue of loaded.issues) emit(`fixture issue ${issue.code} ${issue.path}: ${issue.detail}`);

    if (parsed.flags.has('live')) {
      const env = readAiEnv(host.env ?? process.env);
      if (!env.live) return flush(1, [`live skipped: ${String(env.reason)}`, 'nothing was spent and no request was made']);
      const plan = await livePlanOf(env, mode, loaded);
      const authorized = parsed.values.get('authorize');
      if (authorized !== plan.id) {
        return flush(1, [
          ...plan.lines,
          authorized === undefined
            ? 'no approval: rerun with --authorize <plan-id> once a live run is separately approved'
            : `--authorize names ${authorized}, which is not this plan`,
          'nothing was spent and no request was made',
        ]);
      }
      return flush(1, [...plan.lines, 'this build has no authorized live tier: nothing was spent and no request was made']);
    }

    if (command === 'plan') {
      const produced: string[] = [];
      return flush(await planCommand(loaded, mode, produced), produced);
    }

    if (command === 'resume') {
      const store = createMemoryTrace2SkillStore();
      const limit = parsed.values.get('interrupt');
      const produced: string[] = [];
      if (limit !== undefined) {
        const calls = Number(limit);
        if (!Number.isInteger(calls) || calls < 1) throw new Error(`--interrupt is a positive integer, not '${limit}'`);
        const meter = { calls: 0 };
        const stopped = await executeSkillMode(loaded, mode, { store, meter, callLimit: calls }).then(() => null, (cause: unknown) => cause);
        if (stopped === null) throw new Error(`the drive finished within ${calls} call(s); nothing was interrupted`);
        // Only the wire's own ceiling is an interruption. Anything else that
        // threw is a failure, and calling it a clean stop would hide it.
        if (meter.calls !== calls) throw stopped;
        produced.push(`interrupted after ${meter.calls} call(s)`);
      }
      const meter = { calls: 0 };
      const resumed = await executeSkillMode(loaded, mode, { store, meter });
      produced.push(`resumed with ${meter.calls} call(s); reused ${resumed.run.counts.reused}; written ${resumed.run.counts.written}`);
      const code = summarize(resumed, mode, produced);
      return flush(code, produced);
    }

    const execution = await executeSkillMode(loaded, mode);
    const produced: string[] = [];
    const code = command === 'run' ? summarize(execution, mode, produced)
      : command === 'inspect' ? await inspectCommand(execution, mode, produced)
        : command === 'diff' ? diffCommand(execution, produced)
          : command === 'evaluate' ? evaluateCommand(execution, produced)
            : await activateCommand(execution, execution.store, headOf(parsed.values.get('expected-head')),
              parsed.values.get('actor') ?? 'cli', produced);
    return flush(code, produced);
  }
  catch (cause) {
    return flush(1, [`error: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
}
