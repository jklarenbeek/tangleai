/** A finite file inventory; the enclosing receipt hashes manifest.json itself. */
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { ResearchExportManifest, ResearchManifest, DisclosureChecklist, LessonInjection } from '../contracts.gen.ts';
import { researchArtifactIdOf, researchRevisionOf, immutableResearchJson, stageAttemptIdOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';
import { verifyResearchDraft } from '../stages/verify.ts';
import { researchCostTotal } from '../selection.ts';
import { researchInterventionReport } from '../commands.ts';
import { checkLessonRecord } from '../lessons/records.ts';

export type ResearchExportSource = ResearchExportManifest['source'];
export const RESEARCH_BUNDLE_FILES = ['audit.md', 'claims.json', 'disclosure.json', 'draft.md', 'literature.json', 'metrics.json'] as const;
export const researchJsonFile = (value: unknown): string => canonicalizeJson(value) + '\n';
export async function researchFileHash(content: string): Promise<string> {
  return (await researchArtifactIdOf(new TextEncoder().encode(content))).slice(4);
}
export function researchWritingEvidenceHash(source: Pick<ResearchExportSource, 'inputs' | 'ledger' | 'draft' | 'verification'>): Promise<string> {
  return researchRevisionOf({ literature: source.inputs.literature, cards: source.inputs.cards,
    ledger: source.ledger, draft: source.draft, verification: source.verification });
}
export function researchDisclosure(source: Omit<ResearchExportSource, 'disclosure'>, scientific: ResearchManifest | null): DisclosureChecklist {
  const row = (item: DisclosureChecklist[number]['item'], satisfied: boolean, evidence: string[], reason: string) => ({ item, satisfied, evidence, reason });
  return [
    row('human-review', ['literature', 'design', 'quality'].every(gate => source.provenance.interventions.some(action => action.gate === gate && action.actor === 'human' && action.action === 'approve')),
      ['/source/provenance/interventions'], 'Only attributable human approvals count; scripted responses and model reviews are disclosed separately.'),
    row('runnable-implementation', source.provenance.code.length > 0 && source.provenance.attempts.some(attempt => attempt.stage === 'EXECUTE' && attempt.stopReason === 'completed'),
      ['/source/provenance/code', '/source/provenance/attempts'], 'A completed retained execution and identified code are required for this assertion.'),
    row('reconstructible-execution', false, ['/source/provenance/data', '/source/provenance/code', '/source/provenance/environments'],
      'This bundle re-derives its rendered files; reproducing an experiment also requires the separately retained execution artifacts and host.'),
    row('novelty-audit', false, ['/source/inputs/literature', '/source/inputs/cards'], 'Admitted literature and exact quotes do not establish general novelty.'),
    row('attempt-selection-registration', scientific !== null && source.provenance.selection !== null,
      ['/source/provenance/selection', '/source/inputs/contract'], 'The frozen branch selector retains its candidate inventory and costs.'),
    row('baseline-audit', scientific !== null && (source.inputs.contract?.requiredBaselines.length ?? 0) > 0,
      ['/source/inputs/contract', '/research'], 'Baseline identities and provenance remain bound to the frozen scientific manifest.'),
    row('independent-verification', source.verification.state === 'verified', ['/source/verification'],
      'Deterministic checks establish identity, exact admitted quotation and numeric mapping; model review does not grant support.'),
    row('frozen-hypotheses', scientific?.frozenBeforeResults === true, ['/source/inputs/contract', '/source/inputs/plan', '/research'],
      'The retained scientific manifest records whether hypotheses and the plan were frozen before results.'),
  ];
}
export async function researchExportManifestOf(source: ResearchExportSource, scientific: ResearchManifest | null,
  files: Record<string, string>): Promise<ResearchOutcome<ResearchExportManifest>> {
  try {
    ({ source, scientific, files } = immutableResearchJson({ source, scientific, files }));
    if (!equalsJson(Object.keys(files).sort(), RESEARCH_BUNDLE_FILES)) return researchRefuse('TRSH1002', '/files', 'A Markdown bundle needs exactly its declared file inventory.');
    const verified = await verifyResearchDraft(source.inputs, source.ledger, source.draft); if (!verified.valid) return verified;
    if (verified.value.state !== 'verified') return { valid: false, issues: verified.value.issues };
    if (!equalsJson(verified.value, source.verification)) return researchRefuse('TRSH1002', '/verification', 'The export must retain independently recomputed verification.');
    const interventionReport = researchInterventionReport(source.provenance.interventions);
    const emptyLessons = { injected: [], proposed: [], promoted: [] };
    if (!equalsJson(scientific?.lessons ?? emptyLessons, source.provenance.lessons ?? emptyLessons))
      return researchRefuse('TRSH2007', '/lessons', 'Scientific and export provenance must name the same retained lesson records.');
    for (const injection of source.provenance.lessons?.injected ?? []) {
      const checked = await checkLessonRecord<LessonInjection>('LessonInjection', injection);
      if (!checked.valid || checked.value.projectId !== source.inputs.projectId || checked.value.runId !== source.inputs.projectId)
        return researchRefuse('TRSH2007', '/lessons/injected', 'Export injection identity must bind its actual run.');
    }
    const experimental = source.provenance.mode === undefined ? interventionReport.automatic > 0 : source.provenance.mode === 'full-auto';
    if (source.provenance.mode === 'gate-only' && interventionReport.automatic > 0
      || source.provenance.mode === 'full-auto' && interventionReport.automatic !== interventionReport.total)
      return researchRefuse('TRSH1002', '/provenance/mode', 'Every accepted gate action must retain its project mode and actor.');
    if (scientific) {
      const checked = validateResearchShape<ResearchManifest>('ResearchManifest', scientific); if (!checked.valid) return checked;
      const { manifestHash, ...body } = scientific;
      if (manifestHash !== await researchRevisionOf(body) || scientific.projectId !== source.inputs.projectId
        || scientific.reviewedEvidenceHash !== await researchWritingEvidenceHash(source)
        || scientific.contractHash !== source.inputs.contract?.contractHash || scientific.planHash !== source.inputs.plan?.planHash
        || !equalsJson([...scientific.observationIds].sort(), source.inputs.observations.map(row => row.id).sort())
        || !equalsJson([...scientific.runIds].sort(), source.inputs.analysis?.runIds)
        || !equalsJson(scientific.selectionRule, source.inputs.contract.selectionRule)
        || !equalsJson(scientific.metricOrigin, { evaluatorId: source.inputs.plan.evaluator.id, evaluatorVersion: source.inputs.plan.evaluator.version }))
        return researchRefuse('TRSH1002', '/research', 'The scientific export manifest must retain the exact selected lineage and observations.');
      if (scientific.interventionReport && !equalsJson(scientific.interventionReport, interventionReport)
        || scientific.experimental !== undefined && scientific.experimental !== experimental
        || experimental && (!scientific.experimental || !scientific.interventionReport))
        return researchRefuse('TRSH1002', '/research/interventionReport', 'Scientific manifests must reproduce every intervention and experimental-mode disclosure.');
      const scientificInputs = scientific.inputs;
      if (!source.inputs.contract!.datasets.every(dataset => scientificInputs.some(input => input.sha256 === dataset.sha256))
        || !source.inputs.plan!.inputPaths.every(path => scientificInputs.some(input => input.path === path)))
        return researchRefuse('TRSH1002', '/research/inputs', 'Scientific exports must retain every frozen dataset hash and admitted input path.');
    } else if (source.inputs.scope !== 'retrieval-control') return researchRefuse('TRSH1003', '/research', 'A scientific draft or stopped audit requires its retained scientific manifest.');
    if (!equalsJson(source.disclosure, researchDisclosure(source, scientific)))
      return researchRefuse('TRSH1005', '/disclosure', 'Every disclosure assertion and evidence pointer must reproduce the retained records.');
    const attempts = source.provenance.attempts;
    if (new Set(attempts.map(attempt => attempt.id)).size !== attempts.length
      || !equalsJson(source.provenance.cost, researchCostTotal(attempts.map(attempt => attempt.spend))))
      return researchRefuse('TRSH1002', '/provenance/cost', 'Export costs must reconcile every retained native attempt, including failures.');
    for (const attempt of attempts) if (attempt.projectId !== source.inputs.projectId || attempt.id !== await stageAttemptIdOf(attempt))
      return researchRefuse('TRSH1002', '/provenance/attempts', 'Attempt identities must bind the exported project and admitted manifests.');
    if (scientific && (!source.provenance.selection
      || !equalsJson(source.provenance.seeds, source.inputs.contract!.replicatePolicy.seeds)
      || !equalsJson([...source.provenance.data].sort(), source.inputs.contract!.datasets.map(row => row.id).sort())))
      return researchRefuse('TRSH1002', '/provenance', 'A scientific bundle retains its complete selection, frozen seed policy and datasets.');
    if (source.provenance.selection && (source.provenance.selection.id !== source.inputs.decision?.details?.selectionId
      || source.provenance.selection.selectedBranchId !== source.inputs.analysis?.branchId))
      return researchRefuse('TRSH1002', '/selection', 'Export selection must be the selection retained by the decision.');
    if (source.provenance.selection) {
      const { id, ...body } = source.provenance.selection;
      if (id !== 'selection-' + await researchRevisionOf(body)
        || (['calls', 'tokens', 'ms', 'physical'] as const).some(key => source.provenance.cost[key] < source.provenance.selection!.totalCost[key]))
        return researchRefuse('TRSH1002', '/selection', 'Selection content and every candidate cost remain part of the export.');
    }
    for (const review of source.reviews) {
      const shape = validateResearchShape('Review', review); if (!shape.valid) return shape;
      if (review.projectId !== source.inputs.projectId || review.draftId !== source.draft.id
        || review.claimIds.some(id => !source.ledger.claims.some(claim => claim.id === id)))
        return researchRefuse('TRSH1005', '/reviews', 'A review must name this draft and its admitted claims.');
    }
    const inventory = await Promise.all(RESEARCH_BUNDLE_FILES.map(async path => ({ path, sha256: await researchFileHash(files[path]) })));
    const body = { projectId: source.inputs.projectId, scope: source.inputs.scope, research: scientific, source, files: inventory,
      experimental, interventionReport };
    return validateResearchShape<ResearchExportManifest>('ResearchExportManifest', { id: 'export-' + await researchRevisionOf(body), ...body });
  } catch (cause) { return researchRefuse('TRSH1001', '/export', 'Export manifests require finite immutable records.', cause); }
}
