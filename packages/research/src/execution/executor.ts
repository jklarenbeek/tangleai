/** Execution receipts bind the shipped executor contract to immutable research inputs. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { EVOLVE_EXECUTOR_MANIFEST, type EvolveExecutorManifest } from '@tangleai/evolve';
import type { ExecutionManifest, ExperimentRun, ResearchContract, ExperimentPlan, ResearchRawOutput,
  ResearchIssue, ResearchStopReason, ResearchExecutionIsolation, ResearchResourceUsage, ResearchOutputFile, ResearchExecutorCapability } from '../contracts.gen.ts';
import type { ResearchOutcome } from '../errors.ts';
import { researchIssue } from '../errors.ts';
import { copyResearchBytes, immutableResearchJson, researchArtifactIdOf, researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { captureResearchWorkspace, executionLimitsOf, isResearchWorkspacePath, researchExecutionOutcome,
  validateExecutionManifest, type ResearchWorkspace, type ResearchExecutionArtifact, type ResearchExecutionLimits } from './manifest.ts';

export interface ResearchExecutionContext { contract: ResearchContract; plan: ExperimentPlan; signal: AbortSignal }
export interface ResearchExecutionResult { run: ExperimentRun; artifacts: ResearchExecutionArtifact[] }
/** Evolve owns host processes; research adds a domain receipt, never a second process runner. */
export interface ResearchExecutor {
  readonly contract: EvolveExecutorManifest;
  capability(options: { signal: AbortSignal }): Promise<ResearchOutcome<ResearchExecutorCapability>>;
  run(manifest: ExecutionManifest, workspace: ResearchWorkspace, context: ResearchExecutionContext): Promise<ResearchOutcome<ResearchExecutionResult>>;
}
export interface ResearchExecutionSettlement {
  exitStatus: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
  files: Array<{ path: string; bytes: Uint8Array }>;
  output: ResearchRawOutput | null;
  resources: ResearchResourceUsage;
  stopReason: ResearchStopReason;
  isolation: ResearchExecutionIsolation;
  error: ResearchIssue | null;
}
export const RESEARCH_RAW_OUTPUT_PATH = 'output/raw.json';
const encoder = new TextEncoder();

/** Trusted executors call this after settlement; consumers independently validate the receipt. */
export async function researchExecutionResult(manifest: ExecutionManifest, input: ResearchExecutionSettlement,
  options?: ResearchExecutionLimits): Promise<ResearchOutcome<ResearchExecutionResult>> {
  const limits = executionLimitsOf(options);
  return researchExecutionOutcome(async () => {
    const pinned = immutableResearchJson(manifest);
    const { stdout, stderr, files, ...metadata } = input;
    const value = immutableResearchJson(metadata), out = copyResearchBytes(stdout), err = copyResearchBytes(stderr);
    const captured = files.map(row => ({ path: row.path, bytes: copyResearchBytes(row.bytes) }));
    if (captured.length > limits.maxOutputFiles || out.byteLength + err.byteLength
      + captured.reduce((sum, row) => sum + row.bytes.byteLength, 0) > pinned.resources.outputBytes)
      researchFail('TRSH1010', '/output', 'Retained output exceeds the admitted file or aggregate byte bound.');
    const artifacts = new Map<string, ResearchExecutionArtifact>();
    const put = async (bytes: Uint8Array) => {
      const artifactId = await researchArtifactIdOf(bytes); artifacts.set(artifactId, { artifactId, bytes }); return artifactId;
    };
    const stdoutArtifactId = await put(out), stderrArtifactId = await put(err);
    const inventory: ResearchOutputFile[] = [];
    for (const file of captured) {
      if (!isResearchWorkspacePath(file.path, limits.maxPathBytes) || !file.path.startsWith('output/'))
        researchFail('TRSH1010', '/output/path', 'Captured files must remain in the declared output directory.');
      const artifactId = await put(file.bytes);
      inventory.push({ path: file.path, artifactId, sha256: artifactId.slice(4), bytes: file.bytes.byteLength });
    }
    inventory.sort((a, b) => a.path.localeCompare(b.path));
    if (new Set(inventory.map(row => row.path.toLowerCase())).size !== inventory.length
      || inventory.some(row => inventory.some(other => other.path.toLowerCase().startsWith(row.path.toLowerCase() + '/'))))
      researchFail('TRSH1010', '/outputInventory', 'Captured output paths must identify unique regular files.');
    const rawArtifactHash = value.output === null ? null : await researchRevisionOf(value.output);
    if (rawArtifactHash && !captured.some(row => row.path === RESEARCH_RAW_OUTPUT_PATH
      && new TextDecoder('utf-8', { fatal: true }).decode(row.bytes) === canonicalizeJson(value.output)))
      researchFail('TRSH1002', '/output', 'Structured raw output must resolve to the exact retained canonical file.');
    const ok = value.exitStatus === 0 && value.stopReason === 'completed' && value.isolation.completeOutput
      && value.output !== null && value.error === null;
    const body: Omit<ExperimentRun, 'id'> = { projectId: pinned.projectId, condition: pinned.condition!,
      programId: pinned.programId ?? pinned.codeArtifactId!, seed: pinned.seed, status: ok ? 'ok' : 'failed',
      inputHash: pinned.workspaceHash, executionManifestHash: pinned.executionManifestHash, rawArtifactHash, output: value.output,
      trace: [{ event: 'start', detail: pinned.id }, { event: ok ? 'output' : 'failure', detail: value.stopReason }],
      spend: { calls: 0, tokens: 0, ms: Math.ceil(value.resources.wallMs ?? 0), physical: 1 },
      error: ok ? null : value.error ?? researchIssue('TRSH1008', '/execution', 'Experiment did not produce a complete successful raw output.'),
      exitStatus: value.exitStatus, stdoutArtifactId, stderrArtifactId, outputInventory: inventory,
      resources: value.resources, stopReason: value.stopReason, isolation: value.isolation };
    const run = researchValue(validateResearchShape<ExperimentRun>('ExperimentRun', { ...body, id: 'run-' + await researchRevisionOf(body) }));
    return { run, artifacts: [...artifacts.values()] };
  });
}

