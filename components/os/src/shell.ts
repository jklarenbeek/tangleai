/**
 * The desktop shell: renders the window document, hosts each module in its
 * window, and connects framed modules to the kernel over ports. Shipped code,
 * so it may use the DOM directly; what it shows comes from the kernel's
 * manifests, the theme document and the message catalogue.
 */
import { openPortClient } from '@jarenjs/contract/port';
import { localized, type ModuleManifest } from './manifest.ts';
import { CONNECT, FOCUS, HELLO, KEY, PROTOCOL, systemContracts, type ConnectMessage } from './contracts.ts';
import { DEFAULT_THEMES, checkTheme, type ThemeDocument } from './theme.ts';
import { createOsMessages, type OsCatalogue } from './messages.ts';
import { applyTheme, applyLocale } from './module.ts';
import {
  closeWindow, emptyDesktop, focusWindow, minimizeWindow, moveWindow, openWindow, resizeWindow, setTitle, setViewport, stacked, toggleMaximize,
  type Desktop, type WindowState,
} from './windows.ts';
import type { Kernel } from './kernel.ts';

export type ShippedContext = {
  module: ModuleManifest;
  window: string;
  call(contract: string, op: string, input?: unknown): ReturnType<Kernel['call']>;
  sendMail(envelope: { to?: string, subject: string, body?: string, data?: unknown }): void;
  setTitle(title: string): void;
  provide(contract: unknown, handlers: Record<string, (input: any) => unknown>): void;
  locale: string;
  dir: 'ltr' | 'rtl';
};
/** A shipped component: mounts into a window's content node and returns its disposer. */
export type ShippedMount = (node: HTMLElement, context: ShippedContext) => (() => void) | void;

export type DesktopOptions = {
  kernel: Kernel;
  shipped?: Record<string, ShippedMount>;
  /** URL of the page that loads the document module host as a classic script. */
  documentHost?: string;
  theme?: ThemeDocument;
  /**
   * The theme the dock's light/dark switch moves to; defaults to the built-in
   * pair. A host with a person's own colours returns their variant here.
   */
  themeFor?: (scheme: 'light' | 'dark') => ThemeDocument;
  /** Called after the person switches between light and dark from the dock or a menu. */
  onSchemeSwitch?: (scheme: 'light' | 'dark') => void;
  locale?: string;
  dir?: 'ltr' | 'rtl';
  messages?: Partial<OsCatalogue>;
  /** Defaults to the node's owner window. */
  window?: Window;
  onError?: (error: unknown) => void;
};

type Mounted = { el: HTMLElement, content: HTMLElement, title: HTMLElement, dispose: () => void, frame?: HTMLIFrameElement, moduleClient?: any, ports: MessagePort[] };

const svg = (path: string) => `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON = { close: svg('M4 4l8 8M12 4l-8 8'), minimize: svg('M4 8h8'), maximize: svg('M4.5 4.5h7v7h-7z'), restore: svg('M6 4h6v6M4 6h6v6H4z') };

/**
 * Why an application page may not be framed as an origin module, or null.
 * A page on the desktop's own origin would be framed with that origin's
 * rights and could read the desktop's storage and keys (all project sites of
 * one GitHub Pages account share an origin), so it is refused.
 */
export function originHostProblem(url: string, desktopOrigin: string | undefined): string | null {
  let target: URL;
  try { target = new URL(url); } catch { return `'${url}' is not a URL`; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return `'${url}' is not an http(s) page`;
  if (desktopOrigin && target.origin === desktopOrigin) return `'${url}' shares the desktop's origin; an application must be served from its own origin`;
  return null;
}

