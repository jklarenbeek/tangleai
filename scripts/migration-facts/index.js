import { fileURLToPath } from 'node:url';
import { main } from './derive.js';
import { horizonFacts } from './horizon.js';
import { programFacts } from './program.js';
import { ledgerFacts } from './ledger.js';
import { recallFacts } from './recall.js';
import { readFileSync } from 'node:fs';
const bundleFacts = {
  name: 'program pen bundle',
  docs: () => ['packages/jaren/docs/PROGRAM-PEN.md'],
  facts: () => ({ 'bundle.program': () => JSON.parse(readFileSync(new URL('../../docs/migrations/jaren-ai/program-bundle.json', import.meta.url), 'utf8')).bytes.toLocaleString('en-US') }),
};
process.exitCode=main({root:fileURLToPath(new URL('../../',import.meta.url)), registries:[horizonFacts,programFacts,ledgerFacts,recallFacts,bundleFacts],argv:process.argv.slice(2)});
