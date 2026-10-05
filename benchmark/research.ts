/** Clock-free research fixture measurement with strict selection, drift checks and a whole-run fetch trap. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/args.ts';
import { RESEARCH_ROW_IDS } from './lib/research-schema.ts';
import { buildReport, researchContext, validateResearchReport, renderReport, renderDocument, REPORT_PATH, DOCUMENT_PATH } from './lib/research.ts';
import type { ResearchReport } from './lib/research.types.ts';

export function requireResearchGate(report: ResearchReport, gate: string | undefined): void {
  if (gate === undefined) return;
  if (gate !== 'registration' && gate !== 'oracle' && gate !== 'bundles' && gate !== 'analysis' && gate !== 'writing') throw new Error('Unknown research gate: ' + gate);
  if (!report.gate[gate]) throw new Error('Required research gate failed: ' + gate);
}
export async function runResearchCli(argv: string[]): Promise<ResearchReport> {
  for (const arg of argv) if (arg.startsWith('--check=')) throw new Error('--check takes no value');
  const args = parseArgs(argv, { flags: ['check'], values: ['out', 'rows', 'require'] });
  if (args.rest.length || [...args.values.values()].some(value => !value.trim() || value.startsWith('--')))
    throw new Error('Unexpected research argument or missing option value.');
  const selection = args.values.get('rows');
  const rows = selection === 'lessons' ? ['artifact-oracle', 'no-model-runner'] : selection?.split(',');
  if (rows && (!rows.length || new Set(rows).size !== rows.length || rows.some(id => !RESEARCH_ROW_IDS.some(row => row === id))))
    throw new Error('Research rows must be a nonempty unique subset of registered ids.');
  const gate = args.values.get('require');
  if (gate && !['registration', 'oracle', 'bundles', 'analysis', 'writing'].includes(gate)) throw new Error('Unknown research gate: ' + gate);
  const out = args.values.get('out'), json = out ?? REPORT_PATH, md = out ? out + '.md' : DOCUMENT_PATH;
  const previousFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('The keyless research instrument attempted a network request.'); };
  try {
    let context = await researchContext();
    if (args.flags.has('check')) {
      const previous = JSON.parse(await readFile(json, 'utf8')) as ResearchReport;
      if (!await validateResearchReport(previous, context)) throw new Error('Research report source, registration or measurement drift.');
      context = { ...context, source: previous.source };
    }
    const report = await buildReport({ context, rows });
    if (requests !== 0) throw new Error('Research network trap was reached.');
    requireResearchGate(report, gate);
    const outputs = [[json, renderReport(report)], [md, renderDocument(report)]];
    if (args.flags.has('check')) {
      for (const [path, bytes] of outputs) if (await readFile(path, 'utf8') !== bytes) throw new Error('Research output drift: ' + path);
    } else for (const [path, bytes] of outputs) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
    return report;
  } finally { globalThis.fetch = previousFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runResearchCli(process.argv.slice(2));
  console.log(JSON.stringify({ reportId: report.reportId, decision: report.decision, gate: report.gate,
    measured: report.rows.filter(row => row.state === 'measured').length,
    implementationMissing: report.rows.filter(row => row.state === 'implementation-missing').length }));
}
