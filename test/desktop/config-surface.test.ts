/**
 * The surface: the public contract changed compatibly against the
 * frozen pre-campaign projection, settings reads expose slot status and
 * never a credential value, a read-save round trip retains, clearing
 * requires the explicit flag, the read-only inspection never probes or
 * creates a client, and no serialized contract value or rendered DOM
 * carries a secret byte.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { publicProjection } from '@jarenjs/contract/project';
import { diffContracts, isCompatible } from '@jarenjs/contract/diff';

import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { createTangleUi } from '../../apps/desktop/src/ui/app.ts';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { openHttpClient } from '@jarenjs/contract/client';

const SENTINEL = 'sk-surface-sentinel-0ddba11';
const FROZEN_PATH = 'test/fixtures/desktop-contract-pre-config.json';

const post = (desktop: Desktop, url: string, body: unknown): Promise<{ status: number, body: string }> =>
  desktop.dispatcher.dispatch({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((res: { status: number, body: unknown }) => ({ status: res.status, body: String(res.body) }));
const get = (desktop: Desktop, url: string): Promise<{ status: number, body: string }> =>
  desktop.dispatcher.dispatch({ method: 'GET', url, headers: {}, body: null })
    .then((res: { status: number, body: unknown }) => ({ status: res.status, body: String(res.body) }));

describe('the public contract moved compatibly', () => {
  it('classifies frozen -> final as non-breaking and compatible', async () => {
    const frozen = JSON.parse(await readFile(FROZEN_PATH, 'utf8')) as Record<string, unknown>;
    const current = publicProjection(compileContract(DESKTOP_CONTRACT));
    const diff = diffContracts(frozen, current);
    assert.deepEqual(diff.breaking, [], `breaking changes: ${JSON.stringify(diff.breaking.slice(0, 3))}`);
    assert.equal(isCompatible(frozen, current), true);
    assert.equal(diff.additive.length > 0, true, 'the campaign added operations, errors and members');
    const frozenRevision = await compileContract(frozen).revision();
    const finalRevision = await compileContract(DESKTOP_CONTRACT).revision();
    assert.notEqual(finalRevision, frozenRevision, 'the surface moved — compatibly');
  });

  it('the gate would catch a breaking change: a removed output member fails', async () => {
    const frozen = JSON.parse(await readFile(FROZEN_PATH, 'utf8')) as { operations: Record<string, { output: { required?: string[], properties: Record<string, unknown> } }> };
    const narrowed = structuredClone(frozen);
    const status = narrowed.operations['status.get'].output;
    status.required = (status.required ?? []).filter((name) => name !== 'counts');
    delete status.properties.counts;
    const diff = diffContracts(frozen as never, narrowed as never);
    assert.equal(diff.breaking.length > 0, true, 'removing a required output member is a breaking change');
    assert.equal(diff.breaking[0].rule, 'R8');
    // isCompatible stays true here by design: it is the VERSION negotiation
    // predicate (same-version), while the change classification above is the
    // breaking gate — the campaign requires both, and they answer different
    // questions.
  });
});

describe('settings redaction over the wire', () => {
  let desktop: Desktop;
  before(async () => {
    desktop = await createDesktop({
      driver: nodeDriver(),
      fetch: (() => { throw new Error('the surface must not fetch'); }) as never,
    });
  });
  after(async () => { await desktop.close(); });

  it('a stored secret never returns; slots and retained round trips do', async () => {
    const saved = await post(desktop, '/api/settings', {
      settings: {
        chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: SENTINEL },
        browser: { mode: 'remote', endpoint: 'https://example.com', token: SENTINEL, allowUnsafeLocal: false },
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.includes(SENTINEL), false, 'the write response reflects nothing');

    const read = await get(desktop, '/api/settings');
    assert.equal(read.body.includes(SENTINEL), false, 'the read carries no secret byte');
    const view = JSON.parse(read.body);
    assert.equal(view.chat.apiKey, null);
    assert.equal(view.browser.token, null);
    assert.deepEqual(view.slots, { chatKey: true, embedKey: false, browserToken: true });

    // the browser's read-save cycle: the redacted view saved back verbatim RETAINS
    const roundTrip = await post(desktop, '/api/settings', { settings: view });
    assert.equal(JSON.parse(roundTrip.body).slots.chatKey, true, 'a read-save round trip retains the stored key');

    // replacement is write-only
    const replaced = await post(desktop, '/api/settings', { settings: { chat: { apiKey: 'replacement-value' } } });
    assert.equal(replaced.body.includes('replacement-value'), false, 'even a fresh write is not reflected');
    assert.equal(JSON.parse(replaced.body).slots.chatKey, true);

    // clearing requires the explicit flag
    const cleared = await post(desktop, '/api/settings', { settings: {}, clearChatKey: true, clearBrowserToken: true });
    assert.deepEqual(JSON.parse(cleared.body).slots, { chatKey: false, embedKey: false, browserToken: false });
  });
});

describe('the read-only inspection', () => {
  it('resolves without a probe, a client or a secret, and refuses honestly', async () => {
    let calls = 0;
    const desktop = await createDesktop({
      driver: nodeDriver(),
      fetch: ((() => { calls += 1; throw new Error('a read never probes'); }) as never),
    });
    try {
      const ready = JSON.parse((await get(desktop, '/api/config')).body);
      assert.equal(ready.resolution.state, 'ready');
      assert.equal(ready.identity.embedding.model, 'hash-trigram-64');
      assert.equal(ready.identity.components.policy.id, 'memory-policies-shipped');
      assert.deepEqual(ready.registry.tags.map((tag: { tag: string }) => tag.tag), ['reasoning', 'fast', 'cheap']);
      assert.equal(ready.hostObservation, null, 'no observation is claimed that no probe made');
      for (const tag of ready.registry.tags) {
        assert.equal(typeof tag.limitations, 'string', 'no capability badge without its stated limitation');
      }

      await post(desktop, '/api/settings', {
        settings: { embed: { provider: 'openrouter', baseUrl: null, model: null, apiKey: SENTINEL } },
      });
      const refusedBody = (await get(desktop, '/api/config')).body;
      assert.equal(refusedBody.includes(SENTINEL), false, 'a refusal carries no secret');
      const refused = JSON.parse(refusedBody);
      assert.equal(refused.resolution.state, 'refused');
      assert.equal(refused.resolution.issues.some((issue: { code: string }) => issue.code === 'TCFG1021'), true);
      assert.equal(refused.identity, null);
      assert.equal(calls, 0, 'the inspection made zero network calls');
    } finally {
      await desktop.close();
    }
  });
});

describe('the settings surface in the rendered UI', () => {
  it('secret inputs render blank, the badge says configured, and no DOM byte carries the value', async () => {
    const desktop = await createDesktop({ driver: nodeDriver() });
    const handler = toFetchHandler(desktop.dispatcher);
    const client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test',
      fetch: (async (url: never, init: never) => handler(new Request(url, init))) as never,
    });
    await post(desktop, '/api/settings', {
      settings: { chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: SENTINEL } },
    });
    const errors: unknown[] = [];
    const app = createTangleUi({ client, onError: (report: unknown) => errors.push(report) });
    try {
      const until = async (done: () => boolean): Promise<void> => {
        const start = Date.now();
        while (!done() && Date.now() - start < 4000) await new Promise((resolve) => setTimeout(resolve, 25));
      };
      await until(() => app.getState().settings.draft !== null && app.getState().settings.inspect !== null);
      app.dispatch('nav', 'settings');
      await until(() => app.getVnode() !== undefined);

      const state = app.getState();
      assert.equal(state.settings.draft.chat.apiKey, null, 'the draft never holds a value');
      assert.equal(state.settings.draft.slots.chatKey, true, 'the badge state says configured');
      const dom = JSON.stringify(app.getVnode());
      assert.equal(dom.includes(SENTINEL), false, 'no rendered byte carries the secret');
      assert.match(dom, /configured — type to replace/, 'the input renders blank with the configured placeholder');
      assert.match(dom, /Effective configuration/, 'the inspection panel renders');
      assert.equal(errors.length, 0, JSON.stringify(errors[0] ?? null));

      // a save round trip: the stored key survives, the inputs re-mount blank
      app.dispatch('settings/save');
      await until(() => app.getState().settings.saved === true);
      const savedState = app.getState();
      assert.equal(savedState.settings.draft.slots.chatKey, true, 'a UI save of the redacted draft retains the stored key');
      assert.equal(savedState.settings.saveCount, 1, 'the secret inputs re-mount blank after every save');
      assert.equal(JSON.stringify(app.getVnode()).includes(SENTINEL), false);
    } finally {
      app.destroy();
      await desktop.close();
    }
  });
});
