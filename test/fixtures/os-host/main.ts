/**
 * A host application that is itself the desktop: it mounts `@tangleai/os`'s
 * shell over its own screens (shipped modules), with the options a real host
 * sets. The page reads them from its query, so one fixture covers a phone and
 * a wide screen:
 *   ?modules=16  how many screens   ?compact=760  compact below this width
 *   ?mail=0      no mail tile       ?brand=1      a brand mark in the dock
 *   ?framed=1    two applications on a second origin (localhost): one that
 *                never says hello, one that serves `echo`; ?deadline=ms
 * Everything the browser test needs is on `window.harness`.
 */
import { createKernel } from '../../../components/os/src/index.ts';
import { mountDesktop, type DesktopEvent } from '../../../components/os/src/shell.ts';
import { ECHO } from './echo.ts';

const query = new URLSearchParams(location.search);
const count = Number(query.get('modules') ?? 16);
const kernel = createKernel();
const visibility: Record<string, boolean[]> = {};
const shipped: Record<string, any> = {};
for (let i = 1; i <= count; i++) {
  const id = `screen-${i}`;
  kernel.install({
    $module: '0.1', id, version: '1.0.0', title: { en: `Screen ${i}` },
    icon: { glyph: i === 1 ? 'tag' : 'records', hue: (i * 23) % 360 },
    host: { kind: 'shipped', mount: id },
    window: { width: 840, height: 560, minWidth: 320, minHeight: 240, singleton: true },
  }, 'shipped');
  shipped[id] = (node: HTMLElement, context: any) => {
    node.innerHTML = `<p class="screen">Screen ${i}</p>`;
    visibility[context.window] = [context.visible];
    const stop = context.onVisibility((visible: boolean) => visibility[context.window].push(visible));
    return stop;
  };
}
if (query.get('framed') === '1') {
  const other = `http://localhost:${location.port}`;
  kernel.install({ $module: '0.1', id: 'silent', version: '1.0.0', title: { en: 'Silent' }, host: { kind: 'origin', url: `${other}/silent.html` } }, 'shipped');
  kernel.install({ $module: '0.1', id: 'echo-app', version: '1.0.0', title: { en: 'Echo' }, host: { kind: 'origin', url: `${other}/echo.html` }, provides: [ECHO] }, 'shipped');
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
(window as any).harness = { kernel, desktop, events, visibility };
