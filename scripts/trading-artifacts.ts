/** Build-only prompt I/O; the GMPL compiler owns all parsing and rendering. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileGmplPromptPack, gmplCatalogDocument, createGmplCatalog, gmplSchemaOf,
  type GmplPromptArtifact, type GmplVariables } from '@tangleai/gmpl';
import { tradingSchemaOf } from '../packages/trading/src/schema.ts';
import { tradingPromptFiles, TRADING_PROMPT_OUTPUTS } from './trading-sources.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(a => a !== '--check')) throw new Error('usage: trading-artifacts.ts [--check]');
const text = { schema: { type: 'string', minLength: 1 }, render: 'text' as const };
const data = (schema: Record<string, unknown> = { type: 'object' }): GmplVariables[string] => ({ schema, render: 'json' });
const prompts: GmplPromptArtifact[] = [];
for (const file of tradingPromptFiles()) {
  const name = file.split('/').at(-1)!.slice(0, -5) as keyof typeof TRADING_PROMPT_OUTPUTS;
  const output = TRADING_PROMPT_OUTPUTS[name], research = name.startsWith('research-');
  const variables: GmplVariables = research ? { query: text, evidence: data({ type: 'array', items: gmplSchemaOf('gmplEvidenceUnit') }), context: data() }
    : name === 'trader' ? { asset: text, cutoff_at: text, reports: data({ type: 'array', items: tradingSchemaOf('analystReport') }), verdict: data(tradingSchemaOf('researchVerdict')), portfolio: data(tradingSchemaOf('tradingVisiblePortfolio')) }
    : name.startsWith('risk-') ? { asset: text, persona: text, proposal: data(tradingSchemaOf('tradeProposal')), portfolio: data(tradingSchemaOf('tradingVisiblePortfolio')), policy: data(tradingSchemaOf('riskPolicy')), evidence: data({ type: 'array', items: gmplSchemaOf('gmplEvidenceUnit') }), turns: data({ type: 'array', items: tradingSchemaOf('riskTurn') }) }
    : name === 'fund-manager' ? { asset: text, proposal: data(tradingSchemaOf('tradeProposal')), risk_verdict: data(tradingSchemaOf('riskVerdict')), policy: data(tradingSchemaOf('riskPolicy')), portfolio: data(tradingSchemaOf('tradingVisiblePortfolio')) }
    : { asset: text, cutoff_at: text, snapshot: data(tradingSchemaOf('tradingAnalystView')), portfolio: data(tradingSchemaOf('tradingVisiblePortfolio')) };
  const outputSchema = research ? gmplSchemaOf(output as Parameters<typeof gmplSchemaOf>[0]) : tradingSchemaOf(output as Parameters<typeof tradingSchemaOf>[0]);
  const compiled = await compileGmplPromptPack(await readFile(file, 'utf8'), { variables, outputSchema });
  if (!compiled.valid) throw new Error(file + ': ' + JSON.stringify(compiled.issues));
  prompts.push(compiled.value);
}
const catalog = await gmplCatalogDocument({ id: 'trading-default', prompts, domains: [], recipes: [] });
const checked = await createGmplCatalog(catalog);
if (!checked.valid) throw new Error(JSON.stringify(checked.issues));
const path = 'packages/trading/artifacts/catalog.json', bytes = JSON.stringify(catalog, null, 2) + '\n';
if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw new Error('Trading artifact drift.'); }
else await writeFile(path, bytes);
console.log(`Trading: ${prompts.length} compiled artifacts; ${catalog.revision}`);
