/** Match the existing desktop/Pages browser toolchain without adding a runtime dependency. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
// the repository's .env carries the live tier's key and model; a variable
// already set in the shell wins over the file
const env = new URL('../../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../../jarenjs/package.json', import.meta.url));
execFileSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', '.e2e/migration.config.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
