/**
 * The `@tangleai/os` text keys added, changed and removed since a release, for
 * that release's notes: a host that carries its own catalogue (another
 * register, another language) learns from the list what to translate, instead
 * of from a failing key test.
 *
 *   node scripts/os-message-changes.ts [--base <ref>]   (default: the newest v* tag)
 *
 * Prints a Markdown list, or nothing when the English catalogue is unchanged.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMain } from './release/common.ts';

const FILE = 'components/os/src/messages.ts';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = /^ {2}'([^']+)': ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`),/;

/** Every key and its English literal, read from the catalogue's source text. */
export function catalogueEntries(source: string): Map<string, string> {
  const start = source.indexOf('export const osMessagesEn = {');
  if (start < 0) throw new Error(`${FILE} no longer declares osMessagesEn`);
  const entries = new Map<string, string>();
  for (const line of source.slice(start).split('\n').slice(1)) {
    if (/^\}/.test(line)) break;
    const match = ENTRY.exec(line);
    if (match) entries.set(match[1], match[2]);
  }
  return entries;
}

export function messageChanges(before: Map<string, string>, after: Map<string, string>) {
  const added = [...after.keys()].filter(key => !before.has(key));
  const removed = [...before.keys()].filter(key => !after.has(key));
  const changed = [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key));
  return { added, changed, removed };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--base');
  const base = at >= 0 ? args[at + 1] : execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const before = catalogueEntries(execFileSync('git', ['show', `${base}:${FILE}`], { cwd: ROOT, encoding: 'utf8' }));
  const after = catalogueEntries(readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8'));
  const { osMessagesEn } = await import('../components/os/src/messages.ts');
  const missed = Object.keys(osMessagesEn).filter(key => !after.has(key));
  if (missed.length) throw new Error(`os-message-changes cannot read ${missed.length} keys of ${FILE} (${missed.slice(0, 3).join(', ')}): one entry per line, please`);
  const changes = messageChanges(before, after);
  const lines: string[] = [];
  for (const [label, keys] of [['Added', changes.added], ['Changed', changes.changed], ['Removed', changes.removed]] as const)
    if (keys.length) lines.push(`- ${label} (${keys.length}): ${keys.map(key => `\`${key}\``).join(', ')}`);
  if (lines.length) console.log(`Desktop text keys since ${base}:\n\n${lines.join('\n')}`);
}
