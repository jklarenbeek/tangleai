/** One bundle renderer; reconstruction uses only the immutable records embedded in its manifest. */
import { equalsJson } from '@jarenjs/core/object';
import { toMarkdown } from '@jarenjs/md';
import type { ResearchExportManifest, ResearchManifest, ExportReceipt } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';
import { renderResearchDraft } from '../render.ts';
import { researchExportManifestOf, researchJsonFile, researchFileHash, type ResearchExportSource } from './manifest.ts';

export interface ResearchMarkdownBundle { files: Record<string, string>; manifest: ResearchExportManifest; receipt: ExportReceipt }
export async function renderMarkdownBundle(source: ResearchExportSource, scientific: ResearchManifest | null): Promise<ResearchOutcome<ResearchMarkdownBundle>> {
  try {
    ({ source, scientific } = immutableResearchJson({ source, scientific }));
    const draft = await renderResearchDraft(source.inputs, source.ledger, source.draft); if (!draft.valid) return draft;
    const audit = toMarkdown([{ type: 'heading', depth: 1, children: [{ type: 'text', value: 'Research evidence audit' }] },
      ...[`Scope: ${source.inputs.scope}.`, `Decision: ${source.inputs.decision?.kind ?? 'not applicable to the retrieval control'}.`,
        `Verification: ${source.verification.state}.`, `Model reviews retained: ${source.reviews.length}.`,
        'Support here means exact admitted quotations and registered numeric mapping. It does not establish general semantic entailment or live research quality.',
        ...source.verification.claims.map(claim => `${claim.claimId}: ${claim.status}${claim.critical ? '; critical' : '; open'}. ${claim.issues.map(issue => issue.code + ': ' + issue.detail).join(' ')}`),
      ].map(value => ({ type: 'paragraph', children: [{ type: 'text', value }] }))]);
    const files: Record<string, string> = { 'draft.md': draft.value.markdown, 'claims.json': researchJsonFile({ ledgerId: source.ledger.id,
      claims: source.ledger.claims, envelope: source.verification.envelope, verificationId: source.verification.id }),
      'metrics.json': researchJsonFile({ observations: source.inputs.observations, cells: draft.value.cells }),
      'literature.json': researchJsonFile({ records: source.inputs.literature, cards: source.inputs.cards }),
      'audit.md': audit, 'disclosure.json': researchJsonFile(source.disclosure) };
    const manifest = await researchExportManifestOf(source, scientific, files); if (!manifest.valid) return manifest;
    files['manifest.json'] = researchJsonFile(manifest.value);
    const body: Omit<ExportReceipt, 'id'> = { projectId: source.inputs.projectId, manifestId: manifest.value.id,
      manifestSha256: await researchFileHash(files['manifest.json']), files: await Promise.all(Object.keys(files).sort().map(async path => ({ path, sha256: await researchFileHash(files[path]) }))),
      latex: { state: 'unmeasured', reason: 'Host compilation has not been requested.', files: [] } };
    const receipt = validateResearchShape<ExportReceipt>('ExportReceipt', { id: 'export-receipt-' + await researchRevisionOf(body), ...body });
    return receipt.valid ? { valid: true, value: { files, manifest: manifest.value, receipt: receipt.value } } : receipt;
  } catch (cause) { return researchRefuse('TRSH1001', '/bundle', 'Bundle rendering requires finite immutable records.', cause); }
}
export async function rerunBundle(value: unknown): Promise<ResearchOutcome<ResearchMarkdownBundle>> {
  const checked = validateResearchShape<ResearchExportManifest>('ResearchExportManifest', value); if (!checked.valid) return checked;
  const { id, ...body } = checked.value;
  if (id !== 'export-' + await researchRevisionOf(body)) return researchRefuse('TRSH1002', '/manifest/id', 'The immutable export manifest changed.');
  const rerun = await renderMarkdownBundle(checked.value.source, checked.value.research); if (!rerun.valid) return rerun;
  return equalsJson(rerun.value.manifest, checked.value) ? rerun : researchRefuse('TRSH1002', '/manifest/files', 'Bundle reconstruction does not reproduce the retained file checksums.');
}
export async function verifyResearchBundleFiles(manifest: unknown, files: Record<string, string>): Promise<ResearchOutcome<ResearchMarkdownBundle>> {
  try { files = immutableResearchJson(files); }
  catch (cause) { return researchRefuse('TRSH1001', '/files', 'Bundle files must be finite immutable text.', cause); }
  const expected = await rerunBundle(manifest); if (!expected.valid) return expected;
  return equalsJson(files, expected.value.files) ? expected : researchRefuse('TRSH1002', '/files', 'Missing, additional or changed files cannot pass a bundle checksum review.');
}
