/**
 * The repository-experiment instrument — registered before any executor.
 *
 * The rule this campaign is built under is that no self-evolving capability
 * ships before the instrument that can call it an improvement. This file is
 * that instrument, and it exists first on purpose: the sixteen adversarial
 * proposals, their exact expected decisions, the immutable-surface policy,
 * the budgets and the two analytic controls are all fixed here, so no later
 * mechanism can define the oracle it is scored against.
 *
 * The matrix is adversarial by construction. One proposal is a real
 * improvement; one is a no-op; one regresses; one is flaky; seven try to
 * move a goalpost — the test expectations, CI, the gate script, the
 * registered threshold, the fitness instrument itself, a rename that hides
 * a deleted assertion and a generated file; two escape the working set by
 * path or by size; three are hostile at run time — an import that never
 * returns, one that floods stdout, one that fills the workspace. A
 * mechanism that cannot refuse every goalpost and every escape BEFORE its
 * gate runs has not earned a score.
 *
 * Today every mechanism row is `implementation-missing` and the report says
 * so in its decision: nothing has been run, no hit rate is claimed, and the
 * only numbers published are the registration's own constants and what each
 * patch costs on paper. Later orders replace rows by id; they never touch
 * the registration.
 *
 * Keyless and clock-free by construction: no provider, no credential, no
 * `--live`, and a fetch during a run throws. Durations, temporary paths and
 * commit dates have no representable member in the document, so two runs
 * over the same tree render byte-identical JSON and Markdown.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mulberry32, shuffle } from '@jarenjs/core/random';

import { analyticEnvelope } from './report-envelope.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import { sourceManifest } from './source-manifest.ts';
import { loadEvolveFixture, withMaterializedFixture, type LoadedEvolveFixture } from './evolve-fixture.ts';
import evolveSchema from '../schemas/evolve.schema.json' with { type: 'json' };
import runIdentitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import { count, table } from './table.ts';
import type { Controls, Counts, Evolve, HostProbe, Row, SourceManifest } from './evolve.types.ts';

export { loadEvolveFixture as loadFixture };

export const REPORT_PATH = 'benchmark/results/evolve.json';
export const DOCUMENT_PATH = 'docs/EVOLVE_BENCHMARK.md';

/** The seeded control's stream. Fixed here so the selection is reproducible. */
export const RANDOM_SEED = 17753;
/** How many proposals the unguided control gets to try. */
export const RANDOM_SELECTS = 8;

/** Which suite packages this campaign's mechanism will be built out of. */
const TANGLE_PACKAGES = ['agents', 'config', 'context', 'mas', 'models', 'outcomes', 'store'] as const;

// ---------------------------------------------------------------------------
// the explicit source manifest — what this instrument's behavior reads
// ---------------------------------------------------------------------------

export const SOURCE_MANIFEST: readonly string[] = [
  'benchmark/evolve.ts',
  'benchmark/fixtures/evolve/manifest.json',
  'benchmark/lib/args.ts',
  'benchmark/lib/evolve-fixture.ts',
  'benchmark/lib/evolve.ts',
  'benchmark/lib/evolve.types.ts',
  'benchmark/lib/report-envelope.ts',
  'benchmark/lib/source-manifest.ts',
  'benchmark/lib/table.ts',
  'benchmark/lib/validate.ts',
  'benchmark/schemas/evolve.schema.json',
  'benchmark/scripts/evolve-fixture.ts',
  'test/benchmark/evolve.test.ts',
];

/**
 * The ordered path/digest manifest of the instrument's own bytes. Commit
 * HEAD is deliberately absent: committing identical bytes is provenance,
 * not a change, and must not invalidate a published measurement. The
 * fixture repository and the proposals are bound through the manifest's own
 * digests instead, which is where tampering has to be caught anyway.
 */
export async function evolveSource(root = process.cwd()): Promise<SourceManifest> {
  const source = await sourceManifest(root, SOURCE_MANIFEST);
  const files = source.files;
  return { files, sha256: await canonicalSha256({ files }) };
}

