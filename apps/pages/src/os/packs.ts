/** The Pages applications' own language packs, by language code. */
import type { PagesCatalogue } from './messages.ts';
import { ar } from './messages/ar.ts';
import { de } from './messages/de.ts';
import { es } from './messages/es.ts';
import { fr } from './messages/fr.ts';
import { ja } from './messages/ja.ts';
import { ko } from './messages/ko.ts';
import { nl } from './messages/nl.ts';
import { pt } from './messages/pt.ts';
import { ru } from './messages/ru.ts';
import { tr } from './messages/tr.ts';
import { zhTW } from './messages/zh-tw.ts';

export const PAGES_PACKS: Record<string, PagesCatalogue> = { ar, de, es, fr, ja, ko, nl, pt, ru, tr, 'zh-TW': zhTW };
