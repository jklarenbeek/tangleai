/**
 * A host application that is itself the desktop: it mounts `@tangleai/os`'s
 * shell over its own screens (shipped modules), with the options a real host
 * sets. The page reads them from its query, so one fixture covers a phone and
 * a wide screen:
 *   ?modules=16  how many screens   ?compact=760  compact below this width
 *   ?mail=0      no mail tile       ?brand=1      a brand mark in the dock (large: a 1200×400 image)
 *   ?framed=1    two applications on a second origin (localhost): one that
 *                never says hello, one that serves `echo`; ?deadline=ms
 *   ?settings=1  the desktop's Settings: a host section, screen 1's own
 *                settings, Echo's settings page, a document module's form,
 *                and (with ?framed=1) an application on the 0.49.2 join file
 *   ?header=1    (with ?framed=1) Echo puts a header bar in its title bar, and
 *                the assistant is granted the header contract
 *   ?dir=rtl     the desktop in Arabic, right to left
 *   ?lang=xx     the desktop's chrome in one of the eleven packs (ar mirrors);
 *                ?lang=sentinel renders every key as ⟦key⟧, to find text outside the catalogue
 *   ?dock=1      a suite of one page whose screens are launch entries in two
 *                folders, the dock kept in sessionStorage, the assistant
 *                granted the dock contract
 *   ?state=server  the desktop's state kept by the test server (POST /state/<op>)
 *   ?files=1     the desktop's Files with "This browser" (a folder of OPFS), and
 *                (with ?framed=1) Echo's read-only file location
 *   ?pause=1     (with ?framed=1) Echo also files a paused run that asks for an answer
 *   ?caps=1      two capabilities (purchasing for screen 1, warehouse for Echo); the host
 *                files a paused purchasing run at boot, with no window open
 *   ?web=1       the desktop's Web with a scripted reader: two pages that link each other, a
 *                search that finds both, a refused and an unreadable address; ?web=none has no
 *                web access configured (OS0180)
 *   ?jobs=1      the desktop's Jobs over a scripted host queue: three schedules (every 15 minutes;
 *                daily at 03:00 Amsterdam time and Mondays at 06:00, both set by the host's
 *                registry, the second single-send), jobs in every state with a dead one's error,
 *                one job held by another process (OS0193), recorded attempts and a runtime
 *                heartbeat (&stale=1 makes it five minutes old); ?jobs=none has no job host (OS0190)
 * Everything the browser test needs is on `window.harness`.
 */
import { createKernel, webStorageStore, contractStore, browserLocation, fileLocationContract } from '../../../components/os/src/index.ts';
import { filesModule } from '../../../components/os/src/files-app.ts';
import { webModule } from '../../../components/os/src/web-app.ts';
import { WEB_CODES, unconfiguredWebReader, type WebPage, type WebReader } from '../../../components/os/src/web.ts';
import { jobsModule } from '../../../components/os/src/jobs-app.ts';
import { JOB_CODES, unconfiguredJobQueue, type JobEvent, type JobItem, type JobQueue, type JobSchedule, type JobState, type RegisteredJob } from '../../../components/os/src/jobs.ts';
import { compileRecurrence, floatingValue, utcValue } from '@jarenjs/core/calendar';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { conformLocation } from '../file-location-conformance.ts';
import { mountDesktop, type DesktopEvent } from '../../../components/os/src/shell.ts';
import { ECHO } from './echo.ts';
import { settingsModule } from '../../../components/os/src/settings.ts';
import { osMessagesEn, type OsCatalogue } from '../../../components/os/src/messages.ts';
import { ar } from '../../../components/os/src/messages/ar.ts';
import { de } from '../../../components/os/src/messages/de.ts';
import { es } from '../../../components/os/src/messages/es.ts';
import { fr } from '../../../components/os/src/messages/fr.ts';
import { ja } from '../../../components/os/src/messages/ja.ts';
import { ko } from '../../../components/os/src/messages/ko.ts';
import { nl } from '../../../components/os/src/messages/nl.ts';
import { pt } from '../../../components/os/src/messages/pt.ts';
import { ru } from '../../../components/os/src/messages/ru.ts';
import { tr } from '../../../components/os/src/messages/tr.ts';
import { zhTW } from '../../../components/os/src/messages/zh-tw.ts';