/** Installed foundation identities, name-sorted. */
export async function suitePackages(root = process.cwd()): Promise<Evolve['suite']> {
  const read = async (scope: string, name: string): Promise<{ name: string, version: string }> => {
    const manifest = JSON.parse(await readFile(join(root, 'node_modules', scope, name, 'package.json'), 'utf8')) as { version: string };
    return { name: `${scope}/${name}`, version: manifest.version };
  };
  const jaren = (await readdir(join(root, 'node_modules', '@jarenjs'))).filter((name) => !name.startsWith('.')).sort();
  const packages = [
    ...await Promise.all(jaren.map((name) => read('@jarenjs', name))),
    ...await Promise.all(TANGLE_PACKAGES.map((name) => read('@tangleai', name))),
  ];
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return { packages };
}

// ---------------------------------------------------------------------------
// what a proposal costs before anything runs
// ---------------------------------------------------------------------------

const FILES_PREFIX = '/files/';

/** The file a patch operation addresses, with RFC 6901 escaping undone. */
export function patchTarget(pointer: string): string {
  if (!pointer.startsWith(FILES_PREFIX)) throw new Error(`a proposal addressed '${pointer}', which is outside the worktree file map`);
  return pointer.slice(FILES_PREFIX.length).replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * The static cost of a proposal: the UTF-8 size of its canonical patch and
 * the number of distinct files it touches. Both are registration facts, so
 * an oversized or sprawling patch is visible in the report before any
 * mechanism exists to refuse it.
 */
export function patchCost(patch: readonly { path: string, value?: string }[]): { bytes: number, files: number } {
  return {
    bytes: Buffer.byteLength(JSON.stringify(patch), 'utf8'),
    files: new Set(patch.map((operation) => patchTarget(operation.path))).size,
  };
}

// ---------------------------------------------------------------------------
// the two analytic controls
// ---------------------------------------------------------------------------

/**
 * The oracle reads the registration back as a scorer: what the hit rate is
 * when every proposal produces exactly the decision registered for it. It
 * is a constant a mechanism must reproduce — never a quality claim, and
 * never a number a later order may edit to match a measurement.
 *
 * The seeded row is the honest floor beside it: a shuffle picks eight
 * proposals with no strategy at all. Ranked selection that cannot beat this
 * has not paid for itself.
 */
export function controlsOf(loaded: LoadedEvolveFixture): Controls {
  const attempted = loaded.manifest.proposals.length;
  const kept = loaded.manifest.proposals.filter((entry) => entry.expect.decision === 'kept').length;
  const strategies = loaded.strategies.map((strategy) => {
    const mine = loaded.manifest.proposals.filter((entry) => entry.strategyId === strategy.id);
    const won = mine.filter((entry) => entry.expect.decision === 'kept').length;
    return {
      strategyId: strategy.id,
      attempted: mine.length,
      kept: won,
      hitRate: mine.length === 0 ? 0 : won / mine.length,
    };
  });

  const pool = loaded.manifest.proposals.map((entry) => entry.id);
  const selected = shuffle(mulberry32(RANDOM_SEED), [...pool]).slice(0, RANDOM_SELECTS);
  const wins = new Set(loaded.manifest.proposals.filter((entry) => entry.expect.decision === 'kept').map((entry) => entry.id));
  const drawn = selected.filter((id) => wins.has(id)).length;

  return {
    oracle: { strategies, attempted, kept, hitRate: attempted === 0 ? 0 : kept / attempted },
    random: {
      seed: RANDOM_SEED,
      selects: RANDOM_SELECTS,
      selected,
      attempted: selected.length,
      kept: drawn,
      hitRate: selected.length === 0 ? 0 : drawn / selected.length,
    },
  };
}

// ---------------------------------------------------------------------------
// report assembly
// ---------------------------------------------------------------------------

const ZERO_REASONS: Counts['abandoned']['byReason'] = {
  improved: 0, equal: 0, regression: 0, red: 0, ambiguous: 0, 'over-budget': 0,
  unverifiable: 0, goalpost: 0, escape: 0, command: 0, 'uncertain-effect': 0,
};

/** The census over the rows. Nothing here is asserted; it is all counted. */
export function censusOf(rows: readonly Row[]): Counts {
  const decided = (name: string): Row[] => rows.filter((row) => row.actual?.decision === name);
  const byReason = (of: readonly Row[]): Counts['abandoned']['byReason'] => {
    const counted = { ...ZERO_REASONS };
    for (const row of of) if (row.actual !== null) counted[row.actual.reason] += 1;
    return counted;
  };
  const abandoned = decided('abandoned');
  const refused = decided('refused');
  return {
    attempted: rows.filter((row) => row.state === 'run').length,
    kept: decided('kept').length,
    abandoned: { total: abandoned.length, byReason: byReason(abandoned) },
    refused: { total: refused.length, byReason: byReason(refused) },
    uncertain: decided('uncertain').length,
    processRuns: rows.reduce((total, row) => total + row.effects.legs, 0),
    worktreesCreated: 0,
    worktreesRemoved: 0,
    branchesLeft: 0,
    protectedRefWrites: 0,
    liveModelCalls: 0,
  };
}

/**
 * The claim, over the report alone. `implementation-missing` while any
 * registered row has no executor to run it; `oracle-exact` only when every
 * row produced its registered decision AND every host probe passed. The
 * schema recomputes both directions, so a decision cannot outrun its rows.
 */
export function decideEvolve(rows: readonly Row[], probes: readonly HostProbe[]): Evolve['decision'] {
  if (rows.some((row) => row.state === 'implementation-missing')) return 'implementation-missing';
  const exact = rows.every((row) => row.matches === true) && probes.every((probe) => probe.state === 'pass');
  return exact ? 'oracle-exact' : 'executor-conformant';
}

export interface BuildOptions {
  root?: string;
  /** Injected for deterministic tests; the CLI computes the real one. */
  source?: SourceManifest;
}

const reportValidator = createReportValidator(evolveSchema as object, [runIdentitySchema as object]);

export async function buildReport(options: BuildOptions = {}): Promise<Evolve> {
  const root = options.root ?? process.cwd();
  const loaded = await loadEvolveFixture(root);

  // The base revision is a registered constant, so it is confirmed by
  // building the repository and reading HEAD back — never by trusting the
  // number the manifest states about itself.
  const materialized = await withMaterializedFixture(root, async (fixture) => ({
    baseRevision: fixture.baseRevision,
    runs: fixture.runs,
  }));
  if (materialized.baseRevision !== loaded.manifest.fixture.baseRevision) {
    throw new Error(`the fixture repository materializes to ${materialized.baseRevision}, the manifest registers ${loaded.manifest.fixture.baseRevision}`);
  }

  const rows: Row[] = loaded.proposals.map(({ document }): Row => {
    const cost = patchCost(document.patch);
    return {
      proposalId: document.id,
      strategyId: document.strategyId,
      // No executor exists yet. Saying so is the measurement.
      state: 'implementation-missing',
      actual: null,
      matches: null,
      budgets: {
        patchBytes: cost.bytes,
        patchFiles: cost.files,
        withinPatchBytes: cost.bytes <= loaded.manifest.budgets.patchBytes,
        withinPatchFiles: cost.files <= loaded.manifest.budgets.patchFiles,
      },
      effects: { legs: 0, unresolved: 0 },
    };
  });
  const hostProbes: HostProbe[] = loaded.manifest.hostProbes.map((id): HostProbe => ({
    id,
    state: 'implementation-missing',
    detail: null,
  }));

  const report: Evolve = {
    benchmark: 'evolve',
    instrument: {
      name: 'evolve',
      entry: 'benchmark/evolve.ts',
      contractRevision: await canonicalSha256(evolveSchema as object),
    },
    source: options.source ?? await evolveSource(root),
    suite: await suitePackages(root),
    fixture: {
      id: loaded.manifest.fixture.id,
      licence: loaded.manifest.fixture.licence,
      provenance: loaded.manifest.fixture.provenance,
      manifestRevision: loaded.manifestRevision,
      policyRevision: loaded.policyRevision,
      strategiesRevision: loaded.strategiesRevision,
      baseRevision: materialized.baseRevision,
      files: loaded.manifest.files.length,
      materializationRuns: materialized.runs,
    },
    registration: {
      strategies: loaded.strategies,
      proposals: loaded.manifest.proposals.map((entry) => ({
        id: entry.id,
        strategyId: entry.strategyId,
        revision: entry.revision,
        expect: entry.expect,
      })),
      experiments: 16,
      hostProbes: loaded.manifest.hostProbes,
      budgets: loaded.manifest.budgets,
    },
    rows,
    controls: controlsOf(loaded),
    hostProbes,
    counts: censusOf(rows),
    identity: analyticEnvelope(rows.map((row) => row.proposalId)) as unknown as Evolve['identity'],
    decision: decideEvolve(rows, hostProbes),
    reportId: '0'.repeat(64),
  };
  const { reportId: _placeholder, ...rest } = report;
  report.reportId = await canonicalSha256(rest);

  const outcome = reportValidator(report);
  if (!outcome.valid) {
    throw new Error(`the experiment report does not validate: ${describeErrors(outcome, 8).join('; ')}`);
  }
  return report;
}

/** The exact bytes the committed report holds. */
export function renderReport(report: Evolve): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// the generated benchmark document
// ---------------------------------------------------------------------------

const EXPECTED = (expect: { decision: string, reason: string, code: string | null }): string =>
  `${expect.decision} / ${expect.reason}${expect.code === null ? '' : ` / \`${expect.code}\``}`;

export function renderDocument(report: Evolve): string {
  const { counts, controls, registration } = report;
  const run = counts.attempted;
  const probesRun = report.hostProbes.filter((probe) => probe.state !== 'implementation-missing').length;
  const lines: string[] = [];

  lines.push('# Repository experiments — the instrument, before the mechanism');
  lines.push('');
  lines.push('Generated by `npm run benchmark:evolve`; do not edit numbers by hand.');
  lines.push('');
  lines.push(`**${run}/${registration.experiments} registered proposals run, ${probesRun}/${registration.hostProbes.length} host probes run. Hit rate: not measured — no executor.**`);
  lines.push('');
  lines.push('No self-evolving capability ships before the instrument that can call it an improvement, so this registration exists first and alone. Every proposal below carries the decision it must produce, written down before anything could run it; a later mechanism replaces rows by id and never edits the registration or its denominators.');
  lines.push('');
  lines.push(`Fixture \`${report.fixture.id}\` (${report.fixture.licence}, ${report.fixture.provenance}): ${report.fixture.files} files, base revision \`${report.fixture.baseRevision.slice(0, 12)}…\`, manifest \`${report.fixture.manifestRevision.slice(0, 12)}…\`, policy \`${report.fixture.policyRevision.slice(0, 12)}…\`. The repository is committed as plain files and built into a git repository in a temporary directory at run time under fixed authorship, which costs ${report.fixture.materializationRuns} git processes and is not experiment work.`);
  lines.push('');

  lines.push('## The registered matrix');
  lines.push('');
  lines.push(table({
    head: ['proposal', 'strategy', 'expected', 'patch bytes', 'files', 'within budget', 'state'],
    numeric: [3, 4],
    rows: registration.proposals.map((entry) => {
      const row = report.rows.find((candidate) => candidate.proposalId === entry.id);
      if (row === undefined) throw new Error(`the registration holds ${entry.id} and the rows do not`);
      const within = row.budgets.withinPatchBytes && row.budgets.withinPatchFiles ? 'yes' : 'no';
      return [`\`${entry.id}\``, `\`${entry.strategyId}\``, EXPECTED(entry.expect), count(row.budgets.patchBytes), row.budgets.patchFiles, within, row.state];
    }),
  }));
  lines.push('');
  lines.push(`Budgets: patch ${count(registration.budgets.patchBytes)} B over at most ${registration.budgets.patchFiles} files; gate and fitness ${count(registration.budgets.gateTimeoutMs)} ms each; stdout ${count(registration.budgets.stdoutBytes)} B, stderr ${count(registration.budgets.stderrBytes)} B, workspace ${count(registration.budgets.workspaceBytes)} B; ${registration.budgets.samples} fitness samples per side.`);
  lines.push('');

  lines.push('## Controls');
  lines.push('');
  lines.push('The oracle is the registration read back as a scorer, and the seeded row is the floor a ranked selector has to beat. Neither is a quality claim about anything Tangle does; they are what licenses the rows above once a mechanism fills them in.');
  lines.push('');
  lines.push(table({
    head: ['strategy', 'attempted', 'kept', 'oracle hit rate'],
    rows: [
      ...controls.oracle.strategies.map((strategy) => [
        `\`${strategy.strategyId}\``, strategy.attempted, strategy.kept, `${strategy.kept}/${strategy.attempted}`,
      ]),
      ['**all**', controls.oracle.attempted, controls.oracle.kept, `${controls.oracle.kept}/${controls.oracle.attempted}`],
    ],
  }));
  lines.push('');
  lines.push(`Seeded control (\`mulberry32(${controls.random.seed})\`, first ${controls.random.selects} of a shuffled registration): ${controls.random.kept}/${controls.random.attempted} kept — ${controls.random.selected.map((id) => `\`${id}\``).join(', ')}.`);
  lines.push('');

  lines.push('## Host probes');
  lines.push('');
  lines.push('Refusals that cannot be written as a patch over the worktree file map and must be proven against the host instead.');
  lines.push('');
  lines.push(table({
    head: ['probe', 'state', 'detail'],
    numeric: [],
    rows: report.hostProbes.map((probe) => [`\`${probe.id}\``, probe.state, probe.detail ?? '—']),
  }));
  lines.push('');

  lines.push('## Census');
  lines.push('');
  lines.push(table({
    head: ['counted', 'value'],
    rows: [
      ['attempted', counts.attempted],
      ['kept', counts.kept],
      ['abandoned', counts.abandoned.total],
      ['refused', counts.refused.total],
      ['uncertain', counts.uncertain],
      ['process runs', counts.processRuns],
      ['worktrees created', counts.worktreesCreated],
      ['worktrees removed', counts.worktreesRemoved],
      ['branches left behind', counts.branchesLeft],
      ['protected-ref writes', counts.protectedRefWrites],
      ['live model calls', counts.liveModelCalls],
    ],
  }));
  lines.push('');
  lines.push(table({
    head: ['reason', 'abandoned', 'refused'],
    rows: Object.keys(ZERO_REASONS).map((reason) => [
      reason,
      counts.abandoned.byReason[reason as keyof typeof ZERO_REASONS],
      counts.refused.byReason[reason as keyof typeof ZERO_REASONS],
    ]),
  }));
  lines.push('');
  lines.push('Every reason keeps its column whether or not it happened: an absent column is how a losing row disappears. Protected-ref writes and live model calls are literal zeros the schema asserts, so a report of a run that wrote a protected ref or bought a completion cannot validate at all.');
  lines.push('');
  lines.push(`Report \`${report.reportId.slice(0, 12)}…\`, contract \`${report.instrument.contractRevision.slice(0, 12)}…\`, source \`${report.source.sha256.slice(0, 12)}…\`, decision **${report.decision}**.`);
  lines.push('');
  return lines.join('\n');
}
