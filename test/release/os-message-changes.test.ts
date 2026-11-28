/**
 * The desktop text keys a release adds, changes and removes, read from the
 * catalogue's source: every key of the live English catalogue is read, and a
 * changed sentence is told apart from an added or removed key.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { osMessagesEn } from '@tangleai/os';
import { catalogueEntries, messageChanges } from '../../scripts/os-message-changes.ts';

it('reads every key of the English desktop catalogue from its source', () => {
  const entries = catalogueEntries(readFileSync(new URL('../../components/os/src/messages.ts', import.meta.url), 'utf8'));
  assert.deepEqual([...entries.keys()].sort(), Object.keys(osMessagesEn).sort());
});

it('names added, changed and removed keys apart', () => {
  const before = catalogueEntries("export const osMessagesEn = {\n  'a': 'One',\n  'b': 'Two', // a note\n  'c': \"It's\",\n};\n");
  const after = catalogueEntries("export const osMessagesEn = {\n  'a': 'One',\n  'b': 'Two again',\n  'd': 'Four',\n};\n");
  assert.deepEqual(messageChanges(before, after), { added: ['d'], changed: ['b'], removed: ['c'] });
});
