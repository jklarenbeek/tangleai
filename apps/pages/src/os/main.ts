/**
 * The Pages desktop. The kernel installs the shipped modules, then every
 * suite named by `?suite=<url>`: a suite document an application serves,
 * listing its modules (usually `origin` modules on that application's own
 * pages). A suite joined by a link is installed without grants. `#recovery` boots without the person's own layer.
 */
import { createKernel, validateManifest, type ModuleManifest } from '@tangleai/os';
import * as toolbox from '@tangleai/agents/toolbox';
import { mountDesktop } from '@tangleai/os/shell';
import { builtinModules, shippedMounts } from './modules.ts';
import { createPreferences } from './preferences.ts';
import { createSurfaces } from './surfaces.ts';

type SuiteDocument = { $suite: '0.1', id: string, title?: { en: string }, modules: ModuleManifest[] };

// The assistant may call every served contract for now; the grants order
// replaces this with the person's own consent per module.
const kernel = createKernel({ recovery: location.hash.includes('recovery'), assistantGrants: 'all', tools: toolbox });
for (const manifest of builtinModules()) {
  const installed = kernel.install(manifest, 'shipped');
  if (!installed.ok) console.error(manifest.id, installed.issues);
}

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
  shipped: shippedMounts(build, { kernel, prefs, open: (id) => { desktop.open(id); }, surfaces }),
  documentHost: './os-module.html',
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

async function joinSuite(url: string) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const suite = await response.json() as SuiteDocument;
  if (suite?.$suite !== '0.1' || !Array.isArray(suite.modules)) throw new Error(`${url}: not a suite document`);
  const results = [];
  for (const manifest of suite.modules) {
    const verdict = validateManifest(manifest);
    // a suite named by a link gets no grants: a link must not hand out access
    results.push(verdict.ok ? kernel.install(manifest, 'suite', { grant: false }) : verdict);
  }
  return results;
}

const suites = Promise.all(new URLSearchParams(location.search).getAll('suite').map(url => joinSuite(url).catch((error) => { console.error(error); return [{ ok: false, error: String(error) }]; })));

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
