import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JarenValidator } from '@jarenjs/validate';
import { compileContract, ContractHostError } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { openHttpClient } from '@jarenjs/contract/client';
import { createMemoryLedger } from '@jarenjs/contract/ledger';
import { contractTools } from '@jarenjs/contract/project';
import { createToolbox } from '@tangleai/agents/toolbox';
import { readFileSync } from 'node:fs';
const load = (path: any) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
function shopHandlers() {
  return {
    'catalog.load': () => ({ revision: 1, products: [{ id: 1, name: 'a', price: 1 }] }),
    'product.save': (input: any) => ({ id: input.id, name: input.product.name, price: input.product.price }),
    'image.bytes': () => ({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array([1, 2, 3]) }),
    'product.search': (input: any) => [{ id: 1, name: input.q ?? 'n', price: input.limit ?? 0 }],
    'product.remove': () => true,
  };
}
const shop = load('./fixtures/shop.contract.json');
function openShop() {
  const contract = compileContract(shop);
  const server = serveHttp(contract, shopHandlers(), { ledger: createMemoryLedger() });
  const handler = toFetchHandler(server);
  const client = openHttpClient(contract, { fetch: (url: any, init: any) => handler(new Request(`http://shop.local${url}`, init)) });
  return { contract, client };
}
it('registers into createToolbox() and execute answers the same outcome client.invoke resolves', async () => {
  const { contract, client } = openShop();
  const toolbox = createToolbox();
  for (const tool of contractTools(contract, client)) toolbox.add(tool);
  assert.deepStrictEqual(toolbox.list().map((t) => t.name), ['catalog_load', 'product_save', 'product_search', 'product_remove']);
  assert.strictEqual(toolbox.toFunctionTools()[1].function.name, 'product_save');

  const viaTool = await toolbox.execute('product_save', { id: 7, revision: 1, product: { id: 7, name: 'x', price: 2 } });
  const direct = await client.invoke('product.save', { id: 7, revision: 1, product: { id: 7, name: 'x', price: 2 } });
  assert.strictEqual(viaTool.ok, true);
  assert.deepStrictEqual(viaTool.value, { id: 7, name: 'x', price: 2 });
  assert.deepStrictEqual(viaTool.value, direct.ok ? direct.value : null, 'the tool answers what invoke answers');
  assert.deepStrictEqual(Object.keys(viaTool.meta), ['op', 'attempt', 'trace', 'revision', 'etag', 'notModified']);

  // the toolbox's own schema guard answers the validation errors, before any request
  const invalid = await toolbox.execute('product_save', { id: 'seven' });
  assert.match(invalid.error, /invalid input/i);
  assert.ok(Array.isArray(invalid.errors));

  // a failed outcome is still a RESOLVED value — a tool never rejects
  const outcome = await toolbox.execute('catalog_load', {});
  assert.strictEqual(outcome.ok, true);
});
