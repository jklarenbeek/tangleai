import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderMarkdownBundle, rerunBundle, verifyResearchBundleFiles, researchArtifactIdOf, researchRevisionOf,
  researchInterventionReport, researchDisclosure } from '@tangleai/research';
import { writingExportFixture } from './writing-fixtures.ts';
import { checked } from './fixtures.ts';

it('reconstructs all seven files byte-for-byte and binds the nonrecursive manifest hash in the outer receipt', async () => {
  const f = await writingExportFixture(), bundle = checked(await renderMarkdownBundle(f.source, f.scientific));
  assert.deepEqual(Object.keys(bundle.files).sort(), ['audit.md', 'claims.json', 'disclosure.json', 'draft.md', 'literature.json', 'manifest.json', 'metrics.json']);
  assert.equal(bundle.manifest.files.length, 6); assert.equal(bundle.receipt.files.length, 7);
  for (const file of bundle.receipt.files) assert.equal((await researchArtifactIdOf(new TextEncoder().encode(bundle.files[file.path]))).slice(4), file.sha256);
  assert.equal(bundle.receipt.manifestSha256, bundle.receipt.files.find(row => row.path === 'manifest.json')!.sha256);
  const rerun = checked(await rerunBundle(JSON.parse(bundle.files['manifest.json'])));
  assert.deepEqual(rerun.files, bundle.files); assert.deepEqual(rerun.receipt, bundle.receipt);
  assert.equal((await verifyResearchBundleFiles(bundle.manifest, bundle.files)).valid, true);
  assert.equal(f.source.disclosure.length, 8); assert.equal(new Set(f.source.disclosure.map(item => item.item)).size, 8);
  assert.ok(f.source.disclosure.every(item => item.evidence.length && item.reason));
  assert.equal(f.source.disclosure.find(item => item.item === 'human-review')!.satisfied, false);
  assert.equal(f.source.disclosure.find(item => item.item === 'novelty-audit')!.satisfied, false);
});
it('manifest intervention totals and experimental disclosure cannot be altered by rehashing', async () => {
  const f = await writingExportFixture(), source = structuredClone(f.source);
  source.provenance.interventions = (['literature', 'design', 'quality'] as const).map(gate => ({ id: 'automatic-' + gate,
    gate, actor: 'full-auto', action: 'approve', reviewedManifestHash: 'a'.repeat(64), approvedManifestHash: 'a'.repeat(64),
    substantive: false, experimental: true }));
  const { manifestHash: _old, ...original } = f.scientific;
  const body = { ...original, experimental: true, interventionReport: researchInterventionReport(source.provenance.interventions) };
  const scientific = { ...body, manifestHash: await researchRevisionOf(body) };
  source.disclosure = researchDisclosure(source, scientific);
  const bundle = checked(await renderMarkdownBundle(source, scientific));
  assert.equal(bundle.manifest.experimental, true); assert.equal(bundle.manifest.interventionReport!.automatic, 3);
  assert.deepEqual(bundle.manifest.interventionReport, scientific.interventionReport);
  for (const change of [{ experimental: false }, { interventionReport: { ...bundle.manifest.interventionReport!, automatic: 0 } }]) {
    const changed = { ...bundle.manifest, ...change }, { id: _id, ...content } = changed;
    changed.id = 'export-' + await researchRevisionOf(content); assert.equal((await rerunBundle(changed)).valid, false);
  }
  const duplicated = structuredClone(source); duplicated.provenance.interventions.push(duplicated.provenance.interventions[0]);
  assert.equal((await renderMarkdownBundle(duplicated, scientific)).valid, false);
});
it('full-auto remains experimental even when a bundle contains no accepted gate actions', async () => {
  const f = await writingExportFixture();
  const source = { ...f.source, provenance: { ...f.source.provenance, mode: 'full-auto' as const } };
  const { manifestHash: _old, ...original } = f.scientific;
  const body = { ...original, experimental: true, interventionReport: researchInterventionReport([]) };
  const scientific = { ...body, manifestHash: await researchRevisionOf(body) };
  const bundle = checked(await renderMarkdownBundle(source, scientific));
  assert.equal(bundle.manifest.experimental, true); assert.equal(bundle.manifest.interventionReport!.total, 0);
  assert.deepEqual(checked(await rerunBundle(bundle.manifest)).files, bundle.files);
});
it('intervention summaries refuse clock actors and contradictory experimental attribution', () => {
  const base = { id: 'attribution-probe', gate: 'design' as const, action: 'approve' as const,
    reviewedManifestHash: 'a'.repeat(64), approvedManifestHash: 'a'.repeat(64), substantive: false };
  assert.throws(() => researchInterventionReport([{ ...base, actor: 'timeout' }]));
  assert.throws(() => researchInterventionReport([{ ...base, actor: 'human', experimental: true }]));
  assert.throws(() => researchInterventionReport([{ ...base, actor: 'full-auto', experimental: false }]));
  assert.throws(() => researchInterventionReport([{ ...base, action: 'edit', substantive: true, actor: 'full-auto', experimental: true }]));
});
it('refuses modified, missing and unlisted bundle files and rehashed false numeric content', async () => {
  const f = await writingExportFixture(), bundle = checked(await renderMarkdownBundle(f.source, f.scientific));
  for (const files of [{ ...bundle.files, 'metrics.json': '{}' }, { ...bundle.files, 'extra.json': '{}' },
    Object.fromEntries(Object.entries(bundle.files).filter(([path]) => path !== 'draft.md'))]) {
    const refused = await verifyResearchBundleFiles(bundle.manifest, files); assert.equal(refused.valid, false);
    if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1002');
  }
  const altered = structuredClone(bundle.manifest); altered.source.inputs.observations[0].value += 1;
  const { id: _id, ...body } = altered; altered.id = 'export-' + await researchRevisionOf(body);
  const refused = await rerunBundle(altered); assert.equal(refused.valid, false);
  if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1002');
});
it('cannot hide failed-attempt costs or assert unsupported disclosure completion', async () => {
  const f = await writingExportFixture(), source = structuredClone(f.source);
  source.provenance.cost.physical = 0;
  assert.equal((await renderMarkdownBundle(source, f.scientific)).valid, false);
  const invented = structuredClone(f.source); invented.disclosure.find(item => item.item === 'human-review')!.satisfied = true;
  const result = await renderMarkdownBundle(invented, f.scientific); assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.issues[0].code, 'TRSH1005');
});
it('a stale reviewed-evidence hash remains invalid after the scientific manifest is rehashed', async () => {
  const f = await writingExportFixture(), scientific = structuredClone(f.scientific);
  scientific.reviewedEvidenceHash = 'b'.repeat(64);
  const { manifestHash: _hash, ...body } = scientific; scientific.manifestHash = await researchRevisionOf(body);
  const result = await renderMarkdownBundle(f.source, scientific); assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.issues[0].code, 'TRSH1002');
});
it('retrieval-only controls export literature without inventing experimental records or result claims', async () => {
  const { buildClaimLedger, writeResearchDraft, verifyResearchDraft, researchDisclosure } = await import('@tangleai/research');
  const f = await writingExportFixture();
  const input = { ...f.input, scope: 'retrieval-control' as const, contract: null, plan: null, analysis: null, decision: null, observations: [] };
  const ledger = checked(await buildClaimLedger(input)), draft = checked(await writeResearchDraft(ledger, f.writer, { mode: 'template' }));
  const verification = checked(await verifyResearchDraft(input, ledger, draft));
  const body = { inputs: input, ledger, draft, verification, reviews: [], provenance: { ...f.source.provenance,
    attempts: [], selection: null, code: [], data: [], seeds: [], environments: [], cost: { calls: 0, tokens: 0, ms: 0, physical: 0 } } };
  const source = { ...body, disclosure: researchDisclosure(body, null) }, bundle = checked(await renderMarkdownBundle(source, null));
  assert.equal(bundle.manifest.research, null); assert.equal(bundle.manifest.scope, 'retrieval-control');
  assert.ok(ledger.claims.every(claim => claim.kind !== 'metric')); assert.ok(bundle.files['draft.md'].includes('No registered observations.'));
  assert.deepEqual(checked(await rerunBundle(bundle.manifest)).files, bundle.files);
});
