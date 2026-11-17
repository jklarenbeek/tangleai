/**
 * The module side of the desktop: what an application page calls to join a
 * Tangle OS desktop that frames it. It waits for the shell's ports, serves the
 * module's own contracts and the module control contract on them, opens a
 * client for the kernel's `tangle_os` contract, and applies the theme and
 * language the shell pushes. An application on its own origin keeps its
 * server, its keys and its sign-in; the desktop sees only its contracts.
 */
import { compileContract } from '@jarenjs/contract';
import { servePort, openPortClient } from '@jarenjs/contract/port';
import { CONNECT, FOCUS, HELLO, PROTOCOL, systemContracts, type ConnectMessage } from './contracts.ts';

export type ModuleHandlers = Record<string, (input: any) => unknown>;
export type ConnectOptions = {
  /** Contract documents this page serves, by contract id, with their handlers. */
  serve?: { contract: unknown, handlers: ModuleHandlers }[];
  /** Origins of desktops allowed to frame this page: exact origins, or `'parent'` to accept the framing window whatever its origin (the sandboxed module host). */
  origins: string[] | 'parent';
  /** Called with token values after they are applied to the document root. */
  onTheme?: (theme: { tokens: Record<string, string>, scheme?: 'light' | 'dark' }) => void;
  onLocale?: (locale: { locale: string, dir: 'ltr' | 'rtl' }) => void;
  /** Called when the person changes this module's settings in the desktop's Settings (a `form` module's values). */
  onSettings?: (values: unknown) => void;
  /**
   * The person accepted or rejected one of this module's proposals. Carry it
   * out, or return `{ refused: reason }` (the revision moved, say) and the
   * proposal stays pending with that reason. A module with no handler refuses.
   */
  onDecision?: (decision: { id: string, kind: string, decision: 'accept' | 'reject', revision?: string, payload?: unknown }) => { refused?: string } | void | Promise<{ refused?: string } | void>;
  /** A compact description of what the page shows now, for the assistant. */
  context?: () => unknown;
  /** The window that sends the ports; the page's parent by default. */
  host?: { parent: any, addEventListener: (type: string, listener: (event: any) => void) => void, removeEventListener: (type: string, listener: (event: any) => void) => void, document?: any };
  /** How long a call to the desktop may take once connected (30 s by default). */
  timeoutMs?: number;
  /**
   * How long to wait for a desktop to answer the page's hello. Without it the
   * page waits as long as it is framed; past it the connection is refused
   * with `OS0401` and the page stops listening.
   */
  connectTimeoutMs?: number;
  /** Abandons a connection not yet made: refused with the signal's reason, the page stops listening. */
  signal?: AbortSignal;
  /**
   * Where the desktop's theme and language land: the page's root (`'root'`,
   * the default), an element of the page's own (`{ root }`), or nowhere
   * (`'none'`: an application that keeps its own look, and still hears
   * `onTheme` and `onLocale`).
   */
  presentation?: 'root' | 'none' | { root: any };
};
/** A refused connection: `OS0401` no desktop answered in time, `OS0402` the page is not framed, `OS0403` abandoned. */
export class OsConnectError extends Error {
  readonly code: 'OS0401' | 'OS0402' | 'OS0403';
  constructor(code: 'OS0401' | 'OS0402' | 'OS0403', message: string, options?: { cause?: unknown }) { super(`${code}: ${message}`, options); this.code = code; this.name = 'OsConnectError'; }
}
export type OsConnection = {
  module: string;
  connect: ConnectMessage;
  call(contract: string, op: string, input?: unknown): Promise<any>;
  sendMail(envelope: { to?: string, subject: string, body?: string, data?: unknown }): Promise<any>;
  setTitle(title: string): Promise<any>;
  /** This module's settings as the person set them in the desktop's Settings (a `form` module's values). */
  settings(): Promise<unknown>;
  /** Open the desktop's Settings at this module's own section: the one place the person finds every application's settings. */
  openSettings(): Promise<void>;
  /** File a proposal in the desktop's inbox (filing the same id again replaces it); the module keeps it and refiles after a reload. */
  propose(proposal: { id: string, kind: string, title: string, summary?: string, payload?: unknown, evidence?: { label: string, href?: string }[], revision?: string }): Promise<void>;
  /** Take back a pending proposal. */
  withdraw(id: string): Promise<void>;
  close(): void;
};

/** Set token values as custom properties on a root element, and the colour scheme. */
export function applyTheme(root: any, theme: { tokens: Record<string, string>, scheme?: 'light' | 'dark' }) {
  if (!root?.style) return;
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (/^--[a-z0-9-]+$/.test(name)) root.style.setProperty(name, value);
  }
  // `data-theme` too: Jaren's component stylesheets follow it, so its Markdown, diagrams and charts turn with the desktop
  if (theme.scheme) { root.style.colorScheme = theme.scheme; if (root.dataset) { root.dataset.scheme = theme.scheme; root.dataset.theme = theme.scheme; } }
}

export function applyLocale(root: any, locale: { locale: string, dir: 'ltr' | 'rtl' }) {
  if (!root?.setAttribute) return;
  root.setAttribute('lang', locale.locale);
  root.setAttribute('dir', locale.dir);
}