/** Rebuild the whole receipt, including all byte addresses and run identity, at every external seam. */
export async function validateResearchExecutionResult(input: ResearchExecutionResult, manifest: ExecutionManifest,
  workspace: ResearchWorkspace, registration: Pick<ResearchExecutionContext, 'contract' | 'plan'>,
  options?: ResearchExecutionLimits): Promise<ResearchOutcome<ResearchExecutionResult>> {
  return researchExecutionOutcome(async () => {
    const run = researchValue(validateResearchShape<ExperimentRun>('ExperimentRun', input.run));
    const artifacts = input.artifacts.map(row => ({ artifactId: row.artifactId, bytes: copyResearchBytes(row.bytes) }));
    const captured = captureResearchWorkspace(workspace);
    const pinned = researchValue(await validateExecutionManifest(manifest, captured, registration, options));
    if (run.projectId !== pinned.projectId || run.condition !== pinned.condition
      || run.programId !== (pinned.programId ?? pinned.codeArtifactId) || run.seed !== pinned.seed)
      researchFail('TRSH1003', '/run', 'Run does not belong to this registered condition, program and seed.');
    if (!run.stdoutArtifactId || !run.stderrArtifactId || !run.outputInventory || !run.resources || !run.stopReason || !run.isolation)
      researchFail('TRSH1007', '/run', 'Execution receipt lacks settlement evidence.');
    if (run.isolation.imageDigest !== pinned.imageDigest || run.isolation.setupLogArtifactId !== null
      || run.isolation.kind === 'fixture' && run.isolation.verified || run.isolation.kind === 'container' && !run.isolation.verified)
      researchFail('TRSH1010', '/isolation', 'Isolation evidence must bind the image and distinguish fixtures from containers.');
    const expected = new Set([run.stdoutArtifactId, run.stderrArtifactId, ...run.outputInventory.map(row => row.artifactId)]);
    if (expected.size !== artifacts.length || artifacts.some(row => !expected.has(row.artifactId))
      || new Set(artifacts.map(row => row.artifactId)).size !== artifacts.length)
      researchFail('TRSH1002', '/artifacts', 'Every and only receipted artifact must be retained.');
    for (const artifact of artifacts) if (artifact.artifactId !== await researchArtifactIdOf(artifact.bytes))
      researchFail('TRSH1002', '/artifacts', 'Captured output bytes do not match their identity.');
    const bytes = (id: string) => artifacts.find(row => row.artifactId === id)!.bytes;
    const rebuilt = researchValue(await researchExecutionResult(pinned, { exitStatus: run.exitStatus ?? null,
      stdout: bytes(run.stdoutArtifactId), stderr: bytes(run.stderrArtifactId),
      files: run.outputInventory.map(row => ({ path: row.path, bytes: bytes(row.artifactId) })), output: run.output,
      resources: run.resources, stopReason: run.stopReason, isolation: run.isolation, error: run.error }, options));
    if (!equalsJson(rebuilt.run, run)) researchFail('TRSH1002', '/run', 'Execution receipt does not recompute from its retained bytes and frozen manifest.');
    return rebuilt;
  });
}

export const RESEARCH_EXECUTOR_CONTRACT = EVOLVE_EXECUTOR_MANIFEST;
export function researchRawOutputBytes(output: ResearchRawOutput): Uint8Array { return encoder.encode(canonicalizeJson(output)); }
