/**
 * What Monkey Grove says, in English and Dutch: the HUD, the prompts,
 * Mimi's lines, the praise and every explanation a wrong answer earns.
 * The table is a JSON document (`strings.json`) with one map per
 * language and the same keys in both; `t` fills a line's `{name}`
 * placeholders. A placeholder with no value stays visible as `{name}`,
 * so a line missing its numbers is caught by the tests, never shown as
 * a silent gap.
 */

import STRINGS from './strings.json' with { type: 'json' };

export type Lang = 'en' | 'nl';

/** The languages the game speaks. */
export const LANGS: readonly Lang[] = Object.freeze(['en', 'nl'] as Lang[]);

/** The string tables, by language. */
export const TABLES = STRINGS as Readonly<Record<Lang, Readonly<Record<string, string>>>>;

/** A language the game speaks, or English. */
export function langOf(lang: unknown): Lang {
  return lang === 'nl' ? 'nl' : 'en';
}

/** A line in a language with its placeholders filled: the line, or the key itself when no table has it. */
export function t(lang: Lang, key: string, vars: Record<string, unknown> = {}): string {
  const line = TABLES[lang][key] ?? key;
  return line.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined || vars[name] === null ? whole : String(vars[name])));
}

/** Whether a key is a line the game has. */
export function hasLine(key: string) {
  return Object.hasOwn(TABLES.en, key);
}
