import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { policyArtifactOf, valuesOf } from '../../scripts/lib/policy-default.ts';
import { reportIdOf, type LocomoPolicy } from '../../benchmark/lib/locomo-policy.ts';

it('the real confirmed default, its runtime behavior and public provenance match immutable evidence', async () => {
  const { readPolicyDecision } = await import('../../scripts/lib/policy-default.ts');
  const { generatedPolicy } = await import('../../scripts/policy-default.ts');
  const { verifyRuntimePolicy } = await import('../../scripts/lib/policy-runtime.ts');
  const { DEFAULT_MEMORY_POLICY, POLICY_PROVENANCE } = await import('@tangleai/memory/policy');
  const { renderMarkdown } = await import('../../benchmark/lib/locomo-policy.ts');
  const path = 'benchmark/results/locomo-policy.json';
  const { report, artifact } = await readPolicyDecision(path);
  assert.equal(report.reportId, 'b003bccaac49b44931787955e5caa0efddb58fec706da029760e50540d8f5b14');
  assert.equal(report.purchases!.physical, 258);
  assert.equal(report.selection.decision!.qualifiesAsDefault, false);
  assert.deepEqual(DEFAULT_MEMORY_POLICY, artifact.policy);
  assert.deepEqual(POLICY_PROVENANCE, artifact.provenance);
  assert.deepEqual(artifact.provenance.clauses.filter(c => !c.passed).map(c => c.clause), ['overall-interval']);
  assert.equal(artifact.provenance.power.minimumDetectableEffect, 0.002380462373715384);
  assert.equal(await generatedPolicy(path), await readFile('packages/memory/src/policy.gen.ts', 'utf8'));
  assert.equal(`${renderMarkdown(report)}\n`, await readFile('docs/LOCOMO_POLICY.md', 'utf8'));
  for (const path of ['packages/memory/src/policy.gen.ts', 'docs/LOCOMO_POLICY.md', 'README.md',
    'benchmark/results/locomo-policy.json', ...report.liveEvidence!.map(e => e.path)]) {
    assert.doesNotMatch(await readFile(path, 'utf8'), /TODO_[A-Z0-9_]+\.md|tmp\/policy-campaign\/|sk-or-v1-[a-zA-Z0-9]{20,}/, `${path}: public evidence must contain neither scratch references nor keys`);
  }
  await verifyRuntimePolicy(artifact.policy);
  const drift = structuredClone(artifact.policy); drift.retrieval.k++;
  await assert.rejects(verifyRuntimePolicy(drift), /Public memory defaults/);
  for (const key of ['reportId', 'cellId'] as const) {
    const altered = structuredClone(report);
    if (key === 'reportId') altered.reportId = 'a'.repeat(64);
    else altered.registration.cells[0].cellId = 'a'.repeat(64);
    await assert.rejects(policyArtifactOf(altered), /identity|\$query/);
  }
});

it('a frozen screen cannot silently install inert as a measured default', async () => {
  const screen = JSON.parse(await readFile('benchmark/results/locomo-policy-screen.json', 'utf8')) as LocomoPolicy;
  await assert.rejects(policyArtifactOf(screen), /completed confirmation/);
  screen.selection.state = 'confirmed';
  screen.reportId = await reportIdOf(screen);
  await assert.rejects(policyArtifactOf(screen));
});
it('mechanical policy projection separates the lexical width from ingest and retrieval values', async () => {
  const screen = JSON.parse(await readFile('benchmark/results/locomo-policy-screen.json', 'utf8')) as LocomoPolicy;
  const inert = screen.registration.cells.find(c => c.role === 'inert')!;
  const selected = valuesOf(inert, 512);
  assert.deepEqual(selected.novelty, { enabled: false, threshold: 2 });
  assert.deepEqual(selected.retrieval, { k: 10, minScore: 0 });
  assert.deepEqual(selected.embedding, { model: 'hash-trigram-512', dims: 512, tier: 'keyless' });
  const legacy = valuesOf(screen.registration.cells.find(c => c.role === 'shipped')!);
  assert.deepEqual(legacy.novelty, { enabled: true, threshold: 0.97 });
  assert.equal(legacy.embedding.dims, 64);
});

