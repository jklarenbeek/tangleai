/** Configured assistant appearance on the original desktop and phone viewports; no model request. */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../jarenjs/package.json', import.meta.url));
const { chromium, devices } = require('@playwright/test');
const output = process.env.DRIVE_OUTPUT ?? '/tmp/tangle-drive/shots';
mkdirSync(output, { recursive:true });
const browser = await chromium.launch();
try {
  for (const [name, options] of [
    ['mobile-light', { ...devices['iPhone 13'], colorScheme:'light' }],
    ['mobile-dark', { ...devices['iPhone 13'], colorScheme:'dark' }],
    ['mobile-small', { viewport:{ width:320, height:660 }, hasTouch:true, isMobile:true, deviceScaleFactor:2 }],
    ['desktop', { viewport:{ width:1440, height:900 } }],
  ]) {
    const context = await browser.newContext(options);
    try {
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('tangle-ai', JSON.stringify({provider:'openrouter',baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'fixture'})));
      await page.goto(process.env.BASE ?? 'http://127.0.0.1:4715');
      await page.locator('.ai-launch').click();
      await page.locator('.ai-composer textarea').waitFor();
      await page.screenshot({path:resolve(output,`${name}-assistant.png`),fullPage:false});
      if (errors.length) throw new Error(errors.join('\n'));
      console.log(`${name}: configured assistant captured`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
