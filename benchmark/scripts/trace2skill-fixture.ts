/**
 * Regenerates the derived halves of the skill-evolution fixture.
 *
 * Three things in `benchmark/fixtures/trace2skill/` are computed rather
 * than authored: the manifest's digests and seeded split, the scripted
 * wire, and the oracle expectations. Keeping them here means the
 * authored data — tables, questions, truths, the frozen directory, the
 * registered labels and the patch pool — is the only thing a reviewer
 * reads, and that a corpus edit cannot leave a stale hash behind.
 *
 * Run it with `--check` to prove the committed fixture is exactly what
 * this script produces; it writes nothing and exits non-zero on drift.
 * Running it twice changes no byte.
 *
 *   node benchmark/scripts/trace2skill-fixture.ts [--check]
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mulberry32, drawDistinct } from '@jarenjs/core/random';
import { registeredUnits, scriptUnitKey } from '../lib/trace2skill-script.ts';
import { answerPool, oracleCeiling, randomBand, randomDraw, type TruthEntry } from '../lib/trace2skill-oracle.ts';
import type {
  LabelsDocument, MergeTreeDocument, ScriptDocument, ScriptEntry, ScriptUnit,
  TaskDocument, Trace2skillFixture,
} from '../lib/trace2skill.types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE_DIR = 'benchmark/fixtures/trace2skill';

const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Code-point order, because these names become hash inputs. */
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every fixture file except the manifest itself, path-ordered. */
async function fixtureFiles(dir: string, prefix = ''): Promise<Array<{ path: string, sha256: string }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string, sha256: string }> = [];
  for (const entry of entries.sort((a, b) => byName(a.name, b.name))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await fixtureFiles(join(dir, entry.name), path));
    else if (path !== 'manifest.json') files.push({ path, sha256: digest(await readFile(join(dir, entry.name))) });
  }
  return files.sort((a, b) => byName(a.path, b.path));
}

function scriptedResponse(unit: ScriptUnit, labels: LabelsDocument, truths: Map<string, TruthEntry>): Record<string, unknown> {
  if (unit.role === 'executor') {
    const taskId = unit.taskId as string;
    const conditions = labels.modes[unit.mode].conditions as Record<string, { incorrect: string[] }>;
    const incorrect = new Set(conditions[unit.condition as string].incorrect);
    const budget = labels.budgetTasks.includes(taskId);
    const correct = !incorrect.has(taskId);
    const turns = budget ? labels.turns.budget : correct ? labels.turns.correct : labels.turns.incorrect;
    return {
      kind: 'executor',
      answer: correct ? (truths.get(taskId) as TruthEntry).answer : labels.incorrectAnswer,
      stopReason: budget ? 'budget' : 'complete',
      turns,
      tokens: turns * labels.tokensPerTurn,
    };
  }
  if (unit.role === 'merge') return { kind: 'merge', groupId: unit.groupId, patchId: `merged-${unit.groupId as string}` };
  if (unit.role === 'draft') return { kind: 'draft', root: 'SKILL.md', sections: ['When to use', 'Reading the table', 'Answer format'] };
  const taskId = unit.taskId as string;
  if (unit.condition === 'single-call-error') {
    // With no evaluator to disagree, the single call proposes on every
    // failing trajectory — including the one the proven role excluded.
    const proposed = labels.analystPatches[taskId] ?? labels.ablationPatches[taskId];
    return proposed === undefined
      ? { kind: 'analysis', outcome: 'no-patch', patchId: null, exclusion: 'exhausted' }
      : { kind: 'analysis', outcome: 'patch', patchId: proposed, exclusion: null };
  }
  if (unit.role === 'success-analyst') return { kind: 'analysis', outcome: 'no-patch', patchId: null, exclusion: 'already-correct' };
  const patchId = labels.analystPatches[taskId];
  if (patchId === undefined) {
    return { kind: 'analysis', outcome: 'no-patch', patchId: null, exclusion: labels.exclusions[taskId] ?? 'no-causal-explanation' };
  }
  return { kind: 'analysis', outcome: 'patch', patchId, exclusion: null };
}

