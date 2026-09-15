/**
 * Version negotiation at boot, against the real dispatcher.
 *
 * The end-to-end case proves the server actually answers its well-known
 * document and that the bundle's own contract negotiates with it. The
 * stubbed cases prove the POLICY — which reasons stop a mount and which
 * only report — because those branches cannot be reached from a tree
 * where both halves are built together, and a branch no test takes is a
 * branch nobody has checked.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';
import { toFetchHandler } from '@jarenjs/contract/fetch';

import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { negotiateBoot, type NegotiationResult, type NegotiatingClient } from '../../apps/desktop/src/ui/negotiate.ts';

const stub = (result: Partial<NegotiationResult>): NegotiatingClient => ({
  negotiate: async () => ({ compatible: false, reason: 'version-mismatch', server: null, error: null, ...result }),
});

describe('desktop boot negotiation', () => {
  let desktop: Desktop;
  let folder: string;
  let client: NegotiatingClient;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-negotiate-'));
    desktop = await createDesktop({ driver: nodeDriver(), presetSettings: { folder } });
    const handler = toFetchHandler(desktop.dispatcher);
    client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test',
      fetch: (async (url: any, init: any) => handler(new Request(url, init))) as any,
    }) as unknown as NegotiatingClient;
  });

  after(async () => {
    await desktop?.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('the server answers its well-known document and the shipped bundle negotiates', async () => {
    const verdict = await negotiateBoot(client, DESKTOP_CONTRACT.version);
    assert.equal(verdict.mount, true, 'the halves ship together, so they agree');
    assert.equal(verdict.reason, 'same-version');
    assert.equal(verdict.message, null, 'an unremarkable boot says nothing');
    assert.equal(verdict.code, null);
    assert.equal(verdict.server?.id, 'tangle-desktop', 'the server identified itself');
    assert.equal(verdict.server?.version, DESKTOP_CONTRACT.version);
    assert.match(verdict.server?.revision ?? '', /^[0-9a-f]{64}$/, 'and carried its revision');
  });

  it('a version the two ends do not declare stops the mount, and names both', async () => {
    const verdict = await negotiateBoot(
      stub({ reason: 'version-mismatch', server: { id: 'tangle-desktop', version: '9.9.9', compat: ['9.9.8'], revision: null },
        error: { code: 'JC2057', message: 'incompatible' } }),
      '0.0.1');
    assert.equal(verdict.mount, false, 'every operation after an undeclared version is guesswork');
    assert.equal(verdict.code, 'JC2057');
    assert.match(verdict.message ?? '', /built for desktop 0\.0\.1/);
    assert.match(verdict.message ?? '', /speaks 9\.9\.9/);
    assert.match(verdict.message ?? '', /accepting 9\.9\.8/, 'the operator sees what the server would accept');
    assert.match(verdict.message ?? '', /Reload/);
  });

  it('a declared compat window is accepted, and says nothing', async () => {
    for (const reason of ['server-accepts', 'client-accepts'] as const) {
      const verdict = await negotiateBoot(stub({ compatible: true, reason }), '0.0.1');
      assert.equal(verdict.mount, true, `${reason} is the declaration doing its job`);
      assert.equal(verdict.message, null);
    }
  });

  it('an unreachable or foreign server reports without blocking the mount', async () => {
    const unreachable = await negotiateBoot(
      stub({ reason: 'unreachable', error: { code: 'JC2051', message: 'unreachable' } }), '0.0.1');
    assert.equal(unreachable.mount, true, 'a transport failure is not a version refusal');
    assert.equal(unreachable.code, 'JC2051');
    assert.match(unreachable.message ?? '', /did not answer the version check/);

    const foreign = await negotiateBoot(
      stub({ reason: 'not-a-contract', error: { code: 'JC2056', message: 'not a contract' } }), '0.0.1');
    assert.equal(foreign.mount, true, 'the operator sees this the moment anything is attempted');
    assert.match(foreign.message ?? '', /not this desktop contract/);
  });
});
