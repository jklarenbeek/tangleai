/**
 * A stand-in instrument for the desktop's child-process runner.
 *
 * It is spawned exactly as a real instrument is — `<runtime> <entry>
 * --out <file>` or `--out-dir <directory>` — and it behaves differently
 * per registered id, which it reads from the output path the runner
 * built for it. That keeps one fixture honest about every path the
 * runner has to survive: a clean run, a non-zero exit, a child that
 * ignores its termination signal, a line shaped like a credential, and
 * a directory-writing instrument that produces more than one file.
 *
 * The document it writes carries its own `reportId` under the recipe
 * every real instrument uses — the canonical digest of the document
 * without that member — so the desktop's verification is exercised
 * against the same arithmetic, not a stub of it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';

const [flag, target] = process.argv.slice(2);
if (flag !== '--out' && flag !== '--out-dir') {
  console.error(`unexpected output flag: ${String(flag)}`);
  process.exit(64);
}
const mode = flag === '--out' ? basename(target, '.json') : 'echo-dir';

/** Every environment member a keyless child must never have been handed. */
const suspects = Object.keys(process.env)
  .filter((name) => name.startsWith('TANGLE_AI_') || name.endsWith('_KEY') || name.endsWith('_TOKEN') || name.endsWith('_SECRET'))
  .sort();

console.log(`echo instrument: ${mode}`);
console.log('| step | state |');
console.log('| scan | done |');
console.error('warning: this is a fixture, not a measurement');

if (mode === 'echo-secret') {
  console.log('resolved credential sk-live-0123456789abcdefghij for the run');
  console.log('after the refused line, work continues');
}

if (mode === 'echo-long') {
  for (let i = 0; i < 40; i++) console.log(`line ${i} ${'x'.repeat(400)}`);
}

if (mode === 'echo-fail') {
  console.error('the fixture was asked to fail');
  process.exit(3);
}

if (mode === 'echo-hang') {
  // only an outright kill ends this child: the escalation the runner
  // owns is the thing under test
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  const document = { benchmark: 'echo', mode, rows: [{ id: 'a', value: 1 }], env: { suspects }, reportId: '0'.repeat(64) };
  const { reportId: _placeholder, ...rest } = document;
  document.reportId = await canonicalSha256(rest);

  if (flag === '--out') {
    await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
  } else {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'echo-dir.json'), `${JSON.stringify(document, null, 2)}\n`);
    await writeFile(join(target, 'ECHO.md'), '# echo\n\nA fixture document.\n');
  }
  console.log(`report → ${target} (${document.reportId.slice(0, 12)}…)`);
}
