import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('the public trading root imports without filesystem, database or network work', async () => {
  const script = `import {registerHooks} from 'node:module';
    const banned=['node:fs','node:fs/promises','fs','fs/promises','node:sqlite','bun:sqlite','node:net','node:http','node:https','node:child_process'];
    registerHooks({resolve(specifier,context,next){if(banned.includes(specifier))throw Error('Unexpected IO import: '+specifier);return next(specifier,context)}});
    globalThis.fetch=()=>{throw Error('Unexpected network')};
    const api=await import('@tangleai/trading');
    if(typeof api.createMemoryTradingStore!=='function'||typeof api.latestBarsAsOf!=='function')throw Error('Missing trading exports');`;
  const result = await promisify(execFile)('node', ['--input-type=module', '-e', script]);
  assert.equal(result.stderr, '');
});
