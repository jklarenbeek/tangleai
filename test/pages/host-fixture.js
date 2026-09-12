/** Adapter for the retained assertions: production hosts expose document operations. */
import { mountPageHost } from '../../apps/pages/src/demos/host.js';
export function parseHash(hash) {
  const url = new URL(hash.slice(1), 'https://fixture.invalid');
  return { page: url.pathname.slice(1) || 'home', params: Object.fromEntries(url.searchParams) };
}
export function createSiteApp(env) {
  const document = env.document, root = document.createElement('main'), assistantNode = document.createElement('aside');
  env.node.appendChild(root); env.node.appendChild(assistantNode);
  let route = { page: 'home', params: {} };
  const slots = {};
  for (const [key, old] of [['settings', 'aiStorage'], ['transcript', 'aiChat'], ['ledger', 'aiLedger'], ['projects', 'storage']]) if (env[old]) slots[key] = env[old];
  const host = mountPageHost({ root, assistantNode, slots, schedule: env.schedule, debounceMs: 0, aiFetch: env.aiFetch,
    onError: env.onError, navigate: env.navigate, share: env.share,
    ...(Object.hasOwn(env, 'modelContext') ? { webmcp: { context: env.modelContext } } : {}),
    onRoute: page => { route = { page, params: {} }; },
  });
  env.listenHash?.(next => { host.setRoute(`#/${next.page === 'home' ? '' : next.page}?${new URLSearchParams(next.params)}`); route = next; });
  return { ready: host.webmcp.ready, dispatch: host.assistant.dispatch,
    getState: () => ({ ai: host.assistant.read(), route,
      ...(route.page === 'play' ? { play: host.play().read() } : {}),
      ...(route.page === 'flow' ? { flow: { kind: host.flow().read().kind, doc: host.flow().read().document } } : {}),
    }), destroy: host.dispose, host,
  };
}
