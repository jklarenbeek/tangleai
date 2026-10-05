/** Guarded edits create pending descendants; independent stage verification admits them. */
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { applyJSONPatch, createJSONPatch } from '@jarenjs/json/patch';
import { parseJSONPointer } from '@jarenjs/json/pointer';
import type { ArtifactAdmission, ResearchInputArtifact, ResearchJsonPatch, StageAttemptKey } from './contracts.gen.ts';
import type { ResearchStore } from './store.ts';
import type { ResearchOutcome } from './errors.ts';
import { researchRefuse, researchIssue } from './errors.ts';
import { immutableResearchJson } from './identity.ts';
import { validateResearchShape, type ResearchSchemaName } from './schema.ts';
import { ResearchFailure, researchFail, researchValue } from './workflow-contract.ts';

export interface ResearchStagedEditPreview { candidate: unknown; patch: ResearchJsonPatch }
export interface ResearchStagedArtifactRefiner {
  preview(patch: unknown): Promise<ResearchOutcome<ResearchStagedEditPreview>>;
  commit(patch: unknown): Promise<ResearchOutcome<ArtifactAdmission>>;
}
export function createStagedArtifactRefiner(options: {
  store: ResearchStore; projectId: string; source: ResearchInputArtifact; attempt: StageAttemptKey;
  schema: ResearchSchemaName; allowedPaths: readonly string[]; maxPatchBytes?: number; maxArtifactBytes?: number;
}): ResearchStagedArtifactRefiner {
  const { store, ...data } = options, pinned = immutableResearchJson(data);
  const maxPatchBytes = pinned.maxPatchBytes ?? 8192, maxArtifactBytes = pinned.maxArtifactBytes ?? 200000;
  if (!Number.isSafeInteger(maxPatchBytes) || maxPatchBytes < 1 || maxPatchBytes > 65536
    || !Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1 || maxArtifactBytes > 1048576
    || !pinned.allowedPaths.length || pinned.attempt.projectId !== pinned.projectId)
    throw new TypeError('A staged refiner requires finite bounds, allowed paths and one project.');
  const allowed = pinned.allowedPaths.map(path => parseJSONPointer(path));
  if (allowed.some(path => !path.length || path.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))))
    throw new TypeError('A staged refiner cannot authorize the root or prototype paths.');
  const inside = (pointer: string) => {
    const path = parseJSONPointer(pointer);
    return !path.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))
      && allowed.some(prefix => prefix.every((part, index) => path[index] === part));
  };
  const problem = (code: string, docPath: string, message: string) => ({ valid: false, errors: [{ code, docPath, message }] });
  const shape = (value: unknown) => {
    const checked = validateResearchShape(pinned.schema, value);
    return checked.valid ? { valid: true, errors: [] } : { valid: false,
      errors: checked.issues.map(issue => ({ code: issue.code, docPath: issue.path, message: issue.detail })) };
  };
  async function read() {
    const row = researchValue(await store.readArtifact(pinned.projectId, pinned.source.admissionId));
    if (row.admission.artifact.id !== pinned.source.artifactId || row.bytes.byteLength > maxArtifactBytes)
      researchFail('TRSH1005', '/source', 'The editor requires the exact bounded reviewed artifact.');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(row.bytes)); }
    catch { researchFail('TRSH1001', '/source', 'The staged artifact is not UTF-8 JSON.'); }
    return researchValue(validateResearchShape(pinned.schema, value));
  }
  const guarded = createGuardedRefiner({
    read,
    validateProposal(patch: unknown) {
      const checked = validateResearchShape<ResearchJsonPatch>('ResearchJsonPatch', patch);
      if (!checked.valid) return { valid: false, errors: checked.issues.map(issue => ({ code: issue.code, docPath: issue.path, message: issue.detail })) };
      if (new TextEncoder().encode(canonicalizeJson(checked.value)).byteLength > maxPatchBytes)
        return problem('TRSH1006', '/patch', 'The patch exceeds its declared byte budget.');
      for (const [index, operation] of checked.value.entries()) {
        try {
          if (!inside(operation.path) || 'from' in operation && !inside(operation.from))
            return problem('TRSH1005', '/patch/' + index, 'Every read and write must stay within the allowed artifact paths.');
        } catch { return problem('TRSH1001', '/patch/' + index, 'The patch contains an invalid JSON Pointer.'); }
      }
      return { valid: true, errors: [] };
    },
    apply: applyJSONPatch,
    validateCandidate(candidate: unknown) {
      const checked = shape(candidate); if (!checked.valid) return checked;
      return new TextEncoder().encode(canonicalizeJson(candidate)).byteLength <= maxArtifactBytes ? checked
        : problem('TRSH1006', '/candidate', 'The edited artifact exceeds its declared byte budget.');
    },
    planCommit: (candidate: unknown, previous: unknown) => ({ candidate, patch: createJSONPatch(previous, candidate) }),
    async commit(plan: ResearchStagedEditPreview) {
      // A pending admission grants no claim, metric or committed-stage authority.
      return researchValue(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson(plan.candidate)), {
        projectId: pinned.projectId, attempt: pinned.attempt, mediaType: 'application/json', verification: 'pending', parents: [pinned.source],
      }));
    },
  });
  const refusal = (errors: Array<{ code?: string; docPath?: string; message?: string }>): ResearchOutcome<never> => ({ valid: false,
    issues: errors.length ? errors.map(error => researchIssue(error.code === 'TRSH1005' ? 'TRSH1005' : error.code === 'TRSH1006' ? 'TRSH1006' : 'TRSH1001',
      error.docPath ?? '', error.message ?? 'Guarded artifact edit refused.', error)) : [researchIssue('TRSH1001', '/patch', 'Guarded artifact edit refused.')] });
  const caught = (cause: unknown): ResearchOutcome<never> => cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
    : researchRefuse('TRSH1008', '/edit', 'The staged artifact edit failed.', cause);
  return {
    async preview(patch) {
      try {
        const captured = researchValue(validateResearchShape<ResearchJsonPatch>('ResearchJsonPatch', patch));
        const document = await read(), prepared = guarded.prepare(document, captured);
        return prepared.valid ? { valid: true, value: immutableResearchJson(prepared.plan) as ResearchStagedEditPreview } : refusal(prepared.errors);
      } catch (cause) { return caught(cause); }
    },
    async commit(patch) {
      try {
        const captured = researchValue(validateResearchShape<ResearchJsonPatch>('ResearchJsonPatch', patch));
        const result = await guarded.commit(captured);
        return result.ok ? { valid: true, value: result.value as ArtifactAdmission } : refusal(result.errors);
      } catch (cause) { return caught(cause); }
    },
  };
}
