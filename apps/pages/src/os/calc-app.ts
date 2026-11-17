/**
 * Calculator and Converter: Jaren's multi-mode calculator (`@jarenjs/calc`)
 * as two desktop applications. Calculator opens in its standard mode with
 * scientific, programmer, financial and converter a tab away; Converter is
 * the same component opened in its converter mode alone (units, and currency
 * from live public rates with an offline table to fall back on). Both are
 * `@jarenjs/app` documents the desktop runs; nothing here computes a number.
 * Words come from Jaren's own catalogues in the desktop's language, and the
 * component's dark palette follows the `data-theme` the desktop stamps on
 * its root.
 */
import { createCalcComponent } from '@jarenjs/calc/component';
import { compileMessageCatalog } from '@jarenjs/core/message';
import { ar, de, es, fr, ja, ko, nl, pt, ru, tr, zhTW } from '@jarenjs/locales';
import type { ShippedMount } from '@tangleai/os/shell';

const PACKS: Record<string, Record<string, unknown>> = { ar, de, es, fr, ja, ko, nl, pt, ru, tr, 'zh-TW': zhTW };
const compiled = new Map<string, Readonly<Record<string, unknown>>>();
/** Jaren's catalogue for a language, compiled once; English is the component's own. */
function messagesFor(locale: string) {
  const pack = PACKS[locale] ?? PACKS[locale.split('-')[0]];
  if (!pack) return undefined;
  let catalogue = compiled.get(locale);
  if (!catalogue) { catalogue = compileMessageCatalog(pack as any); compiled.set(locale, catalogue); }
  return catalogue;
}

/** One calculator in a window; `converter` opens it in the converter mode, without the other modes. */
export function calcMount(kind: 'calculator' | 'converter'): ShippedMount {
  return (node, context) => {
    node.classList.add('tos-surface', `tos-surface-${kind}`);
    const host = node.ownerDocument.createElement('div');
    host.className = 'tos-calc';
    node.append(host);
    const app = createCalcComponent({ messages: messagesFor(context.locale) } as any).createApp({ node: host });
    if (kind === 'converter') app.dispatch('calc/mode', { mode: 'converter' });
    return () => { app.destroy(); host.remove(); };
  };
}
