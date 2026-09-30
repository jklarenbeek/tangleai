/** A registered, keyless selection comparison over the durable experiment host. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mulberry32, shuffle } from '@jarenjs/core/random';
import { compileJsonQuery } from '@jarenjs/json/query';
import type { MemoryUnit } from '@tangleai/core';
import { createLedger } from '@tangleai/context';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { compileSurfacePolicy, createPatchRefiner, createModelProposer,
  selectExperiment, EVOLVE_SELECTION_ARMS, EVOLVE_SELECTION_DEFAULT,
  type EvolveIssue, type SelectionArm as Arm, type SelectionCandidate, type SelectionContext } from '@tangleai/evolve';
import { loadEvolveFixture } from './evolve-fixture.ts';
import { withExperimentHost, runExperiment, FIXTURE_EPOCH } from './evolve-host.ts';
import { evolveSource, patchCost } from './evolve.ts';
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import { analyticEnvelope } from './report-envelope.ts';
import schema from '../schemas/evolve-selection.schema.json' with { type: 'json' };
import runIdentitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type { EvolveSelection, SelectionAttempt, SelectionArm, SelectionRound } from './evolve-selection.types.ts';

export const SELECTION_REPORT_PATH = 'benchmark/results/evolve-selection.json';
export const SELECTION_DOCUMENT_PATH = 'docs/EVOLVE_SELECTION.md';
export const ABLATION_PATH = 'benchmark/fixtures/evolve/ablation.json';
const validate = createReportValidator(schema, [runIdentitySchema]);
const verdict = compileJsonQuery(schema['x-verdict-query']);
export type AttemptEvidence = Omit<SelectionAttempt, 'attempt' | 'proposalId' | 'strategyId'>;

/** The same selector loop accepts measured execution or a test's injected runner. */
export async function runSelectionRound(options: Omit<SelectionContext, 'attempted'> & {
  attempts: number;
  execute(candidate: SelectionCandidate, attempt: number): Promise<AttemptEvidence>;
}): Promise<SelectionArm> {
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > options.pool.length) {
    throw new RangeError('An attempt limit must fit its registered pool.');
  }
  const attempted = new Set<string>();
  const rows: SelectionAttempt[] = [];
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const selected = await selectExperiment({ ...options, attempted });
    if (!selected.ok || selected.value === null) throw new Error('Selection refused: ' + JSON.stringify(selected));
    const one = selected.value;
    attempted.add(one.id);
    rows.push({ attempt, proposalId: one.id, strategyId: one.strategyId, ...await options.execute(one, attempt) });
  }
  const decision = (name: string) => rows.filter(row => row.actual.decision === name).length;
  const reason = (name: string) => rows.filter(row => row.actual.reason === name).length;
  const sum = (key: 'processRuns' | 'worktreesCreated' | 'patchBytes' | 'modelCalls' | 'modelTokens') => rows.reduce((n, row) => n + row[key], 0);
  const kept = decision('kept');
  return {
    arm: options.arm, rows, kept, attempts: rows.length, hitRate: kept / rows.length,
    attemptsToFirstKeep: rows.find(row => row.actual.decision === 'kept')?.attempt ?? null,
    red: reason('red'), ambiguous: reason('ambiguous'),
    goalpostRefusals: rows.filter(row => row.actual.reason === 'goalpost' && row.actual.code === 'TEVO1004').length,
    shapeRefusals: rows.filter(row => row.actual.code === 'TEVO1001').length,
    escapeRefusals: reason('escape'), overBudget: reason('over-budget'), uncertain: decision('uncertain'),
    abandoned: decision('abandoned'), refused: decision('refused'),
    processRuns: sum('processRuns'), worktreesCreated: sum('worktreesCreated'), patchBytes: sum('patchBytes'),
    modelCalls: sum('modelCalls'), modelTokens: sum('modelTokens'),
  };
}

/** Hash embeddings and actual ledger recall; no outcome confidence is consulted. */
export async function recallStrategyScores(
  strategies: Array<{ id: string, name: string, when: string, instructions: string }>, near: string,
): Promise<ReadonlyMap<string, number>> {
  const ledger = createLedger({ embedder: createHashEmbedder({ dims: 128 }), now: () => FIXTURE_EPOCH });
  for (const strategy of strategies) {
    const skill = await ledger.addSkill({ id: strategy.id, name: strategy.name, when: strategy.when,
      instructions: strategy.instructions, tools: [], at: FIXTURE_EPOCH });
    if ('error' in skill) throw new Error('Strategy registration refused: ' + skill.error);
  }
  const swept = await ledger.embedMissing();
  if (swept.error || swept.remaining !== 0) throw new Error('Strategy embeddings incomplete: ' + JSON.stringify(swept));
  const recalled = await ledger.recallSkills({ near, limit: strategies.length, minScore: -1 });
  if ('error' in recalled || recalled.skills.length !== strategies.length) throw new Error('Strategy recall incomplete.');
  return new Map(recalled.skills.map((skill, index) => [skill.id, recalled.scores[index]]));
}

