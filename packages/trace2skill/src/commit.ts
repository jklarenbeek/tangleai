/**
 * The one application: a merged patch becomes a staged directory, once.
 *
 * Every check that decides whether a patch may land runs over copies before
 * anything is written — the schema, the compiler against the frozen
 * directory, the format validator over the applied result, and the plan that
 * says what the candidate would be. The guarded editor of the suite owns that
 * sequence; nothing here re-implements read, apply, validate and commit, and
 * neither a validator nor the plan ever sees the reader's own objects. The
 * commit is a single store transaction, so the directory, its pages and the
 * candidate that names them land together or not at all, and the snapshot and
 * restore hooks stay unused because there is no half-written state to undo.
 *
 * A run applies exactly one patch. An intermediate result of a merge level is
 * refused by identity rather than by convention, and a second application is
 * refused after the first has landed: the paper's guarantee is that the
 * evolved directory is `S0` plus one validated patch, not `S0` plus whatever
 * arrived.
 */
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createJSONPatch } from '@jarenjs/json/patch';
import { trace2SkillIssue, trace2SkillRefuse, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { byPath } from './identity.ts';
import { draftsOf, sealSkillBundle, SKILL_ROOT_FILE, type SkillFileDraft, type SkillSnapshot } from './bundle.ts';
import { validateTrace2SkillShape } from './schema.ts';
import { MINIMAL_SKILL_PROFILE, validateFormat, type SkillFormatProfile } from './format.ts';
import { applyCompiled, compilePatch, splitLines, type CompiledPatch, type FrozenSkill } from './patch.ts';
import { mergePatches, type MergeCounts, type MergeDeps, type MergeFanOut } from './merge.ts';
import type {
  CandidateCheck, EvolutionRun, PatchOperation, SkillCandidate, SkillPatch, Trace2SkillIssue,
} from './contracts.gen.ts';
import type { Trace2SkillStore } from './store.ts';

/** The document the guarded editor reads, edits and plans over. */
interface SkillDocument { files: SkillFileDraft[] }

interface GuardedError { code?: unknown, docPath?: unknown, message?: unknown }

/** Issues travel through the guarded editor as its error records and back again. */
const asErrors = (issues: readonly Trace2SkillIssue[]): GuardedError[] =>
  issues.map(issue => ({ code: issue.code, docPath: issue.path, message: issue.detail }));

const CODES = new Set(['TT2S1001', 'TT2S1002', 'TT2S1003', 'TT2S1004', 'TT2S1005', 'TT2S1006',
  'TT2S1007', 'TT2S1008', 'TT2S1009', 'TT2S1010', 'TT2S1011', 'TT2S1012', 'TT2S1013']);

function asIssues(errors: readonly unknown[]): Trace2SkillIssue[] {
  return errors.map(raw => {
    const error = (raw ?? {}) as GuardedError & { stage?: unknown };
    const code = typeof error.code === 'string' && CODES.has(error.code) ? error.code as Trace2SkillIssue['code'] : null;
    const path = typeof error.docPath === 'string' ? error.docPath : '';
    const detail = typeof error.message === 'string' ? error.message : 'the guarded editor refused the proposal';
    return code === null ? trace2SkillIssue('TT2S1001', path, detail, error) : trace2SkillIssue(code, path, detail);
  });
}

/** A refusal the apply stage raises, carrying the code the compiler or validator named. */
class ApplyRefusal extends Error {
  readonly issues: Trace2SkillIssue[];
  constructor(issues: readonly Trace2SkillIssue[]) {
    super(issues[0]?.detail ?? 'the patch does not apply');
    this.issues = [...issues];
  }
}

export interface CandidateDiff { filesAdded: number, filesChanged: number, linesAdded: number, linesRemoved: number }

/** What the committer would write, computed over copies and written by nobody yet. */
export interface CandidatePlan {
  files: SkillFileDraft[];
  diffSummary: CandidateDiff;
  churn: number;
  semantic: CandidateCheck;
}

export interface PreparedCandidate {
  valid: boolean;
  issues: Trace2SkillIssue[];
  plan: CandidatePlan | null;
}

export interface CommittedCandidate { candidate: SkillCandidate, snapshot: SkillSnapshot }

export interface CandidateCommitterOptions {
  store: Trace2SkillStore;
  run: EvolutionRun;
  /** The frozen directory, which this committer reads and never rewrites. */
  frozen: SkillSnapshot;
  /** The one patch of this run that may be applied; anything else is refused. */
  finalPatchId: string;
  /** The patches the merge tree consolidated, for attributing each retained hunk. */
  leaves?: readonly SkillPatch[];
  profile?: SkillFormatProfile;
  forbidden?: readonly string[];
}

export interface CandidateCommitter {
  /** Validate, apply and plan over copies. Nothing is read from or written to the store. */
  prepare(patch: SkillPatch): PreparedCandidate;
  /** The one application. A patch that is not this run's final patch is refused. */
  commit(patch: SkillPatch): Promise<Trace2SkillOutcome<CommittedCandidate>>;
  /** How many patches this run has applied. */
  readonly applications: number;
}

/** Lines a hunk writes and lines it covers: the compiler's own receipt, not a diff guess. */
function lineDelta(compiled: CompiledPatch): { linesAdded: number, linesRemoved: number } {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const hunk of compiled.hunks) {
    linesAdded += hunk.replacement === '' ? 0 : splitLines(hunk.replacement).length;
    linesRemoved += hunk.endLine - hunk.startLine;
  }
  return { linesAdded, linesRemoved };
}

