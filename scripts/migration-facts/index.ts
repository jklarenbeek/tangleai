import { fileURLToPath } from 'node:url';
import { main } from './derive.ts';
import { horizonFacts } from './horizon.ts';
import { programFacts } from './program.ts';
import { ledgerFacts } from './ledger.ts';
import { recallFacts } from './recall.ts';
import { readFileSync } from 'node:fs';
const bundleFacts = {
  name: 'program pen bundle',
  docs: () => ['packages/linq/docs/PROGRAM-PEN.md'],
  facts: () => ({ 'bundle.program': () => JSON.parse(readFileSync(new URL('../../docs/migrations/jaren-ai/program-bundle.json', import.meta.url), 'utf8')).bytes.toLocaleString('en-US') }),
};
process.exitCode = main({ root: fileURLToPath(new URL('../../', import.meta.url)), registries: [horizonFacts, programFacts, ledgerFacts, recallFacts, bundleFacts], argv: process.argv.slice(2) });
