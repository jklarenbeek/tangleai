/**
 * The Pages desktop's sentences at run time: the English catalogue
 * (`./messages.ts`) with a language pack merged over it, compiled once by
 * Jaren's message contract, and the language the desktop speaks. Every
 * sentence is read when it is drawn, so a pack set before the desktop mounts
 * reaches every window. `setPagesMessages('sentinel')` renders every key as
 * `⟦key⟧`, to find text that is not in the catalogue.
 */
import { compileMessageCatalog } from '@jarenjs/core/message';
import type { LocalizedText } from '@tangleai/os';
import { pagesMessagesEn, type PagesCatalogue, type PagesMessageKey } from './messages.ts';

type Compiled = Readonly<Record<PagesMessageKey, (params?: any) => string>>;
type ParamsOf<K extends PagesMessageKey> = typeof pagesMessagesEn[K] extends (params: infer P) => string ? P : Record<string, string | number>;

const compile = (catalogue: PagesCatalogue) => compileMessageCatalog({ ...pagesMessagesEn, ...catalogue } as Record<string, string | ((params: any) => string)>) as Compiled;
const english = compile({});
let messages: Compiled = english;
let language = 'en';

/** Every key rendering as `⟦key⟧`, closures included. */
export function sentinelMessages(): PagesCatalogue {
  return Object.fromEntries(Object.keys(pagesMessagesEn).map(key => [key, `⟦${key}⟧`])) as PagesCatalogue;
}

/** Merge a pack over English and compile it once; no argument restores English. An unknown key is refused. */
export function setPagesMessages(catalogue?: PagesCatalogue | 'sentinel') {
  if (catalogue === undefined) { messages = english; return; }
  const pack = catalogue === 'sentinel' ? sentinelMessages() : catalogue;
  for (const key of Object.keys(pack))
    if (!Object.hasOwn(pagesMessagesEn, key)) throw new TypeError(`unknown Pages message key: ${key}`);
  messages = compile(pack);
}

/** The sentence for a key, its `{name}` placeholders filled as text. */
export function t<K extends PagesMessageKey>(key: K, params?: ParamsOf<K>): string {
  return messages[key](params ?? {});
}

/** The language code the desktop speaks ('en' until one is set). */
export const pagesLanguage = () => language;
export function setPagesLanguage(lang: string) { language = lang || 'en'; }

/** The English sentence of a key, whatever pack is active. */
export const englishOf = <K extends PagesMessageKey>(key: K): string => english[key]({});

/** The languages a manifest's text may carry (its schema refuses any other). */
const MANIFEST_LANGUAGES = new Set(['ar', 'de', 'es', 'fr', 'ja', 'ko', 'nl', 'pt', 'ru', 'tr', 'zh-TW']);
const manifestLanguage = (lang: string) => MANIFEST_LANGUAGES.has(lang) ? lang : MANIFEST_LANGUAGES.has(lang.split('-')[0]) ? lang.split('-')[0] : null;

/**
 * A manifest's text: English, the translations shipped beside it, and the
 * active pack's sentence in the desktop's language when the pack has its own.
 */
export function localizedText(englishText: string, translated: string, shipped: Partial<Record<string, string>> = {}): LocalizedText {
  const lang = manifestLanguage(pagesLanguage());
  return { en: englishText, ...shipped, ...(lang && translated !== englishText ? { [lang]: translated } : {}) } as LocalizedText;
}

/** Settings search words: the English ones, then the pack's when the desktop speaks another language. */
export function localizedKeywords(englishList: string, translated: string): string[] {
  const words = (list: string) => list.split(',').map(word => word.trim()).filter(word => word !== '' && word.length <= 40);
  const all = pagesLanguage() !== 'en' && translated !== englishList ? [...new Set([...words(englishList), ...words(translated)])] : words(englishList);
  return all.slice(0, 24);
}