/** The site an operation edits, so a merged hunk can be traced back to what proposed it. */
function siteOf(operation: PatchOperation): string {
  const prefix = `${operation.path} ${operation.op} `;
  if (operation.op === 'create_file') return prefix;
  return prefix + ('from' in operation ? operation.from : operation.anchor);
}

/**
 * Which trajectories stand behind each retained hunk. A hunk is attributed to
 * every source patch that edited the same site, or whose text the merged text
 * carries; a hunk nothing explains is counted rather than quietly credited to
 * the whole pool.
 */
export function hunkProvenance(
  compiled: CompiledPatch,
  leaves: readonly SkillPatch[],
): Array<{ path: string, opIndex: number, sourceRolloutIds: string[] }> {
  return compiled.hunks.map(hunk => {
    const site = `${hunk.path} ${hunk.op} `;
    const rollouts = new Set<string>();
    for (const leaf of leaves) {
      for (const operation of leaf.operations) {
        const matches = siteOf(operation).startsWith(site)
          && (hunk.op === 'create_file' || hunk.replacement.includes(operation.op === 'delete_section' ? '' : operation.content ?? ''));
        if (!matches) continue;
        for (const rolloutId of leaf.sourceRolloutIds) rollouts.add(rolloutId);
      }
    }
    return { path: hunk.path, opIndex: hunk.opIndex, sourceRolloutIds: [...rollouts].sort(byPath) };
  });
}

/**
 * The guarded consumer that turns one validated patch into one staged
 * directory. Its validators are synchronous because the editor's are; every
 * model-backed judgement has already run as a recorded merge node, and what
 * happens here is the pure re-check of the same compiler, format validator
 * and leak boundary before anything is written.
 */
