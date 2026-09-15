/**
 * Freeze the suite public projection of the desktop contract as bytes.
 *
 * The projection is what a client negotiates against, so a frozen copy is
 * what lets `diffContracts` answer a real question later. The destination
 * is always named on the command line: this writer has no default path and
 * therefore cannot silently refresh a snapshot something else is pinned to.
 *
 *   node scripts/desktop-contract-fixture.ts test/fixtures/<name>.json
 */
import { writeFile } from 'node:fs/promises';
import { compileContract } from '@jarenjs/contract';
import { publicProjection } from '@jarenjs/contract/project';
import { DESKTOP_CONTRACT } from '../apps/desktop/src/contract.ts';

const out = process.argv[2];
if (out === undefined || out === '') {
  console.error('usage: node scripts/desktop-contract-fixture.ts <path>');
  process.exit(1);
}
const compiled = compileContract(DESKTOP_CONTRACT as unknown as Record<string, unknown>);
await writeFile(out, `${JSON.stringify(publicProjection(compiled), null, 2)}\n`);
console.log(`contract projection → ${out} (revision ${(await compiled.revision()).slice(0, 12)}…)`);
