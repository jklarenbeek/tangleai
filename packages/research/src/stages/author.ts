/** Native authoring tools write immutable bounded code; only the injected executor may run it. */
import { composeChecks, checkOutcome } from '@jarenjs/core/check';
import { masRevisionOf, type MasRegistry, type MasHostBindings } from '@tangleai/mas';
import type { ResearchStore } from '../store.ts';
import type { ResearchExecutionPolicy } from '../execution-contract.ts';
import type { ResearchStageOperation } from '../handlers.ts';
import type { ResearchContract, ExperimentPlan, ResearchCodeWrite, ResearchIssue } from '../contracts.gen.ts';
import type { ResearchWorkspace } from '../execution/manifest.ts';
import { immutableResearchJson, researchArtifactIdOf, researchRevisionOf } from '../identity.ts';
import { researchIssue } from '../errors.ts';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';

export const RESEARCH_AUTHOR_TOOLS = ['read-plan', 'read-workspace', 'write-code'] as const;
export const RESEARCH_AUTHOR_INSTRUCTIONS = 'Implement only the candidate condition in the frozen research plan. Read features and the declared seed and parameters from the workspace. Write canonical raw experiment output to output/raw.json. Never produce evaluator metrics, access hidden labels, use the network, or change the evaluator or preregistration. Use read-plan and read-workspace to inspect authorized inputs, and write-code to fill an allowed immutable .mjs slot. Return the entrypoint path. Static checks are advisory defense in depth; the host container supplies isolation.';
export const RESEARCH_AUTHOR_PROPOSAL = { type: 'object', additionalProperties: false, required: ['entrypoint'],
  properties: { entrypoint: { type: 'string', minLength: 1, maxLength: 256 } } };
export async function researchAuthorDeclarations(): Promise<MasRegistry['tools']> {
  return Promise.all(RESEARCH_AUTHOR_TOOLS.map(async id => {
    const properties = id === 'read-plan' ? {} : id === 'read-workspace' ? { path: { type: 'string', minLength: 1, maxLength: 256 } }
      : { path: { type: 'string', minLength: 1, maxLength: 256 }, text: { type: 'string', minLength: 1, maxLength: 65536 } };
    const input = { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
    return { id, title: id, effect: id === 'write-code' ? 'effectful' as const : 'pure' as const, input, inputRevision: await masRevisionOf(input) };
  }));
}
export interface ResearchAuthorScope { operation: ResearchStageOperation; contract: ResearchContract; plan: ExperimentPlan; workspace: ResearchWorkspace }
export function researchCodeStaticIssues(text: string): ResearchIssue[] {
  const checked = checkOutcome(composeChecks(
    () => !/hidden[\\/]/i.test(text) || { valid: false, errors: [researchIssue('TRSH1010', '/code', 'Source mentions an excluded hidden path.')] },
    () => !/(?:["'](?:node:)?(?:https?|net|tls|dns|dgram)["']|\b(?:fetch|WebSocket)\s*\()/i.test(text)
      || { valid: false, errors: [researchIssue('TRSH1010', '/code', 'Source mentions a network import or operation.')] },
  )(text));
  return checked.valid ? [] : checked.errors;
}
export async function researchCodeWriteId(attemptId: string, path: string): Promise<string> {
  return 'code-' + await researchRevisionOf({ attemptId, path });
}
export function createResearchAuthorTools(options: { store: ResearchStore; policy: ResearchExecutionPolicy;
  scope(invocation: { runId: string; path: string }): Promise<ResearchAuthorScope> }): MasHostBindings['toolBindings'] {
  const store = options.store, policy = immutableResearchJson(options.policy), scope = options.scope;
  return Object.fromEntries(RESEARCH_AUTHOR_TOOLS.map(name => [name, { ...(name === 'write-code' ? { idempotency: 'honored' as const } : {}), handler: async (input, context) => {
    if (!context.invocation || policy.mode !== 'authored') researchFail('TRSH1005', '/invocation', 'Authoring requires an admitted native execution author.');
    const requested = immutableResearchJson(input) as { path?: string; text?: string };
    const current = await scope(context.invocation);
    if (name === 'read-plan') return { contract: current.contract, plan: current.plan, allowedCode: policy.codeFiles,
      workspace: current.workspace.manifest, rawOutputPath: 'output/raw.json', requestPath: 'execution.json',
      note: 'The host supplies the frozen execution manifest in execution.json. Only the candidate condition uses authored code.' };
    if (name === 'read-workspace') {
      const entry = current.workspace.manifest.entries.find(row => row.path === requested.path && row.mode === 'read-only' && row.role === 'input');
      if (!entry) researchFail('TRSH1005', '/path', 'The author may read only declared feature inputs.');
      const artifact = current.workspace.artifacts.find(row => row.artifactId === entry.artifactId)!;
      return { path: entry.path, artifactId: entry.artifactId, text: new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes) };
    }
    const slot = policy.codeFiles.find(row => row.path === requested.path);
    if (!slot || typeof requested.text !== 'string') researchFail('TRSH1010', '/path', 'Code writes require a declared immutable slot.');
    const bytes = new TextEncoder().encode(requested.text);
    if (!bytes.byteLength || bytes.byteLength > slot.maxBytes) researchFail('TRSH1010', '/text', 'Code exceeds its reserved byte allowance.');
    const value: ResearchCodeWrite = { id: await researchCodeWriteId(current.operation.attemptId, slot.path), projectId: current.operation.frame.projectId,
      attemptId: current.operation.attemptId, path: slot.path, text: requested.text, bytes: bytes.byteLength,
      artifactId: await researchArtifactIdOf(bytes), staticIssues: researchCodeStaticIssues(requested.text) };
    researchValue(validateResearchShape('ResearchCodeWrite', value));
    // Reserve the immutable slot before staging any bytes. Conflicting retries
    // fail the store's compare operation and cannot accumulate orphan code blobs.
    researchValue(await store.putRecord(value.projectId, { kind: 'ResearchCodeWrite', value }));
    return { recordId: value.id, path: value.path, artifactId: value.artifactId, bytes: value.bytes,
      staticIssues: value.staticIssues, isolationVerified: false };
  } } satisfies MasHostBindings['toolBindings'][string]]));
}
