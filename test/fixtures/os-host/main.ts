/**
 * A host application that is itself the desktop: it mounts `@tangleai/os`'s
 * shell over its own screens (shipped modules), with the options a real host
 * sets. The page reads them from its query, so one fixture covers a phone and
 * a wide screen:
 *   ?modules=16  how many screens   ?compact=760  compact below this width
 *   ?mail=0      no mail tile       ?brand=1      a brand mark in the dock
 *   ?framed=1    two applications on a second origin (localhost): one that
 *                never says hello, one that serves `echo`; ?deadline=ms
 *   ?settings=1  the desktop's Settings: a host section, screen 1's own
 *                settings, Echo's settings page, a document module's form,
 *                and (with ?framed=1) an application on the 0.49.2 join file
 * Everything the browser test needs is on `window.harness`.
 */
import { createKernel } from '../../../components/os/src/index.ts';
import { mountDesktop, type DesktopEvent } from '../../../components/os/src/shell.ts';
import { ECHO } from './echo.ts';
import { settingsModule } from '../../../components/os/src/settings.ts';

const query = new URLSearchParams(location.search);
const count = Number(query.get('modules') ?? 16);
const kernel = createKernel();
const visibility: Record<string, boolean[]> = {};
const shipped: Record<string, any> = {};
const withSettings = query.get('settings') === '1';
const contexts: Record<string, any> = {};
for (let i = 1; i <= count; i++) {
  const id = `screen-${i}`;
  kernel.install({
    ...(withSettings && i === 1 ? { settings: { kind: 'mount', mount: 'screen-1-settings', keywords: ['labels'] } } : {}),
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
  kernel.install({ $module: '0.1', id: 'echo-app', version: '1.0.0', title: { en: 'Echo' }, host: { kind: 'origin', url: `${other}/echo.html` }, provides: [ECHO],
    ...(withSettings ? { settings: { kind: 'page', url: `${other}/echo.html` } } : {}) }, 'shipped');
  // an application that joins with the 0.49.2 release's one-file module side
  kernel.install({ $module: '0.1', id: 'old-echo', version: '1.0.0', title: { en: 'Old echo' }, host: { kind: 'origin', url: `${other}/old.html` },
    provides: [{ $contract: '0.1', id: 'echo_old', operations: { 'echo.say': { kind: 'read', input: { type: 'object', properties: { text: { type: 'string' } } }, output: { type: 'object' } } } }] }, 'shipped');
}
if (withSettings) {
  shipped['screen-1-settings'] = (node: HTMLElement, context: any) => { node.innerHTML = '<h2 class="screen-settings">Screen 1 settings</h2>'; contexts['screen-1-settings'] = context; };
  kernel.install({ $module: '0.1', id: 'notes-doc', version: '1.0.0', title: { en: 'Notes' }, host: { kind: 'document', app: { $app: '0.1', state: {}, view: [] } },
    settings: { kind: 'form', schema: { type: 'object', additionalProperties: false, properties: { greeting: { type: 'string', title: 'Greeting', maxLength: 20 }, count: { type: 'integer', title: 'Count', minimum: 0, maximum: 9 } } } } }, 'shipped');
  const settings = settingsModule({ kernel, shipped, sections: [{ id: 'general', title: { en: 'General' }, keywords: ['name'], mount: (node) => { node.innerHTML = '<h2>General</h2>'; } }] });
  kernel.install(settings.manifest, 'shipped');
  shipped.settings = settings.mount;
}
const brand = query.get('brand') === '1' ? { label: 'Example shop', src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 16%22%3E%3Crect width=%2240%22 height=%2216%22 rx=%224%22/%3E%3C/svg%3E' } : undefined;
const events: DesktopEvent[] = [];
const desktop = mountDesktop(document.getElementById('desktop')!, {
  kernel, shipped,
  ...(query.has('compact') ? { compact: { below: Number(query.get('compact')) } } : {}),
  tray: { mail: query.get('mail') !== '0', ...(brand ? { brand } : {}) },
  ...(query.has('deadline') ? { connectTimeoutMs: Number(query.get('deadline')) } : {}),
});
desktop.subscribe((event) => events.push(event));
(window as any).harness = { kernel, desktop, events, visibility, contexts };
