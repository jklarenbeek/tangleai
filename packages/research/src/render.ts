/** Native Markdown printing and parsing keep literal evidence from becoming document structure. */
import { parseMarkdown, toMarkdown, textOf } from '@jarenjs/md';
import { equalsJson } from '@jarenjs/core/object';
import type { ResearchWritingInputs, ResearchClaimLedger, Draft, ResearchMetricTableCell } from './contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from './errors.ts';
import { immutableResearchJson } from './identity.ts';
import { researchValue, ResearchFailure } from './workflow-contract.ts';
import { researchAggregate } from './statistics.ts';
import { validateResearchWritingInputs, researchDisplayValue, RESEARCH_DRAFT_SECTIONS } from './stages/claims.ts';
import { verifyResearchDraft } from './stages/verify.ts';

type MarkdownNode = { type: string; [key: string]: unknown };
const literal = (value: string): MarkdownNode => ({ type: 'text', value });
const paragraph = (value: string): MarkdownNode => ({ type: 'paragraph', children: [literal(value)] });
const heading = (value: string): MarkdownNode => ({ type: 'heading', depth: 2, children: [literal(value)] });
export async function renderMetricTable(value: ResearchWritingInputs, proposed?: readonly ResearchMetricTableCell[]): Promise<ResearchOutcome<{ markdown: string; cells: ResearchMetricTableCell[] }>> {
  try {
    proposed = proposed ? immutableResearchJson(proposed) : undefined;
    const input = researchValue(await validateResearchWritingInputs(value));
    const cells: ResearchMetricTableCell[] = [];
    for (const condition of input.plan?.conditions ?? []) for (const metric of input.contract?.metrics ?? []) {
      const aggregate = researchAggregate(condition.id, metric.id, metric.unit, input.observations);
      for (const row of aggregate.values) cells.push({ condition: condition.id, metric: metric.id, unit: metric.unit,
        seeds: [row.seed], n: 1, aggregate: 'individual', value: researchDisplayValue(row.value, metric.roundingDigits) });
      if (aggregate.mean !== null) cells.push({ condition: condition.id, metric: metric.id, unit: metric.unit,
        seeds: aggregate.values.map(row => row.seed), n: aggregate.n, aggregate: 'mean', value: researchDisplayValue(aggregate.mean, metric.roundingDigits) });
    }
    if (proposed && !equalsJson(cells, proposed)) return researchRefuse('TRSH1002', '/table', 'Every table cell must reproduce its registered observation or complete aggregate.');
    if (!cells.length) return { valid: true, value: { cells, markdown: 'No registered observations.\n' } };
    const rows = [['Condition', 'Metric', 'Unit', 'Seeds', 'Aggregate', 'n', 'Value'], ...cells.map(cell =>
      [cell.condition, cell.metric, cell.unit, cell.seeds.join(', '), cell.aggregate, String(cell.n), String(cell.value)])];
    const table: MarkdownNode = { type: 'table', align: rows[0].map(() => null), children: rows.map(row => ({ type: 'tableRow',
      children: row.map(value => ({ type: 'tableCell', children: [literal(value)] })) })) };
    return { valid: true, value: { cells, markdown: toMarkdown([table]) } };
  } catch (cause) { return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
    : researchRefuse('TRSH1001', '/table', 'Metric rendering requires finite immutable admitted rows.', cause); }
}
export async function renderResearchDraft(input: ResearchWritingInputs, ledger: ResearchClaimLedger, draft: Draft) {
  try { ({ input, ledger, draft } = immutableResearchJson({ input, ledger, draft })); }
  catch (cause) { return researchRefuse('TRSH1001', '/draft', 'Rendering requires finite immutable records.', cause); }
  const verified = await verifyResearchDraft(input, ledger, draft); if (!verified.valid) return verified;
  if (verified.value.state === 'refused') return { valid: false as const, issues: verified.value.issues };
  const table = await renderMetricTable(input); if (!table.valid) return table;
  const nodes: MarkdownNode[] = [{ type: 'heading', depth: 1, children: [literal(input.scope === 'stopped-run-audit' ? 'Stopped research audit'
    : input.scope === 'retrieval-control' ? 'Literature retrieval control' : 'Research draft')] }];
  for (const section of draft.sections) {
    nodes.push(heading(section.id));
    for (const id of section.claimIds) {
      const claim = ledger.claims.find(claim => claim.id === id)!, check = verified.value.claims.find(check => check.claimId === id)!;
      const citations = claim.literatureIds.map(id => ` [${id}]`).join('');
      nodes.push(paragraph(claim.text + citations + ` [claim: ${claim.id}]` + (check.status === 'unresolved' ? ` ⟦unresolved: ${claim.id}⟧` : '')));
    }
  }
  nodes.push(heading('Registered metrics'), ...parseMarkdown(table.value.markdown).ast);
  nodes.push(heading('Literature'));
  for (const record of input.literature) nodes.push(paragraph(`${record.id}: ${record.title}. ${record.authors.join('; ')}. ${record.date}. ${Object.entries(record.canonicalIds).map(([key, value]) => key + ': ' + value).join('; ')}.`));
  return { valid: true as const, value: { markdown: toMarkdown(nodes), verification: verified.value, cells: table.value.cells } };
}
/** Section extraction belongs to the native Markdown parser, including hostile evidence syntax. */
export function researchMarkdownSectionIds(markdown: string): string[] {
  return parseMarkdown(markdown).ast.filter(node => node.type === 'heading' && node.depth === 2)
    .map(node => textOf(node)).filter(id => (RESEARCH_DRAFT_SECTIONS as readonly string[]).includes(id));
}