export function createCandidateCommitter(options: CandidateCommitterOptions): CandidateCommitter {
  const profile = options.profile ?? MINIMAL_SKILL_PROFILE;
  const forbidden = options.forbidden ?? [];
  const leaves = options.leaves ?? [];
  const frozen: FrozenSkill = { bundle: options.frozen.bundle, files: draftsOf(options.frozen.files) };
  const previousText = new Map(frozen.files.map(file => [file.path, file.content ?? '']));
  let compiled: CompiledPatch | null = null;
  let applications = 0;

  const compile = (patch: SkillPatch): Trace2SkillOutcome<CompiledPatch> => {
    const outcome = compilePatch(frozen, patch, { forbidden, profile });
    if (!outcome.valid) return outcome;
    if (outcome.value.withheld.length > 0) {
      return trace2SkillRefusal<CompiledPatch>([
        trace2SkillIssue('TT2S1004', '/operations',
          `${outcome.value.withheld.length} hunk(s) of the final patch are withheld against the frozen directory`),
        ...outcome.value.issues,
      ]);
    }
    return outcome;
  };

  const guarded = createGuardedRefiner({
    read: async (): Promise<SkillDocument> => ({ files: draftsOf(options.frozen.files) }),
    validateProposal: (proposal: unknown) => {
      compiled = null;
      const shape = validateTrace2SkillShape<SkillPatch>('skillPatch', proposal);
      if (!shape.valid) return { valid: false, errors: asErrors(shape.issues) };
      const outcome = compile(shape.value);
      if (!outcome.valid) return { valid: false, errors: asErrors(outcome.issues) };
      return { valid: true, errors: [] };
    },
    apply: (document: SkillDocument, proposal: SkillPatch): SkillDocument => {
      const outcome = compile(proposal);
      if (!outcome.valid) throw new ApplyRefusal(outcome.issues);
      const applied = applyCompiled(document.files, outcome.value, profile);
      if (!applied.valid) throw new ApplyRefusal(applied.issues);
      compiled = outcome.value;
      return { files: applied.value };
    },
    applyFailure: (error: unknown) => error instanceof ApplyRefusal
      ? asErrors(error.issues)[0]
      : { code: 'TT2S1004', docPath: '/operations', message: error instanceof Error ? error.message : String(error) },
    validateCandidate: (next: SkillDocument, previous: SkillDocument) => {
      const format = validateFormat(next.files, profile);
      if (!format.valid) return { valid: false, errors: asErrors(format.issues) };
      const known = new Set(previous.files.map(file => file.path));
      const rootMoved = (next.files.find(file => file.path === SKILL_ROOT_FILE)?.content ?? '')
        !== (previous.files.find(file => file.path === SKILL_ROOT_FILE)?.content ?? '');
      const added = next.files.some(file => !known.has(file.path));
      if (!rootMoved && !added) {
        return {
          valid: false,
          errors: asErrors([trace2SkillIssue('TT2S1005', '/files',
            'the candidate neither changed the root page nor added a file, so it is the frozen directory again')]),
        };
      }
      return { valid: true, errors: [] };
    },
    planCommit: (next: SkillDocument, previous: SkillDocument) => {
      if (compiled === null) {
        return { valid: false, errors: asErrors([trace2SkillIssue('TT2S1004', '/operations', 'the plan has no compiled patch behind it')]) };
      }
      const manifest = (document: SkillDocument): Record<string, string> =>
        Object.fromEntries([...document.files].sort((a, b) => byPath(a.path, b.path)).map(file => [file.path, file.content ?? '']));
      const moved = createJSONPatch(manifest(previous), manifest(next)) as Array<{ op: string }>;
      const attribution = hunkProvenance(compiled, leaves);
      const unattributed = attribution.filter(entry => entry.sourceRolloutIds.length === 0);
      const previousLines = [...previousText.values()].reduce((total, text) => total + splitLines(text).length, 0);
      const { linesAdded, linesRemoved } = lineDelta(compiled);
      const plan: CandidatePlan = {
        files: next.files,
        diffSummary: {
          filesAdded: moved.filter(operation => operation.op === 'add').length,
          filesChanged: moved.filter(operation => operation.op === 'replace').length,
          linesAdded, linesRemoved,
        },
        churn: previousLines === 0 ? 0 : (linesAdded + linesRemoved) / previousLines,
        semantic: {
          valid: unattributed.length === 0,
          issues: unattributed.map(entry => trace2SkillIssue('TT2S1007', `/hunks/${entry.opIndex}`,
            `the retained edit to ${entry.path} names no source trajectory`)),
        },
      };
      return { valid: true, errors: [], plan };
    },
    commit: async (plan: CandidatePlan): Promise<CommittedCandidate> => {
      const sealed = await sealSkillBundle(plan.files, {
        scopeKey: options.run.scopeKey, mode: options.run.mode, origin: 'evolved',
        parentId: options.frozen.bundle.id, status: 'staged', profile,
      });
      if (!sealed.valid) throw new ApplyRefusal(sealed.issues);
      const payload = {
        runId: options.run.id, scopeKey: options.run.scopeKey, finalPatchId: options.finalPatchId,
        bundleId: sealed.value.bundle.id, parentId: options.frozen.bundle.id,
        structural: { valid: true, issues: [] as Trace2SkillIssue[] },
        semantic: plan.semantic,
        diffSummary: plan.diffSummary,
        churn: plan.churn,
      };
      const candidate: SkillCandidate = { id: await canonicalSha256(payload), ...payload };
      const written = await options.store.putStagedCandidate(sealed.value, candidate);
      if (!written.valid) throw new ApplyRefusal(written.issues);
      return { candidate: written.value, snapshot: sealed.value };
    },
  });

  return {
    get applications() { return applications; },
    prepare(patch: SkillPatch): PreparedCandidate {
      const prepared = guarded.prepare({ files: draftsOf(options.frozen.files) }, patch) as
        { valid: boolean, errors: unknown[], plan?: CandidatePlan };
      return {
        valid: prepared.valid,
        issues: prepared.valid ? [] : asIssues(prepared.errors),
        plan: prepared.valid ? prepared.plan ?? null : null,
      };
    },
    async commit(patch: SkillPatch): Promise<Trace2SkillOutcome<CommittedCandidate>> {
      if (patch.id !== options.finalPatchId) {
        return trace2SkillRefuse<CommittedCandidate>('TT2S1008', '/finalPatchId',
          'only the final patch of the merge tree is applied; an intermediate result is not');
      }
      if (applications > 0) {
        return trace2SkillRefuse<CommittedCandidate>('TT2S1008', '/applications', 'the run has already applied its one patch');
      }
      const result = await guarded.commit(patch) as
        { ok: boolean, value?: CommittedCandidate, errors?: unknown[], stage?: string, cause?: unknown };
      if (!result.ok) {
        const issues = asIssues(result.errors ?? []);
        return { valid: false, issues: issues.length > 0 ? issues : [trace2SkillIssue('TT2S1004', '/commit', `the guarded editor stopped at ${String(result.stage)}`, result.cause)] };
      }
      applications++;
      return { valid: true, value: result.value as CommittedCandidate };
    },
  };
}

