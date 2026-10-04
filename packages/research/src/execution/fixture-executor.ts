/** Trusted fixture functions are deterministic controls, not an isolation boundary for authored code. */
import type { ExecutionManifest, ProgramParams, ResearchRawOutput } from '../contracts.gen.ts';
import { immutableResearchJson, copyResearchBytes } from '../identity.ts';
import { researchIssue } from '../errors.ts';
import { ResearchFailure, researchFail, researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { captureResearchWorkspace, executionLimitsOf, researchExecutionOutcome, validateExecutionManifest,
  type ResearchExecutionLimits } from './manifest.ts';
import { RESEARCH_EXECUTOR_CONTRACT, RESEARCH_RAW_OUTPUT_PATH, researchRawOutputBytes, researchExecutionResult,
  type ResearchExecutor, type ResearchExecutionSettlement } from './executor.ts';

export type ResearchFixtureProgram = (input: { bytes: Uint8Array; seed: number; params: ProgramParams; signal: AbortSignal }) => Promise<ResearchRawOutput>;
export function createFixtureExecutor(programs: Readonly<Record<string, ResearchFixtureProgram>>, options: {
  now: () => number; limits?: ResearchExecutionLimits;
}): ResearchExecutor {
  const registered = new Map(Object.entries(programs)), now = options.now, limits = executionLimitsOf(options.limits);
  if ([...registered.values()].some(program => typeof program !== 'function')) throw new TypeError('Fixture programs must be functions.');
  return Object.freeze({ contract: RESEARCH_EXECUTOR_CONTRACT,
    capability: async () => ({ valid: true as const, value: { available: true, kind: 'fixture' as const, engine: null, version: null,
      imageDigests: [], reason: 'Trusted pure fixture functions; no operating-system isolation or image execution.' } }),
    run: (input, supplied, context) => researchExecutionOutcome(async () => {
      const manifest: ExecutionManifest = immutableResearchJson(input), workspace = captureResearchWorkspace(supplied);
      const registration = immutableResearchJson({ contract: context.contract, plan: context.plan });
      const signal = context.signal;
      researchValue(await validateExecutionManifest(manifest, workspace, registration, limits));
      if (manifest.codeArtifactId || !manifest.programId || !registered.has(manifest.programId))
        researchFail('TRSH1003', '/programId', 'Fixture execution requires an explicitly registered pure program; authored code is refused.');
      if (manifest.network.setup !== 'off') researchFail('TRSH1010', '/network/setup', 'Fixture execution has no network setup phase.');
      const dataset = registration.contract.datasets.find(row => row.id === manifest.datasetId)!;
      const bytes = copyResearchBytes(workspace.artifacts.find(row => row.artifactId === 'art-' + dataset.sha256)!.bytes);
      const start = now();
      const settlement: ResearchExecutionSettlement = { exitStatus: null, stdout: new Uint8Array(), stderr: new Uint8Array(),
        files: [], output: null, resources: { wallMs: 0, cpuMs: null, peakMemoryBytes: null }, stopReason: 'completed',
        isolation: { kind: 'fixture', imageDigest: manifest.imageDigest, verified: false, setupLogArtifactId: null, completeOutput: true }, error: null };
      if (signal.aborted) {
        settlement.stopReason = 'cancelled'; settlement.error = researchIssue('TRSH1008', '/signal', 'Fixture execution was cancelled before dispatch.');
      } else {
        try {
          const output = researchValue(validateResearchShape<ResearchRawOutput>('ResearchRawOutput',
            await registered.get(manifest.programId)!({ bytes, seed: manifest.seed, params: manifest.params, signal })));
          const raw = researchRawOutputBytes(output);
          if (signal.aborted) { settlement.stopReason = 'cancelled'; settlement.error = researchIssue('TRSH1008', '/signal', 'Fixture execution was cancelled.'); }
          else if (raw.byteLength > manifest.resources.outputBytes) {
            settlement.stopReason = 'output-bytes'; settlement.isolation.completeOutput = false;
            settlement.files = [{ path: RESEARCH_RAW_OUTPUT_PATH, bytes: raw.slice(0, manifest.resources.outputBytes) }];
            settlement.error = researchIssue('TRSH1006', '/output', 'Fixture output exceeded its byte cap; the retained prefix is not an observation.');
          } else { settlement.output = output; settlement.files = [{ path: RESEARCH_RAW_OUTPUT_PATH, bytes: raw }]; settlement.exitStatus = 0; }
        } catch (cause) {
          settlement.exitStatus = 1;
          settlement.stopReason = signal.aborted ? 'cancelled' : 'completed';
          settlement.error = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '/program', 'Fixture program failed.', cause);
          settlement.stderr = new TextEncoder().encode(settlement.error.detail).slice(0, manifest.resources.outputBytes);
        }
      }
      settlement.resources.wallMs = Math.max(0, now() - start);
      if (settlement.resources.wallMs > manifest.resources.wallMs && settlement.stopReason === 'completed') {
        settlement.stopReason = 'timeout'; settlement.error = researchIssue('TRSH1006', '/resources/wallMs', 'Trusted fixture exceeded its declared elapsed-time cap.');
      }
      return researchValue(await researchExecutionResult(manifest, settlement, limits));
    }),
  } satisfies ResearchExecutor);
}