const query = new URLSearchParams(location.search);
const PACKS: Record<string, OsCatalogue> = { ar, de, es, fr, ja, ko, nl, pt, ru, tr, 'zh-TW': zhTW };
const lang = query.get('lang');
// the sentinel pack: every key renders as itself, so any other text in the chrome came from somewhere else
const messages: Partial<OsCatalogue> | undefined = lang === 'sentinel'
  ? Object.fromEntries(Object.keys(osMessagesEn).map(k => [k, `⟦${k}⟧`])) as OsCatalogue
  : lang ? PACKS[lang] : undefined;
const count = Number(query.get('modules') ?? 16);
const withHeader = query.get('header') === '1';
const withFiles = query.get('files') === '1';
const withPause = query.get('pause') === '1';
const withCaps = query.get('caps') === '1';
const withMenu = query.get('menu') === '1';
// what the framed Echo turns on, from the host's own switches
const echoFlags = [withHeader && 'header', withFiles && 'files', withPause && 'pause', withCaps && 'caps', withMenu && 'menu'].filter(Boolean);
const echoQuery = echoFlags.length ? `?${echoFlags.join('&')}` : '';
const withDock = query.get('dock') === '1';
// ?state=server keeps the desktop's state on the test server (as an application keeps it in its database)
const serverState = query.get('state') === 'server';
const httpClient = { invoke: async (op: string, input: unknown) => {
  const response = await fetch(`/state/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`state ${op}: ${response.status}`);
  return { ok: true, value: await response.json() };
} };
const state = serverState ? contractStore(httpClient) : withDock ? webStorageStore(sessionStorage) : undefined;
const kernel = createKernel({ ...(withHeader || withDock || withFiles ? { assistantGrants: [...(withHeader ? ['tangle_os_header.*'] : []), ...(withDock ? ['tangle_os_dock.*'] : []), ...(withFiles ? ['tangle_os_files.*', 'tangle_os_files_browser.*', 'echo_files.*'] : [])] } : {}), ...(state ? { state } : {}) });
const screens: string[] = [];
const visibility: Record<string, boolean[]> = {};
const shipped: Record<string, any> = {};
const withSettings = query.get('settings') === '1';
const contexts: Record<string, any> = {};
for (let i = 1; i <= count; i++) {
  const id = `screen-${i}`;
  kernel.install({
    ...(withSettings && i === 1 ? { settings: { kind: 'mount', mount: 'screen-1-settings', keywords: ['labels'] } } : {}),
    ...(withCaps && i === 1 ? { capabilities: ['purchasing'] } : {}),
    $module: '0.1', id, version: '1.0.0', title: { en: `Screen ${i}` },
    icon: { glyph: i === 1 ? 'tag' : 'records', hue: (i * 23) % 360 },
    host: { kind: 'shipped', mount: id },
    window: { width: 840, height: 560, minWidth: 320, minHeight: 240, singleton: true },
  }, 'shipped');
  shipped[id] = (node: HTMLElement, context: any) => {
    node.innerHTML = `<p class="screen">Screen ${i}</p>`;
    visibility[context.window] = [context.visible];
    contexts[id] = context;
    const stop = context.onVisibility((visible: boolean) => visibility[context.window].push(visible));
    return stop;
  };
}
if (query.get('framed') === '1') {
  const other = `http://localhost:${location.port}`;
  kernel.install({ $module: '0.1', id: 'silent', version: '1.0.0', title: { en: 'Silent' }, host: { kind: 'origin', url: `${other}/silent.html` } }, 'shipped');
  kernel.install({ $module: '0.1', id: 'echo-app', version: '1.0.0', title: { en: 'Echo' }, host: { kind: 'origin', url: `${other}/echo.html${echoQuery}` }, provides: [ECHO, ...(withFiles ? [fileLocationContract('echo_files') as any] : [])], ...(withFiles ? { files: { contract: 'echo_files', title: { en: 'Echo files' } }, opens: [{ type: 'text/plain' }] } : {}), ...(withCaps ? { capabilities: ['warehouse'] } : {}), proposals: [{ kind: 'echo.reply', title: { en: 'Echo reply' } }],
    ...(withSettings ? { settings: { kind: 'page', url: `${other}/echo.html?settings` } } : {}) }, 'shipped');
  // an application that joins with the 0.49.2 release's one-file module side
  kernel.install({ $module: '0.1', id: 'old-echo', version: '1.0.0', title: { en: 'Old echo' }, host: { kind: 'origin', url: `${other}/old.html` },
    provides: [{ $contract: '0.1', id: 'echo_old', operations: { 'echo.say': { kind: 'read', input: { type: 'object', properties: { text: { type: 'string' } } }, output: { type: 'object' } } } }] }, 'shipped');
}
const decided: unknown[] = [];
if (withCaps) {
  for (const capability of [
    { $capability: '0.1', id: 'purchasing', title: { en: 'Purchasing' }, contracts: [], prompts: { en: { system: 'You help the buyer.' } },
      proposals: [{ kind: 'purchase.order', title: { en: 'Purchase order' }, review: { origins: ['human', 'ai'], roles: ['buyer'] } }, { kind: 'run.pause', title: { en: 'A run waits' }, review: { origins: ['ai'] } }] },
    { $capability: '0.1', id: 'warehouse', title: { en: 'Warehouse' }, contracts: [], prompts: { en: { system: 'You help count stock.' } },
      proposals: [{ kind: 'stock.count', title: { en: 'Stock count' }, review: { origins: ['human', 'import'] } }] },
  ]) { const installed = kernel.installCapability(capability, 'suite'); if (!installed.ok) throw new Error(installed.error.message); }
}
if (withDock) {
  // one page, five screens: four in two folders, one on its own
  kernel.install({
    $module: '0.1', id: 'suite', version: '1.0.0', title: { en: 'Suite' }, icon: { glyph: 'records', hue: 200 }, host: { kind: 'shipped', mount: 'suite' },
    window: { singleton: true },
    entries: [
      { id: 'staff', title: { en: 'Staff' }, screen: 'staff', folder: 'people' },
      { id: 'leave', title: { en: 'Leave' }, screen: 'leave', folder: 'people' },
      { id: 'rota', title: { en: 'Rota' }, screen: 'rota', folder: 'planning' },
      { id: 'shifts', title: { en: 'Shifts' }, screen: 'shifts', folder: 'planning' },
      { id: 'home', title: { en: 'Home' }, screen: 'home' },
    ],
    dock: { folders: [{ id: 'people', title: { en: 'People' } }, { id: 'planning', title: { en: 'Planning' } }] },
  }, 'shipped');
  shipped.suite = (node: HTMLElement, context: any) => {
    const show = (screen: string) => { screens.push(screen); node.textContent = `Suite: ${screen}`; };
    show(context.screen ?? 'home');
    return context.onScreen(show);
  };
}
let opfsRoot: Promise<FileSystemDirectoryHandle> | null = null;
if (withFiles) {
  opfsRoot = navigator.storage.getDirectory().then(top => top.getDirectoryHandle('tangle-files-test', { create: true }));
  const files = filesModule({ kernel, browser: browserLocation(opfsRoot), ...(messages ? { messages, ...(lang !== 'sentinel' ? { locale: lang! } : {}) } : {}) });
  kernel.install(files.manifest, 'shipped');
  files.serve();
  shipped.files = files.mount;
}
// the Web: a scripted reader, as a host's server would answer
const webMode = query.get('web');
const webCalls: unknown[] = [];
if (webMode) {
  const at = (path: string) => `https://pages.example/${path}`;
  const page = (path: string, title: string, lang: string, blocks: WebPage['blocks']): WebPage => ({
    url: at(path), finalUrl: at(path), title, lang, blocks, links: blocks.flatMap(b => b.kind === 'paragraph' ? b.links ?? [] : []), fetchedAt: '2026-11-23T10:00:00Z', redirects: [],
  });
  const PAGES: Record<string, WebPage> = {
    [at('alpha')]: page('alpha', 'Alpha page', 'en', [
      { kind: 'heading', level: 2, text: 'About alpha' },
      { kind: 'paragraph', text: 'Alpha links to the beta page, and never runs <script>alert(1)</script>.', links: [{ text: 'the beta page', href: '/beta' }, { text: 'a script', href: 'javascript:alert(1)' }] },
      { kind: 'list', ordered: false, items: ['first', 'second'] },
      { kind: 'code', text: 'const answer = 42;' },
    ]),
    [at('beta')]: { ...page('beta', 'Beta-Seite', 'de', [
      { kind: 'paragraph', text: 'Zurück zur Alpha-Seite.', links: [{ text: 'Alpha-Seite', href: 'https://pages.example/alpha' }] },
      { kind: 'table', rows: [['Name', 'Wert'], ['beta', '2']] },
    ]), url: at('b'), redirects: [at('b')] },
  };
  const scripted: WebReader = {
    read: async ({ url }) => {
      webCalls.push({ read: url });
      const known = PAGES[url === at('b') ? at('beta') : url];
      if (known) return known;
      if (url.includes('private')) throw Object.assign(new Error('a private host'), { code: WEB_CODES.refused });
      throw Object.assign(new Error('HTTP 404'), { code: WEB_CODES.unreadable });
    },
    search: async ({ query: words }) => {
      webCalls.push({ search: words });
      return { results: words === 'nothing' ? [] : [
        { title: 'Alpha page', url: at('alpha'), snippet: 'Alpha links to the beta page.' },
        { title: 'Beta-Seite', url: at('b'), snippet: 'Zurück zur Alpha-Seite.' },
      ] };
    },
  };
  const web = webModule({ reader: webMode === 'none' ? unconfiguredWebReader() : scripted, ...(messages ? { messages, ...(lang !== 'sentinel' ? { locale: lang! } : {}) } : {}) });
  kernel.install(web.manifest, 'shipped');
  shipped.web = web.mount;
}
// Jobs: a scripted host queue, answering as the job_queue provider over a store does
const jobsMode = query.get('jobs');
const jobCalls: unknown[] = [];
if (jobsMode) {
  const t0 = Date.now();
  const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
  const job = (id: string, kind: string, state: JobState, extra: Partial<JobItem> = {}): JobItem => ({
    id, kind, state, runAt: t0 + 60_000, attempts: state === 'pending' ? 0 : 1, maxAttempts: 5, leaseUntil: state === 'leased' ? t0 + 30_000 : null,
    lastError: null, createdAt: t0 - 3_600_000, updatedAt: t0 - 60_000, ...extra,
  });
  const jobs: JobItem[] = [
    job('push-0001', 'orders.push', 'failed', { attempts: 2, runAt: t0 + 120_000, lastError: { message: 'the warehouse answered 503\nretry later', code: 'HTTP503' } }),
    job('push-0002', 'orders.push', 'failed', { attempts: 3, lastError: { message: 'timed out after 30 s' } }),
    job('push-0003', 'orders.push', 'failed', { attempts: 1, lastError: { message: 'the connection was reset' } }),
    job('mail-0001', 'mail.send', 'dead', { attempts: 5, runAt: t0 - 600_000, lastError: { message: 'the courier refused the parcel' } }),
    job('mail-0002', 'mail.send', 'dead', { attempts: 5, runAt: t0 - 900_000, lastError: { message: 'mailbox unavailable' } }),
    job('sync-held-here', 'stock.sync', 'leased'),
    job('sync-held-other', 'stock.sync', 'leased'),
    ...Array.from({ length: 60 }, (_, i) => job(`wait-${String(i).padStart(3, '0')}`, i % 2 ? 'mail.send' : 'orders.push', 'pending', { runAt: t0 + (i + 1) * 60_000 })),
    ...Array.from({ length: 6 }, (_, i) => job(`done-${i}`, 'stock.sync', 'done', { runAt: t0 - (i + 1) * 900_000 })),
    job('old-0001', 'report.build', 'cancelled'), job('old-0002', 'report.build', 'cancelled'),
  ];
  const schedules: JobSchedule[] = [
    { id: 'stock', kind: 'stock.sync', series: compileRecurrence({ dtstart: utcValue('2026-01-01T00:00:00Z'), rrule: 'FREQ=MINUTELY;INTERVAL=15' }) as any, zone: null, policy: 'rfc5545', missed: 'skip', latenessMs: null,
      state: 'active', nextRunAt: null, nextRecurrenceId: null, lastRunAt: t0 - 300_000, lastRecurrenceId: null, counts: { fired: 412, skipped: 0 }, stall: null, createdAt: t0 - 86_400_000, updatedAt: t0 - 300_000 },
    { id: 'ops:fixture:stock.full', kind: 'ops.fire', series: compileRecurrence({ dtstart: floatingValue('2026-01-01', '03:00'), rrule: 'FREQ=DAILY' }) as any, zone: 'Europe/Amsterdam', policy: 'rfc5545', missed: 'skip', latenessMs: null,
      state: 'active', nextRunAt: null, nextRecurrenceId: null, lastRunAt: t0 - 32_400_000, lastRecurrenceId: null, counts: { fired: 30, skipped: 1, uncounted: 2 }, stall: null, createdAt: t0 - 86_400_000 * 30, updatedAt: t0 - 32_400_000 },
    { id: 'ops:fixture:orders.push', kind: 'ops.fire', series: compileRecurrence({ dtstart: floatingValue('2026-01-05', '06:00'), rrule: 'FREQ=WEEKLY;BYDAY=MO' }) as any, zone: 'Europe/Amsterdam', policy: 'rfc5545', missed: 'skip', latenessMs: null,
      state: 'active', nextRunAt: null, nextRecurrenceId: null, lastRunAt: t0 - 86_400_000 * 2, lastRecurrenceId: null, counts: { fired: 12, skipped: 0 }, stall: null, createdAt: t0 - 86_400_000 * 90, updatedAt: t0 - 86_400_000 * 2 },
  ];
  // the host's registry: the two schedules it set, one of them a job that must never run twice
  const registry: RegisteredJob[] = [
    { kind: 'stock.full', title: { en: 'Read all stock', nl: 'Alle voorraad lezen' }, safety: 'safe-read', scheduled: true, schedule: 'ops:fixture:stock.full' },
    { kind: 'orders.push', title: { en: 'Send the orders', nl: 'De orders verzenden' }, safety: 'single-send', scheduled: true, schedule: 'ops:fixture:orders.push' },
  ];
  // what the runtime recorded: two failed attempts, a completed one, and an attempt a crash cut off and that is not repeated
  const events: JobEvent[] = [
    { id: 'push-0001#1:started', at: t0 - 1_800_000, event: 'started', kind: 'orders.push', jobId: 'push-0001', attempt: 1 },
    { id: 'push-0001#1:failed', at: t0 - 1_799_000, event: 'failed', kind: 'orders.push', jobId: 'push-0001', attempt: 1, durationMs: 1012, code: 'HTTP503', message: 'the warehouse answered 503\nretry later' },
    { id: 'push-0001#2:started', at: t0 - 120_000, event: 'started', kind: 'orders.push', jobId: 'push-0001', attempt: 2 },
    { id: 'push-0001#2:failed', at: t0 - 119_500, event: 'failed', kind: 'orders.push', jobId: 'push-0001', attempt: 2, durationMs: 480, code: 'HTTP503', message: 'the warehouse answered 503' },
    { id: 'done-0#1:started', at: t0 - 900_000, event: 'started', kind: 'stock.sync', jobId: 'done-0', attempt: 1 },
    { id: 'done-0#1:completed', at: t0 - 898_166, event: 'completed', kind: 'stock.sync', jobId: 'done-0', attempt: 1, durationMs: 1834 },
    { id: 'mail-0002#5:started', at: t0 - 900_000, event: 'started', kind: 'mail.send', jobId: 'mail-0002', attempt: 5 },
    { id: 'mail-0002#5:lost', at: t0 - 600_000, event: 'lost', kind: 'mail.send', jobId: 'mail-0002', attempt: 5, message: 'the process running this attempt stopped' },
    { id: 'mail-0002#5:not-repeated', at: t0 - 600_000, event: 'not-repeated', kind: 'mail.send', jobId: 'mail-0002', attempt: 5 },
  ];
  const stale = query.get('stale') === '1';
  const find = (id: string) => { const found = jobs.find(j => j.id === id); if (!found) throw coded(JOB_CODES.unknown, `there is no job ${id}`); return found; };
  const scripted: JobQueue = {
    counts: async () => {
      jobCalls.push({ counts: true });
      const by = (state: JobState) => jobs.filter(j => j.state === state).length;
      const pendingKinds: Record<string, number> = {};
      for (const j of jobs) if (j.state === 'pending') pendingKinds[j.kind] = (pendingKinds[j.kind] ?? 0) + 1;
      return { pending: by('pending'), leased: by('leased'), done: by('done'), failed: by('failed'), dead: by('dead'), cancelled: by('cancelled'), pendingKinds };
    },
    page: async (input = {}) => {
      jobCalls.push({ page: input });
      const limit = input.limit ?? 100;
      const all = jobs.filter(j => (!input.state || j.state === input.state) && (!input.kind || j.kind === input.kind)).sort((a, b) => a.id.localeCompare(b.id)).filter(j => !input.after || j.id > input.after);
      const items = all.slice(0, limit);
      return all.length > limit ? { items, next: items[items.length - 1].id } : { items };
    },
    get: async ({ id }) => { jobCalls.push({ get: id }); return find(id); },
    schedules: async () => { jobCalls.push({ schedules: true }); return { schedules: [...schedules] }; },
    cancel: async ({ id }) => {
      jobCalls.push({ cancel: id });
      const j = find(id);
      if (j.state === 'cancelled') return { changed: false };
      if (j.state === 'done' || j.state === 'dead') throw coded(JOB_CODES.refused, `job ${id} is ${j.state}`);
      if (id === 'sync-held-other') throw coded(JOB_CODES.held, `job ${id} is running in another process`);
      j.state = 'cancelled'; j.updatedAt = Date.now(); return { changed: true };
    },
    requeue: async ({ id }) => {
      jobCalls.push({ requeue: id });
      const j = find(id);
      if (j.state === 'pending') return { changed: false };
      if (j.state === 'done' || j.state === 'leased') throw coded(JOB_CODES.refused, `job ${id} is ${j.state}`);
      j.state = 'pending'; j.runAt = Date.now(); j.updatedAt = Date.now(); return { changed: true };
    },
    unschedule: async ({ id }) => {
      jobCalls.push({ unschedule: id });
      const at = schedules.findIndex(s => s.id === id);
      if (at < 0) throw coded(JOB_CODES.unknown, `there is no schedule ${id}`);
      if (id.startsWith('ops:')) throw coded(JOB_CODES.refused, 'set by the host\'s registry');
      schedules.splice(at, 1); return { changed: true };
    },
    events: async (input = {}) => {
      jobCalls.push({ events: input });
      return { events: events.filter(e => (!input.jobId || e.jobId === input.jobId) && (!input.kind || e.kind === input.kind)) };
    },
    health: async () => { jobCalls.push({ health: true }); const at = Date.now(); return { now: at, runtimes: [{ runtime: 'fixture@host', at: stale ? at - 300_000 : at - 20_000, stats: { claims: 12, ticks: 340 } }] }; },
    registry: async () => { jobCalls.push({ registry: true }); return { jobs: registry }; },
    run: async ({ kind }) => {
      jobCalls.push({ run: kind });
      if (!registry.some(r => r.kind === kind)) throw coded(JOB_CODES.unknown, `the registry has no job '${kind}'`);
      if (jobs.some(j => j.kind === kind && (j.state === 'pending' || j.state === 'leased'))) throw coded(JOB_CODES.refused, `a '${kind}' job is already waiting`);
      const id = `run:fixture:${kind}@now-${new Date().toISOString()}`;
      jobs.push(job(id, kind, 'pending', { runAt: Date.now() })); return { id };
    },
  };
  const jobsApp = jobsModule({ queue: jobsMode === 'none' ? unconfiguredJobQueue() : scripted, zoneProvider: createIntlZoneProvider({ revision: 'browser ICU' }),
    ...(messages ? { messages, ...(lang !== 'sentinel' ? { locale: lang! } : {}) } : {}) });
  kernel.install(jobsApp.manifest, 'shipped');
  shipped.jobs = jobsApp.mount;
}
if (withSettings) {
  shipped['screen-1-settings'] = (node: HTMLElement, context: any) => { node.innerHTML = '<h2 class="screen-settings">Screen 1 settings</h2>'; contexts['screen-1-settings'] = context; };
  kernel.install({ $module: '0.1', id: 'notes-doc', version: '1.0.0', title: { en: 'Notes' }, host: { kind: 'document', app: { $app: '0.1', state: {}, view: [] } },
    settings: { kind: 'form', schema: { type: 'object', additionalProperties: false, properties: { greeting: { type: 'string', title: 'Greeting', maxLength: 20 }, count: { type: 'integer', title: 'Count', minimum: 0, maximum: 9 } } } } }, 'shipped');
  const settings = settingsModule({ kernel, shipped, ...(messages ? { messages, ...(lang !== 'sentinel' ? { locale: lang! } : {}) } : {}), sections: [{ id: 'general', title: { en: 'General' }, keywords: ['name'], mount: (node) => { node.innerHTML = '<h2>General</h2>'; } }] });
  kernel.install(settings.manifest, 'shipped');
  shipped.settings = settings.mount;
}
const brand = query.get('brand') === '1' ? { label: 'Example shop', src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 16%22%3E%3Crect width=%2240%22 height=%2216%22 rx=%224%22/%3E%3C/svg%3E' }
  // an image with a large intrinsic size, as a raster logo has
  : query.get('brand') === 'large' ? { label: 'Example shop', src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22400%22 viewBox=%220 0 1200 400%22%3E%3Crect width=%221200%22 height=%22400%22 rx=%2240%22/%3E%3C/svg%3E' }
  : undefined;
const events: DesktopEvent[] = [];
const desktop = mountDesktop(document.getElementById('desktop')!, {
  kernel, shipped,
  ...(query.has('compact') ? { compact: { below: Number(query.get('compact')) } } : {}),
  tray: { mail: query.get('mail') !== '0', ...(brand ? { brand } : {}) },
  ...(query.has('deadline') ? { connectTimeoutMs: Number(query.get('deadline')) } : {}),
  ...(query.get('dir') === 'rtl' || lang === 'ar' ? { locale: 'ar', dir: 'rtl' as const } : lang && lang !== 'sentinel' ? { locale: lang } : {}),
  ...(messages ? { messages } : {}),
});
desktop.subscribe((event) => events.push(event));
// the scheduled run paused overnight: the host files it at boot, before any window opens, and takes the answer itself
if (withCaps) {
  kernel.registerDecider('screen-1', 'host', (decision) => { decided.push(decision); });
  const filed = kernel.propose('screen-1', { id: 'weekly-order', kind: 'run.pause', title: 'How many crates of cola this week?', origin: 'ai', revision: '0',
    answer: { label: 'Send', schema: { type: 'object', required: ['crates'], properties: { crates: { type: 'integer', minimum: 0, title: 'Crates' } } } } });
  if (!filed.ok) throw new Error(filed.error.message);
  kernel.propose('screen-1', { id: 'po-cola', kind: 'purchase.order', title: 'Order 12 crates of cola', origin: 'ai' });
}
(window as any).harness = {
  decided, webCalls, jobCalls,
  kernel, desktop, events, visibility, contexts, screens,
  // the conformance suite against a fresh OPFS folder of its own
  conformOpfs: async () => {
    const top = await navigator.storage.getDirectory();
    await top.removeEntry('tangle-files-conformance', { recursive: true }).catch(() => {});
    return conformLocation(browserLocation(await top.getDirectoryHandle('tangle-files-conformance', { create: true })));
  },
  clearFiles: async () => { if (!opfsRoot) return; const root = await opfsRoot; for await (const name of (root as any).keys()) await root.removeEntry(name, { recursive: true }); },
};
