/**
 * The Pages desktop. The kernel installs the shipped modules, then every
 * suite named by `?suite=<url>`: a suite document an application serves,
 * listing its modules (usually `origin` modules on that application's own
 * pages). A link installs nothing by itself: the install sheet shows each
 * application and the person adds what they choose, kept in their state.
 * `#recovery` boots without the person's own layer.
 */
import { createKernel, webStorageStore, browserLocation } from '@tangleai/os';
import { filesModule } from '@tangleai/os/files';
import { parseMarkdown, toHtml } from '@jarenjs/md';
import * as toolbox from '@tangleai/agents/toolbox';
import { mountDesktop, type SuiteDocument } from '@tangleai/os/shell';
import { builtinModules, shippedMounts } from './modules.ts';
import { createPreferences } from './preferences.ts';
import { createSurfaces } from './surfaces.ts';

// The assistant may call every served contract of the desktop's own applications;
// an application the person added reaches it only when they allowed that.
// this page has no server, so the desktop's state (the dock, the applications' settings) is kept in this
// browser; an application with a server passes contractStore over its own backend instead
const state = (() => { try { return webStorageStore(localStorage); } catch { return undefined; } })();
const kernel = createKernel({ recovery: location.hash.includes('recovery'), assistantGrants: 'all', tools: toolbox, ...(state ? { state } : {}) });
for (const manifest of builtinModules()) {
  const installed = kernel.install(manifest, 'shipped');
  if (!installed.ok) console.error(manifest.id, installed.issues);
}

// Files: the person's own files in this browser, in a folder of its private file system set aside for
// them (the file system's top holds the data studio's databases), and Markdown drawn by Jaren, escaped
const filesRoot = (navigator.storage as any)?.getDirectory?.().then((top: FileSystemDirectoryHandle) => top.getDirectoryHandle('tangle-files', { create: true }));
const files = filesModule({
  kernel,
  ...(filesRoot ? { browser: browserLocation(filesRoot) } : {}),
  previewers: [(node, file) => {
    if (file.entry.type !== 'text/markdown') return false;
    const article = document.createElement('article'); article.className = 'md tos-files-markdown';
    article.innerHTML = toHtml(parseMarkdown(file.text()));
    node.append(article);
    return true;
  }],
});
{ const installed = kernel.install(files.manifest, 'shipped'); if (installed.ok) files.serve(); else console.error('files', installed.issues); }

let buildInfo: Promise<any> | null = null;
const json = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
const build = () => (buildInfo ??= Promise.all([json('./build.json'), json('./os-build.json')]).then(([release, os]) => release && { ...release, jaren: os?.jaren }));

const prefs = createPreferences(window);
const node = document.getElementById('desktop')!;
// the work surfaces (Studio, Playground, Flow, Data, the adventure) share one
// composition; their tools join the assistant, and their links open windows
const surfaces = createSurfaces(window, { settings: () => prefs.ai(), open: (id) => { desktop.open(id); } });
const desktop = mountDesktop(node, {
  kernel,
  shipped: { ...shippedMounts(build, { kernel, prefs, open: (id) => { desktop.open(id); }, surfaces }), files: files.mount },
  documentHost: './os-module.html',
  // a phone gets one maximized window at a time
  compact: { below: 720 },
  theme: prefs.theme(prefs.effectiveScheme()),
  themeFor: (scheme) => prefs.theme(scheme),
  // the dock's switch is an explicit choice: it stops following the system
  onSchemeSwitch: (scheme) => { prefs.writeDesktop({ scheme }, 'dock'); },
  locale: document.documentElement.lang || 'en',
  dir: (document.documentElement.dir as 'ltr' | 'rtl') || 'ltr',
});

// the person's appearance: applied when it changes, and when the system's
// scheme changes while they follow it
const applyAppearance = () => {
  const scheme = prefs.effectiveScheme();
  try { desktop.setTheme(prefs.theme(scheme)); } catch (error) { console.error(error); }
};
prefs.subscribe((what, source) => { if (what === 'desktop' && source !== 'dock') applyAppearance(); });
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (prefs.desktop().scheme === 'system') applyAppearance(); });

// a suite named by a link joins only what the person adds in the install sheet
async function joinSuite(url: string) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return desktop.join(await response.json() as SuiteDocument, { source: url });
}

const suites = Promise.all(new URLSearchParams(location.search).getAll('suite').map(url => joinSuite(url).catch((error) => { console.error(error); return { installed: [], declined: [], unchanged: [], refused: [{ id: url, message: String(error) }] }; })));

// arriving: a former page link opens its application; otherwise Welcome greets
const arrival = location.hash.replace(/^#/, '');
const welcomed = (() => { try { return localStorage.getItem('tangle-os-welcomed') === '1'; } catch { return false; } })();
if (!(arrival.startsWith('/') && surfaces.follow(location.hash)) && !location.hash.includes('recovery') && !welcomed) {
  desktop.open('welcome');
  try { localStorage.setItem('tangle-os-welcomed', '1'); } catch { /* Welcome greets again next time */ }
}
window.addEventListener('hashchange', () => { surfaces.follow(location.hash); });

// for scripted checks and the browser tests
(window as any).tangleOs = { kernel, desktop, suites, surfaces };
