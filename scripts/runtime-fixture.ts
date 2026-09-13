/** The Node verification parent owns scratch until the tested runtime exits. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
export interface RuntimeFixtureOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  scratchRoot?: string;
  /** Inspect persisted files after process close and before parent cleanup. */
  afterExit?: (directory: string) => Promise<void>;
}
export async function runRuntimeFixture(runtime: string, args: string[], options: RuntimeFixtureOptions = {}) {
  const directory = await mkdtemp(join(options.scratchRoot ?? tmpdir(), 'tangle fixture é-'));
  try {
    // execFile settles after close, including error/timeout paths. No cleanup
    // runs while the child can still write or retain its native SQLite handles.
    const result = await execute(runtime, args, {
      cwd: options.cwd, timeout: options.timeout ?? 60000, maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
      env: { ...process.env, TANGLE_FIXTURE_DIRECTORY: directory },
    });
    await options.afterExit?.(directory);
    return result;
  } finally {
    // Windows can release filesystem locks after exit. Persistent failures
    // still reject the gate; only these bounded OS cleanup retries are allowed.
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}
