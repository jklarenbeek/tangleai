/** Content-addressed execution admission; no process, filesystem or clock access. */
import { composeChecks, checkOutcome } from '@jarenjs/core/check';
import { equalsJson } from '@jarenjs/core/object';
import { EVOLVE_EXECUTOR_MANIFEST } from '@tangleai/evolve';
import type { WorkspaceManifest, ExecutionManifest, ExecutionManifestResources, ResearchContract, ExperimentPlan,
  ResearchStopReason, WorkspaceManifestEntriesItem } from '../contracts.gen.ts';
import { copyResearchBytes, immutableResearchJson, researchArtifactIdOf, researchRevisionOf } from '../identity.ts';
import { researchIssue, researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';
import { ResearchFailure, researchFail, researchValue } from '../workflow-contract.ts';

export const RESEARCH_STOP_REASONS: readonly ResearchStopReason[] = Object.freeze([
  'completed', 'timeout', 'memory', 'pids', 'output-bytes', 'cancelled', 'isolation-refused',
]);
export interface ResearchExecutionLimits {
  maxFiles: number;
  maxInputBytes: number;
  maxPathBytes: number;
  maxOutputFiles: number;
  resources: ExecutionManifestResources;
}
export const RESEARCH_EXECUTION_LIMITS: Readonly<ResearchExecutionLimits> = immutableResearchJson({
  maxFiles: 64, maxInputBytes: 4194304, maxPathBytes: 256, maxOutputFiles: 128,
  resources: { cpu: 4, memoryBytes: 2147483648, pids: 128, wallMs: 120000, outputBytes: 1048576 },
});
export interface ResearchExecutionArtifact { artifactId: string; bytes: Uint8Array }
export interface ResearchWorkspace { manifest: WorkspaceManifest; artifacts: ResearchExecutionArtifact[] }
export interface ResearchWorkspaceFile {
  path: string;
  bytes: Uint8Array;
  mode: WorkspaceManifestEntriesItem['mode'];
  role: WorkspaceManifestEntriesItem['role'];
}
const encoder = new TextEncoder();
const forbidden = new Set(['hidden', 'secrets', '.env', '.git', '.ssh', '.aws', '.config', 'proc', 'sys', 'dev', 'etc']);

/** The same logical-path policy is used by archives, authoring and output capture. */
export function isResearchWorkspacePath(path: unknown, maxBytes = RESEARCH_EXECUTION_LIMITS.maxPathBytes): path is string {
  return typeof path === 'string' && encoder.encode(path).byteLength <= maxBytes
    && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)
    && path.split('/').every(part => part !== '.' && part !== '..' && !forbidden.has(part.toLowerCase())
      && !part.toLowerCase().startsWith('.env.'));
}
export function executionLimitsOf(input: ResearchExecutionLimits = RESEARCH_EXECUTION_LIMITS): ResearchExecutionLimits {
  const value = immutableResearchJson(input);
  for (const key of ['maxFiles', 'maxInputBytes', 'maxPathBytes', 'maxOutputFiles'] as const)
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > RESEARCH_EXECUTION_LIMITS[key])
      throw new TypeError('Execution limits must be positive and cannot widen the published ceiling.');
  for (const key of ['cpu', 'memoryBytes', 'pids', 'wallMs', 'outputBytes'] as const)
    if (!Number.isFinite(value.resources[key]) || value.resources[key] <= 0
      || key !== 'cpu' && !Number.isSafeInteger(value.resources[key])
      || value.resources[key] > RESEARCH_EXECUTION_LIMITS.resources[key])
      throw new TypeError('Execution resource limits must be finite and cannot widen the published ceiling.');
  return value;
}
export async function researchExecutionOutcome<T>(body: () => Promise<T>): Promise<ResearchOutcome<T>> {
  try { return { valid: true, value: await body() }; }
  catch (cause) {
    return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
      : researchRefuse('TRSH1008', '/execution', 'Execution admission or settlement failed.', cause);
  }
}
function checkEntries(manifest: WorkspaceManifest, limits: ResearchExecutionLimits): void {
  const checks = composeChecks(
    () => manifest.outputDirectory === 'output' && manifest.entries.length <= limits.maxFiles
      || { valid: false, errors: [researchIssue('TRSH1010', '/workspace', 'Workspace needs its declared output directory and a bounded file count.')] },
    () => {
      const paths = new Set<string>();
      for (const [index, entry] of manifest.entries.entries()) {
        const key = entry.path.toLowerCase();
        if (!isResearchWorkspacePath(entry.path, limits.maxPathBytes) || key === 'output' || paths.has(key)
          || manifest.entries.some(other => other !== entry && other.path.toLowerCase().startsWith(key + '/')))
          return { valid: false, errors: [researchIssue('TRSH1010', '/workspace/entries/' + index + '/path', 'Workspace paths must be unique, contained files without hidden or secret inputs.')] };
        paths.add(key);
        if (entry.role === 'output' ? entry.mode !== 'writable' || !entry.path.startsWith('output/')
          : entry.mode !== 'read-only' || entry.path.startsWith('output/'))
          return { valid: false, errors: [researchIssue('TRSH1010', '/workspace/entries/' + index + '/mode', 'Only declared output files are writable; code, inputs and evaluator remain read-only.')] };
      }
      return true;
    },
  );
  const checked = checkOutcome(checks(manifest));
  if (!checked.valid) throw new ResearchFailure(checked.errors[0]);
}
export function captureResearchWorkspace(input: ResearchWorkspace): ResearchWorkspace {
  const manifest = researchValue(validateResearchShape<WorkspaceManifest>('WorkspaceManifest', input.manifest));
  return { manifest, artifacts: input.artifacts.map(row => ({ artifactId: row.artifactId, bytes: copyResearchBytes(row.bytes) })) };
}
export async function validateResearchWorkspace(input: ResearchWorkspace, options?: ResearchExecutionLimits): Promise<ResearchOutcome<ResearchWorkspace>> {
  const limits = executionLimitsOf(options);
  return researchExecutionOutcome(async () => {
    const workspace = captureResearchWorkspace(input), { manifest, artifacts } = workspace;
    checkEntries(manifest, limits);
    if (artifacts.length > limits.maxFiles || new Set(artifacts.map(row => row.artifactId)).size !== artifacts.length
      || artifacts.reduce((total, row) => total + row.bytes.byteLength, 0) > limits.maxInputBytes)
      researchFail('TRSH1010', '/workspace/artifacts', 'Workspace archive exceeds its file or byte bounds, or repeats an address.');
    const expected = new Set(manifest.entries.map(row => row.artifactId));
    if (expected.size !== artifacts.length || artifacts.some(row => !expected.has(row.artifactId)))
      researchFail('TRSH1002', '/workspace/artifacts', 'Every and only declared content address must be supplied.');
    if (manifest.entries.reduce((total, row) => total + artifacts.find(artifact => artifact.artifactId === row.artifactId)!.bytes.byteLength, 0) > limits.maxInputBytes)
      researchFail('TRSH1010', '/workspace/entries', 'Materialized files exceed the input byte cap, including shared content addresses.');
    for (const artifact of artifacts) if (artifact.artifactId !== await researchArtifactIdOf(artifact.bytes))
      researchFail('TRSH1002', '/workspace/artifacts', 'Workspace bytes do not match their content address.');
    const { id, workspaceHash, ...body } = manifest;
    if (workspaceHash !== await researchRevisionOf(body) || id !== 'workspace-' + workspaceHash)
      researchFail('TRSH1002', '/workspace/workspaceHash', 'Workspace identity does not recompute.');
    return workspace;
  });
}
export async function createResearchWorkspace(input: { projectId: string; files: ResearchWorkspaceFile[];
  datasetIds: string[]; splitIds: string[] }, options?: ResearchExecutionLimits): Promise<ResearchOutcome<ResearchWorkspace>> {
  const limits = executionLimitsOf(options);
  return researchExecutionOutcome(async () => {
    const owner = immutableResearchJson({ projectId: input.projectId, datasetIds: input.datasetIds, splitIds: input.splitIds });
    const files = input.files.map(({ bytes, ...file }) => ({ ...immutableResearchJson(file), bytes: copyResearchBytes(bytes) }));
    if (files.length > limits.maxFiles || files.reduce((sum, row) => sum + row.bytes.byteLength, 0) > limits.maxInputBytes)
      researchFail('TRSH1010', '/workspace/files', 'Workspace exceeds its declared file or input byte cap.');
    const entries: WorkspaceManifestEntriesItem[] = [], artifacts = new Map<string, ResearchExecutionArtifact>();
    for (const file of files) {
      const artifactId = await researchArtifactIdOf(file.bytes);
      entries.push({ path: file.path, mode: file.mode, role: file.role, artifactId }); artifacts.set(artifactId, { artifactId, bytes: file.bytes });
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    const body = { ...owner, entries, datasetIds: [...owner.datasetIds].sort(), splitIds: [...owner.splitIds].sort(), outputDirectory: 'output' as const };
    const workspaceHash = await researchRevisionOf(body);
    return researchValue(await validateResearchWorkspace({ manifest: { ...body, id: 'workspace-' + workspaceHash, workspaceHash }, artifacts: [...artifacts.values()] }, limits));
  });
}
export interface ResearchExecutionManifestInput {
  contract: ResearchContract;
  plan: ExperimentPlan;
  workspace: ResearchWorkspace;
  branchId: string;
  condition: string;
  seed: number;
  imageDigest: string;
  dependencyLockHash: string;
  resources: ExecutionManifestResources;
  network?: ExecutionManifest['network'];
  codeArtifactId?: string;
}
export async function buildExecutionManifest(input: ResearchExecutionManifestInput, options?: ResearchExecutionLimits): Promise<ResearchOutcome<ExecutionManifest>> {
  const limits = executionLimitsOf(options);
  return researchExecutionOutcome(async () => {
    const { workspace: supplied, ...rest } = input, value = immutableResearchJson(rest);
    const captured = captureResearchWorkspace(supplied);
    const network = value.network ?? { setup: 'off', measured: 'off' };
    if (network.measured !== 'off' || !['off', 'logged'].includes(network.setup)) researchFail('TRSH1010', '/network', 'Measured execution cannot use the network.');
    if (typeof value.imageDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.imageDigest))
      researchFail('TRSH1010', '/imageDigest', 'Execution requires an immutable image digest.');
    for (const key of ['cpu', 'memoryBytes', 'pids', 'wallMs', 'outputBytes'] as const)
      if (!Number.isFinite(value.resources?.[key]) || value.resources[key] <= 0 || value.resources[key] > limits.resources[key]
        || key !== 'cpu' && !Number.isSafeInteger(value.resources[key])) researchFail('TRSH1010', '/resources/' + key, 'Execution resource request exceeds its finite host cap.');
    const contract = researchValue(validateResearchShape<ResearchContract>('ResearchContract', value.contract));
    const plan = researchValue(validateResearchShape<ExperimentPlan>('ExperimentPlan', value.plan));
    const { contractHash, ...contractBody } = contract, { planHash, ...planBody } = plan;
    if (contractHash !== await researchRevisionOf(contractBody) || planHash !== await researchRevisionOf(planBody)
      || plan.contractHash !== contractHash || plan.projectId !== contract.projectId)
      researchFail('TRSH1009', '/preregistration', 'The frozen contract and plan identities must match their unchanged content.');
    const workspace = researchValue(await validateResearchWorkspace(captured, limits));
    if (workspace.manifest.projectId !== contract.projectId) researchFail('TRSH1003', '/workspace/projectId', 'Workspace belongs to another project.');
    const condition = plan.conditions.find(row => row.id === value.condition);
    if (!condition) researchFail('TRSH1003', '/condition', 'Execution condition is not registered.');
    if (!contract.replicatePolicy.seeds.includes(value.seed)) researchFail('TRSH1006', '/seed', 'Execution seed is not preregistered.');
    if (new Set(plan.conditions.map(row => row.id)).size !== plan.conditions.length
      || plan.conditions.some(row => !contract.datasets.some(dataset => dataset.id === row.datasetId))
      || plan.inputPaths.some(path => !workspace.manifest.entries.some(row => row.path === path && row.role === 'input')))
      researchFail('TRSH1009', '/plan', 'Every condition and declared input path must resolve uniquely to frozen dataset inputs.');
    for (const dataset of contract.datasets)
      if (!workspace.manifest.datasetIds.includes(dataset.id) || !workspace.manifest.entries.some(entry => entry.role === 'input'
        && entry.artifactId === 'art-' + dataset.sha256 && plan.inputPaths.includes(entry.path)))
        researchFail('TRSH1009', '/workspace/datasetIds', 'Every registered dataset must resolve to its exact admitted input bytes.');
    if (!equalsJson([...workspace.manifest.datasetIds].sort(), contract.datasets.map(row => row.id).sort())
      || !equalsJson([...workspace.manifest.splitIds].sort(), [...contract.splits.train, ...contract.splits.test].sort())
      || !workspace.manifest.entries.some(entry => entry.role === 'evaluator'))
      researchFail('TRSH1009', '/workspace', 'Workspace must bind the registered datasets, splits and read-only evaluator harness.');
    let entrypoint: string | null = null;
    if (value.codeArtifactId) {
      const entry = workspace.manifest.entries.find(row => row.role === 'code' && row.artifactId === value.codeArtifactId);
      if (!entry) researchFail('TRSH1003', '/codeArtifactId', 'Authored code must resolve to a read-only workspace artifact.');
      entrypoint = entry.path;
    }
    const body = { projectId: contract.projectId, workspaceHash: workspace.manifest.workspaceHash, contractHash, planHash,
      branchId: value.branchId, condition: condition.id, datasetId: condition.datasetId, programId: value.codeArtifactId ? null : condition.programId,
      codeArtifactId: value.codeArtifactId ?? null, entrypoint, seed: value.seed, params: condition.params,
      imageDigest: value.imageDigest, dependencyLockHash: value.dependencyLockHash, resources: value.resources, network,
      evaluator: plan.evaluator, stopReasons: [...RESEARCH_STOP_REASONS], executorContractHash: await researchRevisionOf(EVOLVE_EXECUTOR_MANIFEST) };
    const executionManifestHash = await researchRevisionOf(body);
    return researchValue(validateResearchShape<ExecutionManifest>('ExecutionManifest', { ...body, id: 'execution-' + executionManifestHash, executionManifestHash }));
  });
}
export async function validateExecutionManifest(input: ExecutionManifest, workspace: ResearchWorkspace,
  registration: { contract: ResearchContract; plan: ExperimentPlan }, options?: ResearchExecutionLimits): Promise<ResearchOutcome<ExecutionManifest>> {
  return researchExecutionOutcome(async () => {
    // Isolation refusals retain their meaning even when an untrusted request also
    // violates the closed wire schema. Never call an executor before this gate.
    if (input?.network?.measured !== 'off' || !/^sha256:[0-9a-f]{64}$/.test(input?.imageDigest ?? ''))
      researchFail('TRSH1010', '/manifest', 'Measured execution requires network off and an immutable image digest.');
    const value = researchValue(validateResearchShape<ExecutionManifest>('ExecutionManifest', input));
    const pinned = immutableResearchJson({ contract: registration.contract, plan: registration.plan }), captured = captureResearchWorkspace(workspace);
    if (value.contractHash !== pinned.contract.contractHash || value.planHash !== pinned.plan.planHash)
      researchFail('TRSH1009', '/preregistration', 'Execution must name the active frozen contract and plan.');
    if (!value.condition || !value.datasetId || !value.executorContractHash || value.entrypoint === undefined)
      researchFail('TRSH1007', '/manifest', 'Execution requires the complete versioned runner binding.');
    const built = researchValue(await buildExecutionManifest({ ...pinned, workspace: captured, branchId: value.branchId,
      condition: value.condition, seed: value.seed, imageDigest: value.imageDigest, dependencyLockHash: value.dependencyLockHash,
      resources: value.resources, network: value.network, ...(value.codeArtifactId ? { codeArtifactId: value.codeArtifactId } : {}) }, options));
    if (!equalsJson(value, built)) researchFail('TRSH1002', '/executionManifestHash', 'Execution manifest differs from its frozen inputs or content identity.');
    return built;
  });
}
