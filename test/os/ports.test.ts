/**
 * The port transport loads only when a framed module connects: serving and
 * opening stay synchronous, what arrives before the transport is held and
 * delivered in order, and nothing a desktop without framed modules imports
 * reaches `@jarenjs/contract/port` statically.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileContract } from '@jarenjs/contract';
import { openPortClient } from '@jarenjs/contract/port';
import { servePortLazily, openPortClientLazily, portsLoaded, loadPorts, portLoader } from '../../components/os/src/ports.ts';

const ECHO = compileContract({ $contract: '0.1', id: 'echo', operations: { 'echo.say': { kind: 'read', input: { type: 'object', properties: { n: { type: 'integer' } } }, output: { type: 'object' } } } } as any);

describe('the lazily loaded port transport', () => {
  it('holds what arrives before the transport is there, and answers it in order', async () => {
    assert.equal(portsLoaded(), false, 'nothing has loaded the transport yet');
    const channel = new MessageChannel();
    const seen: number[] = [];
    const served = servePortLazily(ECHO, { 'echo.say': ({ n }: any) => { seen.push(n); return { n }; } }, { channel: channel.port1 });
    // the other side asks at once, before the server has attached
    const client = openPortClient(ECHO, { channel: channel.port2, timeoutMs: 5000 });
    const answers = await Promise.all([1, 2, 3].map(n => client.invoke('echo.say', { n })));
    assert.deepEqual(answers.map((a: any) => a.value?.n ?? a.n), [1, 2, 3]);
    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(portsLoaded(), true);
    served.close?.(); client.close?.(); channel.port1.close(); channel.port2.close();
  });

  it('opens a client whose calls wait for the transport', async () => {
    // a fresh copy of the module, whose transport has not loaded yet
    const fresh: typeof import('../../components/os/src/ports.ts') = await import(`../../components/os/src/ports.ts?client=${Date.now()}`);
    assert.equal(fresh.portsLoaded(), false);
    const { servePort } = await import('@jarenjs/contract/port');
    const channel = new MessageChannel();
    const served = servePort(ECHO, { 'echo.say': ({ n }: any) => ({ n: n * 2 }) } as any, { channel: channel.port1 });
    const client = fresh.openPortClientLazily(ECHO, { channel: channel.port2, timeoutMs: 5000 });
    const answer: any = await client.invoke('echo.say', { n: 21 });
    assert.equal(answer.value?.n ?? answer.n, 42);
    assert.equal(fresh.portsLoaded(), true);
    served.close?.(); client.close?.(); channel.port1.close(); channel.port2.close();
  });

  it('serves at once when the transport is already there', async () => {
    await loadPorts();
    const channel = new MessageChannel();
    const served = servePortLazily(ECHO, { 'echo.say': ({ n }: any) => ({ n: n + 1 }) }, { channel: channel.port1 });
    const client = openPortClientLazily(ECHO, { channel: channel.port2, timeoutMs: 5000 });
    const answer: any = await client.invoke('echo.say', { n: 1 });
    assert.equal(answer.value?.n ?? answer.n, 2);
    served.close?.(); client.close?.(); channel.port1.close(); channel.port2.close();
  });

  it('keeps a loaded transport but not a failed fetch, so a retry fetches again', async () => {
    let attempts = 0;
    const loader = portLoader(async () => { attempts++; if (attempts === 1) throw new Error('offline'); return import('@jarenjs/contract/port'); });
    await assert.rejects(loader.load(), /offline/);
    assert.equal(loader.get(), null);
    const loaded = await loader.load();
    assert.equal(typeof loaded.servePort, 'function');
    await loader.load();
    assert.equal(attempts, 2, 'a loaded transport is not fetched again');
  });

  it('keeps the transport out of every static import a desktop makes', () => {
    const src = new URL('../../components/os/src/', import.meta.url);
    const seen = new Set<string>();
    const reaches: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(new URL(file, src), 'utf8');
      for (const [, spec] of text.matchAll(/^(?:import|export)(?!\s+type\b)[^;]*?from\s+'([^']+)'/gm)) {
        if (spec === '@jarenjs/contract/port') reaches.push(file);
        else if (spec.startsWith('./')) walk(spec.slice(2));
      }
    };
    // the root entry, the shell, Settings and Files: what a desktop host bundles
    for (const entry of ['index.ts', 'shell.ts', 'settings.ts', 'files-app.ts']) walk(entry);
    assert.deepEqual(reaches, []);
    assert.ok(!seen.has('module.ts'), 'the joining side stays out of the desktop');
    assert.match(readFileSync(new URL('ports.ts', src), 'utf8'), /import\('@jarenjs\/contract\/port'\)/);
  });
});
