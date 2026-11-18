/** A framed application: joins the desktop that frames it and serves one contract, counting its connections. */
import { connectToOs } from '../../../components/os/src/module.ts';
import { fileLocationContract, serveFileLocation, fileBytesToBase64, type FileLocationHandlers } from '../../../components/os/src/files.ts';

/** Echo's own files, read-only: a text inline, and an image the location signs an address for. */
const ECHO_FILES: FileLocationHandlers = {
  'files.info': () => ({ writable: false }),
  'files.list': ({ folder }) => ({ entries: folder ? [] : [
    { id: 'hello', parent: null, name: 'hello.txt', kind: 'file', type: 'text/plain', size: 11 },
    { id: 'logo', parent: null, name: 'logo.png', kind: 'file', type: 'image/png' },
  ] }),
  'files.search': ({ query }) => ({ entries: 'hello.txt'.includes(query) ? [{ id: 'hello', parent: null, name: 'hello.txt', kind: 'file', type: 'text/plain', size: 11 }] : [] }),
  'files.read': ({ id }) => id === 'hello'
    ? { entry: { id: 'hello', parent: null, name: 'hello.txt', kind: 'file', type: 'text/plain', size: 11 }, data: fileBytesToBase64(new TextEncoder().encode('hello, echo')) }
    : { entry: { id: 'logo', parent: null, name: 'logo.png', kind: 'file', type: 'image/png' }, url: `${location.origin}/logo.png` },
};
const withFiles = new URLSearchParams(location.search).has('files');

export const ECHO = { $contract: '0.1', id: 'echo', operations: { 'echo.say': { kind: 'read', input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, output: { type: 'object' } } } };
const loaded = Number(sessionStorage.getItem('loads') ?? 0) + 1;
let connection: Awaited<ReturnType<typeof connectToOs>> | null = null, view = 'calls', pinned = false;
/** Echo's header bar: tabs in the middle, a search, a pin toggle, a menu and buttons that a narrow window moves into "more". */
async function showHeader() {
  await connection?.setHeader({
    start: [{ kind: 'button', id: 'back', label: 'Back', glyph: 'back' }, { kind: 'button', id: 'refresh', label: 'Refresh', glyph: 'refresh' }],
    center: { kind: 'tabs', id: 'view', label: 'View', selected: view, items: [{ id: 'calls', label: 'Calls' }, { id: 'replies', label: 'Replies' }, { id: 'archive', label: 'Archive' }] },
    end: [
      { kind: 'search', id: 'find', label: 'Search echoes' },
      { kind: 'toggle', id: 'pin', label: 'Pin', glyph: 'star', pressed: pinned },
      { kind: 'button', id: 'compose', label: 'Compose', primary: true },
      { kind: 'menu', id: 'more', label: 'Echo menu', glyph: 'menu', entries: [{ id: 'export', label: 'Export', shortcut: 'Ctrl+E' }, { separator: true }, { id: 'clear', label: 'Clear all', assistant: false }] },
    ],
  });
}
sessionStorage.setItem('loads', String(loaded));
// two proposals for the person: one it carries out, one whose revision moved
connectToOs({
  origins: 'parent', presentation: 'none', serve: [{ contract: ECHO, handlers: { 'echo.say': ({ text }: any) => ({ text, loaded }) } }, ...(withFiles ? [{ contract: fileLocationContract('echo_files'), handlers: serveFileLocation(ECHO_FILES) as any }] : [])],
  // every use of the header bar is written down where the test reads it; the page owns the state and sets it again
  onHeader: (activation) => {
    const used = JSON.parse(document.body.dataset.used ?? '[]');
    document.body.dataset.used = JSON.stringify([...used, activation]);
    if (activation.item === 'view' && typeof activation.value === 'string') { view = activation.value; void showHeader(); }
    if (activation.item === 'pin') { pinned = activation.value === true; void showHeader(); }
    if (activation.item === 'find' && typeof activation.value === 'string') document.body.dataset.found = activation.value;
    if (activation.item === 'more' && activation.value === 'clear') return { refused: 'nothing to clear' };
  },
  // a text file the person opens with Echo from the desktop's Files
  onOpen: (file) => {
    if (!file.data) return { refused: 'Echo reads only inline text' };
    document.body.dataset.opened = `${file.name}: ${new TextDecoder().decode(Uint8Array.from(atob(file.data), c => c.charCodeAt(0)))}`;
  },
  onDecision: ({ id, decision, response }) => {
    if (id === 'echo-2' && decision === 'accept') return { refused: 'the echo moved' };
    document.body.dataset.decided = `${id}:${decision}${response === undefined ? '' : `:${JSON.stringify(response)}`}`;
  },
}).then(async (desktop) => {
  connection = desktop;
  document.body.dataset.joined = 'yes';
  if (new URLSearchParams(location.search).has('header')) await showHeader();
  // a settings page joins too, but files nothing: proposals belong to the application's window
  if (window.name === 'settings' || new URLSearchParams(location.search).has('settings')) return;
  await desktop.propose({ id: 'echo-1', kind: 'echo.reply', title: 'Send the echo', summary: 'Answer the last call with its own words.', evidence: [{ label: 'The call', href: 'https://example.com/call' }], revision: 'r1' });
  await desktop.propose({ id: 'echo-2', kind: 'echo.reply', title: 'Send the second echo', revision: 'r1' });
  // the warehouse capability's count, from an import
  if (new URLSearchParams(location.search).has('caps')) await desktop.propose({ id: 'count-1', kind: 'stock.count', title: 'Count of shelf B differs by 3', origin: 'import' });
  // a paused run that asks the person something: filed again on every load, as the server still has it
  if (new URLSearchParams(location.search).has('pause')) await desktop.propose({
    id: 'echo-pause', kind: 'echo.reply', title: 'How many crates for the weekly order?', origin: 'ai', revision: '0',
    answer: { label: 'Send', schema: { type: 'object', additionalProperties: false, required: ['crates'], properties: { crates: { type: 'integer', minimum: 0, title: 'Crates' }, rush: { type: 'boolean', title: 'Rush delivery' }, note: { type: 'string', maxLength: 100, title: 'Note' } } } },
  });
});
