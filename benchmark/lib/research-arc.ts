/** The optional external boundary counts invalid inputs and never repairs or fetches them. */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { researchSchema, researchSchemaReferences, researchIssue, researchRevisionOf, immutableResearchJson,
  type ResearchIssue, type ResearchProject, type ResearchContract, type ExperimentPlan } from '@tangleai/research';
import { createReportValidator } from './validate.ts';
import { researchBytesSha256 } from './research-fixture.ts';
import { ARC_MANIFEST_SCHEMA, ARC_TOPIC_SCHEMA } from './research-arc-schema.ts';
export const ARC_MANIFEST_PATH = 'benchmark/fixtures/research/external/arc-bench.manifest.json';
export type ArcSliceManifest = {
  source: string;
  licence: { spdx: string; textSha256: string; auditedBy: string; auditedAt: string; terms: string[] };
  slice: { name: 'ml-core-25' | 'paper-45' | 'tree-55'; topicIds: string[] };
  protocol: { judge: string; attempts: number; selection: 'all' | 'best-of-n' }; localOnly: string[];
} & ({ commit: string; archiveSha256?: never } | { archiveSha256: string; commit?: never });
export interface ArcResearchTopic { id: string; title: string; question: string; taskFamily: string; contract: ResearchContract; plan: ExperimentPlan }
const manifestShape = createReportValidator(ARC_MANIFEST_SCHEMA);
const topicShape = createReportValidator(ARC_TOPIC_SCHEMA, [researchSchema, ...researchSchemaReferences]);
export function validateArcManifest(value: unknown): { valid: true; value: ArcSliceManifest } | { valid: false; issues: ResearchIssue[] } {
  const licence = (value as { licence?: ArcSliceManifest['licence'] } | null)?.licence;
  if (!licence?.auditedBy || !licence.auditedAt || !Number.isFinite(Date.parse(licence.auditedAt)) || !licence.textSha256 || !licence.terms?.length)
    return { valid: false, issues: [researchIssue('TRSH2009', '/licence', 'An external slice needs a retained licence text hash, named auditor, audit time and terms.')] };
  const checked = manifestShape(value);
  return checked.valid ? { valid: true, value: structuredClone(value) as ArcSliceManifest }
    : { valid: false, issues: [researchIssue('TRSH2009', '/manifest', 'External pin or manifest schema refused.', checked.errors?.[0])] };
}
export async function admitArcTopics(manifest: ArcSliceManifest, values: readonly unknown[]) {
  const issues: ResearchIssue[] = [], topics: ArcResearchTopic[] = [];
  let captured: { manifest: ArcSliceManifest; values: readonly unknown[] };
  try { captured = immutableResearchJson({ manifest, values }); }
  catch { return { topics, issues: [researchIssue('TRSH2009', '/topics', 'External admission requires finite JSON manifest and topic values.')] }; }
  const checked = validateArcManifest(captured.manifest); if (!checked.valid) return { topics, issues: checked.issues };
  const pinned = checked.value;
  if (captured.values.length !== pinned.slice.topicIds.length) issues.push(researchIssue('TRSH2009', '/topics', 'The pinned slice topic census differs.'));
  for (const [i, value] of captured.values.entries()) {
    const shape = topicShape(value);
    if (!shape.valid) { issues.push(researchIssue('TRSH2009', '/topics/' + i, 'Upstream topic schema refused; bytes remain unchanged.', shape.errors?.[0])); continue; }
    const topic = structuredClone(value) as ArcResearchTopic, { contractHash, ...contract } = topic.contract, { planHash, ...plan } = topic.plan;
    if (topic.id !== pinned.slice.topicIds[i] || contractHash !== await researchRevisionOf(contract) || planHash !== await researchRevisionOf(plan)
      || plan.contractHash !== contractHash || plan.projectId !== contract.projectId || plan.hypothesisHash !== await researchRevisionOf(contract.hypothesisSpace)
      || contract.attemptCap !== pinned.protocol.attempts || contract.selectionRule.kind !== pinned.protocol.selection)
      issues.push(researchIssue('TRSH2009', '/topics/' + i, 'The upstream topic identity or preregistration differs from the pinned protocol.'));
    else topics.push(topic);
  }
  return { topics, issues };
}
export function arcResearchProject(topic: ArcResearchTopic, domainProfile: string, at: string): ResearchProject {
  return { id: topic.contract.projectId, topic: topic.title, question: topic.question, domainProfile, owner: 'pinned-external-benchmark',
    mode: 'gate-only', safetyClass: 'computational', status: 'CREATED', createdAt: at,
    budget: { calls: 0, tokens: 0, physical: topic.contract.replicatePolicy.seeds.length * topic.plan.conditions.length, ms: 600000 } };
}
export async function deferredArcBenchRow(root = process.cwd(), supplied?: unknown) {
  let manifest = supplied;
  if (manifest === undefined) {
    try { manifest = JSON.parse(await readFile(join(root, ARC_MANIFEST_PATH), 'utf8')); }
    catch (cause) {
      return { id: 'external:arc-bench/ml-core-25', state: 'not-run' as const, reason: 'manifest-unpinned' as const,
        issues: (cause as NodeJS.ErrnoException).code === 'ENOENT' ? []
          : [researchIssue('TRSH2009', '/manifest', 'The external manifest could not be read as JSON.')],
        modelCalls: 0 as const, runnerInvocations: 0 as const };
    }
  }
  const checked = validateArcManifest(manifest);
  if (!checked.valid) return { id: 'external:arc-bench/ml-core-25', state: 'not-run' as const,
    reason: checked.issues.some(issue => issue.path.startsWith('/licence')) ? 'licence-unaudited' as const : 'manifest-unpinned' as const,
    issues: checked.issues, modelCalls: 0 as const, runnerInvocations: 0 as const };
  let present = false;
  try { present = (await stat(join(root, 'benchmark/arc-bench'))).isDirectory(); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') return { id: 'external:arc-bench/' + checked.value.slice.name,
      state: 'not-run' as const, reason: 'submodule-absent' as const,
      issues: [researchIssue('TRSH2009', '/source', 'The external source directory could not be inspected.')],
      modelCalls: 0 as const, runnerInvocations: 0 as const };
  }
  if (!present) return { id: 'external:arc-bench/' + checked.value.slice.name, state: 'not-run' as const, reason: 'submodule-absent' as const,
    issues: [], modelCalls: 0 as const, runnerInvocations: 0 as const };
  // Adoption requires an explicit upstream byte/source binding; presence alone confers no authority.
  return { id: 'external:arc-bench/' + checked.value.slice.name, state: 'not-run' as const, reason: 'manifest-unpinned' as const,
    issues: [researchIssue('TRSH2009', '/pin', 'The deferred adapter has no adopted upstream byte loader; no slice was executed.')],
    modelCalls: 0 as const, runnerInvocations: 0 as const };
}
export function verifyArcLicenceBytes(manifest: ArcSliceManifest, bytes: Uint8Array): ResearchIssue[] {
  return researchBytesSha256(bytes) === manifest.licence.textSha256 ? [] : [researchIssue('TRSH2009', '/licence/textSha256', 'Licence text differs from the audited pin.')];
}
