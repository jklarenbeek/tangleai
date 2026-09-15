/**
 * The fixture loader: the one door every byte of the corpus comes
 * through.
 *
 * Three things happen here and nowhere else. Every registered file is
 * re-hashed and compared with the manifest, so a corpus that moved is
 * refused rather than measured. The evolve and test halves are checked
 * for disjointness, because a shared id would let a held-out answer
 * influence the directory that is later scored on it. And ground truth
 * is handed out only against a named scope — evaluation, or an error
 * analyst's post-failure repair — so a read from the executor's side of
 * the boundary becomes a counted value instead of a silent success.
 *
 * Refusals are values, not exceptions: the loader returns its issues so
 * the report can publish them and the instrument capability can go
 * false. Only a structurally invalid document throws, because there is
 * then nothing left to count.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { PatchOperation as SkillPatchOperation, SkillPatch } from '@tangleai/trace2skill';
import { createReportValidator, describeErrors, type ReportValidator } from './validate.ts';
import TRACE2SKILL_SCHEMA from '../schemas/trace2skill.schema.json' with { type: 'json' };
import RUN_IDENTITY_SCHEMA from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type {
  FixtureIssue, LabelsDocument, MergeTreeDocument, OracleDocument, PatchDocument,
  ScopeDocument, ScriptDocument, SourceManifest, TaskDocument, Trace2skillFixture, TruthDocument,
} from './trace2skill.types.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_DIR = 'benchmark/fixtures/trace2skill';

/** The only two reasons a registered answer may be read. */
export const TRUTH_SCOPES = ['evaluate', 'error-analyst-repair'] as const;
export type TruthScope = (typeof TRUTH_SCOPES)[number];

/** A refusal that reached a caller instead of a value. */
export interface Refusal { error: string, code: FixtureIssue['code'] }

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && 'error' in value && 'code' in value;
}

export interface LoadedSplits {
  evolve: string[];
  test: string[];
  evolveHash: string;
  testHash: string;
  disjoint: boolean;
  overlapRefused: number;
}

export interface LoadedFixture {
  fixture: Trace2skillFixture;
  fixtureId: string;
  source: SourceManifest;
  tasks: TaskDocument[];
  patches: PatchDocument[];
  tree: MergeTreeDocument;
  labels: LabelsDocument;
  oracle: OracleDocument;
  script: ScriptDocument;
  /** What a trajectory-blind draft may see, and the only thing it may see. */
  scope: ScopeDocument;
  splits: LoadedSplits;
  /** Refusals the loader counted rather than threw. */
  issues: FixtureIssue[];
  /** The frozen directory's files, root first in manifest order. */
  skillFiles: ReadonlyMap<string, string>;
  /** One input file's bytes, or a refusal for anything outside `inputs/`. */
  readInput(path: string): string | Refusal;
  /** A registered answer, only for a named scope. Anything else is leakage. */
  readTruth(scope: string, taskId: string): TruthDocument | Refusal;
}

export interface LoadOptions {
  /** Replace the manifest, so a mutated registration can be measured. */
  manifest?: Trace2skillFixture;
  /** Replace the scripted wire, so a missing entry can be measured. */
  script?: ScriptDocument;
  root?: string;
}

let validator: ReportValidator | undefined;
/** The one validator for every document of this instrument. */
export function createTrace2SkillValidator(): ReportValidator {
  validator ??= createReportValidator(TRACE2SKILL_SCHEMA, [RUN_IDENTITY_SCHEMA]);
  return validator;
}

