/**
 * File locations and the assistant's way into them: every location answers
 * like the memory location, a manifest names its location, and the assistant
 * reads and searches through tangle_os_files but never writes, under any grant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, memoryLocation, fileLocationContract, serveFileLocation, fileBytesToBase64, validateManifest } from '@tangleai/os';
import * as toolbox from '@tangleai/agents/toolbox';
import { conformLocation } from '../fixtures/file-location-conformance.ts';

const DOCS = fileLocationContract('docs_files');
const docsApp = (extra: object = {}) => ({ $module: '0.1', id: 'docs', version: '1.0.0', title: { en: 'Docs' }, host: { kind: 'shipped', mount: 'docs' }, provides: [DOCS], files: { contract: 'docs_files', title: { en: 'Documents' } }, ...extra });
const text = (s: string) => fileBytesToBase64(new TextEncoder().encode(s));

describe('a file location', () => {
  it('the memory location answers every step of the conformance suite', async () => {
    const steps = await conformLocation(memoryLocation({ writable: true }));
    assert.equal(steps.length, 14);
  });
  it('a read-only location refuses every change with its reason', async () => {
    const served = serveFileLocation(memoryLocation());
    assert.deepEqual(await served['files.mkdir']({ name: 'x' }), { refused: { code: 'OS0602', message: 'this location cannot be written' } });
  });
  it('a manifest names a location only among the contracts it provides', () => {
    assert.equal(validateManifest(docsApp()).ok, true);
    const verdict = validateManifest(docsApp({ provides: [] }));
    assert.ok(!verdict.ok && verdict.issues.some(i => i.code === 'OS0006'));
  });
});

describe("the assistant's way into files", () => {
  async function desktop(grants: 'all' | string[], files: object = {}) {
    const kernel = createKernel({ assistantGrants: grants, tools: toolbox });
    kernel.install(docsApp({ files: { contract: 'docs_files', title: { en: 'Documents' }, ...files } }), 'suite');
    const location = memoryLocation({ writable: true });
    const folder = (await location['files.mkdir']!({ name: 'Notes' })).entry;
    await location['files.write']!({ folder: folder.id, name: 'plan.md', data: text('# Plan\n' + 'x'.repeat(7000)) });
    await location['files.write']!({ folder: null, name: 'logo.png', data: text('\x89PNG') });
    kernel.provideLocal('docs', DOCS, serveFileLocation(location) as any);
    return kernel;
  }
  it('lists, searches and reads text, capped, and describes a binary file', async () => {
    const kernel = await desktop(['tangle_os_files.*']);
    const locations: any = await kernel.call('assistant', 'tangle_os_files', 'files.locations', {});
    assert.deepEqual(locations.value.locations, [{ location: 'docs_files', module: 'docs', title: 'Documents' }]);
    const found: any = await kernel.call('assistant', 'tangle_os_files', 'files.search', { query: 'plan' });
    assert.deepEqual(found.value.entries.map((e: any) => [e.location, e.name]), [['docs_files', 'plan.md']]);
    const read: any = await kernel.call('assistant', 'tangle_os_files', 'files.read', { location: 'docs_files', id: found.value.entries[0].id });
    assert.equal(read.value.text.length, 6000);
    assert.equal(read.value.truncated, 7007);
    const top: any = await kernel.call('assistant', 'tangle_os_files', 'files.list', { location: 'docs_files' });
    const logo = top.value.entries.find((e: any) => e.name === 'logo.png');
    const binary: any = await kernel.call('assistant', 'tangle_os_files', 'files.read', { location: 'docs_files', id: logo.id });
    assert.match(binary.value.note, /image\/png/);
    assert.equal(binary.value.text, undefined);
  });
  it('never writes, moves or deletes, even granted everything: the location is no tool of its', async () => {
    const kernel = await desktop('all');
    const names = kernel.tools().toFunctionTools().map((t: any) => t.function.name);
    assert.ok(names.includes('tangle_os_files__files_read'));
    assert.ok(!names.some((n: string) => n.startsWith('docs_files__')), names.join(', '));
    const written = await kernel.call('assistant', 'docs_files', 'files.write', { name: 'x.txt', data: text('x') });
    assert.ok(!written.ok && written.error.code === 'OS0101');
    const deleted = await kernel.call('assistant', 'docs_files', 'files.delete', { id: 'f1' });
    assert.ok(!deleted.ok);
    // the person's own hand (the shell) writes
    assert.equal((await kernel.call('shell', 'docs_files', 'files.mkdir', { name: 'Mine' })).ok, true);
  });
  it('keeps out of a location marked assistant: false', async () => {
    const kernel = await desktop('all', { assistant: false });
    const locations: any = await kernel.call('assistant', 'tangle_os_files', 'files.locations', {});
    assert.deepEqual(locations.value.locations, []);
    const read = await kernel.call('assistant', 'tangle_os_files', 'files.list', { location: 'docs_files' });
    assert.ok(!read.ok && read.error.code === 'OS0122');
  });
});