async function build(): Promise<{ manifest: Trace2skillFixture, script: ScriptDocument, written: Array<[string, string]> }> {
  const dir = join(ROOT, FIXTURE_DIR);
  const read = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(dir, path), 'utf8'));
  const manifest = await read('manifest.json') as Trace2skillFixture;
  const labels = await read('expected/labels.json') as LabelsDocument;
  const tree = await read('patches/expected-merge-tree.json') as MergeTreeDocument;

  const taskNames = (await readdir(join(dir, 'tasks'))).filter((name) => name.endsWith('.json')).sort();
  const tasks = await Promise.all(taskNames.map(async (name) => await read(`tasks/${name}`) as TaskDocument));
  const truths = new Map<string, TruthEntry>();
  for (const task of tasks) truths.set(task.id, await read(`truth/${task.id}.json`) as TruthEntry);

  // The split is drawn, not typed: the seed is the record of how these
  // eight tasks came to be held out.
  const drawn = drawDistinct(mulberry32(manifest.seed), tasks.length, manifest.counts.test)
    .map((index) => tasks[index].id).sort();
  const test = drawn;
  const evolve = tasks.map((task) => task.id).filter((id) => !test.includes(id)).sort();
  for (const task of tasks) {
    const expected = test.includes(task.id) ? 'test' : 'evolve';
    if (task.split !== expected) throw new Error(`${task.id} records split ${task.split}; the seeded draw puts it in ${expected}`);
  }

  const script: ScriptDocument = { document: 'trace2skill-script', entries: [] };
  const entries: ScriptEntry[] = [];
  for (const unit of registeredUnits(tasks, labels, tree)) {
    entries.push({ key: await scriptUnitKey(unit), unit, response: scriptedResponse(unit, labels, truths) });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  script.entries = entries;

  const heldOut = test.map((id) => truths.get(id) as TruthEntry);
  const draw = randomDraw(heldOut, manifest.seed);
  const band = randomBand(heldOut);
  const modes = labels.modes as unknown as Record<string, { conditions: Record<string, { incorrect: string[] }> }>;
  const scoreOf = (mode: string, condition: string): number => {
    const incorrect = new Set(modes[mode].conditions[condition].incorrect);
    return test.filter((id) => !incorrect.has(id)).length / test.length;
  };
  const oracle = {
    document: 'trace2skill-oracle',
    evaluator: labels.evaluator,
    tasks: test.length,
    ceiling: oracleCeiling(heldOut),
    randomPool: answerPool(heldOut),
    randomDraw: { seed: manifest.seed, correct: draw.correct, score: draw.score },
    randomBand: band,
    heldOut: Object.fromEntries(Object.entries(modes).map(([mode, modeLabels]) => [
      mode, Object.fromEntries(Object.keys(modeLabels.conditions).map((condition) => [condition, scoreOf(mode, condition)])),
    ])),
  };

  const scriptBytes = JSON.stringify(script, null, 2) + '\n';
  const oracleBytes = JSON.stringify(oracle, null, 2) + '\n';
  const written: Array<[string, string]> = [['scripts/responses.json', scriptBytes], ['expected/oracle.json', oracleBytes]];
  // The manifest's digests cover these two documents, so they are on
  // disk before the file census runs — `--check` restores them after.
  for (const [path, value] of written) await writeFile(join(dir, path), value);

  const skillFiles = (await fixtureFiles(join(dir, manifest.s0.path)))
    .map((file) => ({ path: file.path, sha256: file.sha256 }));
  // Only the evolve half ever produces a rollout, so only it can produce
  // an analyst and a patch; a held-out failure is evidence, never input.
  const deepening = modes.deepening.conditions;
  const failing = deepening[labels.modes.deepening.rolloutCondition].incorrect.filter((id) => evolve.includes(id));
  const evolved = new Set(deepening['evolved-s-star'].incorrect);
  const patchNames = (await readdir(join(dir, 'patches')))
    .filter((name) => name.endsWith('.json') && name !== 'expected-merge-tree.json')
    .map((name) => name.replace(/\.json$/, '')).sort();
  // The salvaged retrieval-baseline packs, censused rather than typed, so the
  // manifest cannot claim a pack the corpus no longer carries.
  const legacyPacks = (await readdir(join(dir, 'legacy-packs')))
    .filter((name) => name.endsWith('.toml')).map((name) => name.replace(/\.toml$/, '')).sort();

  const next: Trace2skillFixture = {
    ...manifest,
    counts: { evolve: evolve.length, test: test.length },
    splits: {
      evolve, test,
      evolveHash: await canonicalSha256(evolve),
      testHash: await canonicalSha256(test),
    },
    s0: {
      ...manifest.s0,
      files: skillFiles,
      rootHash: (skillFiles.find((file) => file.path === 'SKILL.md') as { sha256: string }).sha256,
      bundleId: await canonicalSha256({
        scopeKey: 'tabular-extract', mode: 'deepening', parent: null, root: 'SKILL.md', files: skillFiles,
      }),
    },
    scriptId: await canonicalSha256(script as unknown as Record<string, unknown>),
    negativePatches: patchNames,
    legacyPacks,
    rollouts: {
      repairable: failing.filter((id) => !evolved.has(id)).sort(),
      unrepairable: failing.filter((id) => evolved.has(id)).sort(),
    },
    files: await fixtureFiles(dir),
  };
  return { manifest: next, script, written };
}

const check = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('this tool takes --check and nothing else');
const dir = join(ROOT, FIXTURE_DIR);
const paths = ['manifest.json', 'scripts/responses.json', 'expected/oracle.json'];
const before = new Map<string, string>();
// A derived document may not exist yet on a first generation; an empty
// string records that absence rather than hiding a read failure.
for (const path of paths) {
  before.set(path, await readFile(join(dir, path), 'utf8').then(
    (bytes) => bytes,
    (cause: unknown) => { if ((cause as { code?: string }).code === 'ENOENT') return ''; throw cause; }));
}
const built = await build();
const after = new Map<string, string>([['manifest.json', JSON.stringify(built.manifest, null, 2) + '\n'], ...built.written]);
const drifted = paths.filter((path) => before.get(path) !== after.get(path));
if (check) {
  // Restore only what this run actually rewrote, so a check leaves even
  // the modification times of an unchanged corpus alone.
  for (const path of drifted) if (before.get(path) !== '') await writeFile(join(dir, path), before.get(path) as string);
  for (const path of drifted) process.stderr.write(`fixture drift: ${relative(ROOT, join(dir, path))}\n`);
  if (drifted.length > 0) process.exitCode = 1;
} else {
  for (const path of paths) await writeFile(join(dir, path), after.get(path) as string);
}
process.stdout.write(`trace2skill fixture: ${built.manifest.files.length} files, ${built.script.entries.length} scripted units, ${drifted.length} changed\n`);