/**
 * Join the desktop that frames this page. Resolves once the shell has handed
 * over its ports; a message from a window that is not the parent, or from an
 * origin not listed, is ignored. A page that is not framed is refused at once
 * (`OS0402`); `connectTimeoutMs` and `signal` bound the wait, and a refused
 * or abandoned connection leaves no listener behind.
 */
export function connectToOs(options: ConnectOptions): Promise<OsConnection> {
  const host = options.host ?? (globalThis as any);
  const presentation = options.presentation ?? 'root';
  const root = presentation === 'none' ? null : presentation === 'root' ? host.document?.documentElement : presentation.root;
  return new Promise((resolve, reject) => {
    if (!host.parent || host.parent === host) { reject(new OsConnectError('OS0402', 'this page is not framed by a desktop')); return; }
    if (options.signal?.aborted) { reject(new OsConnectError('OS0403', 'the connection was abandoned', { cause: options.signal.reason })); return; }
    let timer: any;
    const settle = () => { clearTimeout(timer); host.removeEventListener('message', listener); options.signal?.removeEventListener?.('abort', abandon); };
    const abandon = () => { settle(); reject(new OsConnectError('OS0403', 'the connection was abandoned', { cause: options.signal?.reason })); };
    const listener = (event: any) => {
      const data = event?.data as ConnectMessage;
      if (data?.type !== CONNECT || data.protocol !== PROTOCOL) return;
      if (event.source !== host.parent) return;
      if (options.origins !== 'parent' && !options.origins.includes(event.origin)) return;
      settle();
      const ports: any[] = [...(event.ports ?? [])];
      const named = new Map<string, any>(data.ports.map((name, index) => [name, ports[index]]));
      const { os, module } = systemContracts();

      const disposers: (() => void)[] = [];
      const moduleServer = servePort(module, {
        'module.theme': (theme: any) => { applyTheme(root, theme); options.onTheme?.(theme); return {}; },
        'module.locale': (locale: any) => { applyLocale(root, locale); options.onLocale?.(locale); return {}; },
        'module.context': () => (options.context?.() ?? {}) as object,
        'module.settings': ({ values }: any) => { options.onSettings?.(values); return {}; },
        'module.decide': async (decision: any) => {
          if (!options.onDecision) return { refused: 'this application takes no decisions here' };
          const answer = await options.onDecision(decision);
          return answer && typeof answer.refused === 'string' ? { refused: answer.refused.slice(0, 400) } : {};
        },
      }, { channel: named.get('module') });
      disposers.push(() => (moduleServer as any)?.close?.());
      named.get('module')?.start?.();
      for (const served of options.serve ?? []) {
        const contract = compileContract(served.contract as any);
        const id = (contract as any).doc?.id ?? (served.contract as any).id;
        const port = named.get(id);
        if (!port) continue;
        const server = servePort(contract, served.handlers as any, { channel: port });
        port.start?.();
        disposers.push(() => (server as any)?.close?.());
      }
      const osPort = named.get('os');
      const client = openPortClient(os, { channel: osPort, timeoutMs: options.timeoutMs ?? 30_000 });
      osPort?.start?.();

      // a press anywhere in this page raises its window on the desktop
      const raise = () => host.parent?.postMessage?.({ type: FOCUS }, '*');
      host.document?.addEventListener?.('pointerdown', raise, true);
      disposers.push(() => host.document?.removeEventListener?.('pointerdown', raise, true));
      applyTheme(root, data.theme);
      applyLocale(root, data.locale);
      options.onTheme?.(data.theme);
      options.onLocale?.(data.locale);

      resolve({
        module: data.module,
        connect: data,
        call: (contract, op, input = {}) => client.invoke('os.call', { contract, op, input }),
        sendMail: (envelope) => client.invoke('mail.send', envelope),
        setTitle: (title) => client.invoke('window.title', { title }),
        settings: async () => {
          const outcome: any = await client.invoke('settings.get', {});
          if (outcome?.ok === false) throw Object.assign(new Error(outcome.error?.message ?? 'settings.get failed'), { code: outcome.error?.code });
          return (outcome?.ok === true ? outcome.value : outcome)?.values ?? {};
        },
        openSettings: async () => { await client.invoke('settings.open', {}); },
        propose: async (proposal) => {
          const outcome: any = await client.invoke('mail.propose', proposal);
          if (outcome?.ok === false) throw Object.assign(new Error(outcome.error?.message ?? 'mail.propose failed'), { code: outcome.error?.code });
        },
        withdraw: async (id) => {
          const outcome: any = await client.invoke('mail.withdraw', { id });
          if (outcome?.ok === false) throw Object.assign(new Error(outcome.error?.message ?? 'mail.withdraw failed'), { code: outcome.error?.code });
        },
        close() { for (const dispose of disposers) dispose(); (client as any).close?.(); for (const port of ports) port.close?.(); },
      });
    };
    host.addEventListener('message', listener);
    options.signal?.addEventListener?.('abort', abandon, { once: true });
    if (options.connectTimeoutMs !== undefined)
      timer = setTimeout(() => { settle(); reject(new OsConnectError('OS0401', `no desktop answered within ${options.connectTimeoutMs} ms`)); }, options.connectTimeoutMs);
    // announce this page; the shell answers with the ports
    host.parent?.postMessage?.({ type: HELLO, protocol: PROTOCOL }, '*');
  });
}
