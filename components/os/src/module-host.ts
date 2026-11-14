/**
 * The document module host: the script a sandboxed frame runs. A host bundles
 * this entry once as a CLASSIC script (an opaque-origin frame cannot load a
 * module script from a server that sends no CORS headers) and serves it beside
 * a page that loads it.
 *
 * It boots the module's jaren-app document with exactly one granted effect,
 * `os`, whose only door is the port the shell handed over. The frame's origin
 * is opaque: it cannot read the desktop's storage, keys or DOM.
 *
 * The `os` effect: `{ "run": "os", "with": { "call": "mail.send" | "os.call" |
 * "window.title", "input": {…}, "then"?: action, "catch"?: action } }`.
 */
import { createApp, formEventFields } from '@jarenjs/app';
import { connectToOs, type OsConnection } from './module.ts';
import { KEY } from './contracts.ts';

const OPERATIONS = new Set(['os.call', 'mail.send', 'window.title']);

export type ModuleHostOptions = { node?: any, window?: any, onError?: (error: unknown) => void };

/** Boot the document module this frame is handed. Returns the connection and the running app. */
export async function bootDocumentModule(options: ModuleHostOptions = {}) {
  const win = options.window ?? (globalThis as any);
  const doc = win.document;
  let app: any = null;
  const connection: OsConnection = await connectToOs({ origins: 'parent', host: win, context: () => ({ state: app?.getState?.() ?? null }) });
  const module = connection.connect.document;
  if (!module) throw new Error('the shell sent no document to boot');
  if (module.styles) {
    const style = doc.createElement('style');
    style.setAttribute('data-module-styles', connection.module);
    style.textContent = module.styles;
    doc.head.append(style);
  }
  const report = options.onError ?? ((error: unknown) => win.console?.error?.(error));
  const os = (props: any, dispatch: (name: string, payload?: unknown) => void) => {
    const call = props?.call;
    if (!OPERATIONS.has(call)) { report(new Error(`the os effect cannot run '${String(call)}'`)); return; }
    const run = call === 'os.call' ? connection.call(props.input?.contract, props.input?.op, props.input?.input ?? {})
      : call === 'mail.send' ? connection.sendMail(props.input ?? {})
        : connection.setTitle(props.input?.title ?? '');
    Promise.resolve(run).then((outcome: any) => {
      // os.call answers with the kernel's own outcome inside the transport's
      const value = outcome?.ok ? outcome.value : undefined;
      const inner = call === 'os.call' ? value : outcome;
      if (outcome?.ok && (call !== 'os.call' || inner?.ok)) { if (props.then) dispatch(props.then, call === 'os.call' ? inner.value : value); }
      else if (props.catch) dispatch(props.catch, (call === 'os.call' ? inner?.error : outcome?.error) ?? { code: 'OS0103' });
    }, (error: unknown) => { if (props.catch) dispatch(props.catch, { code: 'OS0103', message: String(error) }); });
  };
  const node = options.node ?? doc.getElementById('module') ?? doc.body;
  app = createApp(module.app as any, {
    node,
    effects: { os },
    capabilities: { effects: ['os'], eventFields: Object.keys(formEventFields()) } as any,
    eventFields: { ...formEventFields() },
    onError: report,
  });
  // the desktop's own shortcuts still work while focus is inside the frame
  doc.addEventListener('keydown', (event: any) => {
    if ((event.ctrlKey || event.metaKey) && ['k', ' '].includes(String(event.key).toLowerCase())) {
      event.preventDefault();
      win.parent?.postMessage({ type: KEY, key: `${event.metaKey ? 'meta' : 'ctrl'}+${String(event.key).toLowerCase()}` }, '*');
    }
  });
  return { connection, app };
}

// as a classic script in a frame: boot at once
if (typeof (globalThis as any).document !== 'undefined' && (globalThis as any).document?.documentElement?.dataset?.tangleOsModule === 'auto') {
  bootDocumentModule().catch((error) => (globalThis as any).console?.error?.(error));
}
