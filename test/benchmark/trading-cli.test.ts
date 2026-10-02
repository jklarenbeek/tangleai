import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile), cli = fileURLToPath(new URL('../../benchmark/trading.ts', import.meta.url));
for (const kind of ['unknown-capability', 'source-drift', 'byte-drift']) it(`trading CLI refuses ${kind} before executing the measurement`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trading-cli-preflight-'));
  try {
    const hook = join(dir, 'hook.mjs'), file = join(dir, 'report.json');
    // Replace the expensive measurement seam, leaving actual CLI parsing and file admission intact.
    await writeFile(hook, `import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  if (!url.endsWith('/benchmark/lib/trading-report.ts')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: \`
    const reached = () => { throw Error('MEASUREMENT_REACHED'); };
    export const buildTradingReport = reached, validateTradingReport = reached, requireCapability = reached;
    export const tradingSource = async () => ({files:[{path:'current-source',sha256:'current'}]});
    export const renderReport = value => JSON.stringify(value, null, 2) + String.fromCharCode(10);
    export const renderDocument = () => '', REPORT_PATH = 'report.json', DOCUMENT_PATH = 'report.md';
  \` };
} });`);
    await writeFile(file, JSON.stringify({ source: { files: [] } }, null, 2) + '\n' + (kind === 'byte-drift' ? ' ' : ''));
    const args = kind === 'unknown-capability' ? ['--require', 'unknown'] : ['--check', '--json', file, '--md', join(dir, 'report.md')];
    await assert.rejects(execute(process.execPath, ['--import', hook, cli, ...args], { maxBuffer: 65536 }), error => {
      const message = String(error); assert.doesNotMatch(message, /MEASUREMENT_REACHED/);
      assert.match(message, kind === 'unknown-capability' ? /Unknown trading capability/ : kind === 'source-drift' ? /source drift/ : /artifact drift/); return true;
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
