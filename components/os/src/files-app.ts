/**
 * The desktop's Files: every file location in one window. The sidebar lists
 * the locations (the person's own "This browser" when the host offers it,
 * then each application's), the window's header bar carries back, forward,
 * up, the search and the menu, and the pane shows a folder. A file opens in a
 * preview beside it: an image as an image, a PDF in the browser's own viewer,
 * text as text, and Markdown or any other type through a previewer the host
 * passes. Nothing a file holds ever runs as the desktop's own markup.
 *
 * Everything Files does goes through the location's contract as the person's
 * own hand (`shell`), into the ledger; the assistant reads files only through
 * the kernel's `tangle_os_files`.
 */
import { localized, type ModuleManifest } from './manifest.ts';
import { createOsMessages, type OsCatalogue } from './messages.ts';
import { fileLocationContract, serveFileLocation, fileAnswer, fileBase64ToBytes, fileBytesToBase64, typeOfName, MAX_INLINE_BYTES, type FileEntry, type FileContent, type FileLocationHandlers } from './files.ts';
import type { Kernel } from './kernel.ts';
import type { ShippedContext, ShippedMount } from './shell.ts';

/** Draws a preview of a file into `node` (Markdown, say), or answers false to leave it to the next. */
export type FilePreviewer = (node: HTMLElement, file: { entry: FileEntry, bytes: Uint8Array, text: () => string }) => boolean | void;
export type FilesOptions = {
  kernel: Kernel,
  /**
   * The person's own files in this browser, when the host offers them: the
   * handlers of a location (`browserLocation` over a directory of the
   * browser's file system the host set aside for them, never its root). A
   * host whose state lives on its server leaves this out.
   */
  browser?: FileLocationHandlers,
  /** Previewers for types the desktop does not draw itself, tried in order before plain text. */
  previewers?: FilePreviewer[],
  messages?: Partial<OsCatalogue>,
  /** The language `messages` is in: the desktop's own title of Files and of "This browser" in it. */
  locale?: string,
  id?: string,
};
export const BROWSER_LOCATION = 'tangle_os_files_browser';

/** The Files module: its manifest, its mount, and `serve` (call once it is installed) for "This browser". */
export function filesModule(options: FilesOptions): { manifest: ModuleManifest, mount: ShippedMount, serve(): void } {
  const id = options.id ?? 'files';
  const t = createOsMessages(options.messages);
  // the desktop's own application is named in the person's language, as its chrome is
  const named = (en: string, text: string) => ({ en, ...(options.locale && options.locale !== 'en' && options.messages ? { [options.locale]: text } : {}) });
  const manifest: ModuleManifest = {
    $module: '0.1', id, version: '1.0.0', category: 'system',
    title: named('Files', t('files/title')), icon: { glyph: 'files', hue: 38 },
    host: { kind: 'shipped', mount: id },
    window: { width: 980, height: 640, minWidth: 420, minHeight: 360, singleton: true },
    ...(options.browser ? { provides: [fileLocationContract(BROWSER_LOCATION) as any], files: { contract: BROWSER_LOCATION, title: named('This browser', t('files/this-browser')) } } : {}),
  };
  return {
    manifest,
    mount: (node, context) => mountFiles(node, context, options),
    serve() { if (options.browser) options.kernel.provideLocal(id, fileLocationContract(BROWSER_LOCATION), serveFileLocation(options.browser) as any); },
  };
}

type Place = { location: string, folder: string | null, trail: { id: string | null, name: string }[] };

