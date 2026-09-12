import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createToolbox, registerModelContext } from '@tangleai/agents/toolbox';
import { WEBMCP_UNSUPPORTED } from '@jarenjs/contract/webmcp';
const schema = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] };
function toolbox(names: string[] = ['add']) {
  const box = createToolbox();
  for (const name of names) box.add({ name, description: 'Add one', inputSchema: schema, execute: ({ value }: any) => ({ value: value + 1 }) });
  return box;
}
function host(method: string = 'registerTool', async: boolean = false) {
  const tools: any[] = [], removed: any[] = [];
  const context: Record<string, any> = {
    [method](definition: any) {
      assert.equal(this, context);
      const accept = () => { tools.push(...(method === 'registerTool' ? [definition] : definition.tools)); };
      if (async) return Promise.resolve().then(accept);
      accept();
    }, unregisterTool(name: any) { removed.push(name); }
  };
  return { context, tools, removed };
}
const bind = (box: any, realm: any, options: Record<string, any> = {}) => registerModelContext(box, undefined, undefined, { realm, ...options });
describe('toolbox WebMCP wrapper over the public browser contract', () => {
  for (const root of ['document', 'navigator']) for (const method of ['registerTool', 'provideContext']) for (const async of [false, true])
    it(`${root}/${method}/${async ? 'async' : 'sync'} validates tools and reports completion`, async () => {
      const h = host(method, async), binding = bind(toolbox(), { [root]: { modelContext: h.context } });
      assert.equal(binding.status, 'pending');
      const result = await binding.ready;
      assert.equal(result.status, 'registered'); assert.equal(result.root, root); assert.equal(result.method, method); assert.equal(result.registered, 1);
      assert.deepEqual(await h.tools[0].execute({ value: 2 }), { value: 3 });
      const refused = await h.tools[0].execute({ value: 'invalid' });
      assert.match(refused.error, /invalid input/); assert.ok(refused.errors.length); assert.deepEqual(refused.inputSchema, schema);
      await binding.dispose(); await binding.dispose();
      assert.match(h.tools[0].execute({ value: 1 }).error, /inactive/);
      assert.deepEqual(h.removed, method === 'registerTool' ? ['add'] : []);
      assert.equal(result.nativeRemoval, method === 'registerTool' ? 'unregister' : 'unverified');
    });
  it('prefers document and registerTool, deduplicates aliases and honors explicit overrides', async () => {
    for (const alias of [false, true]) {
      const d = host(), n = alias ? d : host(); d.context.provideContext = () => assert.fail('legacy retry');
      const realm = { document: { modelContext: d.context }, navigator: { modelContext: n.context } };
      const binding = bind(toolbox(), realm); assert.equal((await binding.ready).root, 'document');
      assert.equal(d.tools.length, 1); if (!alias) assert.equal(n.tools.length, 0); await binding.dispose();
      const explicit = host();
      const override = registerModelContext(toolbox(), explicit.context, undefined, { realm });
      assert.equal((await override.ready).root, 'explicit'); assert.equal(explicit.tools.length, 1); await override.dispose();
      assert.equal((await registerModelContext(toolbox(), null, undefined, { realm }).ready).status, 'unavailable');
      assert.equal(d.tools.length, 1);
    }
  });
  it('guards inaccessible roots and methods, with fallback only before mutation', async () => {
    const blocked = Object.defineProperty({}, 'modelContext', { get() { throw Error('denied'); } });
    const method = Object.defineProperty({}, 'registerTool', { get() { throw Error('denied'); } });
    for (const document of [undefined, null, {}, { modelContext: null }, { modelContext: { registerTool: 3 } }, blocked, { modelContext: method }, { modelContext: { registerTool: () => WEBMCP_UNSUPPORTED } }]) {
      const n = host(), binding = bind(toolbox(), { document, navigator: { modelContext: n.context } });
      assert.equal((await binding.ready).root, 'navigator'); await binding.dispose();
    }
    const h = host('provideContext'); h.context.registerTool = () => WEBMCP_UNSUPPORTED;
    const binding = bind(toolbox(), { document: { modelContext: h.context } });
    assert.equal((await binding.ready).method, 'provideContext'); await binding.dispose();
  });
  for (const async of [false, true]) it(`preserves ${async ? 'rejected' : 'thrown'} registration failures and removes only owned tools`, async () => {
    const failure = Error('permission denied'), cleanup = Error('cleanup'), removed: any[] = [], tools: any[] = [], errors: any[] = [], n = host();
    const context = {
      registerTool(tool: any) {
        if (tool.name === 'second') { if (async) return Promise.reject(failure); throw failure; }
        tools.push(tool); return async ? Promise.resolve() : undefined;
      }, unregisterTool(name: any) { removed.push(name); throw cleanup; }, provideContext() { assert.fail('no retry after mutation'); }
    };
    const binding = registerModelContext(toolbox(['add', 'second']), undefined, error => errors.push(error), { realm: { document: { modelContext: context }, navigator: { modelContext: n.context } } });
    const result = await binding.ready;
    assert.equal(result.status, 'failed'); assert.equal(result.error, failure); assert.deepEqual(result.cleanupErrors, [cleanup]); assert.deepEqual(errors, [failure, cleanup]);
    await binding.dispose(); assert.deepEqual(removed, ['add']); assert.equal(n.tools.length, 0); assert.match(tools[0].execute({ value: 1 }).error, /inactive/);
  });
  it('makes pending callbacks inert before asynchronous disposal finishes', async () => {
    let finish, tool; const removed: any[] = [], promise = new Promise(resolve => { finish = resolve; });
    const context = { registerTool(value: any) { tool = value; return promise; }, unregisterTool(name: any) { removed.push(name); } };
    const binding = registerModelContext(toolbox(['add', 'later']), context), disposing = binding.dispose();
    assert.match(tool!.execute({ value: 1 }).error, /inactive/); finish!();
    assert.equal((await binding.ready).status, 'disposed'); await disposing; await binding.dispose(); assert.deepEqual(removed, ['add']);
  });
  it('supports headless and late mounts, root changes, abort and qualified legacy cleanup', async () => {
    const realm: Record<string, any> = {}; assert.equal((await bind(toolbox(), realm).ready).status, 'unavailable');
    const h = host(), abort = new AbortController(); realm.document = { modelContext: h.context };
    const late = bind(toolbox(), realm, { signal: abort.signal }); await late.ready; realm.document.modelContext = host().context;
    abort.abort(); await late.dispose(); assert.deepEqual(h.removed, ['add']);
    let signal; const owned = registerModelContext(toolbox(), { registerTool(_: any, options: any) { signal = options.signal; } }, undefined, { lifecycle: 'abort' });
    assert.equal((await owned.ready).nativeRemoval, 'abort'); await owned.dispose(); assert.equal(signal!.aborted, true);
    let clears = 0; const legacy = { provideContext() { }, clearContext() { clears++; } };
    const a = registerModelContext(toolbox(), legacy, undefined, { exclusiveLegacyContext: true }); await a.ready;
    const b = registerModelContext(toolbox(), legacy, undefined, { exclusiveLegacyContext: true }); await b.ready;
    await a.dispose(); assert.equal(clears, 0); await b.dispose(); assert.equal(clears, 1);
  });
});
