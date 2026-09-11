/** Verify the compiled server from outside its source checkout. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, readJson } from './common.ts';

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const address = probe.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
const directory = mkdtempSync(resolve(tmpdir(), 'tangle-binary-consumer-'));
const executable = resolve(ROOT, process.platform === 'win32' ? 'dist/tangle.exe' : 'dist/tangle');
const child = spawn(executable, ['--port', String(port), '--data', resolve(directory, 'tangle.db'), '--no-open'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = once(child, 'exit');
let output = '';
child.stdout.on('data', chunk => { output += String(chunk); });
child.stderr.on('data', chunk => { output += String(chunk); });
try {
  let started = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Compiled desktop exited before readiness: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const status = await response.json() as { version: string };
        assert.equal(status.version, readJson(resolve(ROOT, 'package.json')).version);
        started = true;
        break;
      }
    } catch (error) { if (error instanceof assert.AssertionError) throw error; }
    await delay(250);
  }
  assert.ok(started, `Compiled desktop did not become ready: ${output}`);
  for (const path of ['/', '/app.js', '/vendor.css', '/.well-known/jaren-contract']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `Compiled ${path}: HTTP ${response.status}`);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  copyFileSync(executable, resolve(ROOT, `dist/release/tangle-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`));
  console.log('Compiled desktop version, API and embedded assets verified from a foreign directory.');
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([exited, delay(5000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); })]);
  rmSync(directory, { recursive: true, force: true });
}