function mountFiles(node: HTMLElement, context: ShippedContext, options: FilesOptions) {
  const { kernel } = options;
  const doc = node.ownerDocument, win: any = doc.defaultView;
  const t = createOsMessages(options.messages);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => { const e = doc.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  const root = el('div', 'tos-files');
  const side = el('nav', 'tos-files-side'); side.setAttribute('aria-label', t('files/locations'));
  const main = el('div', 'tos-files-main');
  const list = el('ul', 'tos-files-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('files/contents')); list.tabIndex = 0;
  const status = el('p', 'tos-files-status'); status.setAttribute('role', 'status');
  const crumbs = el('nav', 'tos-files-crumbs'); crumbs.setAttribute('aria-label', t('files/path'));
  const preview = el('aside', 'tos-files-preview'); preview.hidden = true; preview.setAttribute('aria-label', t('files/preview'));
  main.append(crumbs, status, list);
  root.append(side, main, preview);
  node.append(root);

  const call = async <T>(location: string, op: string, input: unknown = {}) => fileAnswer<T>(await kernel.call('shell', location, op, input) as any);
  const locations = () => kernel.fileLocations().filter(l => l.served).sort((a, b) => (a.contract === BROWSER_LOCATION ? -1 : b.contract === BROWSER_LOCATION ? 1 : a.title.localeCompare(b.title)));
  const titleOf = (location: string) => { const l = kernel.fileLocations().find(x => x.contract === location); const m = l && kernel.effective(l.module); return l?.contract === BROWSER_LOCATION ? t('files/this-browser') : m?.files?.title ? localized(m.files.title, context.locale) : l?.title ?? location; };
  let place: Place | null = null, entries: FileEntry[] = [], selected: string | null = null, writable = false, query = '';
  const back: Place[] = [], forward: Place[] = [];
  let shownUrl: string | null = null;
  const say = (text: string, alert = false) => { status.textContent = text; status.setAttribute('role', alert ? 'alert' : 'status'); };
  const failed = (error: any) => say(t('files/failed', { detail: String(error?.message ?? error) }), true);

  function header() {
    const here = place;
    context.setHeader({
      start: [
        { kind: 'button', id: 'back', label: t('files/back'), glyph: 'back', disabled: back.length === 0 },
        { kind: 'button', id: 'forward', label: t('files/forward'), glyph: 'forward', disabled: forward.length === 0 },
        { kind: 'button', id: 'up', label: t('files/up'), glyph: 'upload', disabled: !here || here.folder === null },
      ],
      center: { kind: 'search', id: 'search', label: t('files/search'), ...(query ? { value: query } : {}), disabled: !here },
      end: [
        { kind: 'button', id: 'new-folder', label: t('files/new-folder'), glyph: 'add', disabled: !writable },
        { kind: 'menu', id: 'menu', label: t('files/menu'), glyph: 'menu', entries: [
          { id: 'upload', label: t('files/upload'), disabled: !writable },
          { id: 'refresh', label: t('files/refresh'), disabled: !here },
        ] },
      ],
      subtitle: here ? [titleOf(here.location), ...here.trail.map(s => s.name)].join(' › ').slice(0, 120) : '',
    });
  }

  /** Where the person is: the location, then each folder down to this one, each a way back up. */
  function renderCrumbs() {
    if (!place) { crumbs.replaceChildren(); return; }
    const here = place;
    const steps: { name: string, folder: string | null, trail: Place['trail'] }[] = [{ name: titleOf(here.location), folder: null, trail: [] }, ...here.trail.map((s, i) => ({ name: s.name, folder: s.id, trail: here.trail.slice(0, i + 1) }))];
    crumbs.replaceChildren(...steps.flatMap((step, i) => {
      const last = i === steps.length - 1;
      const b = el('button', 'tos-files-crumb', step.name); b.type = 'button';
      if (last) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', () => void go({ location: here.location, folder: step.folder, trail: step.trail }));
      return i ? [el('span', 'tos-files-crumb-sep', '›'), b] : [b];
    }));
  }

  function renderSide() {
    side.replaceChildren(...locations().map(l => {
      const b = el('button', 'tos-files-location', l.contract === BROWSER_LOCATION ? t('files/this-browser') : titleOf(l.contract));
      b.type = 'button'; b.dataset.location = l.contract;
      if (place?.location === l.contract) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => go({ location: l.contract, folder: null, trail: [] }));
      return b;
    }));
    if (!side.children.length) side.append(el('p', 'tos-muted', t('files/no-locations')));
  }

  async function go(next: Place, history = true) {
    if (history && place) { back.push(place); forward.length = 0; }
    place = next; selected = null; query = '';
    closePreview();
    await load();
  }

  async function load() {
    renderSide();
    if (!place) { list.replaceChildren(); say(locations().length ? t('files/choose') : t('files/no-locations')); header(); return; }
    say(t('files/loading'));
    try {
      writable = (await call<{ writable: boolean }>(place.location, 'files.info')).writable === true;
      const all: FileEntry[] = [];
      let cursor: string | undefined;
      do {
        const answer = query
          ? await call<{ entries: FileEntry[], cursor?: string }>(place.location, 'files.search', { query, ...(cursor ? { cursor } : {}) })
          : await call<{ entries: FileEntry[], cursor?: string }>(place.location, 'files.list', { folder: place.folder, ...(cursor ? { cursor } : {}) });
        all.push(...answer.entries); cursor = answer.cursor;
      } while (cursor && all.length < 2000);
      entries = all;
      say(entries.length === 1 ? t('files/count-one') : entries.length ? t('files/count', { count: entries.length }) : query ? t('files/no-match') : t('files/empty'));
    } catch (error) { entries = []; failed(error); }
    renderCrumbs(); renderList(); header();
  }

  const sizeText = (n?: number) => n === undefined ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const glyphOf = (e: FileEntry) => e.kind === 'folder' ? 'folder' : (e.type ?? '').startsWith('image/') ? 'image' : e.type === 'application/pdf' ? 'pdf' : 'document';
  function renderList() {
    list.replaceChildren(...entries.map(e => {
      const li = el('li', 'tos-files-entry'); li.setAttribute('role', 'option'); li.dataset.entry = e.id; li.dataset.kind = e.kind;
      li.setAttribute('aria-selected', String(e.id === selected)); li.tabIndex = -1; li.draggable = writable;
      const glyph = el('span', 'tos-files-glyph'); glyph.dataset.glyph = glyphOf(e); glyph.setAttribute('aria-hidden', 'true');
      const name = el('span', 'tos-files-name', e.name);
      const meta = el('span', 'tos-files-meta', [e.kind === 'file' ? sizeText(e.size) : '', e.modified ? new Date(e.modified).toLocaleDateString(context.locale) : ''].filter(Boolean).join(' · '));
      li.append(glyph, name, meta);
      li.addEventListener('click', () => select(e.id));
      li.addEventListener('dblclick', () => open(e));
      // dragged onto a folder of the same location, it moves there
      li.addEventListener('dragstart', (event) => { event.dataTransfer?.setData('application/x-tangle-file', e.id); });
      if (e.kind === 'folder') {
        li.addEventListener('dragover', (event) => { if (writable && event.dataTransfer?.types.includes('application/x-tangle-file')) { event.preventDefault(); li.classList.add('is-drop'); } });
        li.addEventListener('dragleave', () => li.classList.remove('is-drop'));
        li.addEventListener('drop', (event) => { li.classList.remove('is-drop'); const moved = event.dataTransfer?.getData('application/x-tangle-file'); if (moved && moved !== e.id) { event.preventDefault(); event.stopPropagation(); void act(() => call(place!.location, 'files.move', { id: moved, folder: e.id })); } });
      }
      return li;
    }));
  }

  function select(id: string | null) {
    selected = id;
    for (const li of list.children) li.setAttribute('aria-selected', String((li as HTMLElement).dataset.entry === id));
    (list.querySelector(`[aria-selected="true"]`) as HTMLElement | null)?.focus();
    const entry = entries.find(e => e.id === id);
    if (entry?.kind === 'file') void showPreview(entry); else closePreview();
  }

  function open(entry: FileEntry) {
    if (entry.kind === 'folder') void go({ location: place!.location, folder: entry.id, trail: [...place!.trail, { id: entry.id, name: entry.name }] });
    else select(entry.id);
  }

  async function act(run: () => Promise<unknown>) {
    try { await run(); await load(); } catch (error) { failed(error); }
  }

  function closePreview() {
    preview.hidden = true; preview.replaceChildren();
    if (shownUrl) { URL.revokeObjectURL(shownUrl); shownUrl = null; }
  }

  async function bytesOf(content: FileContent): Promise<Uint8Array> {
    if (content.data !== undefined) return fileBase64ToBytes(content.data);
    if (content.url && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(content.url)) {
      const response = await win.fetch(content.url, { credentials: 'omit' });
      if (!response.ok) throw new Error(`${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    return new Uint8Array();
  }

  async function showPreview(entry: FileEntry) {
    closePreview();
    preview.hidden = false;
    const title = el('h2', 'tos-files-preview-title', entry.name);
    const meta = el('p', 'tos-muted', [entry.type ?? '', sizeText(entry.size)].filter(Boolean).join(' · '));
    const body = el('div', 'tos-files-preview-body');
    const actions = el('div', 'tos-files-actions');
    preview.append(title, meta, body, actions);
    const button = (label: string, run: () => void, danger = false) => { const b = el('button', danger ? 'is-danger' : '', label); b.type = 'button'; b.addEventListener('click', run); actions.append(b); return b; };
    let bytes: Uint8Array | null = null;
    // the applications that open this kind of file, as the person's own choice
    for (const opener of kernel.openersFor(entry.type ?? typeOfName(entry.name)).filter(m => m.id !== context.module.id)) {
      const app = localized(opener.title, context.locale);
      button(t('files/open-in', { app }), () => {
        if (!bytes) return;
        void context.openFile(opener.id, { name: entry.name, type: entry.type ?? typeOfName(entry.name), data: fileBytesToBase64(bytes), source: { location: place!.location, id: entry.id } })
          .then(answer => { if (answer.refused) say(t('files/failed', { detail: answer.refused }), true); });
      });
    }
    button(t('files/download'), () => { if (bytes) download(entry, bytes); });
    if (writable) {
      button(t('files/rename'), () => rename(entry));
      button(t('files/delete'), () => confirmDelete(entry, actions), true);
    }
    body.textContent = t('files/loading');
    try {
      const content = await call<FileContent>(place!.location, 'files.read', { id: entry.id });
      if (selected !== entry.id) return;
      bytes = await bytesOf(content);
      meta.textContent = [content.entry.type ?? entry.type ?? '', sizeText(content.entry.size ?? bytes.length)].filter(Boolean).join(' · ');
      body.replaceChildren();
      const type = (content.entry.type ?? entry.type ?? typeOfName(entry.name)).toLowerCase();
      const text = () => new TextDecoder().decode(bytes!.subarray(0, 200_000));
      // never as the desktop's own markup: an image only in <img>, a PDF only as a PDF, the rest as text
      if (type.startsWith('image/') && type !== 'image/svg+xml') {
        shownUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        const img = el('img', 'tos-files-image'); img.src = shownUrl; img.alt = entry.name; body.append(img);
      } else if (type === 'application/pdf') {
        shownUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
        const pdf = el('embed', 'tos-files-pdf'); pdf.setAttribute('type', 'application/pdf'); pdf.setAttribute('src', shownUrl); pdf.setAttribute('title', entry.name); body.append(pdf);
      } else if (!(options.previewers ?? []).some(p => p(body, { entry: { ...entry, type }, bytes: bytes!, text }) === true)) {
        if (/^text\/|json|xml|csv|yaml|javascript|svg/.test(type)) { const pre = el('pre', 'tos-files-text'); pre.textContent = text(); body.append(pre); }
        else body.append(el('p', 'tos-muted', t('files/no-preview')));
      }
    } catch (error) { body.replaceChildren(); failed(error); }
  }

  function download(entry: FileEntry, bytes: Uint8Array) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: entry.type ?? 'application/octet-stream' }));
    const a = el('a'); a.href = url; a.download = entry.name; doc.body.append(a); a.click(); a.remove();
    win.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function rename(entry: FileEntry) {
    const li = list.querySelector<HTMLElement>(`[data-entry="${CSS.escape(entry.id)}"] .tos-files-name`);
    if (!li) return;
    const input = el('input', 'tos-files-rename'); input.value = entry.name; input.setAttribute('aria-label', t('files/rename'));
    li.replaceChildren(input); input.focus(); input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return; done = true;
      const name = input.value.trim();
      if (save && name && name !== entry.name) void act(() => call(place!.location, 'files.move', { id: entry.id, name }));
      else li.textContent = entry.name;
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } event.stopPropagation(); });
    input.addEventListener('blur', () => finish(true));
  }

  function confirmDelete(entry: FileEntry, actions: HTMLElement) {
    // the desktop has no dialogs: the confirmation is in place
    const ask = el('p', 'tos-files-confirm', t('files/delete-confirm', { name: entry.name }));
    const yes = el('button', 'is-danger', t('files/delete')); yes.type = 'button';
    const no = el('button', '', t('files/cancel')); no.type = 'button';
    yes.addEventListener('click', () => void act(() => call(place!.location, 'files.delete', { id: entry.id })));
    no.addEventListener('click', () => ask.remove());
    ask.append(yes, no);
    actions.after(ask); yes.focus();
  }

  async function upload(files: FileList | File[]) {
    if (!place || !writable) return;
    for (const file of [...files]) {
      if (file.size > MAX_INLINE_BYTES) { say(t('files/too-large', { name: file.name }), true); continue; }
      const data = fileBytesToBase64(new Uint8Array(await file.arrayBuffer()));
      try { await call(place.location, 'files.write', { folder: place.folder, name: file.name, data, type: file.type || typeOfName(file.name) }); }
      catch (error) { failed(error); return; }
    }
    await load();
  }

  function pickUpload() {
    const input = el('input'); input.type = 'file'; input.multiple = true;
    input.addEventListener('change', () => { if (input.files?.length) void upload(input.files); });
    input.click();
  }

  function newFolder() {
    if (!place || !writable) return;
    const taken = new Set(entries.map(e => e.name));
    let name = t('files/new-folder-name'), n = 2;
    while (taken.has(name)) name = `${t('files/new-folder-name')} ${n++}`;
    void (async () => {
      try { const { entry } = await call<{ entry: FileEntry }>(place!.location, 'files.mkdir', { folder: place!.folder, name }); await load(); select(entry.id); rename(entry); }
      catch (error) { failed(error); }
    })();
  }

  // files dropped from the person's computer upload into the folder shown
  main.addEventListener('dragover', (event) => { if (writable && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); main.classList.add('is-drop'); } });
  main.addEventListener('dragleave', () => main.classList.remove('is-drop'));
  main.addEventListener('drop', (event) => { main.classList.remove('is-drop'); if (event.dataTransfer?.files.length) { event.preventDefault(); void upload(event.dataTransfer.files); } });
  // the keyboard: arrows choose, Enter opens, Backspace goes up, F2 renames, Delete asks
  list.addEventListener('keydown', (event) => {
    const at = entries.findIndex(e => e.id === selected);
    const entry = entries[at];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = entries[Math.max(0, Math.min(entries.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]; if (next) select(next.id); }
    else if (event.key === 'Enter' && entry) { event.preventDefault(); open(entry); }
    else if (event.key === 'Backspace' && place?.folder !== null) { event.preventDefault(); up(); }
    else if (event.key === 'F2' && entry && writable) { event.preventDefault(); rename(entry); }
    else if (event.key === 'Delete' && entry && writable) { event.preventDefault(); if (entry.kind === 'file') select(entry.id); confirmDelete(entry, preview.querySelector('.tos-files-actions') ?? main); }
  });

  function up() {
    if (!place || place.folder === null) return;
    const trail = place.trail.slice(0, -1);
    void go({ location: place.location, folder: trail.at(-1)?.id ?? null, trail });
  }

  context.onHeader(({ item, value }) => {
    if (item === 'back' && back.length) { forward.push(place!); void go(back.pop()!, false); }
    else if (item === 'forward' && forward.length) { back.push(place!); void go(forward.pop()!, false); }
    else if (item === 'up') up();
    else if (item === 'search' && typeof value === 'string') { query = value.trim(); void load(); }
    else if (item === 'new-folder') newFolder();
    else if (item === 'menu' && value === 'upload') pickUpload();
    else if (item === 'menu' && value === 'refresh') void load();
    else return { refused: `Files has no '${item}'` };
  });
  // a location that joins or leaves (an application opening or closing) shows at once
  const unsubscribe = kernel.subscribe((event) => { if (event.kind === 'providers' || event.kind === 'modules') renderSide(); });
  const first = locations()[0];
  if (first) void go({ location: first.contract, folder: null, trail: [] }, false); else void load();
  return () => { unsubscribe(); closePreview(); root.remove(); };
}
