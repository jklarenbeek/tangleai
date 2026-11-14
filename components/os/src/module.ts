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
  /** A compact description of what the page shows now, for the assistant. */
  context?: () => unknown;
  /** The window that sends the ports; the page's parent by default. */
  host?: { parent: any, addEventListener: (type: string, listener: (event: any) => void) => void, removeEventListener: (type: string, listener: (event: any) => void) => void, document?: any };
  timeoutMs?: number;
};
export type OsConnection = {
  module: string;
  connect: ConnectMessage;
  call(contract: string, op: string, input?: unknown): Promise<any>;
  sendMail(envelope: { to?: string, subject: string, body?: string, data?: unknown }): Promise<any>;
  setTitle(title: string): Promise<any>;
  close(): void;
};

/** Set token values as custom properties on a root element, and the colour scheme. */
export function applyTheme(root: any, theme: { tokens: Record<string, string>, scheme?: 'light' | 'dark' }) {
  if (!root?.style) return;
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (/^--[a-z0-9-]+$/.test(name)) root.style.setProperty(name, value);
  }
  if (theme.scheme) { root.style.colorScheme = theme.scheme; root.dataset && (root.dataset.scheme = theme.scheme); }
}

export function applyLocale(root: any, locale: { locale: string, dir: 'ltr' | 'rtl' }) {
  if (!root?.setAttribute) return;
  root.setAttribute('lang', locale.locale);
  root.setAttribute('dir', locale.dir);
}

/**
 * Join the desktop that frames this page. Resolves once the shell has handed
 * over its ports; a message from a window that is not the parent, or from an
 * origin not listed, is ignored.
 */
export function connectToOs(options: ConnectOptions): Promise<OsConnection> {
  const host = options.host ?? (globalThis as any);
  const root = host.document?.documentElement;
  return new Promise((resolve) => {
    const listener = (event: any) => {
      const data = event?.data as ConnectMessage;
      if (data?.type !== CONNECT || data.protocol !== PROTOCOL) return;
      if (event.source !== host.parent) return;
      if (options.origins !== 'parent' && !options.origins.includes(event.origin)) return;
      host.removeEventListener('message', listener);
      const ports: any[] = [...(event.ports ?? [])];
      const named = new Map<string, any>(data.ports.map((name, index) => [name, ports[index]]));
      const { os, module } = systemContracts();

      const disposers: (() => void)[] = [];
      const moduleServer = servePort(module, {
        'module.theme': (theme: any) => { applyTheme(root, theme); options.onTheme?.(theme); return {}; },
        'module.locale': (locale: any) => { applyLocale(root, locale); options.onLocale?.(locale); return {}; },
        'module.context': () => (options.context?.() ?? {}) as object,
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
        close() { for (const dispose of disposers) dispose(); (client as any).close?.(); for (const port of ports) port.close?.(); },
      });
    };
    host.addEventListener('message', listener);
    // announce this page; the shell answers with the ports
    host.parent?.postMessage?.({ type: HELLO, protocol: PROTOCOL }, '*');
  });
}
