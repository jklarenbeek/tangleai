/**
 * Capabilities: a domain's contracts, context reads, proposal kinds with
 * their review policy, and prompt pack, declared once and read by the kernel
 * (which kinds a module files, from which origins) and by an assistant's
 * composer (its system text, tools and context), deterministically.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKernel, capabilityIssues, checkCapabilities, capabilitiesPrompt, composeCapabilities, type CapabilityDocument } from '@tangleai/os';
import { compileContract } from '@jarenjs/contract';
import * as toolbox from '@tangleai/agents/toolbox';

const ORDERS = { $contract: '0.1', id: 'purchasing', operations: {
  'orders.open': { kind: 'read', doc: 'Open purchase orders.', input: { type: 'object', properties: {} }, output: { type: 'array' } },
  'orders.draft': { kind: 'command', doc: 'Draft a purchase order.', input: { type: 'object', required: ['supplier'], properties: { supplier: { type: 'string' } } }, output: { type: 'object' } },
} };
const PURCHASING: CapabilityDocument = {
  $capability: '0.1', id: 'purchasing', title: { en: 'Purchasing', nl: 'Inkoop' },
  contracts: [ORDERS],
  context: [{ id: 'open', contract: 'purchasing', op: 'orders.open' }],
  proposals: [
    { kind: 'purchase.order', title: { en: 'Purchase order', nl: 'Inkooporder' }, review: { origins: ['human', 'ai'], roles: ['buyer'] } },
    { kind: 'run.pause', title: { en: 'A run waits', nl: 'Een run wacht' }, review: { origins: ['ai'] } },
  ],
  prompts: {
    en: { system: 'You help the buyer order stock.', kinds: { 'purchase.order': 'Draft one order per supplier.' } },
    nl: { system: 'Je helpt de inkoper voorraad te bestellen.', kinds: { 'purchase.order': 'Eén order per leverancier.' } },
  },
};
const WAREHOUSE: CapabilityDocument = {
  $capability: '0.1', id: 'warehouse', title: { en: 'Warehouse' }, contracts: [],
  proposals: [{ kind: 'stock.count', title: { en: 'Stock count' }, review: { origins: ['human', 'import'] } }],
  prompts: { en: { system: 'You help count stock.' } },
};
const screen = (id: string, capabilities: string[]) => ({ $module: '0.1', id, version: '1.0.0', title: { en: id }, host: { kind: 'shipped', mount: id }, capabilities });

describe('a capability document', () => {
  it('agrees with itself: context reads read its own contracts, each kind once, prompts only for its kinds', () => {
    assert.deepEqual(capabilityIssues(PURCHASING), []);
    const bad = capabilityIssues({ ...PURCHASING, context: [{ id: 'x', contract: 'purchasing', op: 'orders.draft' }], prompts: { en: { system: 's', kinds: { 'other.kind': 'x' } } } });
    assert.deepEqual(bad.map(i => i.path), ['/context/0', '/prompts/en/kinds/other.kind']);
  });
  it('and the manifests that name it agree with the installed set', () => {
    assert.deepEqual(checkCapabilities([PURCHASING, WAREHOUSE], [screen('till', ['purchasing']), screen('stock', ['warehouse'])]), []);
    const issues = checkCapabilities([PURCHASING], [screen('stock', ['warehouse']), { ...screen('own', []), proposals: [{ kind: 'purchase.order' }] }]);
    assert.deepEqual(issues.map(i => i.code), ['OS0132', 'OS0132']);
  });
  it("composes the assistant's text in the person's language, byte for byte, with its tools and context", async () => {
    assert.equal(capabilitiesPrompt([PURCHASING, WAREHOUSE], 'nl'), [
      '## Inkoop', '', 'Je helpt de inkoper voorraad te bestellen.', '',
      '- `purchase.order`: Inkooporder (filed by: human, ai) — Eén order per leverancier.',
      '- `run.pause`: Een run wacht (filed by: ai)', '',
      '## Warehouse', '', 'You help count stock.', '',
      '- `stock.count`: Stock count (filed by: human, import)',
    ].join('\n'));
    assert.match(capabilitiesPrompt([WAREHOUSE], 'ar'), /You help count stock\./, 'a language the pack lacks falls back to English');
    const calls: string[] = [];
    const composed = composeCapabilities([PURCHASING], {
      locale: 'en', tools: toolbox as any, compile: compileContract as any,
      client: () => ({ invoke: async (op: string) => { calls.push(op); return { ok: true, value: [] }; } }),
      call: async (contract, op) => { calls.push(`${contract}.${op}`); return [{ id: 'po-1' }]; },
    });
    assert.deepEqual((composed.toolbox as any).toFunctionTools().map((t: any) => t.function.name), ['purchasing__orders_open', 'purchasing__orders_draft']);
    assert.deepEqual(await composed.context(), { 'purchasing.open': [{ id: 'po-1' }] });
    assert.deepEqual(composed.kinds.map(k => [k.kind, k.origins, k.roles]), [['purchase.order', ['human', 'ai'], ['buyer']], ['run.pause', ['ai'], []]]);
  });
  it('is read in the browser without a model client: the module imports nothing of the agent runtime', () => {
    const source = readFileSync(new URL('../../components/os/src/capability.ts', import.meta.url), 'utf8');
    assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(m => m[1]), ['./manifest.ts']);
  });
});

describe('capabilities in the kernel', () => {
  it('installs only from the host, gives its kinds to the modules that name it, enforces origins and hands the roles on', async () => {
    const kernel = createKernel();
    assert.equal(kernel.installCapability(PURCHASING, 'user').ok, false, 'never from the user layer');
    assert.equal(kernel.installCapability({ ...PURCHASING, prompts: { nl: { system: 'x' } } }).ok, false, 'English is required');
    assert.equal(kernel.installCapability(PURCHASING).ok, true);
    kernel.install(screen('till', ['purchasing']));
    kernel.install(screen('other', []));
    const heard: any[] = [];
    kernel.registerDecider('till', 'host', (d) => { heard.push(d); });
    const filed = kernel.propose('till', { id: 'po-1', kind: 'purchase.order', title: 'Order 12 crates', origin: 'ai' });
    assert.equal(filed.ok, true);
    const wrongOrigin = kernel.propose('till', { id: 'po-2', kind: 'purchase.order', title: 'x', origin: 'import' });
    assert.ok(!wrongOrigin.ok && wrongOrigin.error.code === 'OS0133');
    const noOrigin = kernel.propose('till', { id: 'po-3', kind: 'purchase.order', title: 'x' });
    assert.ok(!noOrigin.ok && noOrigin.error.code === 'OS0133');
    const notItsKind = kernel.propose('other', { id: 'po-4', kind: 'purchase.order', title: 'x', origin: 'human' });
    assert.ok(!notItsKind.ok && notItsKind.error.code === 'OS0107');
    assert.deepEqual(kernel.reviewOf('till', 'purchase.order'), { origins: ['human', 'ai'], roles: ['buyer'] });
    const item = kernel.mail().find(m => m.proposal?.id === 'po-1')!;
    assert.equal((await kernel.decide(item.id, 'accept')).ok, true);
    assert.deepEqual(heard[0].roles, ['buyer'], 'the module receives the roles to check the person against');
  });
});
