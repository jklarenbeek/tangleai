/**
 * A window onto an app the crew built: the app document mounted with
 * `@jarenjs/app` inside the OS, as its own app with its own state. The
 * document is data the contract validated block by block, so mounting
 * it runs nothing but the app runtime interpreting JSON. A new document
 * (the crew built another block) is a fresh mount; the server render is
 * the app's first frame.
 */

import { createApp } from '@jarenjs/app';

export type MiniProps = { app: any, label?: string };

/** The widget definition. */
export const miniWidget = {
  mount(host: any, props: MiniProps, _emit: (binding: any, event?: any) => void, context?: { document?: any }) {
    const handle = { host, doc: context?.document ?? host.ownerDocument, app: null as any, current: null as any };
    open(handle, props.app);
    return handle;
  },
  update(handle: any, props: MiniProps) {
    if (props.app !== handle.current) open(handle, props.app);
  },
  unmount(handle: any) {
    handle.app?.destroy();
  },
  ssr(props: MiniProps) {
    const app = createApp(props.app, {});
    const vnode = app.getVnode();
    app.destroy();
    return vnode;
  },
};

/** Mount (or remount) a document in the widget's host. */
function open(handle: any, doc: any) {
  handle.app?.destroy();
  handle.host.textContent = '';
  handle.current = doc;
  // a block that misbehaves stays inside its app: the studio around it goes on
  handle.app = createApp(doc, { node: handle.host, document: handle.doc, onError: () => {} });
}
