import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compileContract } from '@jarenjs/contract';
import { openLocalClient } from '@jarenjs/contract/local';
import { contractTools } from '@jarenjs/contract/project';
import { typedTools, typedHttpClient } from '@jarenjs/linq/contract';
import { createToolbox } from '@tangleai/agents';
import { Shop } from './fixtures/contract-corpus.ts';
it('contractTools over a pen contract registers into a real toolbox', async () => {
  const compiled = compileContract(Shop.document);
  const client = openLocalClient(compiled, {
    'catalog.load': () => ({ revision: 1, products: [] }),
    'product.save': (input: any) => input.product,
  });
  const tools = typedTools(contractTools(compiled, client), Shop);
  // the HTTP wrapper is the same identity: the value it is handed, unchanged
  const httpLike = { invoke() { }, bytes() { }, url() { }, close() { } };
  assert.strictEqual(typedHttpClient(httpLike, Shop), httpLike);
  assert.deepStrictEqual(tools.map((t) => t.name), ['catalog_load', 'product_save'],
    'the opaque operation is not a tool');
  const toolbox = createToolbox();
  for (const tool of tools) toolbox.add(tool);
  const product = { id: 2, name: 'Rope', price: 3 };
  const answer = await toolbox.execute('product_save', { id: 2, revision: 1, product });
  assert.strictEqual(answer.ok, true);
  assert.deepStrictEqual(answer.value, product);
  // the tool's input schema stands alone: the $defs it reaches are inlined
  const save = tools.find((t) => t.name === 'product_save');
  assert.deepStrictEqual(Object.keys(save!.inputSchema.$defs!), ['Product']);
  client.close();
});
