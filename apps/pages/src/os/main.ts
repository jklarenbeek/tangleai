/**
 * The Pages desktop. The kernel installs the shipped modules, then every
 * suite named by `?suite=<url>`: a suite document an application serves,
 * listing its modules (usually `origin` modules on that application's own
 * pages). A link installs nothing by itself: the install sheet shows each
 * application and the person adds what they choose, kept in their state.
 * `#recovery` boots without the person's own layer.
 */
import { createKernel, webStorageStore, browserLocation, watchJobs, type WorkingHours } from '@tangleai/os';
import { filesModule } from '@tangleai/os/files';
import { webModule } from '@tangleai/os/web';
import { jobsModule } from '@tangleai/os/jobs-app';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { parseMarkdown, toHtml } from '@jarenjs/md';
import * as toolbox from '@tangleai/agents/toolbox';
import { mountDesktop, type SuiteDocument } from '@tangleai/os/shell';
import { builtinModules, shippedMounts } from './modules.ts';
import { createPreferences, JOBS_DECIDED_SLOT } from './preferences.ts';
import { pagesWebReader } from './web-access.ts';
import { pagesJobQueue, twinWanted, failedTwinQueue } from './job-access.ts';
import type { JobQueue } from '@tangleai/os/jobs';
import { browserJobQueue, startTwin, forgetBrowserOps } from '@tangleai/ops/browser';
import { desktopTasks } from './ops-tasks.ts';
import { pagesSimulate } from './ops-simulate.ts';
import { TWIN, DESKTOP_TASKS_CONTRACT } from './ops-twin.ts';
import { setBackground } from './background.ts';
import { createSurfaces } from './surfaces.ts';
import { setPagesLanguage, setPagesMessages } from './i18n.ts';
import { catalogues, dirOf, resolveLanguage, setActiveLanguage } from './language.ts';

// The assistant may call every served contract of the desktop's own applications;
// an application the person added reaches it only when they allowed that.
// this page has no server, so the desktop's state (the dock, the applications' settings) is kept in this
// browser; an application with a server passes contractStore over its own backend instead
const state = (() => { try { return webStorageStore(localStorage); } catch { return undefined; } })();
const prefs = createPreferences(window);
// one language for everything the desktop draws: the person's choice, or the browser's (`?lang=` for a link or a test)
const asked = new URLSearchParams(location.search).get('lang');
const sentinel = asked === 'sentinel';
const language = sentinel ? 'en' : resolveLanguage(asked ?? prefs.desktop().language, navigator.languages ?? [navigator.language]);
const packs = catalogues(sentinel ? 'sentinel' : language);
setPagesLanguage(language);
setPagesMessages(packs.pages);
setActiveLanguage(sentinel ? 'en' : language);
document.documentElement.lang = language;
document.documentElement.dir = dirOf(language);
const chrome = { ...(packs.os ? { messages: packs.os } : {}), ...(language !== 'en' ? { locale: language } : {}) };
// web pages are read by the host's reader the person set in Settings, Web access (none: OS0180), read again on every call
const webReader = pagesWebReader(() => prefs.desktop().webReader);
// background work: a host's, at the address Settings, Background work names; without one, the browser twin's —
// the jobs run in a worker of an open desktop tab, never this page (off under automation unless `?twin=1`)
const twinOn = twinWanted(location.search, navigator.webdriver === true);
let twinQueue: JobQueue | null = null, twin: { stop(): void } | null = null, ownsRuntime = false;
const jobQueue = pagesJobQueue(() => prefs.desktop().jobQueue, { twin: () => twinQueue });
const kernel = createKernel({ recovery: location.hash.includes('recovery'), assistantGrants: 'all', tools: toolbox, web: webReader, jobs: jobQueue, ...(state ? { state } : {}) });
if (twinOn) {
  try {
    twinQueue = browserJobQueue({ channelName: TWIN.channel });
    const storage = (() => { try { return localStorage; } catch { return null; } })();
    twin = startTwin({
      workerUrl: new URL('./os-ops-worker.js', import.meta.url), channelName: TWIN.channel, lockName: TWIN.lock,
      taskContract: DESKTOP_TASKS_CONTRACT,
      // each task gets the runtime's envelope ({ job, key?, input }); the page's tasks read the input
      tasks: Object.fromEntries(Object.entries(desktopTasks({ kernel, storage })).map(([op, run]) => [op, (call: any) => run(call?.input ?? {})])),
      onState: (state: any) => { ownsRuntime = state?.ops === 'owner'; if (state?.ops === 'error') console.error('background work', state.message); },
    });
  } catch (error: any) {
    // the twin never stops the desktop: Jobs says it could not start here, and why
    twinQueue = failedTwinQueue(String(error?.message ?? error));
    console.error('background work', error);
  }
}
setBackground({ forget: async () => {
  if (!twinOn) return false;
  twin?.stop(); twin = null;
  await forgetBrowserOps({ databaseName: TWIN.database, pool: TWIN.pool });
  return true;
} });
for (const manifest of builtinModules()) {
  const installed = kernel.install(manifest, 'shipped');
  if (!installed.ok) console.error(manifest.id, installed.issues);
}