it('the public policy contract refuses a breaking field rename and accepts an additive input', async () => {
  const { POLICY_CONTRACT } = await import('../../scripts/policy-default.ts');
  const { compileContract } = await import('@jarenjs/contract');
  const { diffContracts } = await import('@jarenjs/contract/diff');
  const baseline = JSON.parse(await readFile('scripts/fixtures/policy-contract-v1.json', 'utf8'));
  assert.equal(await compileContract(POLICY_CONTRACT).revision(), await compileContract(baseline).revision());
  const broken = structuredClone(baseline);
  broken.operations['policy.read'].output.properties.recall = broken.operations['policy.read'].output.properties.retrieval;
  delete broken.operations['policy.read'].output.properties.retrieval;
  broken.operations['policy.read'].output.required = broken.operations['policy.read'].output.required.map((key: string) => key === 'retrieval' ? 'recall' : key);
  assert.ok(diffContracts(baseline, broken).breaking.length > 0);
  const additive = structuredClone(baseline);
  additive.operations['policy.read'].input.properties.label = { type: 'string' };
  const diff = diffContracts(baseline, additive);
  assert.equal(diff.breaking.length, 0);
  assert.ok(diff.additive.length > 0);
});

it('a complete synthetic win selects its challenger; changed identity or ineligible confirmation is refused', async () => {
  const { syntheticPolicyDecision } = await import('../fixtures/policy-decision.ts');
  const report = await syntheticPolicyDecision();
  const artifact = await policyArtifactOf(report);
  assert.equal(artifact.provenance.cellId, report.selection.transition!.challenger);
  assert.equal(artifact.policy.embedding.dims, 512);
  const drifted = structuredClone(report);
  drifted.registration.cells[0].retrieval.k++;
  drifted.reportId = await reportIdOf(drifted);
  await assert.rejects(policyArtifactOf(drifted), /identity/);
  const incomplete = structuredClone(report);
  incomplete.attempts.find(a => a.phase === 'confirmation')!.eligibility.eligible = false;
  incomplete.reportId = await reportIdOf(incomplete);
  await assert.rejects(policyArtifactOf(incomplete));
});

it('an eligible challenger that exceeds the token ceiling selects inert without giving shipped incumbency', async () => {
  const { syntheticPolicyDecision } = await import('../fixtures/policy-decision.ts');
  const { comparisonOf, decisionOf } = await import('../../benchmark/lib/locomo-policy.ts');
  const report = await syntheticPolicyDecision();
  const candidate = report.attempts.find(a => a.phase === 'confirmation' && a.cellId === report.selection.transition!.challenger)!;
  const control = report.attempts.find(a => a.phase === 'confirmation' && report.registration.cells.find(c => c.cellId === a.cellId)?.role === 'inert')!;
  candidate.cost!.tokensPerAnswer = 120;
  candidate.cost!.tokens = 120 * candidate.denominators.answered;
  candidate.cost!.promptTokens = 110 * candidate.denominators.answered;
  candidate.results.forEach(r => { r.tokens = 120; });
  const comparison = comparisonOf(candidate, control, report.registration.objective, 'locomo-f1');
  report.comparisons = report.comparisons.map(c => c.phase === 'confirmation' && c.treatment === candidate.cellId ? comparison : c);
  report.selection.decision = decisionOf(comparison, control.cellId, report.registration.objective);
  report.reportId = await reportIdOf(report);
  const artifact = await policyArtifactOf(report);
  assert.equal(artifact.provenance.qualifiesAsDefault, false);
  assert.equal(artifact.provenance.cellId, control.cellId);
  assert.equal(artifact.policy.novelty.enabled, false);
  assert.ok(artifact.provenance.clauses.some(c => c.clause === 'token-ratio' && !c.passed));
});