export async function loadSelectionRegistration(root = process.cwd()) {
  const registration = JSON.parse(await readFile(join(root, ABLATION_PATH), 'utf8')) as {
    registration: string, rounds: number, attempts: number, seed: number, fixtureRevision: string, baseRevision: string,
    arms: Arm[], strategyOrder: string[], tieBreak: string, near: string,
    model: { identity: string, turns: number, tokens: number, ms: number, maxRepairs: number }, permutations: string[][],
    modelReplies: Array<{ round: number, attempt: number, proposalId: string, path: string, revision: string, malformed: boolean, expect: SelectionAttempt['actual'] }>,
  };
  const fixture = await loadEvolveFixture(root);
  if (registration.registration !== 'evolve-selection/v1' || registration.rounds !== 3 || registration.attempts !== 6
    || registration.seed !== 24071 || registration.model.turns !== 6 || registration.model.tokens !== 512
    || registration.model.ms !== 600000 || registration.model.maxRepairs !== 0
    || registration.permutations.length !== 3 || registration.modelReplies.length !== 18
    || JSON.stringify(registration.arms) !== JSON.stringify(EVOLVE_SELECTION_ARMS)
    || JSON.stringify(registration.strategyOrder) !== JSON.stringify(fixture.strategies.map(s => s.id))
    || registration.fixtureRevision !== fixture.manifestRevision || registration.baseRevision !== fixture.manifest.fixture.baseRevision) {
    throw new Error('The selection registration does not match its fixed experiment contract.');
  }
  const random = mulberry32(registration.seed);
  const ids = fixture.proposals.map(p => p.document.id);
  for (const pool of registration.permutations) {
    if (JSON.stringify(pool) !== JSON.stringify(shuffle(random, [...ids]))) throw new Error('Selection permutation changed.');
  }
  const replies = new Map<string, { message: { role: string, content: string }, usage: { total_tokens: number } }>();
  for (const one of registration.modelReplies) {
    const key = one.round + '-' + one.attempt;
    if (replies.has(key) || one.path !== `benchmark/fixtures/evolve/model-replies/${key}.json`
      || one.proposalId !== registration.permutations[one.round - 1]?.[one.attempt - 1]) throw new Error('Reply address mismatch.');
    const reply = JSON.parse(await readFile(join(root, one.path), 'utf8'));
    if (await canonicalSha256(reply) !== one.revision) throw new Error('Registered model reply changed: ' + key);
    replies.set(key, reply);
  }
  return { registration, fixture, replies };
}

export async function validateSelectionReport(report: unknown): Promise<void> {
  const checked = validate(report);
  if (!checked.valid) throw new Error('Selection report invalid: ' + describeErrors(checked).join('\n'));
  const { reportId, ...content } = report as EvolveSelection;
  if (await canonicalSha256(content) !== reportId) throw new Error('Selection report identity mismatch.');
}

