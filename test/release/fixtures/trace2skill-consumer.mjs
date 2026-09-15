/**
 * The installed skill package on Node and Bun: the published example, the
 * browser-safe half, and the eleven collections over a real SQLite file that
 * is closed and reopened — a directory a run staged must still be readable,
 * and reopening must write nothing.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openTangleDb, createTrace2SkillDbStore } from '@tangleai/store';
import {
  EMPTY_SKILL_HEAD, activeBundle, importS0, rollbackHead, skillRootText, TRACE2SKILL_TABLES,
} from '@tangleai/trace2skill';
import { qualifyTrace2SkillBrowser } from './trace2skill-browser.mjs';

globalThis.fetch = async () => { throw Error('Installed skill consumer forbids network'); };
assert.match(import.meta.resolve('@tangleai/trace2skill'), /\.js$/);
assert.match(import.meta.resolve('@tangleai/trace2skill/node'), /\.js$/);
assert.equal(TRACE2SKILL_TABLES.length, 11);

const packs = await import('@tangleai/trace2skill/artifacts', { with: { type: 'json' } });
assert.equal(Object.keys(packs.default.prompts).length, 5);

const browser = await qualifyTrace2SkillBrowser();
assert.equal(browser.hunks, 1);
assert.equal(browser.withheld, 0);
assert.equal(browser.formatValid, true);
assert.equal(browser.publishedRoles, 5);

const example = await import('./trace2skill-example.mjs');
const answered = await example.runTrace2SkillExample();
assert.equal(answered.answer, '3');
assert.deepEqual(answered.tools, ['read_table', 'skill_read']);
assert.ok(answered.system.includes('# Reading a small table'), 'the root page never reached the request');
assert.ok(!answered.system.includes('Separator conventions'), 'a reference page is read through the tool, not preloaded');

const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new Error('installed skill consumer requires parent-owned scratch');
const path = join(directory, 'trace2skill.db');
const pages = [
  { path: 'SKILL.md', bytes: new TextEncoder().encode('# Installed\n\n## Reading the table\n\nThe first line is a header.\n') },
  { path: 'references/units.md', bytes: new TextEncoder().encode('# Units\n\n- One kilogram is 2.20462 pounds.\n') },
];
let db = await openTangleDb({ path });
try {
  const store = createTrace2SkillDbStore(db);
  const imported = await importS0(store, pages, { scopeKey: 'installed', mode: 'deepening' });
  assert.ok(imported.valid, JSON.stringify(imported.issues));
  assert.ok((await store.markBundle(imported.value.bundle.id, 'eligible')).valid);
  const head = await store.activate('installed', EMPTY_SKILL_HEAD, imported.value.bundle.id);
  assert.ok(head.valid, JSON.stringify(head.issues));
  assert.equal(head.value.revision, 1);
  await db.close();

  db = await openTangleDb({ path });
  const reopened = createTrace2SkillDbStore(db);
  const before = reopened.stats().writes;
  const active = await activeBundle(reopened, 'installed');
  assert.ok(active.valid, JSON.stringify(active.issues));
  assert.equal(active.value.bundle.id, imported.value.bundle.id);
  assert.equal(active.value.files.length, 2);
  assert.match(skillRootText(active.value).value, /^# Installed/);
  assert.equal(reopened.stats().writes, before, 'reading the active directory wrote something');
  assert.deepEqual(await reopened.scopes('runs'), []);
  assert.deepEqual(await reopened.scopes('bundles'), ['installed']);
  // Rolling back needs a directory this scope served before; there is none.
  const nothing = await rollbackHead(reopened, {
    scopeKey: 'installed', bundleId: imported.value.bundle.id,
    expectedHead: await reopened.head('installed'), actor: 'consumer',
  });
  assert.equal(nothing.outcome, 'refused');
  assert.equal(nothing.issues[0].code, 'TT2S1010');
  assert.equal((await db.integrityCheck()).ok, true);
} finally { await db.close(); }
console.log('Installed skill directories: browser root import, packed artifacts, SQLite reopen and fenced head passed');
