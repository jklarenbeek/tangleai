import { selectBranch, planResearchDecision, researchArtifactIdOf, researchRevisionOf, type ResearchWritingInputs,
  type ResearchClaimLedger, type ResearchClaim } from '@tangleai/research';
import { buildClaimLedger } from '../../packages/research/src/stages/claims.ts';
import { writeResearchDraft } from '../../packages/research/src/stages/write.ts';
import { analysisFixture } from './analysis-fixtures.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';
import { checked, hash } from './fixtures.ts';

export async function writingFixture() {
  const science = await analysisFixture(), evidence = await reasoningFixture();
  const selection = checked(await selectBranch([{ analysis: science.analysis, branches: [science.input.branch] }], science.contract));
  const grant = { calls: 100, tokens: 10000, ms: 10000, physical: 100 };
  const decision = checked(await planResearchDecision(science.analysis, science.contract, { attempt: 1, pivot: 1, selection },
    { remaining: grant, nextAttempt: grant, nextPivot: grant, nextWrite: grant }, { reviewerIdentityId: 'independent-review', findings: [],
      artifactIds: [await researchArtifactIdOf(new TextEncoder().encode('Retained independent fixture review.'))] }));
  const input: ResearchWritingInputs = { projectId: science.contract.projectId, scope: 'research-draft', contract: science.contract,
    plan: science.plan, decision, analysis: science.analysis, observations: science.input.observations, cards: evidence.cards, literature: [evidence.literature] };
  const ledger = checked(await buildClaimLedger(input));
  const writer = { roleId: 'fixture-writer', promptRevision: hash(), modelIdentity: 'fixture-model' };
  const draft = checked(await writeResearchDraft(ledger, writer, { mode: 'template' }));
  return { input, ledger, draft, writer, science, evidence, selection };
}
/** Rehashing is intentional: refusal tests exercise semantic checks beyond the digest. */
export async function revisedWritingFixture(f: Awaited<ReturnType<typeof writingFixture>>, change: (claims: ResearchClaim[]) => void) {
  const claims = structuredClone(f.ledger.claims); change(claims);
  const ledger = checked(await buildClaimLedger(f.input, claims));
  const draft = checked(await writeResearchDraft(ledger, f.writer, { mode: 'template' }));
  return { ledger, draft };
}
export async function rehashLedger(ledger: ResearchClaimLedger) {
  const { id: _id, ...body } = ledger;
  return { id: 'ledger-' + await researchRevisionOf(body), ...body };
}

/** Synthetic record fixture for the pure file renderer; this is not a native workflow receipt. */
export async function writingExportFixture() {
  const f = await writingFixture();
  const { verifyResearchDraft, researchDisclosure, researchWritingEvidenceHash } = await import('@tangleai/research');
  const { attempt, manifest } = await import('./fixtures.ts');
  const verification = checked(await verifyResearchDraft(f.input, f.ledger, f.draft));
  const scientificBody: Omit<import('@tangleai/research').ResearchManifest, 'manifestHash'> = {
    projectId: f.input.projectId, contractHash: f.science.contract.contractHash, planHash: f.science.plan.planHash,
    promptRevision: f.writer.promptRevision, reviewedEvidenceHash: await researchWritingEvidenceHash({ inputs: f.input, ledger: f.ledger, draft: f.draft, verification }), runIdentityId: null,
    environment: { executor: 'synthetic-record-fixture', version: '1', programSourceHash: hash() },
    inputs: f.science.contract.datasets.map((row, index) => ({ path: f.science.plan.inputPaths[index], sha256: row.sha256 })),
    runIds: f.science.analysis.runIds, observationIds: f.science.analysis.observationIds,
    selectionRule: f.science.contract.selectionRule, baselineSources: f.science.contract.requiredBaselines.map(row => row.source),
    metricOrigin: { evaluatorId: f.science.plan.evaluator.id, evaluatorVersion: f.science.plan.evaluator.version },
    searchedLiterature: f.input.literature.map(row => row.id), frozenBeforeResults: true,
  };
  const scientific = { ...scientificBody, manifestHash: await researchRevisionOf(scientificBody) };
  const execution = await attempt(manifest(f.input.projectId, 'EXECUTE')); execution.spend = f.selection.totalCost;
  const body: Omit<import('@tangleai/research').ResearchExportSource, 'disclosure'> = { inputs: f.input, ledger: f.ledger, draft: f.draft,
    verification, reviews: [], provenance: { runGraph: 'Synthetic record fixture; native integration is qualified separately.', attempts: [execution],
      selection: f.selection, prompts: [f.writer], tools: [], code: f.science.plan.conditions.map(row => row.programId),
      data: f.science.contract.datasets.map(row => row.id), seeds: f.science.contract.replicatePolicy.seeds,
      environments: ['synthetic-record-fixture'], interventions: [], cost: execution.spend } };
  const source = { ...body, disclosure: researchDisclosure(body, scientific) };
  return { ...f, source, scientific };
}
