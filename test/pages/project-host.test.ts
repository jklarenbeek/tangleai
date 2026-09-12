import { it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { compileContract } from '@jarenjs/contract';
import { servePort } from '@jarenjs/contract/port';
import { nodeDriver } from '@jarenjs/db/node';
import { createDataHandlers } from '@jarenjs/studio/data/host';
import contract from '@jarenjs/studio/contracts/data.contract.json' with { type: 'json' };
import { mountPageHost } from '../../apps/pages/src/demos/host.ts';
import { projectTemplate } from '../../apps/pages/src/demos/playground/projectTemplates.ts';
import { createStubHost } from '../assistant/dom.stub.ts';
const reply = (value: any) => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }] });
async function site(t: any, extra: any) {
  const { container, document } = createStubHost(); let registered: any;
  const host = mountPageHost({
    root: container, assistantNode: document.createElement('aside'), hash: '#/project', schedule: (f: any) => f(), debounceMs: 0,
    slots: { settings: { read: () => ({ provider: 'openrouter', baseUrl: '', model: 'test', apiKey: 'test-key' }), write() { } } },
    webmcp: { context: { provideContext: ({ tools }: { tools?: any; }) => { registered = tools; } } }, ...extra
  });
  t.after(() => host.dispose()); await host.webmcp.ready;
  const app = {
    getState: () => ({ project: host.project().read().document }), destroy: host.dispose,
    async dispatch(action: any, payload: any) {
      const editor = host.project(), before = editor.read();
      const candidate = action === 'project/open' ? payload : { ...before.document, files: payload.files };
      assert.ok(['project/open', 'project/files-set'].includes(action));
      const result = await editor.replace(candidate, { expectedRevision: before.revision }); assert.equal(result.ok, true);
    },
  };
  return { app, tool: (name: any) => registered.find((tool: any) => tool.name === name) };
}
it('structured authoring publishes a validated file and returns a recoverable candidate on a concurrent edit', async (t) => {
  let pending: ((reply: Response) => void) | undefined;
  const requests: any[] = [];
  const { app, tool } = await site(t, {
    aiFetch: async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      if (requests.length === 1) return reply({ generated: true });
      return new Promise<Response>((resolve) => { pending = resolve; });
    }
  });
  const author = tool('jaren_project_author');
  const first = await author.execute({ name: 'generated.data', kind: 'data', prompt: 'Create data.' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(JSON.parse(app.getState().project.files.at(-1).text), { generated: true });
  const second = author.execute({ name: 'generated.data', prompt: 'Revise data.' });
  for (let i = 0; i < 100 && !pending; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(pending);
  const files = app.getState().project.files.map((f: any) => f.name === 'generated.data' ? { ...f, text: '{"human":true}' } : f);
  await app.dispatch('project/files-set', { files });
  pending(reply({ generated: 'later' }));
  const conflict = await second;
  assert.equal(conflict.conflict, true);
  assert.deepEqual(JSON.parse(conflict.file.text), { generated: 'later' });
  assert.deepEqual(app.getState().project.files, files);
  assert.equal(requests[0].response_format.json_schema.name, 'studio_data');
});
it('the assistant model runner uses the injected private worker and app teardown closes it', async (t) => {
  let terminated = 0;
  const releases: any[] = [];
  const { app, tool } = await site(t, {
    projectWorker: () => {
      const { port1, port2 } = new MessageChannel();
      const table = createDataHandlers(({
        init: async () => ({ topology: 'memory', vfs: 'memory', version: '3' }),
        makeDriver: () => nodeDriver(), makeScratchDriver: () => nodeDriver(), path: () => ':memory:',
        vfs: () => 'memory', durable: () => false, unlink: () => { }, announce: () => { },
      } as any));
      const server = servePort(compileContract(contract), table.handlers, { channel: port1 });
      const release = async () => { await server.close(); await table.dispose(); port1.close(); port2.close(); };
      releases.push(release);
      Object.assign(port2, { terminate: () => { terminated++; void release(); } });
      return port2;
    }
  });
  t.after(async () => { for (const release of releases) await release(); });
  await app.dispatch('project/open', projectTemplate('store'));
  const result = await tool('jaren_project_run').execute({ name: 'notes.query' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.ran, /SELECT/);
  app.destroy();
  assert.equal(terminated, 1);
});
