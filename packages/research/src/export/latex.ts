/** Text-only TeX export from the same verified ledger; compilation is a host capability. */
import { rerunBundle } from './markdown.ts';
import { renderMetricTable } from '../render.ts';
import type { ResearchExportManifest } from '../contracts.gen.ts';
import type { ResearchOutcome } from '../errors.ts';

const replacements: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\textbraceleft{}', '}': '\\textbraceright{}',
  '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' };
const texText = (text: string): string => text.replace(/[\\{}#$%&_^~]/g, character => replacements[character]).replace(/\r?\n/g, ' ');
export async function renderLatexBundle(manifest: ResearchExportManifest): Promise<ResearchOutcome<{ files: Record<'main.tex' | 'references.bib', string>; manifestId: string }>> {
  const rerun = await rerunBundle(manifest); if (!rerun.valid) return rerun;
  const source = rerun.value.manifest.source, records = [...source.inputs.literature].sort((a, b) => a.id.localeCompare(b.id));
  const keys = new Map(records.map((record, index) => [record.id, 'ref' + (index + 1)]));
  const bibliography = records.map(record => `@misc{${keys.get(record.id)},\n  title = {${texText(record.title)}},\n  author = {${record.authors.map(texText).join(' and ')}},\n  year = {${texText(record.date)}},\n  note = {${texText(Object.entries(record.canonicalIds).map(([key, value]) => key + ': ' + value).join('; '))}}\n}\n`).join('\n');
  const table = await renderMetricTable(source.inputs); if (!table.valid) return table;
  const sections = source.draft.sections.map(section => `\\section{${texText(section.id)}}\n` + section.claimIds.map(id => {
    const claim = source.ledger.claims.find(claim => claim.id === id)!, check = source.verification.claims.find(check => check.claimId === id)!;
    const citations = claim.literatureIds.map(id => keys.has(id) ? ` \\cite{${keys.get(id)}}` : ` [unresolved citation: ${texText(id)}]`).join('');
    return texText(claim.text) + citations + ` [claim: ${texText(claim.id)}]` + (check.status === 'unresolved' ? ` [unresolved: ${texText(claim.id)}]` : '');
  }).join('\n\n')).join('\n\n');
  const rows = table.value.cells.map(row => [row.condition, row.metric, row.unit, row.seeds.join(', '), row.aggregate, String(row.n), String(row.value)]
    .map(texText).join(' & ') + ' \\\\').join('\n');
  const metrics = rows ? '\\begin{longtable}{p{.11\\linewidth}p{.11\\linewidth}p{.13\\linewidth}p{.10\\linewidth}p{.10\\linewidth}rp{.17\\linewidth}}\nCondition & Metric & Unit & Seeds & Aggregate & n & Value \\\\\n\\hline\n' + rows + '\n\\end{longtable}' : 'No registered observations.';
  const title = source.inputs.scope === 'stopped-run-audit' ? 'Stopped research audit' : source.inputs.scope === 'retrieval-control' ? 'Literature retrieval control' : 'Research draft';
  const main = '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\usepackage{longtable}\n'
    + '\\pdfinfoomitdate=1\n\\pdftrailerid{}\n\\pdfsuppressptexinfo=15\n'
    + `\\title{${title}}\n\\author{}\n\\date{}\n\\begin{document}\n\\maketitle\n${sections}\n\n\\section{Registered metrics}\n\\small\n${metrics}\n\\normalsize\n`
    + '\\nocite{*}\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n';
  return { valid: true, value: { files: { 'main.tex': main, 'references.bib': bibliography }, manifestId: rerun.value.manifest.id } };
}
