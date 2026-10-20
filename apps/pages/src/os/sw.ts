/**
 * The Radiant OS service worker, Tangle edition: the OS works offline, all of it.
 *
 *   - install: precache the shell and every file the build emitted, read
 *     from the list the build writes (`precache.json`: the app, its
 *     styles, the database worker, the SQLite wasm and its OPFS proxy,
 *     the Library's documents) — so an OS installed once boots, and
 *     reads its documentation, with no network at all;
 *   - everything else in scope: network-first, falling back to the
 *     cache — the build's file names carry no hash, so a cache-first
 *     worker would keep serving the release it was installed with; a
 *     fresh answer refreshes only what was precached;
 *   - navigations: the same, and only a navigation to the shell itself
 *     refreshes the cached shell;
 *   - every cache.put is gated on response.ok.
 *
 * Its caches are the `tangle-radiant-os-` ones and it never touches
 * another prefix: the Jaren edition's worker shares this origin (and
 * retires `radiant-os-` caches, which is why this prefix does not start
 * with that one).
 */

const worker = globalThis as any;
const PREFIX = 'tangle-radiant-os-';
const CACHE = `${PREFIX}v2`;
const BASE: string = worker.registration.scope; // e.g. https://host/tangleai/os/
const SHELL_PATH = new URL(BASE).pathname;

const PRECACHE = [
  BASE,
  `${BASE}manifest.webmanifest`,
  `${BASE}radiant.svg`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
];

const putOk = (key: any, response: Response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(key, copy));
  }
  return response;
};

/** Every file the build emitted, from the list the build writes. */
const builtFiles = (): Promise<string[]> => fetch(`${BASE}precache.json`)
  .then((response) => (response.ok ? response.json() : { files: [] }))
  .then((list: any) => (Array.isArray(list.files) ? list.files.map((file: string) => `${BASE}${file}`) : []))
  .catch(() => []);

worker.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).then(builtFiles).then((files) => cache.addAll(files)))
      .then(() => worker.skipWaiting()));
});

worker.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()));
});

worker.addEventListener('fetch', (event: any) => {
  const request: Request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(BASE)) return;

  if (request.mode === 'navigate') {
    const isShell = new URL(request.url).pathname === SHELL_PATH;
    event.respondWith(
      fetch(request)
        .then((response) => (isShell ? putOk(BASE, response) : response))
        .catch(() => caches.match(BASE)));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => fetch(request)
      .then((response) => (hit ? putOk(request, response) : response))
      .catch(() => hit ?? Response.error())));
});
