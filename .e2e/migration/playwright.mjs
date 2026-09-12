import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../../jarenjs/package.json', import.meta.url));
export const { test, expect, defineConfig, devices } = require('@playwright/test');
