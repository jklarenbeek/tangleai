/**
 * Settings → Applications and access: every application on the desktop, where
 * it comes from, what it may use and its recent calls. For one the person
 * joined, each scope it asked for and the assistant's access are switches
 * they change at any time, and the application can be removed; what the host
 * installed is shown as the host granted it.
 */
import { localized } from './manifest.ts';
import type { OsMessageKey } from './messages.ts';
import type { Kernel } from './kernel.ts';

type Context = { kernel: Kernel, doc: Document, locale: string, t: (key: OsMessageKey, values?: Record<string, string | number>) => string, self: string };

/** A focus key inside a quoted attribute selector (ids and scopes carry no quotes, but stay safe). */
const attr = (value: string) => value.replace(/["\\]/g, '\\$&');
/** How many recent calls each application shows. */
const RECENT = 12;

export function mountAccess(pane: HTMLElement, ctx: Context): () => void {
  const { kernel, doc, t, locale } = ctx;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const root = el('section', 'tos-access');
  root.append(el('h2', 'tos-access-title', t('access/title')), el('p', 'tos-muted', t('access/lead')));
  const list = el('ul', 'tos-access-list');
  root.append(list);
  pane.append(root);
  /** Which applications show their calls, and which one is asking to be removed, across renders. */
  const open = new Set<string>();
  let confirming: string | null = null;

  function render() {
    const focused = (doc.activeElement as HTMLElement | null)?.dataset?.focusKey;
    const ledger = kernel.ledger();
    // the applications the person added first: theirs to change
    const rank = (id: string) => ({ user: 0, suite: 1, shipped: 2 } as const)[kernel.layerOf(id) ?? 'shipped'];
    const items = kernel.modules().filter(m => m.id !== ctx.self).sort((a, b) => rank(a.id) - rank(b.id)).map((m) => {
      const consent = kernel.consentOf(m.id), layer = kernel.layerOf(m.id) ?? 'shipped';
      const title = localized(m.title, locale);
      const item = el('li', 'tos-access-item');
      item.dataset.module = m.id;
      const head = el('div', 'tos-access-head');
      const glyph = el('span', 'tos-glyph'); glyph.dataset.glyph = m.icon?.glyph ?? 'app';
      if (m.icon?.hue !== undefined) glyph.style.setProperty('--hue', String(m.icon.hue));
      head.append(glyph, el('strong', undefined, title), el('span', 'tos-access-layer', layer === 'user' ? t('access/layer-user') : layer === 'suite' ? t('access/layer-suite') : t('access/layer-shipped')));
      item.append(head);
      const host: any = m.host;
      if (host.kind === 'origin') { try { item.append(el('p', 'tos-muted', t('join/origin', { origin: new URL(host.url).origin }))); } catch { /* not a URL: the kernel refused it */ } }

      if (consent) {
        if (consent.offered.length) {
          const set = el('fieldset', 'tos-access-scopes');
          set.append(el('legend', undefined, t('join/asks')));
          for (const scope of consent.offered) {
            const row = el('label', 'tos-join-scope');
            const box = el('input'); box.type = 'checkbox'; box.checked = consent.scopes.includes(scope); box.dataset.scope = scope;
            box.dataset.focusKey = `${m.id}:${scope}`;
            box.addEventListener('change', () => {
              const scopes = box.checked ? [...consent.scopes, scope] : consent.scopes.filter(s => s !== scope);
              kernel.setConsent(m.id, { scopes });
            });
            row.append(box, el('code', undefined, scope.endsWith('.*') ? scope.slice(0, -2) : scope));
            if (scope.endsWith('.*')) row.append(el('span', 'tos-muted', t('join/scope-all')));
            set.append(row);
          }
          item.append(set);
        }
        const ai = el('label', 'tos-join-assistant');
        const box = el('input'); box.type = 'checkbox'; box.checked = consent.assistant; box.className = 'tos-access-ai';
        box.dataset.focusKey = `${m.id}:assistant`;
        box.addEventListener('change', () => { kernel.setConsent(m.id, { assistant: box.checked }); });
        ai.append(box, el('span', undefined, t('join/assistant')));
        item.append(ai);
      } else {
        const granted = kernel.grants()[m.id] ?? [];
        item.append(el('p', 'tos-muted', granted.length ? t('access/uses', { scopes: granted.join(', ') }) : t('access/uses-nothing')));
      }

      const provided = new Set((m.provides ?? []).map(c => c.id));
      const calls = ledger.filter(e => e.caller === m.id || provided.has(e.contract)).slice(-RECENT).reverse();
      const details = el('details', 'tos-access-ledger');
      details.open = open.has(m.id);
      details.addEventListener('toggle', () => { if (details.open) open.add(m.id); else open.delete(m.id); });
      details.append(el('summary', undefined, t('access/calls', { count: calls.length })));
      if (!calls.length) details.append(el('p', 'tos-muted', t('access/calls-none')));
      else {
        const rows = el('ul', 'tos-access-calls');
        for (const call of calls) {
          const operation = `${call.contract}.${call.op}`;
          const time = new Date(call.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const row = el('li', call.ok ? undefined : 'is-refused', call.ok ? t('access/call', { caller: call.caller, operation, time }) : t('access/call-refused', { caller: call.caller, operation, time, code: call.code ?? '' }));
          rows.append(row);
        }
        details.append(rows);
      }
      item.append(details);

      if (layer === 'user') {
        const actions = el('div', 'tos-access-actions');
        if (confirming === m.id) {
          actions.append(el('span', undefined, t('access/remove-confirm', { title })));
          const yes = el('button', 'tos-button is-danger', t('access/remove')); yes.type = 'button';
          yes.addEventListener('click', () => { confirming = null; kernel.remove(m.id); render(); });
          const no = el('button', 'tos-button', t('access/keep')); no.type = 'button';
          no.dataset.focusKey = `${m.id}:keep`;
          no.addEventListener('click', () => { confirming = null; render(); });
          actions.append(yes, no);
        } else {
          const remove = el('button', 'tos-button', t('access/remove')); remove.type = 'button';
          remove.dataset.focusKey = `${m.id}:remove`;
          remove.addEventListener('click', () => { confirming = m.id; render(); (list.querySelector(`[data-focus-key="${attr(`${m.id}:keep`)}"]`) as HTMLElement | null)?.focus(); });
          actions.append(remove);
        }
        item.append(actions);
      }
      return item;
    });
    list.replaceChildren(...items);
    if (focused) (list.querySelector(`[data-focus-key="${attr(focused)}"]`) as HTMLElement | null)?.focus();
  }

  let queued = false;
  const later = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); };
  const unsubscribe = kernel.subscribe((event) => { if (event.kind === 'modules' || event.kind === 'ledger') later(); });
  render();
  return () => { unsubscribe(); root.remove(); };
}
