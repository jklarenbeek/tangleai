/**
 * The install sheet: what a person sees before applications from a suite
 * document join their desktop. A link names the suite; nothing installs until
 * the person adds it here. Each application shows where its pages come from,
 * the contracts it provides, what it asks to use (each a choice) and whether
 * the assistant may use it (off until they say so). An application on this
 * device or the local network says that the browser may ask about it first.
 * The sheet asks only for what is new: an application joined before is
 * updated quietly unless it now asks for more or comes from another origin.
 */
import { localized, validateManifest, type LocalizedText, type ModuleManifest } from './manifest.ts';
import { isLocalOrigin, originOf, scopesOf } from './consent.ts';
import type { OsMessageKey } from './messages.ts';
import type { Kernel } from './kernel.ts';

/** A suite document: the applications one source offers a desktop. */
export type SuiteDocument = { $suite: '0.1', id: string, title?: LocalizedText, modules: unknown[] };

/** What became of each application a suite offered. */
export type JoinResult = {
  /** Added or changed by the person's choice in the sheet. */
  installed: string[],
  /** Left out by the person (unticked, or the sheet cancelled). */
  declined: string[],
  /** Already on the desktop as allowed: updated without asking, or kept by the host. */
  unchanged: string[],
  /** Not valid, or refused by the kernel. */
  refused: { id: string, message: string }[],
};

type Context = {
  kernel: Kernel, doc: Document, node: HTMLElement, locale: string,
  t: (key: OsMessageKey, values?: Record<string, string | number>) => string,
  desktopOrigin: string | null,
};

type Offer = { manifest: ModuleManifest, reason: 'new' | 'origin' | 'more', checked: Set<string>, assistant: boolean };

/** Join a suite's applications, asking the person for what is new. */
export async function joinSuite(ctx: Context, suite: SuiteDocument, source?: string): Promise<JoinResult> {
  const { kernel } = ctx;
  const result: JoinResult = { installed: [], declined: [], unchanged: [], refused: [] };
  if (suite?.$suite !== '0.1' || !Array.isArray(suite.modules)) throw Object.assign(new Error('not a suite document'), { code: 'OS0150' });
  await kernel.ready();
  const offers: Offer[] = [];
  for (const value of suite.modules) {
    const verdict = validateManifest(value);
    if (!verdict.ok) { result.refused.push({ id: String((value as any)?.id ?? '?'), message: verdict.issues.map(i => `${i.path} ${i.message}`).join('; ') }); continue; }
    const manifest = verdict.manifest, layer = kernel.layerOf(manifest.id);
    if (layer && layer !== 'user') { result.unchanged.push(manifest.id); continue; }
    const before = kernel.consentOf(manifest.id);
    const need = kernel.consentNeeded(manifest);
    if (!need.needed && before) {
      // asked for nothing new: keep what the person allowed, within what it asks for now
      const offered = scopesOf(manifest);
      const outcome = kernel.join(manifest, { scopes: before.scopes.filter(s => offered.includes(s)), assistant: before.assistant, ...(source ? { source } : {}) });
      if (outcome.ok) result.unchanged.push(manifest.id); else result.refused.push({ id: manifest.id, message: outcome.error.message });
      continue;
    }
    if (!need.needed) continue;
    // what the person allowed before stays as it was and what is new is offered ticked; another origin starts over
    const fresh = !before || need.reason === 'origin';
    const checked = new Set(scopesOf(manifest).filter(s => fresh || before!.scopes.includes(s) || !before!.offered.includes(s)));
    offers.push({ manifest, reason: need.reason, checked, assistant: need.reason === 'origin' ? false : before?.assistant ?? false });
  }
  if (!offers.length) return result;
  const chosen = await ask(ctx, suite, offers, source);
  for (const offer of offers) {
    if (!chosen.has(offer.manifest.id)) { result.declined.push(offer.manifest.id); continue; }
    const outcome = kernel.join(offer.manifest, { scopes: [...offer.checked], assistant: offer.assistant, ...(source ? { source } : {}) });
    if (outcome.ok) result.installed.push(offer.manifest.id); else result.refused.push({ id: offer.manifest.id, message: outcome.error.message });
  }
  return result;
}