// Files: the person's own files in this browser, in a folder of its private file system set aside for
// them (the file system's top holds the data studio's databases), and Markdown drawn by Jaren, escaped
const filesRoot = (navigator.storage as any)?.getDirectory?.().then((top: FileSystemDirectoryHandle) => top.getDirectoryHandle('tangle-files', { create: true }));
const files = filesModule({
  kernel, ...chrome,
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

// Web: a reader of pages, beside Files in the dock, reading through the host's reader the person named
// in Settings, Web access; without one it says so (OS0180), and its button opens that section
const web = webModule({ ...chrome, reader: kernel.webReader(), configure: () => {
  desktop.openSettings();
  void kernel.call('shell', 'tangle_os_settings', 'settings.show', { section: 'web' });
} });
{ const installed = kernel.install(web.manifest, 'shipped'); if (!installed.ok) console.error('web', installed.issues); }

// Jobs: the background work of the host the person named in Settings, Background work (none: OS0190),
// beside Web; the runs of a wall-clock schedule are computed with the browser's own time zone data
const jobs = jobsModule({ ...chrome, queue: kernel.jobQueue(), ownsRuntime: () => ownsRuntime, zoneProvider: createIntlZoneProvider({ revision: 'browser ICU' }),
  // what will happen: the registered schedules simulated in a worker of their own, on a separate copy
  simulate: pagesSimulate(new URL('./os-ops-sim-worker.js', import.meta.url), { zone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })() }),
  configure: () => {
  desktop.openSettings();
  void kernel.call('shell', 'tangle_os_settings', 'settings.show', { section: 'jobs' });
} });
{ const installed = kernel.install(jobs.manifest, 'shipped'); if (!installed.ok) console.error('jobs', installed.issues); }
// background work that needs the person reaches them: one inbox item per failed job or silent runtime, noticed in the
// working hours the Calendar keeps (none kept yet: never noticed, still filed), and what they decided is remembered
{
  const local = (() => { try { return localStorage; } catch { return null; } })();
  const hours = (): WorkingHours | undefined => {
    try { const doc = JSON.parse(local?.getItem('tangle-calendar') ?? 'null'); return doc?.$calendar === '0.1' && doc.hours ? doc.hours : undefined; } catch { return undefined; }
  };
  watchJobs({ kernel, queue: kernel.jobQueue(), hours, remember: {
    load: () => { try { return JSON.parse(local?.getItem(JOBS_DECIDED_SLOT) ?? '{}') ?? {}; } catch { return {}; } },
    save: (decided) => { try { local?.setItem(JOBS_DECIDED_SLOT, JSON.stringify(decided)); } catch { /* kept for this page */ } },
  } });
}

let buildInfo: Promise<any> | null = null;
const json = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
const build = () => (buildInfo ??= Promise.all([json('./build.json'), json('./os-build.json')]).then(([release, os]) => release && { ...release, jaren: os?.jaren }));

const node = document.getElementById('desktop')!;
// the work surfaces (Studio, Playground, Flow, Data, the adventure) share one
// composition; their tools join the assistant, and their links open windows
const surfaces = createSurfaces(window, { settings: () => prefs.ai(), open: (id) => { desktop.open(id); } });
const desktop = mountDesktop(node, {
  kernel,
  shipped: { ...shippedMounts(build, { kernel, prefs, open: (id) => { desktop.open(id); }, surfaces, chrome }), files: files.mount, web: web.mount, jobs: jobs.mount },
  documentHost: './os-module.html',
  // a phone gets one maximized window at a time
  compact: { below: 720 },
  theme: prefs.theme(prefs.effectiveScheme()),
  themeFor: (scheme) => prefs.theme(scheme),
  // the dock's switch is an explicit choice: it stops following the system
  onSchemeSwitch: (scheme) => { prefs.writeDesktop({ scheme }, 'dock'); },
  locale: language,
  dir: dirOf(language),
  ...(packs.os ? { messages: packs.os } : {}),
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
(window as any).tangleOs = { kernel, desktop, suites, surfaces, twin: { on: twinOn, owns: () => ownsRuntime } };