export async function buildSelectionReport(root = process.cwd()): Promise<EvolveSelection> {
  const { registration, fixture, replies } = await loadSelectionRegistration(root);
  const baseFiles: Record<string, string> = {};
  for (const file of fixture.manifest.files) baseFiles[file.path] = await readFile(join(root, fixture.manifest.fixture.repo, file.path), 'utf8');
  const rounds: SelectionRound[] = [];
  const carried = new Map<string, MemoryUnit>();
  let operatorWorktreeChanged = false, protectedRefWrites = 0;
  for (let round = 1; round <= registration.rounds; round++) {
    const arms: SelectionArm[] = [];
    for (const arm of registration.arms) {
      arms.push(await withExperimentHost(root, fixture, async host => {
        const beforeRefs = await host.protectedRefs();
        const beforeTree = await host.host.trackedDigest(host.repositoryRoot);
        if (!beforeTree.ok) throw new Error('Cannot seal operator worktree.');
        if (arm === 'outcome-ranked') for (const value of carried.values()) if (value !== undefined) await host.outcomeStore.memories.put(value);
        const budget = createBudgetAccount(registration.model, () => 0);
        const policy = compileSurfacePolicy({
          immutablePaths: [...fixture.manifest.policy.immutable.paths, ...fixture.manifest.policy.immutable.prefixes],
          generated: fixture.manifest.policy.immutable.generated.map(one => one.path), budgets: host.budgets,
        });
        const refiner = createPatchRefiner({ policy, budgets: host.budgets });
        let activeReply: ReturnType<typeof replies.get>, calls = 0;
        const proposer = createModelProposer({
          client: { endpoint: { provider: 'openai' }, complete: async () => {
            if (activeReply === undefined) throw new Error('Unregistered model attempt.');
            calls++;
            return activeReply;
          } }, budget, tier: 'scripted', prepare: proposal => refiner.prepare(baseFiles, proposal),
        });
        const recalled = arm === 'recall' ? await recallStrategyScores(fixture.strategies, registration.near) : new Map<string, number>();
        const measured = await runSelectionRound({
          arm, attempts: registration.attempts, strategyOrder: registration.strategyOrder,
          pool: registration.permutations[round - 1].map(id => {
            const proposal = fixture.proposals.find(p => p.document.id === id)!.document;
            return { id, strategyId: proposal.strategyId };
          }),
          recall: async () => recalled,
          confidence: async id => {
            if (arm !== 'outcome-ranked') throw new Error('Confidence leaked into another arm.');
            const unit = await host.outcomeStore.memories.get('evolve-strategy:' + id);
            if (unit === undefined || unit.confidence === undefined) throw new Error('Missing strategy carrier.');
            return unit.confidence;
          },
          execute: async (candidate, attempt) => {
            const index = fixture.proposals.findIndex(p => p.document.id === candidate.id);
            let document = fixture.proposals[index].document;
            let expected = fixture.manifest.proposals[index].expect as SelectionAttempt['actual'];
            let refusal: EvolveIssue[] | undefined;
            const tokensBefore = budget.spent().tokens, callsBefore = calls;
            if (arm === 'scripted-model') {
              activeReply = replies.get(round + '-' + attempt);
              expected = registration.modelReplies.find(one => one.round === round && one.attempt === attempt)!.expect;
              const proposed = await proposer.propose({
                messages: [{ role: 'user', content: 'Propose the registered candidate ' + candidate.id }],
                proposalId: candidate.id, strategyId: candidate.strategyId,
              });
              if (!proposed.ok) refusal = proposed.issues;
              else document = { ...document, rationale: proposed.value.rationale,
                evidence: proposed.value.evidence.join('; '), patch: proposed.value.patch };
            }
            const cost = patchCost(document.patch);
            const worktreesBefore = host.counters.worktreesCreated;
            const ran = await runExperiment(fixture, {
              document: document as never, index: (round - 1) * 6 + attempt, expect: expected, refusal,
              origin: arm === 'scripted-model' ? 'model' : 'hand-authored',
              budgets: { patchBytes: cost.bytes, patchFiles: cost.files,
                withinPatchBytes: cost.bytes <= host.budgets.patchBytes, withinPatchFiles: cost.files <= host.budgets.patchFiles },
            }, host, baseFiles);
            if (ran.row.actual === null) throw new Error('Attempt did not produce a decision.');
            return { actual: ran.row.actual, expected, matches: ran.row.matches === true,
              processRuns: ran.row.effects.legs, worktreesCreated: host.counters.worktreesCreated - worktreesBefore,
              patchBytes: refusal === undefined ? cost.bytes : 0, modelCalls: calls - callsBefore, modelTokens: budget.spent().tokens - tokensBefore };
          },
        });
        if (arm === 'outcome-ranked') for (const id of registration.strategyOrder) {
          const unit = await host.outcomeStore.memories.get('evolve-strategy:' + id);
          if (unit === undefined) throw new Error('Projected carrier disappeared.');
          carried.set(id, unit);
        }
        if (await host.protectedRefs() !== beforeRefs) protectedRefWrites++;
        const afterTree = await host.host.trackedDigest(host.repositoryRoot);
        if (!afterTree.ok || JSON.stringify(afterTree.value) !== JSON.stringify(beforeTree.value)) operatorWorktreeChanged = true;
        return measured;
      }));
    }
    const [floor, recall, ranked] = arms;
    rounds.push({ round, pool: registration.permutations[round - 1], arms: arms as SelectionRound['arms'],
      oracleAttemptsToFirstKeep: 1,
      comparison: { rankedFirst: ranked.attemptsToFirstKeep ?? 7, unrankedFirst: floor.attemptsToFirstKeep ?? 7,
        recallFirst: recall.attemptsToFirstKeep ?? 7, rankedGoalposts: ranked.goalpostRefusals,
        unrankedGoalposts: floor.goalpostRefusals, recallGoalposts: recall.goalpostRefusals } });
  }
  const prior = await evolveSource(root);
  const extra = await sourceManifest(root, [ABLATION_PATH, 'benchmark/lib/evolve-selection.ts', 'benchmark/lib/evolve-selection.types.ts',
    'benchmark/schemas/evolve-selection.schema.json', 'package.json', 'package-lock.json'], ['benchmark/fixtures/evolve/model-replies']);
  const files = [...prior.files, ...extra.files].sort((a, b) => a.path.localeCompare(b.path));
  const content: Omit<EvolveSelection, 'reportId'> = {
    benchmark: 'evolve-selection/v1',
    registration: { revision: await canonicalSha256(registration), fixtureRevision: fixture.manifestRevision,
      baseRevision: fixture.manifest.fixture.baseRevision, rounds: 3, attempts: 6, seed: 24071 },
    source: { files, sha256: await canonicalSha256({ files }) }, rounds, experiments: 72,
    modelDecision: rounds.every(r => r.arms.every(a => a.rows.every(row => row.matches))) ? 'model-exact' : 'model-mismatch',
    verdict: verdict({ rounds }) as EvolveSelection['verdict'], default: EVOLVE_SELECTION_DEFAULT,
    candidateWeights: registration.strategyOrder.map(strategyId => ({ strategyId, confidence: carried.get(strategyId)?.confidence ?? NaN })),
    identity: analyticEnvelope(rounds.flatMap(r => r.arms.map(a => r.round + '/' + a.arm))),
    selectionHead: null, protectedRefWrites: protectedRefWrites as 0, operatorWorktreeChanged: operatorWorktreeChanged as false, liveModelCalls: 0,
  };
  const report = { ...content, reportId: await canonicalSha256(content) };
  await validateSelectionReport(report);
  return report;
}