/** Show the sheet; resolves with the ids the person added (none when they cancel). */
function ask(ctx: Context, suite: SuiteDocument, offers: Offer[], source?: string): Promise<Set<string>> {
  const { doc, node, t, locale } = ctx;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const previous = doc.activeElement as HTMLElement | null;
  const scrim = el('div', 'tos-sheet-scrim');
  const sheet = el('section', 'tos-sheet tos-join');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  const heading = el('h2', 'tos-sheet-title', t('join/title', { suite: suite.title ? localized(suite.title, locale) : suite.id }));
  heading.id = `tos-join-${Math.random().toString(36).slice(2, 8)}`;
  sheet.setAttribute('aria-labelledby', heading.id);
  sheet.append(heading);
  let from: string | null = null;
  try { from = source ? new URL(source).host : null; } catch { from = null; }
  if (from) sheet.append(el('p', 'tos-sheet-lead', t('join/from', { source: from })));
  sheet.append(el('p', 'tos-muted', t('join/lead')));

  const picked = new Set(offers.map(o => o.manifest.id));
  const list = el('ul', 'tos-join-apps');
  for (const offer of offers) {
    const m = offer.manifest, origin = originOf(m);
    const item = el('li', 'tos-join-app');
    item.dataset.module = m.id;
    const pick = el('label', 'tos-join-pick');
    const box = el('input'); box.type = 'checkbox'; box.checked = true; box.className = 'tos-join-add';
    box.addEventListener('change', () => { if (box.checked) picked.add(m.id); else picked.delete(m.id); item.classList.toggle('is-off', !box.checked); });
    const glyph = el('span', 'tos-glyph'); glyph.dataset.glyph = m.icon?.glyph ?? 'app';
    if (m.icon?.hue !== undefined) glyph.style.setProperty('--hue', String(m.icon.hue));
    pick.append(box, glyph, el('strong', undefined, localized(m.title, locale)));
    item.append(pick);
    if (offer.reason !== 'new') item.append(el('p', 'tos-join-again', offer.reason === 'origin' ? t('join/again-origin') : t('join/again-more')));
    item.append(el('p', 'tos-join-origin', origin ? t('join/origin', { origin }) : t('join/document')));
    const provides = (m.provides ?? []).map(c => c.id);
    if (provides.length) item.append(el('p', 'tos-join-provides', t('join/provides', { contracts: provides.join(', ') })));
    const scopes = scopesOf(m);
    if (scopes.length) {
      const set = el('fieldset', 'tos-join-scopes');
      set.append(el('legend', undefined, t('join/asks')));
      for (const scope of scopes) {
        const row = el('label', 'tos-join-scope');
        const check = el('input'); check.type = 'checkbox'; check.checked = offer.checked.has(scope); check.dataset.scope = scope;
        check.addEventListener('change', () => { if (check.checked) offer.checked.add(scope); else offer.checked.delete(scope); });
        const all = scope.endsWith('.*');
        const code = el('code', undefined, all ? scope.slice(0, -2) : scope);
        row.append(check, code);
        if (all) row.append(el('span', 'tos-muted', t('join/scope-all')));
        set.append(row);
      }
      item.append(set);
    }
    const assistant = el('label', 'tos-join-assistant');
    const allow = el('input'); allow.type = 'checkbox'; allow.checked = offer.assistant; allow.className = 'tos-join-ai';
    allow.addEventListener('change', () => { offer.assistant = allow.checked; });
    assistant.append(allow, el('span', undefined, t('join/assistant')));
    item.append(assistant);
    if (origin && isLocalOrigin(origin) && !isLocalOrigin(ctx.desktopOrigin)) item.append(el('p', 'tos-join-note', t('join/local-network')));
    list.append(item);
  }
  sheet.append(list);

  const actions = el('div', 'tos-sheet-actions');
  const cancel = el('button', 'tos-button', t('join/cancel')); cancel.type = 'button';
  const add = el('button', 'tos-button is-primary', t('join/add')); add.type = 'button';
  actions.append(cancel, add);
  sheet.append(actions);
  scrim.append(sheet);
  node.append(scrim);
  add.focus();

  return new Promise((resolve) => {
    const done = (ids: Set<string>) => {
      scrim.remove();
      doc.removeEventListener('keydown', onKey, true);
      try { previous?.focus?.(); } catch { /* gone */ }
      resolve(ids);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); done(new Set()); return; }
      if (event.key !== 'Tab') return;
      // the sheet keeps the keyboard until it closes
      const stops = [...sheet.querySelectorAll<HTMLElement>('input, button')].filter(e => !(e as HTMLInputElement).disabled);
      const first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    doc.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done(new Set()));
    add.addEventListener('click', () => done(new Set(picked)));
  });
}

