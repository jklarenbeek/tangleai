/**
 * The desktop's Settings: the one place a person finds the settings of the
 * desktop and of every application on it. A host adds its own sections; each
 * module whose manifest declares `settings` gets one:
 *
 * - `mount` (a shipped module): the host's own settings screen, rendered in
 *   the pane with a module context; the application keeps its values.
 * - `page` (an origin module): the application's settings page, framed from
 *   its own origin, joined like its window (theme and language, its own `os`
 *   port) but given no contract ports; the application keeps its values.
 * - `form` (a document module, with no server of its own): a form from the
 *   module's JSON Schema, whose values the desktop keeps (`kernel.setSettings`)
 *   and pushes to the module's windows.
 *
 * A module opens its own section with `openSettings()` (its own port, so no
 * grant is needed); the shell's menus offer it too. Kept apart from the shell
 * so the forms machinery loads only where Settings is installed.
 */
import { createApp, createFormActions, createFormView, formEventFields } from '@jarenjs/app';
import { buildFormModel, buildFormViewModel, createInitialData } from '@jarenjs/forms';
import { openPortClient } from '@jarenjs/contract/port';
import { localized, type LocalizedText, type ModuleManifest } from './manifest.ts';
import { CONNECT, HELLO, PROTOCOL, systemContracts, type ConnectMessage } from './contracts.ts';
import { createOsMessages, type OsCatalogue } from './messages.ts';
import type { Kernel } from './kernel.ts';
import type { ShippedContext, ShippedMount } from './shell.ts';

/** What the shell calls to show a section: `module:<id>` for a module's, a host section's own id otherwise. */
export const SETTINGS_CONTRACT = {
  $contract: '0.1',
  id: 'tangle_os_settings',
  operations: {
    'settings.show': {
      kind: 'command',
      doc: 'Show a section of the desktop\'s Settings.',
      input: { type: 'object', additionalProperties: false, required: ['section'], properties: { section: { type: 'string', minLength: 1, maxLength: 200 } } },
      output: { type: 'object' },
    },
  },
} as const;

/** A host's own section: its id stays stable (a deep link, a test), its title is localized. */
export type SettingsSection = {
  id: string;
  title: LocalizedText;
  keywords?: string[];
  mount: (node: HTMLElement, context: ShippedContext) => (() => void) | void;
};

export type SettingsOptions = {
  kernel: Kernel;
  /** The host's shipped mounts, where a `mount` module's settings screen is found. */
  shipped?: Record<string, ShippedMount>;
  /** The host's own sections, first, in this order. */
  sections?: SettingsSection[];
  /** The section shown when Settings opens without one; the first by default. */
  initial?: () => string;
  /** How long a settings page has to say hello (15 s by default). */
  connectTimeoutMs?: number;
  messages?: Partial<OsCatalogue>;
  /** The module id of Settings itself (`settings` by default). */
  id?: string;
};

type Entry = { id: string, title: string, keywords: string[], kind: 'host' | 'mount' | 'page' | 'form', manifest?: ModuleManifest, section?: SettingsSection };

/** The Settings module: its manifest for the kernel and its mount for the shell. */
export function settingsModule(options: SettingsOptions): { manifest: ModuleManifest, mount: ShippedMount } {
  const id = options.id ?? 'settings';
  const manifest: ModuleManifest = {
    $module: '0.1', id, version: '1.0.0', category: 'system',
    title: { en: 'Settings' }, icon: { glyph: 'gear', hue: 215 },
    host: { kind: 'shipped', mount: id },
    provides: [SETTINGS_CONTRACT as any],
    window: { width: 900, height: 620, minWidth: 560, minHeight: 420, singleton: true },
  };
  return { manifest, mount: (node, context) => mountSettings(node, context, options) };
}