export function mountDesktop(node: HTMLElement, options: DesktopOptions) {
  const { kernel } = options;
  const win: any = options.window ?? node.ownerDocument.defaultView;
  const doc = node.ownerDocument;
  const t = createOsMessages(options.messages);
  const report = options.onError ?? ((error: unknown) => win.console?.error?.(error));
  let theme = options.theme ?? DEFAULT_THEMES[win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'];
  let locale = { locale: options.locale ?? 'en', dir: options.dir ?? 'ltr' as 'ltr' | 'rtl' };
  let desktop: Desktop = emptyDesktop({ w: node.clientWidth || 1280, h: node.clientHeight || 800 });
  const mounted = new Map<string, Mounted>();

  // ── structure ───────────────────────────────────────────────────────────
  node.classList.add('tos');
  node.setAttribute('role', 'application');
  node.setAttribute('aria-label', t('desktop/label'));
  const wallpaper = doc.createElement('div'); wallpaper.className = 'tos-wallpaper';
  const layer = doc.createElement('div'); layer.className = 'tos-windows';
  const shield = doc.createElement('div'); shield.className = 'tos-shield'; shield.hidden = true;
  const dock = doc.createElement('nav'); dock.className = 'tos-dock'; dock.setAttribute('aria-label', t('dock/label'));
  const mailPanel = doc.createElement('section'); mailPanel.className = 'tos-mail'; mailPanel.hidden = true; mailPanel.setAttribute('aria-label', t('mail/title'));
  node.replaceChildren(wallpaper, layer, shield, mailPanel, dock);

  const setDesktop = (next: Desktop) => { desktop = next; render(); };

  // ── theme and language ────────────────────────────────────────────────────
  function applyShellTheme(next: ThemeDocument) {
    const problems = checkTheme(next);
    if (problems.length) throw new Error(`the theme is refused: ${problems.join('; ')}`);
    theme = next;
    applyTheme(node, { tokens: next.tokens, scheme: next.scheme });
    for (const m of mounted.values()) m.moduleClient?.invoke('module.theme', { tokens: next.tokens, scheme: next.scheme });
    renderDock();
  }
  function applyShellLocale(next: { locale: string, dir: 'ltr' | 'rtl' }) {
    locale = next;
    applyLocale(node, next);
    for (const m of mounted.values()) m.moduleClient?.invoke('module.locale', next);
    render(); renderDock();
  }

  // ── hosting ───────────────────────────────────────────────────────────────
  function connectFrame(w: WindowState, manifest: ModuleManifest, frame: HTMLIFrameElement, entry: Mounted) {
    const targetOrigin = manifest.host.kind === 'origin' ? new URL(manifest.host.url).origin : '*';
    const expected = manifest.host.kind === 'origin' ? targetOrigin : 'null';
    const onHello = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || (event.data as any)?.type !== HELLO) return;
      if (event.origin !== expected) { report(new Error(`${manifest.id}: a frame of origin ${event.origin} answered for ${expected}`)); return; }
      win.removeEventListener('message', onHello);
      const os = new MessageChannel(), control = new MessageChannel();
      const provided = (manifest.provides ?? []).map(contract => ({ contract, channel: new MessageChannel() }));
      kernel.serveModule(manifest.id, os.port1, { setTitle: (title) => setDesktop(setTitle(desktop, w.id, title)) });
      os.port1.start();
      const moduleClient = openPortClient(systemContracts().module, { channel: control.port1, timeoutMs: 10_000 });
      control.port1.start();
      for (const { contract, channel } of provided) {
        try { kernel.connectProvider(manifest.id, contract, channel.port1, 10_000, w.id); }
        catch (error) { report(error); }
      }
      entry.moduleClient = moduleClient;
      entry.ports.push(os.port1, control.port1, ...provided.map(p => p.channel.port1));
      const message: ConnectMessage = {
        type: CONNECT, protocol: PROTOCOL, module: manifest.id,
        ports: ['os', 'module', ...provided.map(p => p.contract.id)],
        theme: { tokens: theme.tokens, scheme: theme.scheme }, locale,
        ...(manifest.host.kind === 'document' ? { document: { app: manifest.host.app, ...(manifest.styles ? { styles: manifest.styles } : {}) } } : {}),
      };
      frame.contentWindow!.postMessage(message, targetOrigin, [os.port2, control.port2, ...provided.map(p => p.channel.port2)]);
      entry.el.classList.remove('is-loading');
    };
    win.addEventListener('message', onHello);
    return () => win.removeEventListener('message', onHello);
  }

  function mountModule(w: WindowState, manifest: ModuleManifest, entry: Mounted) {
    const host = manifest.host;
    if (host.kind === 'shipped') {
      const mount = options.shipped?.[host.mount];
      if (!mount) throw new Error(`no shipped component '${host.mount}'`);
      const dispose = mount(entry.content, {
        module: manifest, window: w.id, locale: locale.locale, dir: locale.dir,
        call: (contract, op, input) => kernel.call(manifest.id, contract, op, input),
        sendMail: (envelope) => { kernel.sendMail(manifest.id, envelope); },
        setTitle: (title) => setDesktop(setTitle(desktop, w.id, title)),
        provide: (contract, handlers) => kernel.provideLocal(manifest.id, contract, handlers, w.id),
      });
      entry.el.classList.remove('is-loading');
      return () => { dispose?.(); kernel.withdraw(manifest.id, w.id); };
    }
    const frame = doc.createElement('iframe');
    frame.className = 'tos-frame';
    frame.title = localized(manifest.title, locale.locale);
    if (host.kind === 'document') {
      if (!options.documentHost) throw new Error('documentHost is not configured');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = options.documentHost;
    } else {
      const problem = originHostProblem(host.url, win.location?.origin);
      if (problem) throw Object.assign(new Error(problem), { code: 'OS0201' });
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');
      frame.setAttribute('referrerpolicy', 'strict-origin');
      frame.src = host.url;
    }
    entry.frame = frame;
    // focus moving into this frame (from the page or from another frame) raises its window
    frame.addEventListener('focus', () => { if (desktop.focus !== w.id) setDesktop(focusWindow(desktop, w.id)); });
    const stop = connectFrame(w, manifest, frame, entry);
    entry.content.append(frame);
    return () => { stop(); kernel.withdraw(manifest.id, w.id); for (const port of entry.ports) port.close(); frame.remove(); };
  }

  // ── windows ───────────────────────────────────────────────────────────────
  function createWindowElement(w: WindowState, manifest: ModuleManifest): Mounted {
    const el = doc.createElement('section');
    el.className = 'tos-window is-loading';
    el.dataset.window = w.id;
    el.dataset.module = w.module;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', w.title);
    const bar = doc.createElement('header'); bar.className = 'tos-titlebar';
    const title = doc.createElement('h2'); title.className = 'tos-title';
    const controls = doc.createElement('div'); controls.className = 'tos-controls';
    const button = (action: string, label: string, icon: string) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = `tos-control tos-${action}`; b.dataset.action = action;
      b.setAttribute('aria-label', label); b.title = label; b.innerHTML = icon; return b;
    };
    controls.append(button('minimize', t('window/minimize'), ICON.minimize), button('maximize', t('window/maximize'), ICON.maximize), button('close', t('window/close'), ICON.close));
    const glyph = doc.createElement('span'); glyph.className = 'tos-glyph'; glyph.dataset.glyph = manifest.icon?.glyph ?? 'app';
    if (manifest.icon?.hue !== undefined) glyph.style.setProperty('--hue', String(manifest.icon.hue));
    bar.append(glyph, title, controls);
    const content = doc.createElement('div'); content.className = 'tos-content';
    const grip = doc.createElement('div'); grip.className = 'tos-resize'; grip.setAttribute('aria-hidden', 'true');
    el.append(bar, content, grip);

    el.addEventListener('pointerdown', () => { if (desktop.focus !== w.id) setDesktop(focusWindow(desktop, w.id)); }, true);
    controls.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest('button')?.dataset.action;
      if (action === 'close') close(w.id);
      else if (action === 'minimize') setDesktop(minimizeWindow(desktop, w.id));
      else if (action === 'maximize') setDesktop(toggleMaximize(desktop, w.id));
    });
    bar.addEventListener('dblclick', (event) => { if (!(event.target as HTMLElement).closest('button')) setDesktop(toggleMaximize(desktop, w.id)); });
    drag(bar, w.id, 'move');
    drag(grip, w.id, 'resize');
    return { el, content, title, dispose: () => {}, ports: [] };
  }

  /** Pointer drags over frames: a shield takes the pointer for the drag's duration. */
  function drag(handle: HTMLElement, id: string, mode: 'move' | 'resize') {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      const current = desktop.windows.find(w => w.id === id);
      if (!current || current.maximized) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, rect: { ...current.rect } };
      const rtl = locale.dir === 'rtl' && mode === 'resize' ? -1 : 1;
      shield.hidden = false; shield.dataset.mode = mode;
      const move = (e: PointerEvent) => {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (mode === 'move') setDesktop(moveWindow(desktop, id, start.rect.x + dx, start.rect.y + dy));
        else setDesktop(resizeWindow(desktop, id, start.rect.w + dx * rtl, start.rect.h + dy));
      };
      const up = () => { shield.hidden = true; shield.removeEventListener('pointermove', move); shield.removeEventListener('pointerup', up); shield.removeEventListener('pointercancel', up); };
      shield.addEventListener('pointermove', move);
      shield.addEventListener('pointerup', up);
      shield.addEventListener('pointercancel', up);
    });
  }

  function open(moduleId: string): string | null {
    const manifest = kernel.effective(moduleId);
    if (!manifest) { report(new Error(`no module '${moduleId}'`)); return null; }
    const before = new Set(desktop.windows.map(w => w.id));
    const title = localized(manifest.title, locale.locale);
    desktop = openWindow(desktop, { module: moduleId, title, ...manifest.window });
    const created = desktop.windows.find(w => !before.has(w.id));
    if (!created) { render(); return desktop.focus; }
    const entry = createWindowElement(created, manifest);
    mounted.set(created.id, entry);
    layer.append(entry.el);
    try { entry.dispose = mountModule(created, manifest, entry); }
    catch (error: any) {
      entry.el.classList.remove('is-loading');
      entry.content.textContent = t('window/failed', { title, detail: String(error?.message ?? error) });
      report(error);
    }
    render();
    return created.id;
  }

  function close(id: string) {
    const entry = mounted.get(id);
    if (entry) { try { entry.dispose(); } catch (error) { report(error); } entry.el.remove(); mounted.delete(id); }
    setDesktop(closeWindow(desktop, id));
  }

  function render() {
    for (const w of stacked(desktop)) {
      const entry = mounted.get(w.id);
      if (!entry) continue;
      const { el } = entry;
      el.style.insetInlineStart = '';
      el.style.left = `${w.rect.x}px`;
      el.style.top = `${w.rect.y}px`;
      el.style.width = `${w.rect.w}px`;
      el.style.height = `${w.rect.h}px`;
      el.style.zIndex = String(w.z);
      el.hidden = w.minimized;
      el.classList.toggle('is-focused', desktop.focus === w.id);
      el.classList.toggle('is-maximized', w.maximized);
      el.setAttribute('aria-label', w.title);
      entry.title.textContent = w.title;
      const max = el.querySelector<HTMLButtonElement>('.tos-maximize');
      if (max) { const label = w.maximized ? t('window/restore') : t('window/maximize'); max.setAttribute('aria-label', label); max.title = label; max.innerHTML = w.maximized ? ICON.restore : ICON.maximize; }
    }
    renderDock();
  }

  // ── dock and mail ─────────────────────────────────────────────────────────
  let dockSignature = '';
  function renderDock(force = false) {
    const signature = JSON.stringify([kernel.modules().map(m => [m.id, localized(m.title, locale.locale), m.icon]), [...new Set(desktop.windows.map(w => w.module))].sort(), kernel.mail().filter(m => !m.read).length, theme.scheme, locale]);
    if (!force && signature === dockSignature) return;
    dockSignature = signature;
    const items = kernel.modules().map(manifest => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'tos-dock-item'; b.dataset.module = manifest.id;
      const title = localized(manifest.title, locale.locale);
      b.setAttribute('aria-label', t('dock/open', { title })); b.title = title;
      const glyph = doc.createElement('span'); glyph.className = 'tos-glyph'; glyph.dataset.glyph = manifest.icon?.glyph ?? 'app';
      if (manifest.icon?.hue !== undefined) glyph.style.setProperty('--hue', String(manifest.icon.hue));
      b.append(glyph);
      if (desktop.windows.some(w => w.module === manifest.id)) b.classList.add('is-running');
      b.addEventListener('click', () => {
        const running = desktop.windows.filter(w => w.module === manifest.id).sort((a, c) => c.z - a.z)[0];
        if (running) setDesktop(focusWindow(desktop, running.id)); else open(manifest.id);
      });
      return b;
    });
    const unread = kernel.mail().filter(m => !m.read).length;
    const mailButton = doc.createElement('button');
    mailButton.type = 'button'; mailButton.className = 'tos-dock-item tos-dock-mail';
    mailButton.setAttribute('aria-label', t('mail/title')); mailButton.title = t('mail/title');
    mailButton.innerHTML = '<span class="tos-glyph" data-glyph="mail"></span>';
    if (unread) { const badge = doc.createElement('span'); badge.className = 'tos-badge'; badge.textContent = String(unread); mailButton.append(badge); }
    mailButton.addEventListener('click', toggleMail);
    const themeButton = doc.createElement('button');
    themeButton.type = 'button'; themeButton.className = 'tos-dock-item tos-dock-theme';
    const label = theme.scheme === 'dark' ? t('tray/theme-light') : t('tray/theme-dark');
    themeButton.setAttribute('aria-label', label); themeButton.title = label;
    themeButton.innerHTML = `<span class="tos-glyph" data-glyph="${theme.scheme === 'dark' ? 'sun' : 'moon'}"></span>`;
    themeButton.addEventListener('click', toggleScheme);
    const separator = doc.createElement('span'); separator.className = 'tos-dock-separator'; separator.setAttribute('aria-hidden', 'true');
    dock.replaceChildren(...items, separator, mailButton, themeButton);
  }

  function toggleMail() { mailPanel.hidden = !mailPanel.hidden; renderMail(); }
  function toggleScheme() {
    const scheme = theme.scheme === 'dark' ? 'light' : 'dark';
    try { applyShellTheme(options.themeFor?.(scheme) ?? DEFAULT_THEMES[scheme]); }
    catch (error) { report(error); applyShellTheme(DEFAULT_THEMES[scheme]); }
    options.onSchemeSwitch?.(scheme);
  }

  // ── context menus ─────────────────────────────────────────────────────────
  // A right click (or the menu key, or Shift+F10) on the desktop, a title bar
  // or a dock item opens the shell's own menu. Inside a window's content the
  // browser's menu stays: a module's text is the module's to copy, and a
  // framed module's clicks never reach this page at all.
  type MenuEntry = { label: string, run: () => void, disabled?: boolean, glyph?: { glyph: string, hue?: number } } | 'separator';
  let menu: { el: HTMLElement, restore: HTMLElement | null } | null = null;

  const windowsOf = (moduleId: string) => desktop.windows.filter(w => w.module === moduleId).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const singleton = (moduleId: string) => kernel.effective(moduleId)?.window?.singleton === true;
  const appGlyph = (manifest: ModuleManifest) => ({ glyph: manifest.icon?.glyph ?? 'app', hue: manifest.icon?.hue });

  function windowMenu(id: string): MenuEntry[] {
    const w = desktop.windows.find(x => x.id === id);
    if (!w) return [];
    return [
      { label: t('window/minimize'), run: () => setDesktop(minimizeWindow(desktop, id)) },
      { label: w.maximized ? t('window/restore') : t('window/maximize'), run: () => setDesktop(toggleMaximize(desktop, id)) },
      ...(singleton(w.module) ? [] : ['separator' as const, { label: t('menu/new-window'), run: () => { open(w.module); } }]),
      'separator',
      { label: t('window/close'), run: () => close(id) },
    ];
  }

  function dockMenu(moduleId: string): MenuEntry[] {
    const manifest = kernel.effective(moduleId);
    if (!manifest) return [];
    const title = localized(manifest.title, locale.locale);
    const running = windowsOf(moduleId);
    const entries: MenuEntry[] = running.map(w => ({ label: w.title, glyph: appGlyph(manifest), run: () => setDesktop(focusWindow(desktop, w.id)) }));
    if (running.length === 0) entries.push({ label: t('dock/open', { title }), run: () => { open(moduleId); } });
    else if (!singleton(moduleId)) entries.push('separator', { label: t('menu/new-window'), run: () => { open(moduleId); } });
    if (running.length) entries.push('separator', { label: running.length === 1 ? t('window/close') : t('menu/close-all'), run: () => { for (const w of windowsOf(moduleId)) close(w.id); } });
    return entries;
  }

  function desktopMenu(): MenuEntry[] {
    const shown = desktop.windows.filter(w => !w.minimized), hidden = desktop.windows.filter(w => w.minimized);
    return [
      ...kernel.modules().map(manifest => ({ label: localized(manifest.title, locale.locale), glyph: appGlyph(manifest), run: () => {
        const top = windowsOf(manifest.id).sort((a, b) => b.z - a.z)[0];
        if (top) setDesktop(focusWindow(desktop, top.id)); else open(manifest.id);
      } })),
      'separator',
      { label: t('menu/show-desktop'), disabled: shown.length === 0, run: () => setDesktop(desktop.windows.reduce((d, w) => minimizeWindow(d, w.id), desktop)) },
      { label: t('menu/show-windows'), disabled: hidden.length === 0, run: () => setDesktop(stacked(desktop).filter(w => w.minimized).reduce((d, w) => focusWindow(d, w.id), desktop)) },
      { label: t('menu/close-all'), disabled: desktop.windows.length === 0, run: () => { for (const w of [...desktop.windows]) close(w.id); } },
      'separator',
      { label: t('mail/title'), run: toggleMail },
      { label: theme.scheme === 'dark' ? t('tray/theme-light') : t('tray/theme-dark'), run: toggleScheme },
    ];
  }

  /** What a right click on this element offers, or null for the browser's own menu. */
  function menuFor(target: HTMLElement): { title: string, entries: MenuEntry[] } | null {
    if (target.closest('.tos-content, .tos-mail')) return null;
    const windowEl = target.closest<HTMLElement>('.tos-window');
    if (windowEl?.dataset.window) {
      const w = desktop.windows.find(x => x.id === windowEl.dataset.window);
      return w ? { title: w.title, entries: windowMenu(w.id) } : null;
    }
    const item = target.closest<HTMLElement>('.tos-dock-item[data-module]');
    if (item?.dataset.module) {
      const manifest = kernel.effective(item.dataset.module);
      return manifest ? { title: localized(manifest.title, locale.locale), entries: dockMenu(manifest.id) } : null;
    }
    return { title: t('desktop/label'), entries: desktopMenu() };
  }

  function closeMenu(returnFocus = false) {
    if (!menu) return;
    const { el, restore } = menu;
    menu = null;
    el.remove();
    if (returnFocus && restore?.isConnected) restore.focus();
  }

  function openMenu(title: string, entries: MenuEntry[], at: { x: number, y: number }, restore: HTMLElement | null) {
    closeMenu();
    const el = doc.createElement('div');
    el.className = 'tos-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', t('menu/label', { title }));
    // no leading, trailing or doubled separators, whatever the entries say
    const tidy = entries.filter((e, i, all) => e !== 'separator' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'separator'));
    for (const entry of tidy) {
      if (entry === 'separator') { const hr = doc.createElement('div'); hr.className = 'tos-menu-separator'; hr.setAttribute('role', 'separator'); el.append(hr); continue; }
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'tos-menu-item'; b.tabIndex = -1;
      b.setAttribute('role', 'menuitem');
      if (entry.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (entry.glyph) {
        const glyph = doc.createElement('span'); glyph.className = 'tos-glyph'; glyph.dataset.glyph = entry.glyph.glyph;
        if (entry.glyph.hue !== undefined) glyph.style.setProperty('--hue', String(entry.glyph.hue));
        b.append(glyph);
      }
      const label = doc.createElement('span'); label.textContent = entry.label; b.append(label);
      // the pointer and the keyboard share one highlighted item
      if (!entry.disabled) b.addEventListener('pointermove', () => { if (doc.activeElement !== b) b.focus({ preventScroll: true }); });
      b.addEventListener('click', () => {
        closeMenu();
        try { entry.run(); } catch (error) { report(error); }
      });
      el.append(b);
    }
    el.addEventListener('keydown', (event) => {
      const items = [...el.querySelectorAll<HTMLButtonElement>('.tos-menu-item:not(:disabled)')];
      const index = items.indexOf(doc.activeElement as HTMLButtonElement);
      const go = (i: number) => { event.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
      if (event.key === 'ArrowDown') go(index + 1);
      else if (event.key === 'ArrowUp') go(index < 0 ? -1 : index - 1);
      else if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(-1);
      else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(true); }
    });
    el.addEventListener('contextmenu', (event) => event.preventDefault());
    el.style.visibility = 'hidden';
    node.append(el);
    // at the pointer, opening towards the line's end (towards the start on a
    // right-to-left desktop) and flipped where it would leave the desktop
    const box = node.getBoundingClientRect(), width = el.offsetWidth, height = el.offsetHeight, margin = 6;
    let x = at.x - box.left, y = at.y - box.top;
    if (locale.dir === 'rtl') { if (x - width >= margin) x -= width; }
    else if (x + width > box.width - margin) x -= width;
    if (y + height > box.height - margin) y -= height;
    el.style.left = `${Math.round(Math.max(margin, Math.min(x, box.width - width - margin)))}px`;
    el.style.top = `${Math.round(Math.max(margin, Math.min(y, box.height - height - margin)))}px`;
    el.style.visibility = '';
    menu = { el, restore };
    el.querySelector<HTMLButtonElement>('.tos-menu-item:not(:disabled)')?.focus({ preventScroll: true });
  }

  const onContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (menu?.el.contains(target)) { event.preventDefault(); return; }
    const offer = menuFor(target);
    if (!offer || offer.entries.length === 0) { closeMenu(); return; }
    event.preventDefault();
    // the menu key and Shift+F10 fire with no pointer position: anchor on the element
    let at = { x: event.clientX, y: event.clientY };
    if (event.button !== 2 && at.x === 0 && at.y === 0) {
      const r = (target.closest('.tos-titlebar, .tos-dock-item') ?? target).getBoundingClientRect();
      at = { x: r.left + Math.min(24, r.width / 2), y: r.bottom };
    }
    const active = doc.activeElement;
    openMenu(offer.title, offer.entries, at, active && active !== doc.body ? active as HTMLElement : null);
  };
  const onOutside = (event: Event) => { if (menu && !menu.el.contains(event.target as Node)) closeMenu(); };
  const onMenuBlur = () => closeMenu();
  node.addEventListener('contextmenu', onContextMenu);
  doc.addEventListener('pointerdown', onOutside, true);
  win.addEventListener('blur', onMenuBlur);
  win.addEventListener('resize', onMenuBlur);

  function renderMail() {
    if (mailPanel.hidden) return;
    const heading = doc.createElement('h2'); heading.textContent = t('mail/title');
    const list = doc.createElement('ul');
    const items = kernel.mail().reverse();
    if (items.length === 0) { const empty = doc.createElement('p'); empty.className = 'tos-muted'; empty.textContent = t('mail/empty'); mailPanel.replaceChildren(heading, empty); return; }
    for (const item of items) {
      const li = doc.createElement('li'); li.className = item.read ? 'is-read' : '';
      const subject = doc.createElement('strong'); subject.textContent = item.subject;
      const sender = kernel.effective(item.from);
      const from = doc.createElement('span'); from.className = 'tos-muted'; from.textContent = t('mail/from', { sender: sender ? localized(sender.title, locale.locale) : item.from });
      li.append(subject, from);
      if (item.body) { const body = doc.createElement('p'); body.textContent = item.body; li.append(body); }
      list.append(li);
      if (!item.read) kernel.markRead(item.id);
    }
    mailPanel.replaceChildren(heading, list);
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  const unsubscribe = kernel.subscribe((event) => {
    if (event.kind === 'mail') { renderDock(); renderMail(); }
    if (event.kind === 'modules') renderDock();
  });
  const onKey = (event: MessageEvent) => {
    const type = (event.data as any)?.type;
    if (type !== KEY && type !== FOCUS) return;
    const source = [...mounted].find(([, m]) => m.frame?.contentWindow === event.source);
    if (!source) return;
    if (type === FOCUS) { if (desktop.focus !== source[0]) setDesktop(focusWindow(desktop, source[0])); return; }
    if ((event.data as any).key?.endsWith('+k')) (dock.querySelector('.tos-dock-item') as HTMLElement | null)?.focus();
  };
  win.addEventListener('message', onKey);
  // a click inside a framed window goes to the frame, not the shell: when
  // focus moves into a frame, raise the window that holds it
  const onBlur = () => win.setTimeout(() => {
    const active = doc.activeElement;
    if (active?.tagName !== 'IFRAME') return;
    for (const [id, entry] of mounted) if (entry.frame === active && desktop.focus !== id) setDesktop(focusWindow(desktop, id));
  }, 0);
  win.addEventListener('blur', onBlur);
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => setDesktop(setViewport(desktop, { w: node.clientWidth, h: node.clientHeight }))) : null;
  observer?.observe(node);

  applyShellTheme(theme);
  applyShellLocale(locale);

  return {
    open,
    close,
    focus: (id: string) => setDesktop(focusWindow(desktop, id)),
    minimize: (id: string) => setDesktop(minimizeWindow(desktop, id)),
    maximize: (id: string) => setDesktop(toggleMaximize(desktop, id)),
    move: (id: string, x: number, y: number) => setDesktop(moveWindow(desktop, id, x, y)),
    state: (): Desktop => JSON.parse(JSON.stringify(desktop)),
    setTheme: applyShellTheme,
    setLocale: applyShellLocale,
    theme: () => theme,
    /** The framed module's own context row, for the assistant. */
    context: (id: string) => mounted.get(id)?.moduleClient?.invoke('module.context', {}),
    dispose() {
      unsubscribe(); observer?.disconnect(); win.removeEventListener('message', onKey); win.removeEventListener('blur', onBlur);
      closeMenu(); node.removeEventListener('contextmenu', onContextMenu); doc.removeEventListener('pointerdown', onOutside, true);
      win.removeEventListener('blur', onMenuBlur); win.removeEventListener('resize', onMenuBlur);
      for (const id of [...mounted.keys()]) close(id);
      node.replaceChildren(); node.classList.remove('tos');
    },
  };
}

export type DesktopHandle = ReturnType<typeof mountDesktop>;