export interface ConsolidationCounts extends MergeCounts {
  /** How many patches this run applied to the frozen directory. */
  applications: number;
  /** Retained edits the run could not trace to a trajectory. */
  unattributed: number;
}

export interface Consolidation {
  fanOut: MergeFanOut;
  final: SkillPatch | null;
  candidate: SkillCandidate | null;
  snapshot: SkillSnapshot | null;
  counts: ConsolidationCounts;
  issues: Trace2SkillIssue[];
}

export interface ConsolidateDeps extends MergeDeps {
  leaves?: readonly SkillPatch[];
}

/**
 * The whole consolidation stage: plan, merge level by level, then apply the
 * one surviving patch through the guarded committer. A run that already
 * staged its candidate replays it — the same identity, no model call and no
 * second application — because the candidate is the receipt of an application
 * that already happened.
 */
export async function consolidate(run: EvolutionRun, pool: readonly SkillPatch[], deps: ConsolidateDeps): Promise<Consolidation> {
  const staged = (await deps.store.listBy(run.scopeKey, 'candidates')).find(candidate => candidate.runId === run.id);
  const fanOut = await mergePatches(run, pool, deps);
  const counts: ConsolidationCounts = { ...fanOut.counts, applications: 0, unattributed: 0 };
  const issues = [...fanOut.issues];
  if (fanOut.final === null) {
    return { fanOut, final: null, candidate: null, snapshot: null, counts, issues };
  }
  if (staged !== undefined) {
    const snapshot = await deps.store.getSnapshot(staged.bundleId);
    if (!snapshot.valid) issues.push(...snapshot.issues);
    counts.unattributed = staged.semantic.issues.length;
    return {
      fanOut, final: fanOut.final, candidate: staged,
      snapshot: snapshot.valid ? snapshot.value : null, counts, issues,
    };
  }
  const committer = createCandidateCommitter({
    store: deps.store, run, frozen: deps.snapshot, finalPatchId: fanOut.final.id,
    leaves: deps.leaves ?? pool,
    ...(deps.profile === undefined ? {} : { profile: deps.profile }),
    ...(deps.forbidden === undefined ? {} : { forbidden: deps.forbidden }),
  });
  const committed = await committer.commit(fanOut.final);
  if (!committed.valid) {
    issues.push(...committed.issues);
    return { fanOut, final: fanOut.final, candidate: null, snapshot: null, counts, issues };
  }
  counts.applications = committer.applications;
  counts.written++;
  counts.unattributed = committed.value.candidate.semantic.issues.length;
  issues.push(...committed.value.candidate.semantic.issues);
  deps.trajectory?.add({
    kind: 'candidate', candidateId: committed.value.candidate.id,
    bundleId: committed.value.candidate.bundleId, finalPatchId: fanOut.final.id,
  });
  return {
    fanOut, final: fanOut.final, candidate: committed.value.candidate,
    snapshot: committed.value.snapshot, counts, issues,
  };
}