function mountSettings(node: HTMLElement, context: ShippedContext, options: SettingsOptions) {
  const { kernel } = options;
  const doc = node.ownerDocument, win: any = doc.defaultView;
  const t = createOsMessages(options.messages);
  const locale = context.locale;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
    return e;
  };
  const root = el('div', { class: 'tos-settings' });
  const side = el('div', { class: 'tos-settings-side' });
  const search = el('input', { class: 'tos-settings-search', type: 'search', 'aria-label': t('settings/search'), placeholder: t('settings/search') }) as HTMLInputElement;
  const nav = el('nav', { class: 'tos-settings-nav', 'aria-label': t('settings/sections') });
  const pane = el('div', { class: 'tos-settings-pane' });
  side.append(search, nav);
  root.append(side, pane);
  node.append(root);

  const entries = (): Entry[] => [
    ...(options.sections ?? []).map(section => ({ id: section.id, title: localized(section.title, locale), keywords: section.keywords ?? [], kind: 'host' as const, section })),
    ...kernel.modules().filter(m => m.settings && m.id !== context.module.id).map(m => ({
      id: `module:${m.id}`, title: localized(m.settings!.title ?? m.title, locale), keywords: m.settings!.keywords ?? [], kind: m.settings!.kind, manifest: m,
    })),
  ];
  let current = '', dispose: (() => void) | void = undefined;

  function renderNav() {
    const query = search.value.trim().toLocaleLowerCase(locale);
    const all = entries();
    const shown = query ? all.filter(e => [e.title, ...e.keywords].some(word => word.toLocaleLowerCase(locale).includes(query))) : all;
    const button = (e: Entry) => {
      const b = el('button', { type: 'button', 'data-section': e.id });
      if (e.id === current) { b.className = 'is-current'; b.setAttribute('aria-current', 'page'); }
      if (e.manifest) {
        const glyph = el('span', { class: 'tos-glyph' }); glyph.dataset.glyph = e.manifest.icon?.glyph ?? 'app';
        if (e.manifest.icon?.hue !== undefined) glyph.style.setProperty('--hue', String(e.manifest.icon.hue));
        b.append(glyph);
      }
      b.append(e.title);
      b.addEventListener('click', () => show(e.id));
      return b;
    };
    const host = shown.filter(e => e.kind === 'host'), apps = shown.filter(e => e.kind !== 'host');
    const groups: Node[] = [...host.map(button)];
    if (apps.length) { const heading = el('h3', { class: 'tos-settings-group' }); heading.textContent = t('settings/applications'); groups.push(heading, ...apps.map(button)); }
    if (!shown.length) { const none = el('p', { class: 'tos-muted' }); none.textContent = t('settings/no-match'); groups.push(none); }
    nav.replaceChildren(...groups);
  }

  function show(section: string) {
    const all = entries();
    const entry = all.find(e => e.id === section) ?? all.find(e => e.id === options.initial?.()) ?? all[0];
    try { dispose?.(); } catch (error) { win.console?.error?.(error); }
    dispose = undefined;
    pane.replaceChildren();
    current = entry?.id ?? '';
    renderNav();
    if (!entry) { const empty = el('p', { class: 'tos-muted' }); empty.textContent = t('settings/empty'); pane.append(empty); return; }
    pane.dataset.showing = entry.id;
    if (entry.kind === 'host') dispose = entry.section!.mount(pane, context);
    else if (entry.kind === 'mount') dispose = mountSection(entry.manifest!);
    else if (entry.kind === 'page') dispose = pageSection(entry.manifest!);
    else dispose = formSection(entry.manifest!);
  }

  /** A shipped module's own settings screen, with a context of that module's own. */
  function mountSection(manifest: ModuleManifest) {
    const name = (manifest.settings as { mount: string }).mount, mount = options.shipped?.[name];
    if (!mount) { const missing = el('p', { class: 'tos-muted' }); missing.textContent = t('window/failed', { title: localized(manifest.title, locale), detail: `no shipped component '${name}'` }); pane.append(missing); return; }
    return mount(pane, {
      ...context, module: manifest,
      call: (contract, op, input) => kernel.call(manifest.id, contract, op, input),
      sendMail: (envelope) => { kernel.sendMail(manifest.id, envelope); },
      setTitle: () => {},
      provide: () => { throw new Error('a settings section provides no contract; its module window does'); },
      openSettings: () => show(`module:${manifest.id}`),
    });
  }

  /** An application's settings page, from its own origin: joined for theme and language, given no contract ports. */
  function pageSection(manifest: ModuleManifest) {
    const url = (manifest.settings as { url: string }).url, origin = new URL(url).origin;
    const frame = el('iframe', { class: 'tos-frame tos-settings-frame', title: localized(manifest.settings!.title ?? manifest.title, locale) }) as HTMLIFrameElement;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.setAttribute('referrerpolicy', 'strict-origin');
    const ports: MessagePort[] = [];
    let served: { close?: () => void } | undefined, deadline: any, notice: HTMLElement | null = null;
    const release = () => { try { served?.close?.(); } catch { /* closing */ } for (const p of ports.splice(0)) p.close(); served = undefined; };
    const arm = () => { win.clearTimeout(deadline); deadline = win.setTimeout(unanswered, options.connectTimeoutMs ?? 15_000); };
    function unanswered() {
      release();
      notice = el('div', { class: 'tos-notice', role: 'alert' });
      const text = el('p'); text.textContent = t('window/unanswered', { title: localized(manifest.title, locale) });
      const retry = el('button', { type: 'button' }); retry.textContent = t('window/retry');
      retry.addEventListener('click', () => { notice?.remove(); notice = null; arm(); frame.src = url; });
      notice.append(text, retry);
      pane.append(notice);
    }
    const onHello = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || (event.data as any)?.type !== HELLO || event.origin !== origin) return;
      win.clearTimeout(deadline); release(); notice?.remove(); notice = null;
      const os = new MessageChannel(), control = new MessageChannel();
      served = kernel.serveModule(manifest.id, os.port1, { openSettings: () => show(`module:${manifest.id}`) });
      os.port1.start();
      openPortClient(systemContracts().module, { channel: control.port1, timeoutMs: 10_000 }); control.port1.start();
      ports.push(os.port1, control.port1);
      const theme = context.theme;
      const message: ConnectMessage = { type: CONNECT, protocol: PROTOCOL, module: manifest.id, ports: ['os', 'module'], theme: { tokens: theme.tokens, scheme: theme.scheme ?? 'light' }, locale: { locale: context.locale, dir: context.dir } };
      frame.contentWindow!.postMessage(message, origin, [os.port2, control.port2]);
    };
    win.addEventListener('message', onHello);
    arm();
    frame.src = url;
    pane.append(frame);
    return () => { win.clearTimeout(deadline); win.removeEventListener('message', onHello); release(); frame.remove(); };
  }

  /** A document module's settings: a form from its schema; the desktop keeps the values. */
  function formSection(manifest: ModuleManifest) {
    const schema = (manifest.settings as { schema: Record<string, unknown> }).schema;
    const model = buildFormModel(schema);
    const host = el('div', { class: 'tos-settings-form' });
    const status = el('p', { class: 'tos-settings-status', role: 'status' });
    pane.append(host, status);
    const stored = kernel.settings(manifest.id) as Record<string, unknown>;
    const app = createApp({
      state: { data: Object.keys(stored ?? {}).length ? stored : createInitialData(model) },
      view: [...createFormView() as any[], { match: '$', body: ['div', {}, { $apply: '$.form' }] }],
      actions: createFormActions({ dataPointer: '/data' }),
    } as any, {
      node: host, document: doc, eventFields: { ...formEventFields() },
      viewModel: (state: any) => ({ form: buildFormViewModel(model, state.data, { validateFields: true }) }),
    } as any);
    const stop = app.subscribe((state: any) => {
      const outcome = kernel.setSettings(manifest.id, state.data);
      status.textContent = outcome.ok ? t('settings/saved') : t('settings/refused', { detail: outcome.error.message });
      status.dataset.tone = outcome.ok ? 'ok' : 'fail';
    });
    return () => { stop?.(); app.destroy(); };
  }

  search.addEventListener('input', () => renderNav());
  const unsubscribe = kernel.subscribe((event) => { if (event.kind === 'modules') renderNav(); });
  context.provide(SETTINGS_CONTRACT, { 'settings.show': ({ section }: { section: string }) => { show(section); return {}; } });
  show(options.initial?.() ?? '');
  return () => { unsubscribe(); try { dispose?.(); } catch { /* closing */ } root.remove(); };
}
