/** Native contracts share the record schema and the read projection's derived shapes. */
import './training-service-contract.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { createExperientialContract, experientialContractDocument } from '../packages/experiential/src/contract.ts';

createExperientialContract();
const bytes = JSON.stringify(experientialContractDocument, null, 2) + '\n';
const path = new URL('../packages/experiential/schemas/experiential.contract.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw Error('Experiential operation contract is stale; run npm run emit:experiential-contract');
} else await writeFile(path, bytes);
