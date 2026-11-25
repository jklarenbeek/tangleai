/**
 * The desktop shell: renders the window document, hosts each module in its
 * window, and connects framed modules to the kernel over ports. Shipped code,
 * so it may use the DOM directly; what it shows comes from the kernel's
 * manifests, the theme document and the message catalogue.
 */
import type { ResizeEdge } from './windows.ts';
import { checkMenu, menuPoint, type MenuDocument, type MenuItem, type MenuPoint } from './menu.ts';
import { openPortClientLazily, loadPorts, portsLoaded } from './ports.ts';
import { joinSuite, type SuiteDocument, type JoinResult } from './install-sheet.ts';
export type { SuiteDocument, JoinResult } from './install-sheet.ts';
import { isLocalOrigin } from './consent.ts';
import { originHostProblem } from './shell-origin.ts';
import { localized, type ModuleManifest } from './manifest.ts';
import { CONNECT, FOCUS, HELLO, KEY, PROTOCOL, systemContracts, type ConnectMessage } from './contracts.ts';
import { DEFAULT_THEMES, checkTheme, type ThemeDocument } from './theme.ts';
import { patternBackground } from './wallpaper.ts';
import { createOsMessages, type OsCatalogue } from './messages.ts';
import { applyTheme, applyLocale } from './apply.ts';
import {
  closeWindow, emptyDesktop, focusWindow, isVisible, minimizeWindow, moveWindow, openWindow, resizeDesktop, resizeWindow, resizeWindowFrom, setTitle, stacked, toggleMaximize,
  type Desktop, type WindowState,
} from './windows.ts';
import type { Kernel, Decider } from './kernel.ts';
import type { OpenedFile } from './module.ts';
import { HEADER_CONTRACT, HEADER_GLYPHS, fitHeader, headerItems, type Header, type HeaderHandler, type HeaderItem, type HeaderMenu } from './header.ts';
import { arrangeDock, dockIcons, folderTitles, groupInDock, hideInDock, moveInDock, renameDockFolder, showInDock, type DockIcon, type DockLayout } from './dock.ts';

export type ShippedContext = {
  module: ModuleManifest;
  window: string;
  call(contract: string, op: string, input?: unknown): ReturnType<Kernel['call']>;
  sendMail(envelope: { to?: string, subject: string, body?: string, data?: unknown }): void;
  setTitle(title: string): void;
  provide(contract: unknown, handlers: Record<string, (input: any) => unknown>): void;
  locale: string;
  dir: 'ltr' | 'rtl';
  /** Whether the window is on screen: not minimized, and on a compact desktop the focused one. */
  readonly visible: boolean;
  /** Called when the window is hidden or shown again, so a module can pause what only matters on screen. */
  onVisibility(listener: (visible: boolean) => void): () => void;
  /** The desktop's theme now: tokens and scheme. */
  readonly theme: { tokens: Record<string, string>, scheme?: 'light' | 'dark' };
  /** Open the desktop's Settings at this module's own section. */
  openSettings(): void;
  /** File a proposal in the desktop's inbox (the same id again replaces it). */
  propose(proposal: { id: string, kind: string, title: string, summary?: string, payload?: unknown, evidence?: { label: string, href?: string }[], revision?: string, origin?: 'human' | 'rule' | 'import' | 'ai', answer?: { schema: Record<string, unknown> | boolean, label?: string } }): ReturnType<Kernel['propose']>;
  /** Take back a pending proposal. */
  withdraw(id: string): ReturnType<Kernel['withdrawProposal']>;
  /** Where the person's decisions on this module's proposals arrive while its window is open; return `{ refused }` to keep one pending. */
  onDecision(handler: Decider): () => void;
  /** Put buttons, toggles, menus, tabs and a search field in the window's title bar (`null` takes them away); refused with `OS0113` when it does not match the header schema. */
  setHeader(header: Header | null): void;
  /** Where uses of the header bar arrive (by the person or a granted caller); return `{ refused }` to say it was not done. */
  onHeader(handler: HeaderHandler): () => void;
  /** The screen of the launch entry the window was opened from, if any. */
  readonly screen?: string;
  /** Called when the person opens one of the module's launch entries while this window is open. */
  onScreen(listener: (screen: string) => void): () => void;
  /** The window's default right-click menu (`null` takes it away); refused with `OS0170` when it does not match the menu schema. A right-click the module handles itself (`preventDefault`) does not show it. */
  setContextMenu(menu: MenuDocument | null): void;
  /** Where a choice from the default right-click menu arrives. */
  onContextMenu(handler: (id: string) => void): () => void;
  /** Show a menu for one target at a point of the page; answers the chosen id, or null when the person dismissed it. */
  menu(items: MenuDocument, at: MenuPoint): Promise<string | null>;
  /** Where files the person opens with this module arrive (from the desktop's Files); return `{ refused }` to say why not. */
  onOpen(handler: (file: OpenedFile) => { refused?: string } | void | Promise<{ refused?: string } | void>): () => void;
  /** Hand a file to another module, as the person asked (Files' "Open in …"): its window opens if it is not running. */
  openFile(module: string, file: OpenedFile): Promise<{ refused?: string }>;
};
/**
 * What happened to a window, with its state after it: a host that subscribes
 * before the first `open` can rebuild `state().windows` and `focus` from these
 * alone. `restored` is a window leaving minimized or maximized.
 */
export type DesktopEvent = {
  type: 'opened' | 'closed' | 'focused' | 'minimized' | 'restored' | 'maximized' | 'moved' | 'resized' | 'retitled'
    /** The module is running in it (a framed one has connected, again after it reloads); `failed`: it could not start, or did not answer in time. */
    | 'ready' | 'failed',
  window: string, module: string, state: WindowState,
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
  /**
   * A desktop narrower than `below` pixels is compact (a phone): every
   * window opens maximized and only the focused one is shown. The dock never
   * leaves the desktop at any width: its tiles shrink to fit, then it scrolls.
   */
  compact?: { below: number };
  /**
   * What the dock carries after the modules: the mail tile and the light/dark
   * switch (both by default), and a brand mark at its start, which is not a
   * module and takes no keyboard stop.
   */
  tray?: { mail?: boolean, theme?: boolean, brand?: { label: string, src?: string, node?: HTMLElement } };
  /**
   * How long a framed module has to say hello (15 s by default). Past it the
   * window says so and offers to try again, and the shell holds nothing open
   * for it; a module that answers later still connects.
   */
  connectTimeoutMs?: number;
  /** The module that is the desktop's Settings (`settings` by default, as `@tangleai/os/settings` installs it). */
  settings?: string;
  /** Defaults to the node's owner window. */
  window?: Window;
  onError?: (error: unknown) => void;
};

/** A window's header bar as drawn: its rows, the item elements by id, and what the narrow bar moved into "more". */
type HeaderBar = {
  bar: HTMLElement, start: HTMLElement, center: HTMLElement, end: HTMLElement, more: HTMLButtonElement, subtitle: HTMLElement, titleBox: HTMLElement,
  items: Map<string, HTMLElement>, overflow: string[], fitted: number, search?: any,
};
type PendingOpen = { file: OpenedFile, settle: (answer: { refused?: string }) => void };
type Mounted = { contextMenu?: MenuDocument | null, menuHandlers?: Set<(id: string) => void>, el: HTMLElement, content: HTMLElement, title: HTMLElement, dispose: () => void, frame?: HTMLIFrameElement, moduleClient?: any, ports: MessagePort[], served?: { close?: () => void }, connected?: boolean, releaseDecider?: () => void, header: HeaderBar, releaseHeader?: () => void, screen?: string, screens: Set<(screen: string) => void>, opens: PendingOpen[], openHandler?: (file: OpenedFile) => unknown };

const svg = (path: string) => `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON = { close: svg('M4 4l8 8M12 4l-8 8'), minimize: svg('M4 8h8'), maximize: svg('M4.5 4.5h7v7h-7z'), restore: svg('M6 4h6v6M4 6h6v6H4z') };
/** A header glyph from the desktop's own set: never markup an application sent. */
const headerGlyph = (name: string | undefined) => name && Object.hasOwn(HEADER_GLYPHS, name)
  ? `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="${HEADER_GLYPHS[name as keyof typeof HEADER_GLYPHS]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  : '';
/** What a press in the title bar leaves to the element under it instead of dragging or maximizing the window. */
const INTERACTIVE = 'button, input, select, textarea, a[href], [role="tab"]';