function digestOf(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checked<T>(value: unknown, what: string): T {
  const outcome = createTrace2SkillValidator()(value);
  if (!outcome.valid) throw new Error(`the skill-evolution fixture does not validate (${what}): ${describeErrors(outcome, 3).join('; ')}`);
  return value as T;
}

/** Load, hash-verify and validate the fixture. */
export async function loadTrace2SkillFixture(options: LoadOptions = {}): Promise<LoadedFixture> {
  const root = options.root ?? ROOT;
  const dir = join(root, FIXTURE_DIR);
  const read = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(dir, path), 'utf8'));
  const manifest = options.manifest ?? checked<Trace2skillFixture>(await read('manifest.json'), 'manifest.json');
  const issues: FixtureIssue[] = [];

  const files: Array<{ path: string, sha256: string }> = [];
  const bytes = new Map<string, string>();
  for (const entry of manifest.files) {
    const content = await readFile(join(dir, entry.path)).then(
      (bytes) => bytes,
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
    if (typeof content === 'string') {
      issues.push({ code: 'TT2S1003', path: entry.path, detail: `a registered file is unreadable: ${content}` });
      continue;
    }
    const sha256 = digestOf(content);
    if (sha256 !== entry.sha256) {
      issues.push({ code: 'TT2S1002', path: entry.path, detail: `recorded ${entry.sha256.slice(0, 12)}…, found ${sha256.slice(0, 12)}…` });
    }
    files.push({ path: entry.path, sha256 });
    bytes.set(entry.path, content.toString('utf8'));
  }
  const registered = new Set(manifest.files.map((entry) => entry.path));
  for (const path of await corpusPaths(dir)) {
    if (!registered.has(path)) issues.push({ code: 'TT2S1003', path, detail: 'a corpus file is not registered in the manifest' });
  }

  const taskNames = (await readdir(join(dir, 'tasks'))).filter((name) => name.endsWith('.json')).sort();
  const tasks = await Promise.all(taskNames.map(async (name) => checked<TaskDocument>(await read(`tasks/${name}`), name)));
  const truths = new Map<string, TruthDocument>();
  for (const task of tasks) truths.set(task.id, checked<TruthDocument>(await read(`truth/${task.id}.json`), `truth/${task.id}.json`));
  const patches = await Promise.all(manifest.negativePatches.map(async (name) =>
    checked<PatchDocument>(await read(`patches/${name}.json`), `patches/${name}.json`)));
  const tree = checked<MergeTreeDocument>(await read('patches/expected-merge-tree.json'), 'expected-merge-tree.json');
  const labels = checked<LabelsDocument>(await read('expected/labels.json'), 'labels.json');
  const oracle = checked<OracleDocument>(await read('expected/oracle.json'), 'oracle.json');
  const script = options.script ?? checked<ScriptDocument>(await read(manifest.script), manifest.script);
  const scope = checked<ScopeDocument>(await read(manifest.creationScope), manifest.creationScope);

  const evolve = [...manifest.splits.evolve];
  const test = [...manifest.splits.test];
  const shared = evolve.filter((id) => test.includes(id));
  for (const id of shared) {
    issues.push({ code: 'TT2S1006', path: `tasks/${id}.json`, detail: 'the task is in both the evolve and the held-out split' });
  }
  if (manifest.counts.evolve !== evolve.length || manifest.counts.test !== test.length) {
    issues.push({ code: 'TT2S1001', path: 'manifest.json', detail: 'the registered counts disagree with the split lists' });
  }
  const evolveHash = await canonicalSha256([...evolve].sort());
  const testHash = await canonicalSha256([...test].sort());
  if (evolveHash !== manifest.splits.evolveHash || testHash !== manifest.splits.testHash) {
    issues.push({ code: 'TT2S1002', path: 'manifest.json', detail: 'the registered split identities disagree with the split lists' });
  }
  const known = new Set(tasks.map((task) => task.id));
  for (const id of [...evolve, ...test]) {
    if (!known.has(id)) issues.push({ code: 'TT2S1001', path: 'manifest.json', detail: `the split names ${id}, which no task document declares` });
  }

  const skillFiles = new Map<string, string>();
  for (const entry of manifest.s0.files) {
    const content = bytes.get(`${manifest.s0.path}/${entry.path}`);
    if (content === undefined) issues.push({ code: 'TT2S1005', path: entry.path, detail: 'the frozen directory names a file the manifest does not register' });
    else skillFiles.set(entry.path, content);
  }
  if (!skillFiles.has('SKILL.md')) issues.push({ code: 'TT2S1005', path: manifest.s0.path, detail: 'the frozen directory has no root page' });

  return {
    fixture: manifest,
    fixtureId: await canonicalSha256(manifest as unknown as Record<string, unknown>),
    source: { files, sha256: await canonicalSha256({ files }) },
    tasks, patches, tree, labels, oracle, script, scope,
    splits: { evolve, test, evolveHash, testHash, disjoint: shared.length === 0, overlapRefused: shared.length },
    issues,
    skillFiles,
    readInput(path: string): string | Refusal {
      if (!path.startsWith('inputs/')) return { error: `the executor may read inputs/ only, not ${path}`, code: 'TT2S1003' };
      const content = bytes.get(path);
      return content ?? { error: `no such input: ${path}`, code: 'TT2S1003' };
    },
    readTruth(scope: string, taskId: string): TruthDocument | Refusal {
      if (!(TRUTH_SCOPES as readonly string[]).includes(scope)) {
        return { error: `ground truth is unreadable from ${scope}`, code: 'TT2S1006' };
      }
      const truth = truths.get(taskId);
      return truth ?? { error: `no registered answer for ${taskId}`, code: 'TT2S1001' };
    },
  };
}

/**
 * The registered document's spelling mapped onto the compiler's operation
 * shape, once. The fixture writes `file`/`text`/`anchor`; the patch language
 * reads `path`/`content`/`from`. A second mapping would let the corpus and
 * the compiler disagree about what a registered patch says.
 */
export function operationsOf(document: PatchDocument): SkillPatchOperation[] {
  return document.operations.map((operation) => operation.op === 'create_file'
    ? { op: 'create_file' as const, path: operation.file, group: operation.group, content: operation.text ?? '' }
    : operation.op === 'insert_before' || operation.op === 'insert_after'
      ? { op: operation.op, path: operation.file, group: operation.group, anchor: operation.anchor ?? '', content: operation.text ?? '' }
      : { op: operation.op as 'replace_section' | 'delete_section', path: operation.file, group: operation.group, from: operation.anchor ?? '', to: null, content: operation.text ?? null });
}

/** One registered document as a patch record, addressed by its own content. */
export async function patchFromDocument(
  document: PatchDocument,
  binding: { runId: string, baseHash: string, operations?: SkillPatchOperation[], sourcePatchIds?: string[], supportCount?: number },
): Promise<SkillPatch> {
  const payload = {
    runId: binding.runId,
    baseHash: document.baseHash ?? binding.baseHash,
    sourceRolloutIds: [document.origin.rollout],
    sourcePatchIds: binding.sourcePatchIds ?? [],
    supportCount: binding.supportCount ?? 1,
    reasoning: document.rationale,
    operations: binding.operations ?? operationsOf(document),
    changelog: [] as string[],
    validation: { state: 'pending' as const, issues: [] },
  };
  return { id: await canonicalSha256(payload), ...payload };
}

/** Every file actually present under the fixture, manifest excluded. */
async function corpusPaths(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await corpusPaths(join(dir, entry.name), path));
    else if (path !== 'manifest.json') paths.push(path);
  }
  return paths.sort();
}
