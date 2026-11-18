// An application that pulled this repository in as a submodule: it installed
// only the tracked desktop tarball and its Jaren foundation, nothing else of
// Tangle. It runs a desktop kernel from the package, and joins it twice: through
// the package's module entry, and through the one-file module side a page on
// any foundation loads by URL.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createKernel, CONNECT, HELLO, PROTOCOL, systemContracts } from '@tangleai/os';
import * as packaged from '@tangleai/os/module';
import { checkSuite, createTestDesktop } from '@tangleai/os/testing';
import { ar } from '@tangleai/os/messages/ar';
import { AUTHORING_SEED, gateAuthoredApp } from '@tangleai/os/authoring';
import { osMessagesEn } from '@tangleai/os';
import { openPortClient } from '@jarenjs/contract/port';

globalThis.fetch = async () => { throw Error('The desktop consumer forbids network'); };
const manifest = JSON.parse(readFileSync('./os/manifest.json', 'utf8'));
for (const part of [manifest.package, manifest.module])
  assert.equal(createHash('sha256').update(readFileSync(`./os/${part.file}`)).digest('hex'), part.sha256, `${part.file} matches its manifest`);
assert.equal(manifest.protocol, PROTOCOL, 'the manifest names the protocol the package speaks');
assert.deepEqual(readdirSync('./node_modules/@tangleai'), ['os'], 'the desktop installs without any other Tangle package');
const single = await import('./os/tangle-os-module.js');
assert.deepEqual(Object.keys(single).sort(), manifest.module.exports);

const RECORDS = { $contract: '0.1', id: 'records', operations: { 'records.search': { kind: 'read', doc: 'Find records by name.', input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, output: { type: 'array' } } } };

/** A page in a frame: its parent, a style root, the listeners the shell posts to. */
function framedPage() {
  const listeners = new Set(); const posted = []; const style = new Map();
  const root = { style: { setProperty: (k, v) => style.set(k, v), colorScheme: '' }, dataset: {}, setAttribute() {} };
  const host = { parent: { postMessage: (m) => posted.push(m) }, document: { documentElement: root }, addEventListener: (_, l) => listeners.add(l), removeEventListener: (_, l) => listeners.delete(l) };
  return { host, posted, style, deliver: (event) => { for (const l of [...listeners]) l(event); } };
}

async function join(connectToOs, label) {
  const kernel = createKernel({ assistantGrants: 'all' });
  kernel.install({ $module: '0.1', id: 'records-app', version: '1.0.0', title: { en: 'Records' }, host: { kind: 'origin', url: 'https://records.example/app' }, provides: [RECORDS] }, 'suite');
  const page = framedPage();
  const joined = connectToOs({ origins: ['https://desk.example'], host: page.host, serve: [{ contract: RECORDS, handlers: { 'records.search': ({ query }) => [{ name: `${label} ${query}` }] } }] });
  assert.deepEqual(page.posted, [{ type: HELLO, protocol: PROTOCOL }], `${label}: the page announces the protocol`);
  const os = new MessageChannel(), control = new MessageChannel(), records = new MessageChannel();
  try {
    kernel.serveModule('records-app', os.port1); os.port1.start();
    kernel.connectProvider('records-app', RECORDS, records.port1);
    openPortClient(systemContracts().module, { channel: control.port1, timeoutMs: 5000 }); control.port1.start();
    page.deliver({ source: page.host.parent, origin: 'https://desk.example', ports: [os.port2, control.port2, records.port2],
      data: { type: CONNECT, protocol: PROTOCOL, module: 'records-app', ports: ['os', 'module', 'records'], theme: { tokens: { '--os-accent': '#0a7' }, scheme: 'light' }, locale: { locale: 'en', dir: 'ltr' } } });
    const connection = await joined;
    assert.equal(page.style.get('--os-accent'), '#0a7', `${label}: the desktop's theme reaches the page`);
    assert.deepEqual(await kernel.call('assistant', 'records', 'records.search', { query: 'oak' }), { ok: true, value: [{ name: `${label} oak` }] });
    assert.equal((await kernel.call('assistant', 'records', 'records.search', {})).ok, false, `${label}: the page's contract refuses what it does not accept`);
    // a served contract, and every window's header bar, under the same grant
    assert.deepEqual(kernel.operations().map(o => [o.tool, o.kind]), [['records__records_search', 'read'], ['tangle_os_header__header_list', 'read'], ['tangle_os_header__header_activate', 'command'], ['tangle_os_dock__dock_read', 'read'], ['tangle_os_dock__dock_suggest', 'command'], ['tangle_os_files__files_locations', 'read'], ['tangle_os_files__files_list', 'read'], ['tangle_os_files__files_search', 'read'], ['tangle_os_files__files_read', 'read']]);
    assert.equal(kernel.operations()[0].doc, 'Find records by name.');
    assert.equal((await connection.sendMail({ subject: 'Ready' })).ok, true);
    connection.close();
  } finally { for (const c of [os, control, records]) { c.port1.close(); c.port2.close(); } }
}

await join(packaged.connectToOs, 'package');
await join(single.connectToOs, 'single-file');
// a language pack from the tarball: every sentence of the chrome
assert.deepEqual(Object.keys(ar).sort(), Object.keys(osMessagesEn).sort());
// the authoring gate from the tarball: the crib's own example passes it
assert.deepEqual(gateAuthoredApp(JSON.parse(JSON.stringify(AUTHORING_SEED))).problems, []);
// the consumer's own CI: its suite checked, and run headless as a person's link would join it
const SUITE = { $suite: '0.1', id: 'records-suite', modules: [{ $module: '0.1', id: 'records-app', version: '1.0.0', title: { en: 'Records' }, host: { kind: 'origin', url: 'https://records.example/app' }, provides: [RECORDS] }] };
assert.deepEqual(checkSuite(SUITE, { desktopOrigin: 'https://desk.example' }), []);
const test = await createTestDesktop({ suite: SUITE, consent: { 'records-app': { assistant: false } }, serve: { records: { 'records.search': ({ query }) => [{ name: query }] } } });
assert.equal((await test.assistant.call('records', 'records.search', { query: 'oak' })).ok, false, 'the assistant waits for the person\'s consent');
assert.deepEqual(await test.call('shell', 'records', 'records.search', { query: 'oak' }), { ok: true, value: [{ name: 'oak' }] });
console.log(JSON.stringify({ protocol: PROTOCOL, joined: ['package', 'single-file'], tested: test.joined, tangle: ['os'] }));