export { originHostProblem } from './shell-origin.ts';

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
  /** The dock says when it scrolls (a phone, many modules), so its tray can cover the tiles that pass beneath. */
  const syncDockScroll = () => dock.classList.toggle('is-scrolling', dock.scrollWidth > dock.clientWidth + 1);
  win.addEventListener('resize', syncDockScroll);
  const mailPanel = doc.createElement('section'); mailPanel.className = 'tos-mail'; mailPanel.hidden = true; mailPanel.setAttribute('aria-label', t('mail/title'));
  node.replaceChildren(wallpaper, layer, shield, mailPanel, dock);

  // ── events ────────────────────────────────────────────────────────────────
  const listeners = new Set<(event: DesktopEvent) => void>();
  const visibility = new Map<string, { visible: boolean, listeners: Set<(visible: boolean) => void> }>();
  const copy = (w: WindowState): WindowState => JSON.parse(JSON.stringify(w));
  function changes(prev: Desktop, next: Desktop): DesktopEvent[] {
    const out: DesktopEvent[] = [];
    const push = (type: DesktopEvent['type'], w: WindowState) => out.push({ type, window: w.id, module: w.module, state: copy(w) });
    const before = new Map(prev.windows.map(w => [w.id, w]));
    for (const w of next.windows) {
      const was = before.get(w.id);
      if (!was) { push('opened', w); continue; }
      if (!was.minimized && w.minimized) push('minimized', w);
      else if (was.minimized && !w.minimized) push('restored', w);
      if (!was.maximized && w.maximized) push('maximized', w);
      else if (was.maximized && !w.maximized) push('restored', w);
      else {
        if (was.rect.x !== w.rect.x || was.rect.y !== w.rect.y) push('moved', w);
        if (was.rect.w !== w.rect.w || was.rect.h !== w.rect.h) push('resized', w);
      }
      if (was.title !== w.title) push('retitled', w);
    }
    for (const was of prev.windows) if (!next.windows.some(w => w.id === was.id)) push('closed', was);
    const focused = next.focus !== prev.focus || next.windows.find(w => w.id === next.focus)?.z !== prev.windows.find(w => w.id === next.focus)?.z
      ? next.windows.find(w => w.id === next.focus) : undefined;
    if (focused) push('focused', focused);
    return out;
  }
  /** Every change of the desktop goes through here: it renders, tells modules what is on screen, and reports. */
  function setDesktop(next: Desktop) {
    const prev = desktop;
    desktop = next;
    render();
    for (const [id, entry] of visibility) {
      const w = desktop.windows.find(x => x.id === id);
      const visible = w ? isVisible(desktop, w) : false;
      if (visible === entry.visible) continue;
      entry.visible = visible;
      for (const listener of [...entry.listeners]) { try { listener(visible); } catch (error) { report(error); } }
    }
    if (listeners.size) for (const event of changes(prev, next)) tell(event);
  }
  function tell(event: DesktopEvent) { for (const listener of [...listeners]) { try { listener(event); } catch (error) { report(error); } } }
  /** A module's lifecycle in its window, reported beside the window changes. */
  function lifecycle(type: 'ready' | 'failed', id: string) {
    const w = desktop.windows.find(x => x.id === id);
    if (w) tell({ type, window: w.id, module: w.module, state: copy(w) });
  }
  const resized = (d: Desktop, viewport: Desktop['viewport']) => resizeDesktop(d, viewport, options.compact !== undefined && viewport.w < options.compact.below);

  // ── theme and language ────────────────────────────────────────────────────
  function applyShellTheme(next: ThemeDocument) {
    const problems = checkTheme(next);
    if (problems.length) throw new Error(`the theme is refused: ${problems.join('; ')}`);
    theme = next;
    applyTheme(node, { tokens: next.tokens, scheme: next.scheme });
    // a procedural wallpaper is drawn from the theme's colours and seed; any other value is CSS
    const tk = next.tokens;
    wallpaper.style.background = patternBackground(tk) ?? '';
    for (const m of mounted.values()) m.moduleClient?.invoke('module.theme', { tokens: next.tokens, scheme: next.scheme });
    renderDock();
  }
  function applyShellLocale(next: { locale: string, dir: 'ltr' | 'rtl' }) {
    locale = next;
    applyLocale(node, next);
    for (const m of mounted.values()) m.moduleClient?.invoke('module.locale', next);
    for (const m of mounted.values()) m.header.fitted = -1;
    render(); renderDock();
  }

  // ── hosting ───────────────────────────────────────────────────────────────
  function connectFrame(w: WindowState, manifest: ModuleManifest, frame: HTMLIFrameElement, entry: Mounted) {
    const targetOrigin = manifest.host.kind === 'origin' ? new URL(manifest.host.url).origin : '*';
    const expected = manifest.host.kind === 'origin' ? targetOrigin : 'null';
    let deadline: any, notice: HTMLElement | null = null;
    /** Close what an earlier connection of this window held. */
    const release = () => {
      kernel.withdraw(manifest.id, w.id);
      entry.releaseDecider?.(); entry.releaseDecider = undefined;
      // a frame that reloads draws its header again; until then the bar has none
      entry.releaseHeader?.(); entry.releaseHeader = undefined;
      kernel.setHeader(manifest.id, w.id, null);
      try { entry.served?.close?.(); } catch (error) { report(error); }
      for (const port of entry.ports) port.close();
      entry.ports = []; entry.served = undefined; entry.moduleClient = undefined; entry.connected = false;
    };
    const unanswered = () => {
      if (entry.connected) return;
      release();
      entry.el.classList.remove('is-loading'); entry.el.classList.add('is-failed');
      notice?.remove();
      notice = doc.createElement('div'); notice.className = 'tos-notice'; notice.setAttribute('role', 'alert');
      const text = doc.createElement('p'); text.textContent = t('window/unanswered', { title: localized(manifest.title, locale.locale) });
      notice.append(text);
      // a page on this device or the local network may wait for the browser's permission, or have been refused it
      if (manifest.host.kind === 'origin' && isLocalOrigin(targetOrigin) && !isLocalOrigin(win.location?.origin ?? null)) {
        const hint = doc.createElement('p'); hint.className = 'tos-muted'; hint.textContent = t('window/local-network');
        notice.append(hint);
      }
      const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = t('window/retry');
      retry.addEventListener('click', () => {
        notice?.remove(); notice = null;
        entry.el.classList.remove('is-failed'); entry.el.classList.add('is-loading');
        arm();
        frame.src = frame.src;
      });
      notice.append(retry);
      entry.content.append(notice);
      lifecycle('failed', w.id);
    };
    const arm = () => { win.clearTimeout(deadline); deadline = win.setTimeout(unanswered, options.connectTimeoutMs ?? 15_000); };
    const onHello = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || (event.data as any)?.type !== HELLO) return;
      if (event.origin !== expected) { report(new Error(`${manifest.id}: a frame of origin ${event.origin} answered for ${expected}`)); return; }
      win.clearTimeout(deadline);
      // the transport arrives with the first framed window; a failed fetch is this window's failure, and Retry fetches again
      if (!portsLoaded()) {
        loadPorts().then(() => { if (frame.isConnected) connect(); }, (error) => { report(error); if (frame.isConnected) unanswered(); });
        return;
      }
      connect();
    };
    const connect = () => {
      // a frame that reloaded says hello again: it starts over on fresh ports
      if (entry.connected || entry.ports.length) release();
      notice?.remove(); notice = null; entry.el.classList.remove('is-failed');
      const os = new MessageChannel(), control = new MessageChannel();
      const provided = (manifest.provides ?? []).map(contract => ({ contract, channel: new MessageChannel() }));
      entry.served = kernel.serveModule(manifest.id, os.port1, {
        setTitle: (title) => setDesktop(setTitle(desktop, w.id, title)), openSettings: () => openSettings(manifest.id), window: w.id,
        // a framed page's point is its own: the frame's place on the page turns it into the desktop's
        menu: async (items, at, check) => {
          const checked = checkMenu(items);
          if (!checked.ok) return { refused: checked.error };
          if (check) return { id: null };
          const r = entry.frame?.getBoundingClientRect(), p = menuPoint(at);
          return { id: await showAppMenu(w.id, checked.value, { x: p.x + (r?.left ?? 0), y: p.y + (r?.top ?? 0) }) };
        },
      });
      os.port1.start();
      const moduleClient = openPortClientLazily(systemContracts().module, { channel: control.port1, timeoutMs: 10_000 });
      control.port1.start();
      for (const { contract, channel } of provided) {
        try { kernel.connectProvider(manifest.id, contract, channel.port1, 10_000, w.id); }
        catch (error) { report(error); }
      }
      entry.moduleClient = moduleClient;
      // uses of the header bar go over the same control channel
      entry.releaseHeader = kernel.registerHeaderHandler(manifest.id, w.id, async (activation) => {
        const outcome: any = await moduleClient.invoke('module.header', activation);
        if (outcome?.ok === false) throw new Error(outcome.error?.message ?? 'the application did not take it');
        return outcome?.ok === true ? outcome.value : outcome;
      });
      // the person's decisions on this module's proposals go over its own control channel, never the bus
      entry.releaseDecider = kernel.registerDecider(manifest.id, w.id, async (decision) => {
        const outcome: any = await moduleClient.invoke('module.decide', decision);
        if (outcome?.ok === false) throw new Error(outcome.error?.message ?? 'the application did not take the decision');
        return outcome?.ok === true ? outcome.value : outcome;
      });
      entry.ports.push(os.port1, control.port1, ...provided.map(p => p.channel.port1));
      const message: ConnectMessage = {
        type: CONNECT, protocol: PROTOCOL, module: manifest.id,
        ports: ['os', 'module', ...provided.map(p => p.contract.id)],
        theme: { tokens: theme.tokens, scheme: theme.scheme }, locale,
        ...(entry.screen !== undefined ? { screen: entry.screen } : {}),
        ...(manifest.host.kind === 'document' ? { document: { app: manifest.host.app, ...(manifest.styles ? { styles: manifest.styles } : {}) } } : {}),
      };
      frame.contentWindow!.postMessage(message, targetOrigin, [os.port2, control.port2, ...provided.map(p => p.channel.port2)]);
      entry.connected = true;
      entry.el.classList.remove('is-loading');
      lifecycle('ready', w.id);
      deliverOpens(entry);
    };
    win.addEventListener('message', onHello);
    arm();
    return () => { win.clearTimeout(deadline); win.removeEventListener('message', onHello); };
  }

  function mountModule(w: WindowState, manifest: ModuleManifest, entry: Mounted) {
    const host = manifest.host;
    if (host.kind === 'shipped') {
      const mount = options.shipped?.[host.mount];
      if (!mount) throw new Error(`no shipped component '${host.mount}'`);
      const seen = { visible: isVisible(desktop, w), listeners: new Set<(visible: boolean) => void>() };
      visibility.set(w.id, seen);
      const dispose = mount(entry.content, {
        module: manifest, window: w.id, locale: locale.locale, dir: locale.dir,
        get visible() { return seen.visible; },
        get theme() { return { tokens: { ...theme.tokens }, scheme: theme.scheme }; },
        openSettings: () => openSettings(manifest.id),
        propose: (proposal) => kernel.propose(manifest.id, proposal),
        withdraw: (id) => kernel.withdrawProposal(manifest.id, id),
        onDecision: (handler) => { entry.releaseDecider?.(); return (entry.releaseDecider = kernel.registerDecider(manifest.id, w.id, handler)); },
        onVisibility: (listener) => { seen.listeners.add(listener); return () => { seen.listeners.delete(listener); }; },
        call: (contract, op, input) => kernel.call(manifest.id, contract, op, input),
        sendMail: (envelope) => { kernel.sendMail(manifest.id, envelope); },
        setTitle: (title) => setDesktop(setTitle(desktop, w.id, title)),
        setHeader: (header) => { const outcome = kernel.setHeader(manifest.id, w.id, header); if (!outcome.ok) throw Object.assign(new Error(outcome.error.message), { code: outcome.error.code }); },
        onHeader: (handler) => { entry.releaseHeader?.(); return (entry.releaseHeader = kernel.registerHeaderHandler(manifest.id, w.id, handler)); },
        screen: entry.screen,
        onScreen: (listener) => { entry.screens.add(listener); return () => { entry.screens.delete(listener); }; },
        onOpen: (handler) => { entry.openHandler = handler; deliverOpens(entry); return () => { if (entry.openHandler === handler) entry.openHandler = undefined; }; },
        openFile: (module, file) => openFile(module, file),
        provide: (contract, handlers) => kernel.provideLocal(manifest.id, contract, handlers, w.id),
        setContextMenu: (items) => {
          if (items === null) { entry.contextMenu = null; return; }
          const checked = checkMenu(items);
          if (!checked.ok) throw Object.assign(new Error(checked.error.message), { code: checked.error.code });
          entry.contextMenu = checked.value;
        },
        onContextMenu: (handler) => { (entry.menuHandlers ??= new Set()).add(handler); return () => { entry.menuHandlers?.delete(handler); }; },
        menu: (items, at) => {
          const checked = checkMenu(items);
          if (!checked.ok) return Promise.reject(Object.assign(new Error(checked.error.message), { code: checked.error.code }));
          return showAppMenu(w.id, checked.value, menuPoint(at));
        },
      });
      entry.el.classList.remove('is-loading');
      lifecycle('ready', w.id);
      return () => { visibility.delete(w.id); dispose?.(); kernel.withdraw(manifest.id, w.id); entry.releaseDecider?.(); };
    }
    // a framed module talks over ports: fetch that transport while its page loads
    loadPorts().catch(() => { /* the hello retries the fetch and reports it */ });
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
    return () => { stop(); kernel.withdraw(manifest.id, w.id); entry.releaseDecider?.(); try { entry.served?.close?.(); } catch { /* closing */ } for (const port of entry.ports) port.close(); frame.remove(); };
  }

  // ── windows ───────────────────────────────────────────────────────────────
  function createWindowElement(w: WindowState, manifest: ModuleManifest): Mounted {
    const el = doc.createElement('section');
    // the opening animation plays once, not again when the window is shown or restored
    el.className = 'tos-window is-loading is-opening';
    el.addEventListener('animationend', (event) => { if (event.target === el) el.classList.remove('is-opening'); });
    el.dataset.window = w.id;
    el.dataset.module = w.module;
    // a window is a labelled region of the desktop, not a modal dialog
    el.setAttribute('role', 'region');
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
    // the header bar's rows sit around the title; empty rows take no room
    const row = (name: string) => { const r = doc.createElement('div'); r.className = `tos-hb-row tos-hb-${name}`; return r; };
    const start = row('start'), center = row('center'), end = row('end');
    const titleBox = doc.createElement('div'); titleBox.className = 'tos-titlebox';
    const subtitle = doc.createElement('p'); subtitle.className = 'tos-subtitle'; subtitle.hidden = true;
    titleBox.append(title, subtitle);
    const more = doc.createElement('button'); more.type = 'button'; more.className = 'tos-hb-item tos-hb-more'; more.dataset.more = '';
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-label', t('window/more')); more.title = t('window/more');
    more.innerHTML = headerGlyph('more'); more.hidden = true;
    bar.append(glyph, start, titleBox, center, end, more, controls);
    const header: HeaderBar = { bar, start, center, end, more, subtitle, titleBox, items: new Map(), overflow: [], fitted: -1 };
    const content = doc.createElement('div'); content.className = 'tos-content';
    // every edge and corner resizes; the edges are on screen (north is up), whatever the language's direction
    const grips = (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map(edge => {
      const grip = doc.createElement('div'); grip.className = 'tos-resize'; grip.dataset.edge = edge; grip.setAttribute('aria-hidden', 'true');
      return grip;
    });
    el.append(bar, content, ...grips);
    wireHeader(w.id, header);

    el.addEventListener('pointerdown', () => { if (desktop.focus !== w.id) setDesktop(focusWindow(desktop, w.id)); }, true);
    controls.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest('button')?.dataset.action;
      if (action === 'close') close(w.id);
      else if (action === 'minimize') setDesktop(minimizeWindow(desktop, w.id));
      else if (action === 'maximize') setDesktop(toggleMaximize(desktop, w.id));
    });
    bar.addEventListener('dblclick', (event) => { if (!(event.target as HTMLElement).closest(INTERACTIVE)) setDesktop(toggleMaximize(desktop, w.id)); });
    drag(bar, w.id, 'move');
    for (const grip of grips) drag(grip, w.id, 'resize', grip.dataset.edge as ResizeEdge);
    return { el, content, title, dispose: () => {}, ports: [], header, screens: new Set(), opens: [] };
  }

  /** Pointer drags over frames: a shield takes the pointer for the drag's duration. */
  function drag(handle: HTMLElement, id: string, mode: 'move' | 'resize', edge: ResizeEdge = 'se') {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest(INTERACTIVE)) return;
      const current = desktop.windows.find(w => w.id === id);
      if (!current || current.maximized) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, rect: { ...current.rect } };
      shield.hidden = false; shield.dataset.mode = mode;
      // the pointer keeps the handle's own arrow over frames while it drags
      shield.style.cursor = mode === 'resize' ? win.getComputedStyle(handle).cursor : '';
      const move = (e: PointerEvent) => {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (mode === 'move') setDesktop(moveWindow(desktop, id, start.rect.x + dx, start.rect.y + dy));
        else setDesktop(resizeWindowFrom(desktop, id, edge, start.rect, dx, dy));
      };
      const up = () => { shield.hidden = true; shield.removeEventListener('pointermove', move); shield.removeEventListener('pointerup', up); shield.removeEventListener('pointercancel', up); };
      shield.addEventListener('pointermove', move);
      shield.addEventListener('pointerup', up);
      shield.addEventListener('pointercancel', up);
    });
  }

  /** Open a module (at one of its screens, for a launch entry). */
  function open(moduleId: string, screen?: string): string | null {
    const manifest = kernel.effective(moduleId);
    if (!manifest) { report(new Error(`no module '${moduleId}'`)); return null; }
    const before = new Set(desktop.windows.map(w => w.id));
    const title = localized(manifest.title, locale.locale);
    const next = openWindow(desktop, { module: moduleId, title, ...manifest.window });
    const created = next.windows.find(w => !before.has(w.id));
    if (!created) { setDesktop(next); return desktop.focus; }
    const entry = createWindowElement(created, manifest);
    if (screen !== undefined) entry.screen = screen;
    mounted.set(created.id, entry);
    layer.append(entry.el);
    // the window is on the desktop before its module mounts, so the module may retitle it at once
    setDesktop(next);
    try { entry.dispose = mountModule(created, manifest, entry); }
    catch (error: any) {
      entry.el.classList.remove('is-loading');
      entry.content.textContent = t('window/failed', { title, detail: String(error?.message ?? error) });
      report(error);
      lifecycle('failed', created.id);
    }
    return created.id;
  }

  /** Show one screen in an open window: a launch entry opened while its module runs. */
  function showScreen(id: string, screen: string) {
    const entry = mounted.get(id);
    if (!entry) return;
    entry.screen = screen;
    if (entry.frame) entry.moduleClient?.invoke('module.screen', { screen }).catch((error: unknown) => report(error));
    else for (const listener of [...entry.screens]) { try { listener(screen); } catch (error) { report(error); } }
  }

  /** Hand the files waiting for a window to its module, once it can take them. */
  function deliverOpens(entry: Mounted) {
    const ready = entry.frame ? entry.connected && entry.moduleClient : entry.openHandler;
    if (!ready) return;
    for (const pending of entry.opens.splice(0)) {
      const run = entry.frame
        ? entry.moduleClient.invoke('module.open', pending.file).then((outcome: any) => outcome?.ok === false ? { refused: outcome.error?.message ?? 'not opened' } : (outcome?.ok === true ? outcome.value : outcome) ?? {})
        : Promise.resolve().then(() => entry.openHandler!(pending.file)).then((answer: any) => answer && typeof answer.refused === 'string' ? { refused: answer.refused } : {});
      run.then(pending.settle, (error: any) => pending.settle({ refused: String(error?.message ?? error) }));
    }
  }

  /**
   * Hand a file to a module as the person asked: to its open window (raised),
   * or to a window opened for it. The answer says whether it was opened.
   */
  function openFile(moduleId: string, file: OpenedFile): Promise<{ refused?: string }> {
    const manifest = kernel.effective(moduleId);
    if (!manifest) return Promise.resolve({ refused: `no module '${moduleId}'` });
    const running = desktop.windows.filter(w => w.module === moduleId).sort((a, c) => c.z - a.z)[0];
    const id = running ? running.id : open(moduleId);
    if (!id) return Promise.resolve({ refused: `'${moduleId}' could not start` });
    if (running) setDesktop(focusWindow(desktop, running.id));
    const entry = mounted.get(id);
    if (!entry) return Promise.resolve({ refused: `'${moduleId}' could not start` });
    return new Promise((settle) => { entry.opens.push({ file, settle }); deliverOpens(entry); });
  }

  /** What a dock icon does: raise the module's window (at the icon's screen), or open it. */
  function launch(icon: DockIcon) {
    const running = desktop.windows.filter(w => w.module === icon.module).sort((a, c) => c.z - a.z)[0];
    if (!running) { open(icon.module, icon.screen); return; }
    setDesktop(focusWindow(desktop, running.id));
    if (icon.screen !== undefined) showScreen(running.id, icon.screen);
  }

  /**
   * Open the desktop's Settings, at a module's own section when one is
   * named: the one place every application's settings are found.
   */
  function openSettings(moduleId?: string) {
    const settingsId = options.settings ?? 'settings';
    if (!kernel.effective(settingsId)) { report(new Error(`no Settings module '${settingsId}' is installed`)); return; }
    const running = desktop.windows.find(w => w.module === settingsId);
    if (running) setDesktop(focusWindow(desktop, running.id)); else open(settingsId);
    if (moduleId) kernel.call('shell', 'tangle_os_settings', 'settings.show', { section: `module:${moduleId}` }).then(outcome => { if (!outcome.ok) report(new Error(outcome.error.message)); });
  }

  function close(id: string) {
    const entry = mounted.get(id);
    if (entry) {
      try { entry.dispose(); } catch (error) { report(error); }
      entry.releaseHeader?.(); entry.releaseHeader = undefined;
      const module = desktop.windows.find(x => x.id === id)?.module;
      if (module) kernel.setHeader(module, id, null);
      win.clearTimeout(entry.header.search?.timer);
      for (const pending of entry.opens.splice(0)) pending.settle({ refused: 'the window closed' });
      entry.el.remove(); mounted.delete(id);
    }
    setDesktop(closeWindow(desktop, id));
  }

  function render() {
    node.classList.toggle('is-compact', desktop.compact === true);
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
      el.hidden = !isVisible(desktop, w);
      el.classList.toggle('is-focused', desktop.focus === w.id);
      el.classList.toggle('is-maximized', w.maximized);
      el.setAttribute('aria-label', w.title);
      entry.title.textContent = w.title;
      if (entry.header.fitted !== w.rect.w && !el.hidden) fitSoon(w.id);
      const max = el.querySelector<HTMLButtonElement>('.tos-maximize');
      if (max) { const label = w.maximized ? t('window/restore') : t('window/maximize'); max.setAttribute('aria-label', label); max.title = label; max.innerHTML = w.maximized ? ICON.restore : ICON.maximize; }
    }
    renderDock();
  }

  // ── dock and mail ─────────────────────────────────────────────────────────
  let dockSignature = '';
  // The dock is the person's document (`kernel.dock()`), arranged over the
  // installed modules' icons: modules, their launch entries and folders. In
  // edit mode the person moves icons (drag, or Alt with the arrow keys),
  // drops one on another to make a folder, hides and shows them; every one of
  // those is also in the tile's menu.
  let editing = false, dragging = false, openFolderId: string | null = null;
  const folderPanel = doc.createElement('div');
  folderPanel.className = 'tos-dock-folder-panel'; folderPanel.hidden = true; folderPanel.setAttribute('role', 'dialog');
  node.append(folderPanel);
  const dockState = () => {
    const manifests = kernel.modules();
    return arrangeDock(kernel.dock(), dockIcons(manifests, locale.locale), folderTitles(manifests, locale.locale), t('dock/folder'));
  };
  const saveDock = (next: DockLayout) => { const outcome = kernel.setDock(next); if (!outcome.ok) report(new Error(outcome.error.message)); };
  const glyphOf = (icon: { glyph: string, hue?: number } | undefined) => {
    const glyph = doc.createElement('span'); glyph.className = 'tos-glyph'; glyph.dataset.glyph = icon?.glyph ?? 'app';
    if (icon?.hue !== undefined) glyph.style.setProperty('--hue', String(icon.hue));
    return glyph;
  };
  /** The dock is the person's document: it is edited only once their state has loaded. */
  const stateReady = () => kernel.stateStatus().status === 'ready';
  function setEditing(next: boolean) {
    if (editing === next || (next && !stateReady())) return;
    editing = next;
    if (!next) closeFolder();
    renderDock(true);
    (dock.querySelector(next ? '.tos-dock-item[data-icon], .tos-dock-folder' : '.tos-dock-item') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function iconTile(icon: DockIcon, running: Set<string>, transient = false): HTMLElement {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'tos-dock-item'; b.dataset.module = icon.module; b.dataset.icon = icon.id;
    b.setAttribute('aria-label', editing ? icon.title : t('dock/open', { title: icon.title })); b.title = icon.title;
    b.append(glyphOf(icon.icon));
    if (running.has(icon.module)) b.classList.add('is-running');
    if (transient) b.classList.add('is-transient');
    b.addEventListener('click', () => { if (!editing && !dragging) launch(icon); });
    if (!editing || transient) return b;
    // in edit mode a tile carries its hide badge beside it, never inside the button
    const slot = doc.createElement('span'); slot.className = 'tos-dock-slot';
    const hide = doc.createElement('button');
    hide.type = 'button'; hide.className = 'tos-dock-hide'; hide.tabIndex = -1;
    hide.setAttribute('aria-label', t('dock/hide', { title: icon.title })); hide.title = t('dock/hide', { title: icon.title });
    hide.textContent = '−';
    hide.addEventListener('click', () => saveDock(hideInDock(dockState().layout, icon.id)));
    slot.append(b, hide);
    return slot;
  }

  function folderTile(folder: { id: string, title: string, icons: DockIcon[] }, running: Set<string>): HTMLElement {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'tos-dock-item tos-dock-folder'; b.dataset.folder = folder.id;
    b.setAttribute('aria-label', t('dock/folder-open', { title: folder.title })); b.title = folder.title;
    b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', String(openFolderId === folder.id));
    const grid = doc.createElement('span'); grid.className = 'tos-dock-folder-grid'; grid.setAttribute('aria-hidden', 'true');
    for (const icon of folder.icons.slice(0, 4)) grid.append(glyphOf(icon.icon));
    b.append(grid);
    if (folder.icons.some(i => running.has(i.module))) b.classList.add('is-running');
    b.addEventListener('click', () => { if (!dragging) { if (openFolderId === folder.id) closeFolder(); else openFolder(folder.id, b); } });
    return b;
  }

  function closeFolder() {
    if (openFolderId === null) return;
    const opener = dock.querySelector<HTMLElement>(`[data-folder="${openFolderId}"]`);
    openFolderId = null; folderPanel.hidden = true; folderPanel.replaceChildren();
    opener?.setAttribute('aria-expanded', 'false');
  }

  function openFolder(id: string, anchor: HTMLElement | null, focus = true) {
    const folder = dockState().view.items.find(i => i.kind === 'folder' && i.id === id) as { kind: 'folder', id: string, title: string, icons: DockIcon[] } | undefined;
    if (!folder) { closeFolder(); return; }
    openFolderId = id;
    const running = new Set(desktop.windows.map(w => w.module));
    folderPanel.setAttribute('aria-label', folder.title);
    let heading: HTMLElement;
    if (editing) {
      const input = doc.createElement('input');
      input.type = 'text'; input.className = 'tos-dock-folder-name'; input.value = folder.title; input.maxLength = 64;
      input.setAttribute('aria-label', t('dock/rename'));
      const commit = () => { if (input.value.trim() !== folder.title) saveDock(renameDockFolder(dockState().layout, id, input.value)); };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } });
      heading = input;
    } else { heading = doc.createElement('h2'); heading.className = 'tos-dock-folder-title'; heading.textContent = folder.title; }
    const grid = doc.createElement('div'); grid.className = 'tos-dock-folder-icons';
    for (const icon of folder.icons) {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'tos-dock-folder-icon'; b.dataset.icon = icon.id; b.dataset.module = icon.module;
      if (running.has(icon.module)) b.classList.add('is-running');
      const label = doc.createElement('span'); label.textContent = icon.title;
      b.append(glyphOf(icon.icon), label);
      b.addEventListener('click', () => { if (editing || dragging) return; closeFolder(); launch(icon); });
      grid.append(b);
    }
    folderPanel.replaceChildren(heading, grid);
    folderPanel.hidden = false;
    // above its tile, kept on the desktop
    const box = node.getBoundingClientRect(), dockBox = dock.getBoundingClientRect();
    const at = (anchor ?? dock.querySelector<HTMLElement>(`[data-folder="${id}"]`))?.getBoundingClientRect();
    const width = folderPanel.offsetWidth;
    const center = at ? at.left + at.width / 2 - box.left : box.width / 2;
    folderPanel.style.left = `${Math.round(Math.max(8, Math.min(center - width / 2, box.width - width - 8)))}px`;
    folderPanel.style.bottom = `${Math.round(box.bottom - dockBox.top + 10)}px`;
    dock.querySelector(`[data-folder="${id}"]`)?.setAttribute('aria-expanded', 'true');
    if (focus) (folderPanel.querySelector('input, button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function renderDock(force = false) {
    // a drag in progress holds the dock still; it draws again when the drop lands
    if (dragging) return;
    const signature = JSON.stringify([kernel.modules().map(m => [m.id, localized(m.title, locale.locale), m.icon, m.entries, m.dock]), kernel.dock(), editing, kernel.stateStatus().status, kernel.stateStatus().failed, [...new Set(desktop.windows.map(w => w.module))].sort(), kernel.mail().filter(m => m.proposal ? m.proposal.status === 'pending' || m.proposal.status === 'deciding' : !m.read).length, theme.scheme, locale, desktop.focus]);
    if (!force && signature === dockSignature) return;
    dockSignature = signature;
    const { view } = dockState();
    const running = new Set(desktop.windows.map(w => w.module));
    const items: HTMLElement[] = view.items.map(item => item.kind === 'icon' ? iconTile(item.icon, running) : folderTile(item, running));
    // a hidden icon whose module runs keeps a tile while it runs: the dock is the way back to its window
    if (!editing) for (const icon of view.hidden) if (running.has(icon.module) && !items.some(el => el.dataset.module === icon.module)) items.push(iconTile(icon, running, true));
    if (editing) {
      if (view.hidden.length) {
        const shown = doc.createElement('button');
        shown.type = 'button'; shown.className = 'tos-dock-item tos-dock-hidden';
        shown.setAttribute('aria-label', t('dock/hidden')); shown.title = t('dock/hidden');
        shown.textContent = '+';
        const badge = doc.createElement('span'); badge.className = 'tos-badge'; badge.textContent = String(view.hidden.length); shown.append(badge);
        shown.addEventListener('click', () => {
          const r = shown.getBoundingClientRect();
          openMenu(t('dock/hidden'), view.hidden.map(icon => ({ label: t('dock/show', { title: icon.title }), glyph: { glyph: icon.icon?.glyph ?? 'app', hue: icon.icon?.hue }, run: () => saveDock(showInDock(dockState().layout, icon.id)) })), { x: r.left, y: r.top - 8 }, shown);
        });
        items.push(shown);
      }
      const done = doc.createElement('button');
      done.type = 'button'; done.className = 'tos-dock-item tos-dock-done'; done.textContent = t('dock/done');
      done.addEventListener('click', () => setEditing(false));
      items.push(done);
    }
    dock.classList.toggle('is-editing', editing);
    // plain mail until it is read, a proposal while it waits for the person
    const unread = kernel.mail().filter(m => m.proposal ? m.proposal.status === 'pending' || m.proposal.status === 'deciding' : !m.read).length;
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
    const tray = [...(options.tray?.mail === false ? [] : [mailButton]), ...(options.tray?.theme === false ? [] : [themeButton])];
    // the person's state could not be read, or a change could not be saved: said, with a way to try again
    const state = kernel.stateStatus();
    if (state.status === 'unavailable' || state.failed) {
      const notice = doc.createElement('button');
      notice.type = 'button'; notice.className = 'tos-dock-item tos-dock-state';
      const text = state.status === 'unavailable' ? t('state/unavailable') : t('state/failed', { detail: state.failed ?? '' });
      notice.setAttribute('aria-label', `${text} ${t('window/retry')}`); notice.title = text;
      notice.setAttribute('role', 'status');
      notice.textContent = '!';
      notice.addEventListener('click', () => { if (kernel.stateStatus().status === 'unavailable') void kernel.reloadState(); else void kernel.flushState(); });
      tray.unshift(notice);
    }
    const separator = doc.createElement('span'); separator.className = 'tos-dock-separator'; separator.setAttribute('aria-hidden', 'true');
    const brand = brandMark();
    // the tiles shrink with the count before the dock overflows; a brand mark takes about two and a half tiles
    dock.style.setProperty('--tos-dock-count', String(items.length + tray.length + (brand ? 2.5 : 0)));
    // a keyboard user stays on the tile they were on when the dock redraws
    const active = doc.activeElement as HTMLElement | null;
    const had = active && dock.contains(active) ? (active.dataset.icon ? `[data-icon="${active.dataset.icon}"]` : active.dataset.folder ? `[data-folder="${active.dataset.folder}"]` : active.dataset.module ? `[data-module="${active.dataset.module}"]` : active.classList.contains('tos-dock-mail') ? '.tos-dock-mail' : active.classList.contains('tos-dock-theme') ? '.tos-dock-theme' : active.classList.contains('tos-dock-done') ? '.tos-dock-done' : null) : null;
    // the tray keeps to the dock's visible end while the dock scrolls (a phone), so its mail and badge stay in view
    const trayGroup = doc.createElement('span'); trayGroup.className = 'tos-dock-tray'; trayGroup.append(separator, ...tray);
    dock.replaceChildren(...(brand ? [brand] : []), ...items, ...(tray.length ? [trayGroup] : []));
    syncDockScroll();
    if (had) dock.querySelector<HTMLElement>(had)?.focus({ preventScroll: true });
    if (openFolderId !== null) { if (view.items.some(i => i.kind === 'folder' && i.id === openFolderId)) openFolder(openFolderId, null, false); else closeFolder(); }
  }

  /** The top-level id a dock tile stands for: its folder, or its icon. */
  const topId = (el: HTMLElement) => el.dataset.folder ?? el.dataset.icon ?? '';
  const layoutIndex = (layout: DockLayout, id: string) => layout.items.findIndex(i => (typeof i === 'string' ? i : i.folder) === id);
  const newFolderId = () => `f${Date.now().toString(36)}`;

  // dragging in edit mode: an icon onto another makes a folder (onto a folder,
  // joins it); beside a tile, it moves there; out of an open folder onto the
  // dock, it leaves the folder
  function onDragStart(event: PointerEvent) {
    if (!editing || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.tos-dock-hide, input')) return;
    const tile = target.closest<HTMLElement>('.tos-dock [data-icon], .tos-dock [data-folder], .tos-dock-folder-panel [data-icon]');
    if (!tile) return;
    const fromFolder = !!tile.closest('.tos-dock-folder-panel');
    const id = fromFolder ? tile.dataset.icon! : topId(tile);
    const start = { x: event.clientX, y: event.clientY };
    let ghost: HTMLElement | null = null, mark: { el: HTMLElement, kind: 'group' | 'before' | 'after' } | null = null;
    const unmark = () => { if (mark) mark.el.classList.remove('is-drop-group', 'is-drop-before', 'is-drop-after'); mark = null; };
    const move = (e: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
        dragging = true;
        ghost = doc.createElement('div'); ghost.className = 'tos-dock-ghost';
        ghost.append((tile.querySelector('.tos-glyph, .tos-dock-folder-grid') as HTMLElement | null)?.cloneNode(true) ?? doc.createElement('span'));
        node.append(ghost);
        tile.classList.add('is-dragging');
      }
      const box = node.getBoundingClientRect();
      ghost.style.left = `${e.clientX - box.left}px`; ghost.style.top = `${e.clientY - box.top}px`;
      unmark();
      const over = (doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.tos-dock [data-icon], .tos-dock [data-folder], .tos-dock-folder-panel [data-icon]');
      if (!over || over === tile) return;
      const r = over.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      const groupable = !tile.dataset.folder || fromFolder;
      const kind = groupable && x > 0.25 && x < 0.75 ? 'group' : (x < 0.5) !== (locale.dir === 'rtl') ? 'before' : 'after';
      mark = { el: over, kind: over.closest('.tos-dock-folder-panel') ? 'group' : kind };
      over.classList.add(`is-drop-${mark.kind}`);
    };
    const end = (e: PointerEvent, cancelled: boolean) => {
      win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', cancel);
      if (!ghost) return;
      ghost.remove(); tile.classList.remove('is-dragging');
      const drop = mark; unmark();
      const layout = dockState().layout;
      let next: DockLayout | null = null;
      if (!cancelled && drop) {
        const targetId = drop.el.closest('.tos-dock-folder-panel') ? openFolderId! : topId(drop.el);
        if (drop.kind === 'group') next = groupInDock(layout, id, targetId, newFolderId());
        else { const at = layoutIndex(layout, targetId); if (at >= 0) next = moveInDock(layout, id, at + (drop.kind === 'after' ? 1 : 0)); }
      } else if (!cancelled && fromFolder && !(doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.tos-dock-folder-panel')) {
        next = moveInDock(layout, id, layout.items.length);
      }
      // the click that ends a drag opens nothing
      win.setTimeout(() => { dragging = false; if (next) saveDock(next); else renderDock(true); }, 0);
    };
    const up = (e: PointerEvent) => end(e, false), cancel = (e: PointerEvent) => end(e, true);
    win.addEventListener('pointermove', move); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', cancel);
  }
  dock.addEventListener('pointerdown', onDragStart);
  folderPanel.addEventListener('pointerdown', onDragStart);

  // the keyboard in edit mode: Alt with the arrow keys moves a tile, Delete hides an icon, Escape is done
  dock.addEventListener('keydown', (event) => {
    if (!editing) return;
    const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-icon], [data-folder]');
    if (event.key === 'Escape') { event.preventDefault(); setEditing(false); return; }
    if (!tile) return;
    const id = topId(tile), layout = dockState().layout, at = layoutIndex(layout, id);
    const back = locale.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft', forward = locale.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    if (event.altKey && (event.key === back || event.key === forward) && at >= 0) {
      event.preventDefault();
      saveDock(moveInDock(layout, id, event.key === back ? Math.max(0, at - 1) : at + 2));
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && tile.dataset.icon) {
      event.preventDefault();
      saveDock(hideInDock(layout, tile.dataset.icon));
    }
  });
  folderPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); const id = openFolderId; closeFolder(); if (id) dock.querySelector<HTMLElement>(`[data-folder="${id}"]`)?.focus(); }
  });

  /** What a dock tile's menu offers in edit mode: every drag has its entry here. */
  function editMenu(el: HTMLElement): MenuEntry[] {
    const { layout, view } = dockState();
    const entries: MenuEntry[] = [];
    const inFolder = !!el.closest('.tos-dock-folder-panel');
    if (el.dataset.folder) {
      entries.push({ label: t('dock/rename'), run: () => openFolder(el.dataset.folder!, el) });
    } else if (el.dataset.icon) {
      const id = el.dataset.icon, title = el.title || el.textContent || id;
      entries.push({ label: t('dock/hide', { title }), run: () => saveDock(hideInDock(layout, id)) });
      if (inFolder) entries.push({ label: t('dock/take-out'), run: () => { saveDock(moveInDock(layout, id, layout.items.length)); } });
      for (const f of view.items) if (f.kind === 'folder' && !f.icons.some(i => i.id === id)) entries.push({ label: t('dock/put-in', { folder: f.title }), run: () => saveDock(groupInDock(layout, id, f.id, newFolderId())) });
      if (!inFolder) {
        const at = view.items.findIndex(i => i.kind === 'icon' && i.icon.id === id);
        const neighbour = view.items[at + 1] ?? view.items[at - 1];
        if (neighbour?.kind === 'icon') entries.push({ label: t('dock/new-folder', { title: neighbour.icon.title }), run: () => saveDock(groupInDock(layout, neighbour.icon.id, id, newFolderId())) });
      }
    }
    if (!inFolder) {
      const id = topId(el), at = layoutIndex(layout, id);
      if (at > 0) entries.push('separator', { label: t('dock/move-back'), run: () => saveDock(moveInDock(layout, id, at - 1)) });
      if (at >= 0 && at < layout.items.length - 1) entries.push({ label: t('dock/move-forward'), run: () => saveDock(moveInDock(layout, id, at + 2)) });
    }
    entries.push('separator', { label: t('dock/done'), run: () => setEditing(false) });
    return entries;
  }

  let brandNode: HTMLElement | null = null;
  function brandMark(): HTMLElement | null {
    const brand = options.tray?.brand;
    if (!brand) return null;
    if (brandNode) return brandNode;
    const mark = doc.createElement('span');
    mark.className = 'tos-dock-brand';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', brand.label);
    mark.title = brand.label;
    if (brand.node) mark.append(brand.node);
    else if (brand.src) { const img = doc.createElement('img'); img.src = brand.src; img.alt = ''; mark.append(img); }
    return (brandNode = mark);
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
  type MenuEntry = { label: string, run: () => void, disabled?: boolean, glyph?: { glyph: string, hue?: number }, checked?: boolean, hint?: string } | 'separator';
  let menu: { el: HTMLElement, restore: HTMLElement | null, onClose?: () => void } | null = null;

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
      ...(kernel.effective(w.module)?.settings ? ['separator' as const, { label: t('menu/settings'), run: () => openSettings(w.module) }] : []),
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
    if (manifest.settings) entries.push('separator', { label: t('menu/settings'), run: () => openSettings(moduleId) });
    if (running.length) entries.push('separator', { label: running.length === 1 ? t('window/close') : t('menu/close-all'), run: () => { for (const w of windowsOf(moduleId)) close(w.id); } });
    entries.push('separator', { label: t('dock/edit'), disabled: !stateReady(), run: () => setEditing(true) });
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
      ...(options.tray?.mail === false ? [] : [{ label: t('mail/title'), run: toggleMail }]),
      ...(options.tray?.theme === false ? [] : [{ label: theme.scheme === 'dark' ? t('tray/theme-light') : t('tray/theme-dark'), run: toggleScheme }]),
      'separator',
      { label: editing ? t('dock/done') : t('dock/edit'), disabled: !editing && !stateReady(), run: () => setEditing(!editing) },
    ];
  }

  /** What a right click on this element offers, or null for the browser's own menu. */
  function menuFor(target: HTMLElement): { title: string, entries: MenuEntry[] } | null {
    if (target.closest('.tos-content, .tos-mail, .tos-dock-brand, input')) return null;
    if (target.closest('.tos-dock-folder-panel') && !target.closest('[data-icon]')) return null;
    const windowEl = target.closest<HTMLElement>('.tos-window');
    if (windowEl?.dataset.window) {
      const w = desktop.windows.find(x => x.id === windowEl.dataset.window);
      return w ? { title: w.title, entries: windowMenu(w.id) } : null;
    }
    const tile = target.closest<HTMLElement>('.tos-dock [data-icon], .tos-dock [data-folder], .tos-dock-folder-panel [data-icon]');
    if (editing && tile) return { title: tile.title || t('dock/label'), entries: editMenu(tile) };
    if (tile?.dataset.folder) return { title: tile.title, entries: [{ label: t('dock/folder-open', { title: tile.title }), run: () => openFolder(tile.dataset.folder!, tile) }, 'separator', { label: t('dock/edit'), run: () => setEditing(true) }] };
    const item = target.closest<HTMLElement>('.tos-dock-item[data-module], .tos-dock-folder-panel [data-module]');
    if (item?.dataset.module) {
      const manifest = kernel.effective(item.dataset.module);
      return manifest ? { title: localized(manifest.title, locale.locale), entries: dockMenu(manifest.id) } : null;
    }
    return { title: t('desktop/label'), entries: desktopMenu() };
  }

  /**
   * An application's menu, drawn as the desktop's own: the promise answers the
   * chosen id, or null when the person dismissed it. A submenu replaces its
   * parent at the same place, with a way back as its first item.
   */
  function showAppMenu(windowId: string, items: MenuDocument, at: MenuPoint): Promise<string | null> {
    const title = desktop.windows.find(w => w.id === windowId)?.title ?? '';
    const active = doc.activeElement;
    const restore = active && active !== doc.body ? active as HTMLElement : null;
    return new Promise((resolve) => {
      let settled = false, generation = 0;
      const done = (id: string | null) => { if (!settled) { settled = true; resolve(id); } };
      const level = (list: MenuDocument, parent: MenuDocument | null) => {
        const entries: MenuEntry[] = [];
        if (parent) entries.push({ label: t('menu/back'), glyph: undefined, hint: locale.dir === 'rtl' ? '›' : '‹', run: () => level(parent, null) }, 'separator');
        for (const item of list) {
          if (item === 'separator') { entries.push('separator'); continue; }
          const sub = (item as MenuItem).items;
          entries.push({
            label: item.label, disabled: item.disabled, checked: item.checked,
            hint: sub ? (locale.dir === 'rtl' ? '‹' : '›') : item.hint,
            ...(item.glyph ? { glyph: { glyph: item.glyph } } : {}),
            run: () => { if (sub) level(sub, list); else done(item.id); },
          });
        }
        // a choice runs after the menu closes: a dismissal is decided a moment later, and only while no
        // other level has opened since (a submenu, or the way back), so a choice or a new level wins
        const mine = ++generation;
        openMenu(title, entries, at, restore, () => queueMicrotask(() => { if (generation === mine) done(null); }));
      };
      level(items, null);
    });
  }

  function closeMenu(returnFocus = false) {
    if (!menu) return;
    const { el, restore, onClose } = menu;
    menu = null;
    el.remove();
    onClose?.();
    if (returnFocus && restore?.isConnected) restore.focus();
  }

  function openMenu(title: string, entries: MenuEntry[], at: { x: number, y: number }, restore: HTMLElement | null, onClose?: () => void) {
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
      b.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (entry.checked !== undefined) { b.setAttribute('aria-checked', String(entry.checked)); b.classList.add('is-checkable'); }
      if (entry.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (entry.glyph) {
        const glyph = doc.createElement('span'); glyph.className = 'tos-glyph'; glyph.dataset.glyph = entry.glyph.glyph;
        if (entry.glyph.hue !== undefined) glyph.style.setProperty('--hue', String(entry.glyph.hue));
        b.append(glyph);
      }
      const label = doc.createElement('span'); label.className = 'tos-menu-label'; label.textContent = entry.label; b.append(label);
      if (entry.hint) { const hint = doc.createElement('kbd'); hint.className = 'tos-menu-hint'; hint.textContent = entry.hint; b.append(hint); }
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
    menu = { el, restore, onClose };
    el.querySelector<HTMLButtonElement>('.tos-menu-item:not(:disabled)')?.focus({ preventScroll: true });
  }

  const onContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (menu?.el.contains(target)) { event.preventDefault(); return; }
    // inside a window: the module's own (it handled the event), or the default menu it registered
    const content = target.closest<HTMLElement>('.tos-content');
    if (content) {
      if (event.defaultPrevented) return;
      const windowId = content.closest<HTMLElement>('.tos-window')?.dataset.window;
      const entry = windowId ? mounted.get(windowId) : undefined;
      if (windowId && entry?.contextMenu) {
        event.preventDefault();
        const handlers = entry.menuHandlers;
        void showAppMenu(windowId, entry.contextMenu, { x: event.clientX, y: event.clientY })
          .then(id => { if (id !== null) for (const handler of [...(handlers ?? [])]) { try { handler(id); } catch (error) { report(error); } } });
        return;
      }
    }
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
  const onOutside = (event: Event) => {
    if (menu && !menu.el.contains(event.target as Node)) closeMenu();
    const target = event.target as HTMLElement;
    if (openFolderId !== null && !folderPanel.contains(target) && !target.closest?.(`[data-folder="${openFolderId}"]`) && !menu?.el.contains(target)) closeFolder();
  };
  const onMenuBlur = () => closeMenu();
  node.addEventListener('contextmenu', onContextMenu);
  doc.addEventListener('pointerdown', onOutside, true);
  win.addEventListener('blur', onMenuBlur);
  win.addEventListener('resize', onMenuBlur);

  function renderMail() {
    if (mailPanel.hidden) return;
    const heading = doc.createElement('h2'); heading.textContent = t('mail/title');
    const items = kernel.mail().reverse();
    const appName = (id: string) => { if (id === 'desktop') return t('desktop/label'); const sender = kernel.effective(id); return sender ? localized(sender.title, locale.locale) : id; };
    const open = items.filter(m => m.proposal && (m.proposal.status === 'pending' || m.proposal.status === 'deciding'));
    const rest = items.filter(m => !open.includes(m));
    const sections: HTMLElement[] = [heading];
    if (open.length) {
      const title = doc.createElement('h3'); title.className = 'tos-mail-group'; title.textContent = t('mail/to-decide');
      const list = doc.createElement('ul'); list.className = 'tos-proposals';
      for (const item of open) list.append(proposalItem(item, appName(item.from)));
      sections.push(title, list);
    }
    if (rest.length) {
      const list = doc.createElement('ul');
      for (const item of rest) {
        const li = doc.createElement('li'); li.className = item.read || item.proposal ? 'is-read' : '';
        const subject = doc.createElement('strong'); subject.textContent = item.subject;
        const from = doc.createElement('span'); from.className = 'tos-muted'; from.textContent = t('mail/from', { sender: appName(item.from) });
        li.append(subject, from);
        if (item.proposal) { const status = doc.createElement('span'); status.className = 'tos-muted'; status.textContent = item.proposal.status === 'accepted' ? t('mail/accepted') : t('mail/rejected'); li.append(status); }
        if (item.body) { const body = doc.createElement('p'); body.textContent = item.body; li.append(body); }
        list.append(li);
        if (!item.read && !item.proposal) kernel.markRead(item.id);
      }
      sections.push(list);
    }
    if (!open.length && !rest.length) { const empty = doc.createElement('p'); empty.className = 'tos-muted'; empty.textContent = t('mail/empty'); sections.push(empty); }
    mailPanel.replaceChildren(...sections);
  }

  /** One proposal waiting for the person: text only, links to http(s) pages only, the decision carried to its module. */
  /**
   * The form an answer schema asks for: one field per property of a flat
   * object (text, a longer text, a number, a choice, a yes or no), or one text
   * for any other schema, read as JSON when it is not a plain string schema.
   * Labels are the schema's own titles; nothing in it is markup.
   */
  function answerForm(schema: Record<string, unknown> | boolean): { el: HTMLFormElement, value: () => unknown } {
    const el = doc.createElement('form'); el.className = 'tos-answer';
    const s: any = schema;
    const props = s && typeof s === 'object' && s.type === 'object' && s.properties && typeof s.properties === 'object' ? Object.entries<any>(s.properties).slice(0, 20) : null;
    if (!props || props.some(([, p]) => !['string', 'number', 'integer', 'boolean'].includes(p?.type) && !Array.isArray(p?.enum))) {
      const area = doc.createElement('textarea'); area.rows = 3; area.setAttribute('aria-label', typeof s?.title === 'string' ? s.title : t('mail/answer'));
      el.append(area);
      const plain = s === true || s?.type === 'string';
      return { el, value: () => plain ? area.value : JSON.parse(area.value) };
    }
    const required = new Set<string>(Array.isArray(s.required) ? s.required : []);
    const read: (() => [string, unknown] | null)[] = [];
    for (const [name, p] of props) {
      const field = doc.createElement('label'); field.className = 'tos-answer-field';
      const caption = doc.createElement('span'); caption.textContent = typeof p.title === 'string' ? p.title : name;
      let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (Array.isArray(p.enum)) {
        const select = doc.createElement('select');
        for (const option of p.enum.slice(0, 50)) { const o = doc.createElement('option'); o.value = JSON.stringify(option); o.textContent = String(option); select.append(o); }
        control = select;
        read.push(() => [name, JSON.parse(select.value)]);
      } else if (p.type === 'boolean') {
        const box = doc.createElement('input'); box.type = 'checkbox'; box.checked = p.default === true; control = box;
        read.push(() => [name, box.checked]);
      } else if (p.type === 'number' || p.type === 'integer') {
        const input = doc.createElement('input'); input.type = 'number'; if (p.type === 'integer') input.step = '1'; control = input;
        read.push(() => input.value === '' ? null : [name, Number(input.value)]);
      } else {
        const long = (p.maxLength ?? 0) > 200 || p.maxLength === undefined;
        const input = long ? doc.createElement('textarea') : doc.createElement('input');
        if (input instanceof HTMLTextAreaElement) input.rows = 2; else input.type = 'text';
        if (typeof p.maxLength === 'number') input.maxLength = p.maxLength;
        control = input;
        read.push(() => input.value === '' && !required.has(name) ? null : [name, input.value]);
      }
      if (required.has(name) && !(control instanceof HTMLInputElement && control.type === 'checkbox')) control.required = true;
      field.append(caption, control);
      el.append(field);
    }
    return { el, value: () => Object.fromEntries(read.map(r => r()).filter((x): x is [string, unknown] => x !== null)) };
  }

  /** A suggested dock, in the desktop's words: what it would change, by the dock's own titles. */
  function dockSuggestion(li: HTMLElement, subject: HTMLElement, from: HTMLElement, payload: { by?: string, changes?: { moved: string[], hidden: string[], shown: string[], folders: { id: string, items: string[] }[] } }) {
    const manifests = kernel.modules();
    const titles = new Map(dockIcons(manifests, locale.locale).map(i => [i.id, i.title]));
    const folders = folderTitles(manifests, locale.locale);
    const name = (id: string) => titles.get(id) ?? id;
    const by = payload.by === 'assistant' ? (kernel.effective('assistant') ? localized(kernel.effective('assistant')!.title, locale.locale) : 'assistant') : payload.by ? (kernel.effective(payload.by) ? localized(kernel.effective(payload.by)!.title, locale.locale) : payload.by) : t('desktop/label');
    subject.textContent = t('dock/suggestion');
    from.textContent = t('dock/suggested-by', { sender: by });
    const changes = payload.changes ?? { moved: [], hidden: [], shown: [], folders: [] };
    const list = doc.createElement('ul'); list.className = 'tos-dock-changes';
    const line = (text: string) => { const row = doc.createElement('li'); row.textContent = text; list.append(row); };
    if (changes.folders.length) line(t('dock/changes-folders', { list: changes.folders.map(f => `${folders.get(f.id) ?? t('dock/folder')} (${f.items.map(name).join(', ')})`).join('; ') }));
    if (changes.hidden.length) line(t('dock/changes-hidden', { list: changes.hidden.map(name).join(', ') }));
    if (changes.shown.length) line(t('dock/changes-shown', { list: changes.shown.map(name).join(', ') }));
    if (changes.moved.length) line(t('dock/changes-moved', { list: changes.moved.map(name).join(', ') }));
    li.append(list);
  }

  /** An application the assistant wrote, in the desktop's words: who wrote it, what it is for, and that it asks for nothing. */
  function appOffer(li: HTMLElement, subject: HTMLElement, from: HTMLElement, payload: { title?: string, summary?: string, by?: string }, revision = false) {
    const by = payload.by && kernel.effective(payload.by) ? localized(kernel.effective(payload.by)!.title, locale.locale) : payload.by ?? t('desktop/label');
    subject.textContent = revision ? t('apps/revise-offer', { title: payload.title ?? '' }) : t('apps/offer', { title: payload.title ?? '' });
    from.textContent = t('apps/written-by', { sender: by });
    if (payload.summary) { const summary = doc.createElement('p'); summary.textContent = payload.summary; li.append(summary); }
    const note = doc.createElement('p'); note.className = 'tos-muted'; note.textContent = t('apps/asks-nothing');
    li.append(note);
  }

  /** A change to a background job the assistant proposed: what would happen, who proposed it, why, and when it would not. */
  function jobChange(li: HTMLElement, subject: HTMLElement, from: HTMLElement, payload: { action?: string, id?: string, kind?: string, reason?: string, by?: string }) {
    const id = payload.id ?? '';
    subject.textContent = payload.action === 'run' ? t('inbox/job-run', { kind: payload.kind ?? '' })
      : payload.action === 'cancel' ? t('inbox/job-cancel', { id }) : payload.action === 'requeue' ? t('inbox/job-requeue', { id }) : t('inbox/job-unschedule', { id });
    const by = payload.by && kernel.effective(payload.by) ? localized(kernel.effective(payload.by)!.title, locale.locale) : payload.by ?? t('desktop/label');
    from.textContent = t('inbox/job-by', { sender: by });
    if (payload.reason) { const reason = doc.createElement('p'); reason.textContent = payload.reason; li.append(reason); }
    const note = doc.createElement('p'); note.className = 'tos-muted'; note.textContent = payload.action === 'run' ? t('inbox/job-run-note') : t('inbox/job-note');
    li.append(note);
  }

  function proposalItem(item: ReturnType<Kernel['mail']>[number], app: string) {
    const p = item.proposal!;
    const li = doc.createElement('li'); li.className = 'tos-proposal'; li.dataset.proposal = p.id; li.dataset.module = item.from;
    const subject = doc.createElement('strong'); subject.textContent = item.subject;
    const from = doc.createElement('span'); from.className = 'tos-muted'; from.textContent = t('mail/from', { sender: app });
    li.append(subject, from);
    if (item.from === 'desktop' && p.kind === 'dock.layout') dockSuggestion(li, subject, from, p.payload as any);
    else if (item.from === 'desktop' && p.kind === 'app.add') appOffer(li, subject, from, p.payload as any);
    else if (item.from === 'desktop' && p.kind === 'app.revise') appOffer(li, subject, from, p.payload as any, true);
    else if (item.from === 'desktop' && p.kind === 'job.change') jobChange(li, subject, from, p.payload as any);
    else if (p.summary) { const summary = doc.createElement('p'); summary.textContent = p.summary; li.append(summary); }
    if (p.evidence?.length) {
      const evidence = doc.createElement('ul'); evidence.className = 'tos-evidence'; evidence.setAttribute('aria-label', t('mail/evidence'));
      for (const e of p.evidence) {
        const row = doc.createElement('li');
        if (e.href && /^https?:\/\//.test(e.href)) { const a = doc.createElement('a'); a.href = e.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = e.label; row.append(a); }
        else row.textContent = e.label;
        evidence.append(row);
      }
      li.append(evidence);
    }
    if (p.reason) {
      const reason = doc.createElement('p'); reason.className = 'tos-proposal-reason'; reason.setAttribute('role', 'alert');
      reason.textContent = p.reason.code === 'OS0110' ? t('mail/not-running', { app }) : t('mail/refused', { detail: p.reason.message });
      li.append(reason);
    }
    // the roles the kind's policy names: shown here, checked by the application that applies it
    const roles = kernel.reviewOf(item.from, p.kind)?.roles ?? [];
    if (roles.length) { const hint = doc.createElement('span'); hint.className = 'tos-proposal-origin tos-proposal-roles'; hint.textContent = t('mail/roles', { roles: roles.join(', ') }); li.insertBefore(hint, from.nextSibling); }
    if (p.origin) { const origin = doc.createElement('span'); origin.className = 'tos-proposal-origin'; origin.textContent = { human: t('mail/origin-human'), rule: t('mail/origin-rule'), import: t('mail/origin-import'), ai: t('mail/origin-ai') }[p.origin]; li.insertBefore(origin, from.nextSibling); }
    const actions = doc.createElement('div'); actions.className = 'tos-proposal-actions';
    const deciding = p.status === 'deciding';
    // a proposal that asks something: its answer is a form drawn from the schema, sent instead of an accept
    if (p.answer) {
      const form = answerForm(p.answer.schema);
      const error = doc.createElement('p'); error.className = 'tos-proposal-reason'; error.setAttribute('role', 'alert'); error.hidden = true;
      const send = doc.createElement('button'); send.type = 'submit'; send.dataset.decision = 'answer'; send.textContent = deciding ? t('mail/deciding') : p.answer.label ?? t('mail/answer'); send.disabled = deciding;
      const reject = doc.createElement('button'); reject.type = 'button'; reject.dataset.decision = 'reject'; reject.textContent = t('mail/reject'); reject.disabled = deciding;
      reject.addEventListener('click', () => { send.disabled = reject.disabled = true; kernel.decide(item.id, 'reject').catch(report); });
      form.el.addEventListener('submit', (event) => {
        event.preventDefault();
        let response: unknown;
        try { response = form.value(); } catch (problem: any) { error.textContent = t('mail/answer-invalid', { detail: String(problem?.message ?? problem) }); error.hidden = false; return; }
        send.disabled = reject.disabled = true;
        kernel.decide(item.id, 'answer', response).then((outcome) => {
          if (!outcome.ok && (outcome.error.code === 'OS0124' || outcome.error.code === 'OS0123')) { error.textContent = t('mail/answer-invalid', { detail: outcome.error.message }); error.hidden = false; send.disabled = reject.disabled = false; }
        }, report);
      });
      actions.append(send, reject);
      form.el.append(error, actions);
      li.append(form.el);
      return li;
    }
    for (const [decision, label] of [['accept', t('mail/accept')], ['reject', t('mail/reject')]] as const) {
      const b = doc.createElement('button'); b.type = 'button'; b.dataset.decision = decision; b.textContent = deciding ? t('mail/deciding') : label;
      b.disabled = deciding;
      b.addEventListener('click', () => {
        for (const x of actions.querySelectorAll('button')) (x as HTMLButtonElement).disabled = true;
        // an application the person just added opens, so they see what they accepted
        kernel.decide(item.id, decision).then((outcome: any) => {
          if (!outcome?.ok || !outcome.value?.module) return;
          // a new version replaces the running one: its windows start again on the new document
          if (outcome.value.revised) for (const w of desktop.windows.filter(x => x.module === outcome.value.module)) close(w.id);
          open(outcome.value.module);
        }, report);
      });
      actions.append(b);
    }
    li.append(actions);
    return li;
  }

  // ── header bars ───────────────────────────────────────────────────────────
  // What an application puts in its title bar is a document the kernel holds
  // (`kernel.setHeader`); the shell draws it, and every use, the person's
  // included, goes through `tangle_os_header` so it is checked and lands in
  // the ledger exactly like the assistant's. Items are updated in place by
  // id, so a redraw never takes focus, the caret or a composition away.

  /** Use one header item: the person's hand is the trusted caller `shell`. */
  function useHeader(id: string, item: string, value?: string | boolean) {
    kernel.call('shell', HEADER_CONTRACT.id, 'header.activate', { window: id, item, ...(value !== undefined ? { value } : {}) })
      .then(outcome => { if (!outcome.ok) report(new Error(outcome.error.message)); });
  }

  function wireHeader(id: string, hb: HeaderBar) {
    const itemOf = (el: HTMLElement | null) => {
      const header = kernel.header(id);
      return el && header ? headerItems(header).find(i => i.id === el.dataset.item) : undefined;
    };
    hb.bar.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-more]')) { openMore(id, hb); return; }
      const el = target.closest<HTMLElement>('[data-item]');
      const item = itemOf(el);
      if (!el || !item || (el as HTMLButtonElement).disabled) return;
      if (item.kind === 'button') useHeader(id, item.id);
      else if (item.kind === 'toggle') useHeader(id, item.id, !item.pressed);
      else if (item.kind === 'menu') openHeaderMenu(id, item, el);
      else if (item.kind === 'tabs') { const tab = target.closest<HTMLElement>('[data-tab]'); if (tab && !(tab as HTMLButtonElement).disabled && tab.dataset.tab !== item.selected) useHeader(id, item.id, tab.dataset.tab); }
    });
    // a search field reports what is typed, a moment after the typing stops; Enter at once
    hb.bar.addEventListener('input', (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-item]');
      if (!input) return;
      win.clearTimeout(hb.search?.timer);
      hb.search = { timer: win.setTimeout(() => useHeader(id, input.dataset.item!, input.value), 150) };
    });
    hb.bar.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (target.matches('input[data-item]')) {
        const input = target as HTMLInputElement;
        if (event.key === 'Enter') { event.preventDefault(); win.clearTimeout(hb.search?.timer); useHeader(id, input.dataset.item!, input.value); }
        else if (event.key === 'Escape' && input.value !== '') { event.preventDefault(); input.value = ''; win.clearTimeout(hb.search?.timer); useHeader(id, input.dataset.item!, ''); }
        return;
      }
      // tabs move and select with the arrow keys, mirrored on a right-to-left desktop
      const tab = target.closest<HTMLButtonElement>('[role="tab"]');
      if (!tab) return;
      const tabs = [...tab.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
      const at = tabs.indexOf(tab), forward = locale.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight', back = locale.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      const next = event.key === forward ? tabs[(at + 1) % tabs.length] : event.key === back ? tabs[(at - 1 + tabs.length) % tabs.length]
        : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return;
      event.preventDefault();
      next.focus();
      const owner = itemOf(tab.closest<HTMLElement>('[data-item]'));
      if (owner?.kind === 'tabs' && next.dataset.tab !== owner.selected) useHeader(id, owner.id, next.dataset.tab);
    });
  }

  /** Open a header menu under its button (or under "more" for one the narrow bar moved there). */
  function openHeaderMenu(id: string, item: HeaderMenu, anchor: HTMLElement) {
    const live = kernel.hasHeaderHandler(id);
    const entries: MenuEntry[] = item.entries.map(e => 'separator' in e ? 'separator' as const
      : { label: e.label, disabled: e.disabled === true || !live, ...(e.checked !== undefined ? { checked: e.checked } : {}), ...(e.shortcut ? { hint: e.shortcut } : {}), run: () => useHeader(id, item.id, e.id) });
    const r = anchor.getBoundingClientRect();
    anchor.setAttribute('aria-expanded', 'true');
    openMenu(item.label, entries, { x: locale.dir === 'rtl' ? r.right : r.left, y: r.bottom + 4 }, anchor, () => anchor.setAttribute('aria-expanded', 'false'));
  }

  /** The items a narrow bar has no room for, as one menu. */
  function openMore(id: string, hb: HeaderBar) {
    const header = kernel.header(id);
    if (!header) return;
    const live = kernel.hasHeaderHandler(id);
    const entries: MenuEntry[] = headerItems(header).filter(i => hb.overflow.includes(i.id)).map(item => {
      const disabled = ('disabled' in item && item.disabled === true) || !live;
      if (item.kind === 'toggle') return { label: item.label, checked: item.pressed, disabled, run: () => useHeader(id, item.id, !item.pressed) };
      if (item.kind === 'menu') return { label: item.label, disabled, run: () => openHeaderMenu(id, item, hb.more) };
      return { label: item.label, disabled, ...(item.kind === 'button' && item.shortcut ? { hint: item.shortcut } : {}), run: () => useHeader(id, item.id) };
    });
    const r = hb.more.getBoundingClientRect();
    hb.more.setAttribute('aria-expanded', 'true');
    openMenu(t('window/more'), entries, { x: locale.dir === 'rtl' ? r.right : r.left, y: r.bottom + 4 }, hb.more, () => hb.more.setAttribute('aria-expanded', 'false'));
  }

  /** Make or update one item's element in place; a kind that changed is built again. */
  function headerElement(hb: HeaderBar, item: HeaderItem, live: boolean): HTMLElement {
    let el = hb.items.get(item.id);
    if (el && el.dataset.kind !== item.kind) { el.remove(); el = undefined; }
    if (!el) {
      el = item.kind === 'search' ? doc.createElement('input') : item.kind === 'tabs' ? doc.createElement('div') : doc.createElement('button');
      el.dataset.item = item.id; el.dataset.kind = item.kind;
      el.className = item.kind === 'search' || item.kind === 'tabs' ? `tos-hb-${item.kind}` : `tos-hb-item tos-hb-${item.kind}`;
      if (item.kind === 'search') { (el as HTMLInputElement).type = 'search'; el.setAttribute('autocomplete', 'off'); el.setAttribute('spellcheck', 'false'); }
      else if (item.kind === 'tabs') el.setAttribute('role', 'tablist');
      else (el as HTMLButtonElement).type = 'button';
      hb.items.set(item.id, el);
    }
    const disabled = ('disabled' in item && item.disabled === true) || !live;
    el.setAttribute('aria-label', item.label);
    if (item.kind === 'search') {
      const input = el as HTMLInputElement;
      input.disabled = disabled;
      input.placeholder = item.placeholder ?? item.label;
      // the application's text never replaces what the person is typing
      if (doc.activeElement !== input && input.value !== (item.value ?? '')) input.value = item.value ?? '';
      return el;
    }
    if (item.kind === 'tabs') {
      const ids = item.items.map(tab => tab.id).join('\n');
      if (el.dataset.tabs !== ids) {
        el.dataset.tabs = ids;
        el.replaceChildren(...item.items.map(tab => { const b = doc.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = tab.id; b.className = 'tos-hb-tab'; return b; }));
      }
      [...el.children].forEach((b, i) => {
        const tab = item.items[i], button = b as HTMLButtonElement, selected = tab.id === item.selected;
        button.innerHTML = headerGlyph(tab.glyph);
        const text = doc.createElement('span'); text.textContent = tab.label; button.append(text);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.disabled = disabled || tab.disabled === true;
      });
      return el;
    }
    const button = el as HTMLButtonElement;
    button.disabled = disabled;
    const shortcut = 'shortcut' in item && item.shortcut ? ` (${item.shortcut})` : '';
    button.title = item.label + shortcut;
    // an icon when there is one (the label stays its name), else the label as text
    button.innerHTML = headerGlyph(item.glyph);
    if (!item.glyph) { const text = doc.createElement('span'); text.textContent = item.label; button.append(text); }
    button.classList.toggle('has-text', !item.glyph);
    button.classList.toggle('is-primary', item.kind === 'button' && item.primary === true);
    if (item.kind === 'toggle') button.setAttribute('aria-pressed', String(item.pressed)); else button.removeAttribute('aria-pressed');
    if (item.kind === 'menu') { button.setAttribute('aria-haspopup', 'menu'); if (!button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false'); }
    return el;
  }

  function renderHeader(id: string) {
    const entry = mounted.get(id);
    if (!entry) return;
    const hb = entry.header, header = kernel.header(id), live = kernel.hasHeaderHandler(id);
    entry.el.classList.toggle('has-header', header !== undefined);
    entry.el.classList.toggle('has-center', header?.center !== undefined);
    hb.subtitle.textContent = header?.subtitle ?? '';
    hb.subtitle.hidden = !header?.subtitle;
    const seen = new Set<string>();
    const place = (row: HTMLElement, items: HeaderItem[]) => {
      items.forEach((item, i) => {
        seen.add(item.id);
        const el = headerElement(hb, item, live);
        // moved only when out of place: moving an element takes its focus away
        if (row.children[i] !== el) row.insertBefore(el, row.children[i] ?? null);
      });
    };
    place(hb.start, header?.start ?? []);
    place(hb.center, header?.center ? [header.center] : []);
    place(hb.end, header?.end ?? []);
    for (const [itemId, el] of hb.items) if (!seen.has(itemId)) { el.remove(); hb.items.delete(itemId); }
    hb.fitted = -1;
    fitSoon(id);
  }

  const fitting = new Set<string>();
  /** Fit the bar after the frame's layout, once however often it is asked. */
  function fitSoon(id: string) {
    if (fitting.has(id)) return;
    fitting.add(id);
    const run = () => { fitting.delete(id); fitBar(id); };
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run); else run();
  }

  /**
   * A narrow bar keeps the items it has room for and moves the rest into
   * "more": primary buttons stay longest, then the others in the order the
   * application listed them. Tabs keep room for themselves (and scroll past
   * it); a search field in a crowded bar shrinks to its icon and opens across
   * the bar while it has focus.
   */
  function fitBar(id: string) {
    const entry = mounted.get(id), w = desktop.windows.find(x => x.id === id);
    if (!entry || !w) return;
    const hb = entry.header;
    hb.fitted = w.rect.w;
    const all = [...hb.start.children, ...hb.center.children, ...hb.end.children] as HTMLElement[];
    const searches = all.filter(el => el.dataset.kind === 'search');
    const droppable = [...hb.start.children, ...hb.end.children].filter(el => (el as HTMLElement).dataset.kind !== 'search') as HTMLElement[];
    for (const el of droppable) el.hidden = false;
    for (const el of searches) el.classList.remove('is-collapsed');
    hb.more.hidden = true; hb.overflow = [];
    const inner = hb.bar.clientWidth;
    if (!inner || (droppable.length === 0 && searches.length === 0)) return;
    const style = win.getComputedStyle(hb.bar);
    const gap = parseFloat(style.columnGap) || 0;
    const pad = (parseFloat(style.paddingInlineStart) || 0) + (parseFloat(style.paddingInlineEnd) || 0);
    const rowGap = parseFloat(win.getComputedStyle(hb.end).columnGap) || 0;
    const width = (el: Element) => (el as HTMLElement).hidden ? 0 : el.getBoundingClientRect().width;
    // what never moves: the glyph and the window controls
    const kept = [...hb.bar.children].filter(el => el !== hb.start && el !== hb.center && el !== hb.end && el !== hb.more && el !== hb.titleBox && !(el as HTMLElement).hidden);
    const tabs = hb.center.querySelector<HTMLElement>('[data-kind="tabs"]');
    const room = (searchWidth: number) => kept.reduce((sum, el) => sum + width(el), 0)
      + searches.reduce(sum => sum + searchWidth + rowGap, 0)
      + (tabs ? Math.min(tabs.scrollWidth, 168) : 0)
      + (entry.el.classList.contains('has-center') ? 0 : Math.min(hb.titleBox.scrollWidth, 96))
      + gap * (kept.length + 4) + pad;
    const order = [...droppable.filter(el => el.classList.contains('is-primary')), ...droppable.filter(el => !el.classList.contains('is-primary'))];
    const widths = order.map(el => width(el) + rowGap);
    let fits = fitHeader(widths, inner - room(96), 32 + gap);
    const crowded = fits < order.length || room(96) > inner;
    if (crowded && searches.length) {
      for (const el of searches) el.classList.add('is-collapsed');
      fits = fitHeader(widths, inner - room(30), 32 + gap);
    }
    order.forEach((el, i) => { el.hidden = i >= fits; });
    hb.overflow = order.slice(fits).map(el => el.dataset.item!);
    hb.more.hidden = hb.overflow.length === 0;
  }

  /** An item someone other than the person used lights up, so the person sees what was done in their window. */
  function showUse(id: string, item: string) {
    const hb = mounted.get(id)?.header;
    if (!hb) return;
    const el = hb.items.get(item);
    const shown = el && !el.hidden ? el : hb.more;
    shown.classList.remove('is-used');
    void shown.offsetWidth;
    shown.classList.add('is-used');
    win.setTimeout(() => shown.classList.remove('is-used'), 1400);
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  const unsubscribe = kernel.subscribe((event) => {
    if (event.kind === 'mail') { renderDock(); renderMail(); }
    if (event.kind === 'header' && event.window && mounted.has(event.window)) {
      renderHeader(event.window);
      if (event.item && event.by !== 'shell') showUse(event.window, event.item);
    }
    if (event.kind === 'modules' || event.kind === 'dock' || event.kind === 'state') renderDock();
    // a module that left the desktop (removed, undone, dropped by another device) takes its windows along
    if (event.kind === 'modules' && event.module && !kernel.effective(event.module)) {
      for (const w of desktop.windows.filter(x => x.module === event.module)) close(w.id);
    }
    // a form module's windows hear their new settings; one that predates them may refuse, which is fine
    if (event.kind === 'settings' && event.module) {
      const values = kernel.settings(event.module);
      for (const [id, m] of mounted) if (desktop.windows.find(w => w.id === id)?.module === event.module)
        m.moduleClient?.invoke('module.settings', { values }).catch(() => {});
    }
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
  // leaving the page sends what is still unsaved
  const onPageHide = () => { void kernel.flushState(); };
  win.addEventListener('pagehide', onPageHide);
  // a click inside a framed window goes to the frame, not the shell: when
  // focus moves into a frame, raise the window that holds it
  const onBlur = () => win.setTimeout(() => {
    const active = doc.activeElement;
    if (active?.tagName !== 'IFRAME') return;
    for (const [id, entry] of mounted) if (entry.frame === active && desktop.focus !== id) setDesktop(focusWindow(desktop, id));
  }, 0);
  win.addEventListener('blur', onBlur);
  // windows live in the window layer, which stops above the dock: lay them out in its area
  const area = () => ({ w: layer.clientWidth || node.clientWidth, h: layer.clientHeight || node.clientHeight });
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => setDesktop(resized(desktop, area()))) : null;
  observer?.observe(node);

  let joining: Promise<unknown> = Promise.resolve();
  desktop = resized(desktop, area());
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
    /** Open the desktop's Settings, at a module's own section when one is named. */
    openSettings,
    /** Hand a file to a module, opening its window when it is not running. */
    openFile,
    /**
     * Offer a suite's applications to the person: an install sheet shows each
     * one's origin, what it provides and asks to use, and the assistant's
     * access, and only what they add joins the desktop (kept in their state).
     */
    join: (suite: SuiteDocument, join: { source?: string } = {}): Promise<JoinResult> => {
      // one sheet at a time: a second suite waits for the person's answer to the first
      const next = joining.catch(() => undefined).then(() => joinSuite({ kernel, doc, node, locale: locale.locale, t, desktopOrigin: win.location?.origin ?? null }, suite, join.source));
      joining = next;
      return next;
    },
    /** Every window change, as it happens; returns the unsubscribe. */
    subscribe(listener: (event: DesktopEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setTheme: applyShellTheme,
    setLocale: applyShellLocale,
    theme: () => theme,
    /** The framed module's own context row, for the assistant. */
    context: (id: string) => mounted.get(id)?.moduleClient?.invoke('module.context', {}),
    dispose() {
      unsubscribe(); observer?.disconnect(); win.removeEventListener('message', onKey); win.removeEventListener('blur', onBlur); win.removeEventListener('pagehide', onPageHide);
      closeMenu(); node.removeEventListener('contextmenu', onContextMenu); doc.removeEventListener('pointerdown', onOutside, true);
      win.removeEventListener('blur', onMenuBlur); win.removeEventListener('resize', onMenuBlur); win.removeEventListener('resize', syncDockScroll);
      for (const id of [...mounted.keys()]) close(id);
      listeners.clear(); visibility.clear();
      node.replaceChildren(); node.classList.remove('tos', 'is-compact');
    },
  };
}

export type DesktopHandle = ReturnType<typeof mountDesktop>;
