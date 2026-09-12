import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createMasRegistrySnapshot, instantiateMasTemplate, masTemplateVersionIdOf,
  type MasTemplate, type MasWorkflow,
} from '@tangleai/mas';

const source = JSON.parse(await readFile('benchmark/fixtures/mas/templates/parallel-analysis.json', 'utf8')) as {
  template: MasTemplate; instances: { a: Record<string, unknown> };
};
async function edited(edit: (template: MasTemplate) => void) {
  const template = structuredClone(source.template);
  edit(template);
  template.versionId = await masTemplateVersionIdOf(template as unknown as Record<string, unknown>);
  return template;
}
async function target(pointer: string, mode: MasTemplate['bindings'][number]['mode'], value: unknown) {
  const template = await edited(t => {
    t.parameters.schema = { type: 'object', properties: { value: {} }, required: ['value'], additionalProperties: false };
    t.bindings = [{ parameterPointer: '/value', targetPointer: pointer, mode }];
  });
  return instantiateMasTemplate(template, { value });
}

describe('semantic template binding safety', () => {
  it('template rejects cap disguised as role', async () => {
    const t = await edited(t => { t.bindings[2].mode = 'role'; });
    const r = await instantiateMasTemplate(t, { ...source.instances.a, calls: 16 });
    assert.ok(!r.valid);
    assert.equal(r.issues[0].code, 'TMAS1004');
    assert.equal(r.issues[0].path, '/bindings/2/targetPointer');
  });

  it('template rejects structural target bindings', async () => {
    for (const pointer of ['/nodes', '/nodes/0', '/nodes/0/id', '/nodes/0/kind', '/nodes/0/input', '/messages', '/control', '/registry/revision', '/limits', '/nodes/0/limits']) {
      const r = await target(pointer, 'role', 'valid-looking');
      assert.ok(!r.valid, pointer);
      assert.equal(r.issues[0].code, 'TMAS1004', pointer);
      assert.equal(r.issues[0].path, '/bindings/0/targetPointer', pointer);
    }
  });

  it('template bindings are unambiguous and capability-monotone', async () => {
    const duplicate = await edited(t => { t.bindings.push({ ...t.bindings[0] }); });
    assert.equal((await instantiateMasTemplate(duplicate, source.instances.a)).valid, false);
    for (const value of [9, '8', null, {}, -1, 1.5]) {
      const r = await target('/nodes/0/limits/calls', 'caps', value);
      assert.ok(!r.valid, JSON.stringify(value));
    }
    for (const value of [8, 4, 0]) assert.ok((await target('/nodes/0/limits/calls', 'caps', value)).valid);
    assert.equal((await target('/nodes/1/limits/calls', 'caps', 1)).valid, false);
    assert.equal((await target('/nodes/00/role', 'role', 'analyst-alpha')).valid, false);
    assert.equal((await target('/nodes/0/rol~2e', 'role', 'analyst-alpha')).valid, false);
    const tools = await target('/nodes/0/tools', 'tools', ['new-tool']);
    assert.ok(!tools.valid);
    assert.equal(tools.issues[0].code, 'TMAS1009');
    assert.ok((await target('/nodes/0/tools', 'tools', [])).valid);
  });

  it('parameter pointers use RFC 6901 escaping and optional absence leaves the source intact', async () => {
    const t = await edited(t => {
      t.parameters.schema = { type: 'object', properties: { 'a/b~c': { type: 'integer' } }, additionalProperties: false };
      t.bindings = [{ parameterPointer: '/a~1b~0c', targetPointer: '/nodes/0/limits/calls', mode: 'caps' }];
    });
    const a = await instantiateMasTemplate(t, { 'a/b~c': 3 });
    const b = await instantiateMasTemplate(t, {});
    assert.ok(a.valid && b.valid);
    assert.equal(a.value.workflow.nodes[0].limits?.calls, 3);
    assert.equal(b.value.workflow.nodes[0].limits?.calls, 8);
    assert.equal((t.fragment as unknown as MasWorkflow).nodes[0].limits?.calls, 8);
  });

  it('registration cannot admit a template that instantiation refuses', async () => {
    const t = await edited(t => { t.bindings[2].mode = 'role'; });
    const registry = JSON.parse(await readFile('benchmark/fixtures/mas/control-registry.json', 'utf8'));
    registry.templates = [{ id: t.templateId, versionId: t.versionId, template: t }];
    const r = await createMasRegistrySnapshot(registry);
    assert.ok(!r.valid);
    assert.equal(r.issues[0].code, 'TMAS1004');
    assert.equal(r.issues[0].path, '/templates/0/template/bindings/2/targetPointer');
  });
  it('loop caps and switch guard literals specialize without exposing control structure', async () => {
    const loopFixture = JSON.parse(await readFile('benchmark/fixtures/mas/control/reflection-revision.json', 'utf8'));
    const workflow = loopFixture.workflow as MasWorkflow;
    const index = workflow.nodes.findIndex(n => n.kind === 'loop');
    const t = await edited(t => {
      t.fragment = workflow as unknown as Record<string, unknown>;
      t.parameters.schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false };
      t.bindings = [{ parameterPointer: '/n', targetPointer: `/nodes/${index}/maxIterations`, mode: 'caps' }];
    });
    assert.ok((await instantiateMasTemplate(t, { n: 1 })).valid);
    const r = await instantiateMasTemplate(t, { n: 99 });
    assert.ok(!r.valid && r.issues[0].code === 'TMAS1008');
    const switches = JSON.parse(await readFile('benchmark/fixtures/mas/control/peer-review.json', 'utf8')).workflow as MasWorkflow;
    const si = switches.nodes.findIndex(n => n.kind === 'switch');
    const node = switches.nodes[si]; assert.ok(node.kind === 'switch');
    node.branches[0].when = { $and: [{ $const: true }, node.branches[0].when] };
    const st = await edited(t => {
      t.fragment = switches as unknown as Record<string, unknown>;
      t.parameters.schema = { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false };
      t.bindings = [{ parameterPointer: '/enabled', targetPointer: `/nodes/${si}/branches/0/when/$and/0/$const`, mode: 'branch-enablement' }];
    });
    assert.ok((await instantiateMasTemplate(st, { enabled: false })).valid);
    const escaped = await edited(t => {
      t.fragment = switches as unknown as Record<string, unknown>;
      t.bindings = [{ parameterPointer: '/role', targetPointer: `/nodes/${si}/branches/0/nodes`, mode: 'role' }];
    });
    assert.equal((await instantiateMasTemplate(escaped, source.instances.a)).valid, false);
  });

});
