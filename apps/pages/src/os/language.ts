/**
 * The Pages desktop's one language choice. The person picks a language in
 * Settings (or follows the browser's); at boot it becomes every catalogue the
 * desktop draws from: the chrome's (`@tangleai/os/messages/*`), the
 * assistant's (`@tangleai/assistant/messages/*`), the Pages applications'
 * own (`./messages/*`), the locale Jaren's applications and `Intl` format with,
 * and the direction (Arabic mirrors). `?lang=` overrides it for a link or a
 * test; `?lang=sentinel` renders every key of every catalogue as `⟦key⟧`.
 */
import { osMessagesEn, type OsCatalogue } from '@tangleai/os';
import * as osAr from '@tangleai/os/messages/ar';
import * as osDe from '@tangleai/os/messages/de';
import * as osEs from '@tangleai/os/messages/es';
import * as osFr from '@tangleai/os/messages/fr';
import * as osJa from '@tangleai/os/messages/ja';
import * as osKo from '@tangleai/os/messages/ko';
import * as osNl from '@tangleai/os/messages/nl';
import * as osPt from '@tangleai/os/messages/pt';
import * as osRu from '@tangleai/os/messages/ru';
import * as osTr from '@tangleai/os/messages/tr';
import * as osZhTw from '@tangleai/os/messages/zh-tw';
import * as aiAr from '@tangleai/assistant/messages/ar';
import * as aiDe from '@tangleai/assistant/messages/de';
import * as aiEs from '@tangleai/assistant/messages/es';
import * as aiFr from '@tangleai/assistant/messages/fr';
import * as aiJa from '@tangleai/assistant/messages/ja';
import * as aiKo from '@tangleai/assistant/messages/ko';
import * as aiNl from '@tangleai/assistant/messages/nl';
import * as aiPt from '@tangleai/assistant/messages/pt';
import * as aiRu from '@tangleai/assistant/messages/ru';
import * as aiTr from '@tangleai/assistant/messages/tr';
import * as aiZhTw from '@tangleai/assistant/messages/zh-tw';
import type { AssistantCatalogue } from '@tangleai/assistant/messages';
import type { PagesCatalogue } from './messages.ts';
import { PAGES_PACKS } from './packs.ts';

/** The languages the desktop speaks, each named in itself. */
export const LANGUAGES: readonly { code: string, name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'nl', name: 'Nederlands' }, { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' }, { code: 'pt', name: 'Português' }, { code: 'ru', name: 'Русский' }, { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' }, { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' }, { code: 'zh-TW', name: '繁體中文' },
];
const CODES = new Set(LANGUAGES.map(l => l.code));

/** The one pack of a module namespace (each pack file exports one catalogue). */
const one = <T>(module: Record<string, unknown>) => Object.values(module).find(v => v && typeof v === 'object') as T;
const OS: Record<string, OsCatalogue> = Object.fromEntries(([['ar', osAr], ['de', osDe], ['es', osEs], ['fr', osFr], ['ja', osJa], ['ko', osKo], ['nl', osNl], ['pt', osPt], ['ru', osRu], ['tr', osTr], ['zh-TW', osZhTw]] as const).map(([code, m]) => [code, one<OsCatalogue>(m)]));
const AI: Record<string, AssistantCatalogue> = Object.fromEntries(([['ar', aiAr], ['de', aiDe], ['es', aiEs], ['fr', aiFr], ['ja', aiJa], ['ko', aiKo], ['nl', aiNl], ['pt', aiPt], ['ru', aiRu], ['tr', aiTr], ['zh-TW', aiZhTw]] as const).map(([code, m]) => [code, one<AssistantCatalogue>(m)]));

/** A language a browser lists, as one the desktop speaks, or null: `nl-BE` is Dutch, `zh-Hant` and `zh-HK` read Traditional Chinese. */
export function supported(tag: string): string | null {
  const lower = tag.toLowerCase();
  if (lower === 'zh-tw' || lower.startsWith('zh-hant') || lower === 'zh-hk' || lower === 'zh-mo') return 'zh-TW';
  if (lower.startsWith('zh')) return null;
  const base = lower.split('-')[0];
  return CODES.has(base) ? base : null;
}

/** The language to draw in: the person's choice, else the first of the browser's the desktop speaks, else English. */
export function resolveLanguage(choice: string | undefined, browser: readonly string[] = []): string {
  if (choice && choice !== 'system') { const chosen = supported(choice); if (chosen) return chosen; }
  for (const tag of browser) { const found = supported(tag); if (found) return found; }
  return 'en';
}

export const dirOf = (code: string): 'ltr' | 'rtl' => (code === 'ar' ? 'rtl' : 'ltr');

/** Every catalogue for one language; `sentinel` renders each key as itself. */
export function catalogues(code: string): { os?: OsCatalogue, assistant?: AssistantCatalogue, pages?: PagesCatalogue | 'sentinel' } {
  if (code === 'sentinel') return { os: Object.fromEntries(Object.keys(osMessagesEn).map(k => [k, `⟦${k}⟧`])) as OsCatalogue, pages: 'sentinel' };
  if (code === 'en') return {};
  return { os: OS[code], assistant: AI[code], pages: PAGES_PACKS[code] };
}

let active: { code: string, assistant?: AssistantCatalogue } = { code: 'en' };
/** The language the desktop draws in now, and the assistant's pack for it. */
export const activeLanguage = () => active.code;
export const assistantMessages = () => active.assistant;
export function setActiveLanguage(code: string) { active = { code, ...(catalogues(code).assistant ? { assistant: catalogues(code).assistant } : {}) }; }
