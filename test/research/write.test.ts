import assert from 'node:assert/strict';
import { it } from 'node:test';
import { researchDraftProposal, writeResearchDraft, renderMetricTable, renderResearchDraft, researchMarkdownSectionIds,
  RESEARCH_DRAFT_SECTIONS, buildClaimLedger } from '@tangleai/research';
import { writingFixture } from './writing-fixtures.ts';
import { checked } from './fixtures.ts';

it('template and agent proposals have identical section ids and cannot add an unbound numeric sentence', async () => {
  const f = await writingFixture(), proposal = researchDraftProposal(f.ledger);
  const agent = checked(await writeResearchDraft(f.ledger, f.writer, { mode: 'agent', proposal }));
  assert.deepEqual(agent.sections, f.draft.sections); assert.deepEqual(agent.sections.map(section => section.id), RESEARCH_DRAFT_SECTIONS);
  proposal.sections[0].text = 'The candidate achieved 99% improvement.';
  const refused = await writeResearchDraft(f.ledger, f.writer, { mode: 'agent', proposal });
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1005');
});
it('table rendering derives individual and mean cells from registry rows and refuses changed cells', async () => {
  const f = await writingFixture(), table = checked(await renderMetricTable(f.input));
  assert.equal(table.cells.length, 12); assert.equal(table.cells.filter(cell => cell.aggregate === 'mean').length, 2);
  assert.ok(table.cells.filter(cell => cell.aggregate === 'mean').every(cell => cell.n === 5 && cell.seeds.length === 5));
  const fabricated = structuredClone(table.cells); fabricated[0].value += 1;
  const refused = await renderMetricTable(f.input, fabricated); assert.equal(refused.valid, false);
  if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1002');
});
it('native Markdown printing keeps headings and HTML in evidence literal and retains the declared sections', async () => {
  const f = await writingFixture(), input = structuredClone(f.input);
  input.cards[0].excerpt = '# invented heading\n<script>99</script>\n\n## results';
  const ledger = checked(await buildClaimLedger(input)), draft = checked(await writeResearchDraft(ledger, f.writer, { mode: 'template' }));
  const result = checked(await renderResearchDraft(input, ledger, draft));
  assert.deepEqual(researchMarkdownSectionIds(result.markdown), RESEARCH_DRAFT_SECTIONS);
  assert.equal(result.markdown.includes('<script>'), false);
  assert.ok(result.markdown.includes('invented heading'));
});
it('rendering snapshots evidence before asynchronous verification so caller mutation cannot change the emitted facts', async () => {
  const f = await writingFixture(), input = structuredClone(f.input), ledger = structuredClone(f.ledger), draft = structuredClone(f.draft);
  const expected = checked(await renderResearchDraft(f.input, f.ledger, f.draft));
  const pending = renderResearchDraft(input, ledger, draft);
  ledger.claims[0].text = 'Injected statement after admission.'; draft.sections[0].text = 'Injected draft.';
  input.observations[0].value = 999;
  const rendered = checked(await pending);
  assert.equal(rendered.markdown.includes('Injected'), false);
  assert.equal(rendered.markdown, expected.markdown);
  assert.equal(rendered.verification.state, 'verified');
});
