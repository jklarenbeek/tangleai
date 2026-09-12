import { it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { openHttpClient } from '@jarenjs/contract/client';
import { contractTools } from '@jarenjs/contract/project';
import { createMemoryLedger } from '@jarenjs/contract/ledger';
import { createToolbox } from '@tangleai/agents';
it('the contract campaign client projects and executes tools over the real SQLite-backed HTTP boundary', async t => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/shop.contract.json', import.meta.url), 'utf8'));
  doc.operations['catalog.live'] = { kind: 'subscribe', output: { type: 'object', required: ['rows'], properties: { rows: { type: 'array' } } } };
  const contract = compileContract(doc);
  const store = await openStore({ $model: '0.1', collections: { products: { schema: { type: 'object', required: ['id','name','price'], properties: { id: { type: 'integer' }, name: { type: 'string' }, price: { type: 'number' } } }, key: '/id' } } }, { driver: nodeDriver(), capture: true });
  const rows = store.collection('products');
  await rows.insert({ id: 1, name: 'first', price: 5 });
  const scan = [{ $for: { it: '$[*]' }, $return: '$it' }];
  const dispatcher = serveHttp(contract, {
    'catalog.load': async () => ({ revision: 1, products: await rows.execute(scan) }),
    'product.save': async input => { await rows.put(input.product, input.id); return input.product; },
    'product.search': async input => (await rows.execute(scan)).filter(row => input.q === undefined || row.name.includes(input.q)),
    'product.remove': () => true,
    'image.bytes': () => ({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array([1]) }),
    'catalog.live': () => rows.live(scan),
  }, { ledger: createMemoryLedger() });
  const server = http.createServer(toNodeHandler(dispatcher)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = openHttpClient(contract, { baseUrl: `http://127.0.0.1:${server.address().port}` });
  t.after(async () => { client.close(); dispatcher.close(); server.closeAllConnections(); server.close(); await once(server, 'close'); await store.close(); });
  const saved = await client.invoke('product.save', { id: 2, revision: 1, product: { id: 2, name: 'second', price: 9 } }); assert.equal(saved.ok, true);
  const toolbox = createToolbox(); for (const tool of contractTools(contract, client)) toolbox.add(tool);
  assert.deepEqual(toolbox.list().map(tool => tool.name), ['catalog_load','product_save','product_search','product_remove'], 'opaque and subscribe operations are excluded');
  const outcome = await toolbox.execute('product_search', { q: 'second' });
  assert.equal(outcome.ok, true); assert.deepEqual(outcome.value, [{ id: 2, name: 'second', price: 9 }]);
});