export const renderSelectionReport = (report: EvolveSelection): string => JSON.stringify(report, null, 2) + '\n';
export function renderSelectionDocument(report: EvolveSelection): string {
  const lines = [
    '# Repository strategy selection', '',
    'Generated by `npm run benchmark:evolve -- --ablation`. Three rounds, six attempts per arm; 72 real durable experiments over one fixed fixture revision. All model replies and hash embeddings are keyless.', '',
    `Verdict: **${report.verdict}**. Default: **${report.default}**. Model registration: **${report.modelDecision}**.`, '',
    'The oracle ceiling is a keep at attempt 1. The unranked arm is the floor. A dash means no keep in six attempts; comparisons treat that as 7. Ranked selection must be strictly earlier than the floor, no later than recall, and have unchanged goalpost-refusal counts in both later rounds. It loses when either control finds a keep earlier; all other results are inconclusive.', '',
    '| Round | Policy | Kept / attempted | First keep | Red | Ambiguous | Goalpost | Escape | Shape | Budget | Uncertain | Abandoned | Refused | Processes | Worktrees | Patch bytes | Model calls | Tokens |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const round of report.rounds) {
    lines.push(`| ${round.round} | oracle ceiling | 1 / 1 | 1 | — | — | — | — | — | — | — | — | — | 0 | 0 | 0 | 0 | 0 |`);
    for (const arm of round.arms) lines.push(`| ${round.round} | ${arm.arm} | ${arm.kept} / ${arm.attempts} | ${arm.attemptsToFirstKeep ?? '—'} | ${arm.red} | ${arm.ambiguous} | ${arm.goalpostRefusals} | ${arm.escapeRefusals} | ${arm.shapeRefusals} | ${arm.overBudget} | ${arm.uncertain} | ${arm.abandoned} | ${arm.refused} | ${arm.processRuns} | ${arm.worktreesCreated} | ${arm.patchBytes} | ${arm.modelCalls} | ${arm.modelTokens} |`);
  }
  lines.push('', 'Process counts are fenced effect legs, as in the baseline instrument; setup, read-only git probes and cleanup are outside that census. Patch bytes count the proposed file content; a model reply refused before preparation contributes zero. Each green experiment measures fresh base and candidate samples. No base measurement is cached.', '',
    'Only the ranked arm carries outcome-projected strategy confidence between rounds. Recall uses ledger skill similarity with 128-dimensional hash embeddings. Seed 24071 continues one mulberry32 stream across round permutations. Ties use registered strategy order, then round pool order. Each scripted round allows six turns and 512 tokens; each recorded response uses 64 tokens, and repair is disabled. The malformed response is counted separately from forbidden-surface refusals.', '',
    `Protected-ref writes: ${report.protectedRefWrites}. Operator worktree changed: ${report.operatorWorktreeChanged}. Live model calls: ${report.liveModelCalls}. Selection head: null. No evaluation, approval or promotion is performed.`, '',
    'Candidate confidence after the final ranked round: ' + report.candidateWeights.map(w => `${w.strategyId}=${w.confidence}`).join(', ') + '.', '',
    'This fixture compares selection mechanics. It establishes neither model quality nor improvement on Tangle or Jaren source. A live host must print its frozen model, attempt and token plan, then explicitly authorize its injected client.', '',
    `Registration: \`${report.registration.revision}\`. Source: \`${report.source.sha256}\`. Report: \`${report.reportId}\`.`, '');
  return lines.join('\n');
}
