# @tangleai/os

A browser operating system for applications built on
[JarenJS](https://github.com/jklarenbeek/jarenjs) and Tangle. A module is a JSON
manifest plus the `@jarenjs/contract` operations it serves and needs. The
desktop gives it a window, one theme and language, a place in the dock, mail to
the person and to other modules, and a seat at one assistant that sees every
granted contract as tools.

Modules come in three host kinds:

| Kind | Runs | Reaches the desktop through |
|---|---|---|
| `shipped` | A component the host registered, in the desktop's page | A context object (`call`, `sendMail`, `setTitle`, `provide`) |
| `document` | A jaren-app document in a `sandbox="allow-scripts"` frame (opaque origin) | One granted effect, `os`, over a port |
| `origin` | An application's own page on its own origin | `connectToOs` from `@tangleai/os/module`, over ports |

Whatever a person or the assistant designs is a document: a manifest, a
jaren-app document, a stylesheet, a contract. Behaviour that needs script ships
as components. A document module cannot read the desktop's storage, keys or
DOM; an application on its own origin keeps its server, its keys and its
sign-in, and the desktop sees only its contracts.

## Entries

- `@tangleai/os`: headless and Node-safe. `validateManifest`,
  `MODULE_MANIFEST_SCHEMA`, `createKernel`, the window document
  (`openWindow`, `focusWindow`, `moveWindow`, …), `DEFAULT_THEMES`,
  `checkTheme`, the message catalogue.
- `@tangleai/os/shell`: `mountDesktop(node, { kernel, shipped, documentHost,
  theme, themeFor, onSchemeSwitch, locale, dir, messages })`. `themeFor(scheme)`
  gives the dock's light/dark switch the person's own variant of a theme, and
  `onSchemeSwitch` reports the switch so a host can keep the choice. A right
  click (or the menu key) on the desktop, a title bar or a dock item opens the
  shell's menu; inside a window's content the browser's own menu stays.
- `@tangleai/os/module`: `connectToOs({ origins, serve, context, onTheme,
  onLocale })` for an application page framed by a desktop.
- `@tangleai/os/module-host`: the document module host. A host bundles it once
  as a **classic** script (an opaque-origin frame cannot load a module script
  from a server without CORS headers) and serves it from a page whose root
  carries `data-tangle-os-module="auto"`.
- `@tangleai/os/schemas/module`, `@tangleai/os/styles/os.css`,
  `@tangleai/os/styles/module.css`.

## Hosting the desktop in your own page

An application can be the desktop: its page mounts the shell over its own
screens, each a `shipped` module.

```ts
import { createKernel } from '@tangleai/os';
import { mountDesktop } from '@tangleai/os/shell';
const desktop = mountDesktop(node, {
  kernel, shipped,
  compact: { below: 760 },                          // a phone: one maximized window at a time
  tray: { mail: false, brand: { label: 'Example shop', src: '/logo.svg' } },
});
desktop.subscribe((event) => save(event));           // opened, focused, minimized, restored, maximized, moved, resized, retitled, closed, ready, failed
```

- **Compact.** Below `compact.below` pixels every window opens maximized,
  only the focused one is shown and windows offer no maximize; above it the
  windows the desktop maximized get their places back. At any width the dock
  stays on the desktop: its tiles shrink to fit, then it scrolls sideways,
  every tile reachable by pointer and keyboard.
- **Tray.** The mail tile and the light/dark switch are on by default
  (`tray.mail`, `tray.theme`); mail still reaches `kernel.mail()` without its
  tile. `tray.brand` puts a mark at the dock's start, an image (`src`) or a
  node the host renders, with an accessible name; it is not a module and
  takes no keyboard stop.
- **Events.** `desktop.subscribe(listener)` reports every window change with
  the window's state after it, so a host that subscribes before the first
  `open` can rebuild `state()` from the events alone (to reopen windows after
  a reload, or to know which window is focused). `restored` is a window
  leaving minimized or maximized.
- **Lifecycle.** `ready` reports a module running in its window (a framed
  one once it has connected, and again after its page reloads, on fresh
  ports); `failed` one that could not start or did not answer within
  `connectTimeoutMs` (15 s by default). A window whose module did not answer
  says so and offers to try again, and the shell holds no port or listener
  for it meanwhile.
- **Visibility.** A shipped module's context carries `visible` and
  `onVisibility(listener)`: a window is visible when it is not minimized and,
  on a compact desktop, focused; a module pauses its polling while hidden.
- **Glyphs.** A manifest's `icon.glyph` names a mask the shell draws in the
  module's hue, in the dock, the title bar and the menus. The shell ships
  `app`, `mail`, `sun`, `moon`, `info`, `check`, `records`, `spark` and `gear`;
  a host adds its own with one rule, which is supported API:

  ```css
  .tos-glyph[data-glyph="tag"] { --glyph: url("data:image/svg+xml,…"); }
  ```

  The SVG is a mask: its shape counts, not its colours.

A window is a labelled `region` of the desktop, not a dialog; it keeps its
manifest's `minWidth` and `minHeight` when the person resizes it, and opens
wholly on the desktop, sized to it. Motion stops under
`prefers-reduced-motion`.

## Proposals: one inbox for what the person decides

An application, or the assistant working through it, often prepares
something a person must approve: a purchase draft, a print batch, a leave
request. The desktop's mail is the one inbox for all of them, so the person
does not visit each application's own review screen.

```jsonc
// the manifest declares the kinds it files
"proposals": [{ "kind": "purchase.draft", "title": { "en": "Purchase draft" } }]
```

```ts
const desktop = await connectToOs({
  origins: ['https://desk.example'],
  onDecision: async ({ id, decision, revision }) => {
    if (await stale(id, revision)) return { refused: 'the stock moved since this draft' };
    if (decision === 'accept') await placeOrder(id);
  },
});
await desktop.propose({ id: 'po-7', kind: 'purchase.draft', title: 'Reorder 12 oak tables',
  summary: 'Stock is 2, the reorder point 5.', evidence: [{ label: 'Stock report', href: 'https://shop.example/stock' }], revision: 'r3' });
```

- **The application keeps its proposals.** The inbox lives as long as the
  page; filing the same `id` again replaces it, and `withdraw(id)` takes one
  back, so an application refiles what is still open when it connects. A
  shipped module has the same `propose`, `withdraw` and `onDecision` in its
  context; `kernel.propose`, `kernel.decide` and the `mail` events serve a
  host that renders its own inbox.
- **Only the person decides.** The decision reaches the application over its
  own control channel, never as a contract operation, so neither the
  assistant nor another module can accept a proposal, whatever their grants.
- **One decision at a time, and honest about failure.** A double click makes
  one call. An application that is not running (`OS0110`), or that refuses
  (`OS0112`, for instance because the `revision` it expected moved), leaves
  the proposal pending with the reason shown.
- **Shown as text.** Titles and summaries are bounded text, evidence links go
  to http(s) pages only, and the application's name comes from its manifest.
  A proposal of a kind the manifest does not declare is refused (`OS0107`), as
  is one that does not match the schema (`OS0108`).

**Who proposes, and proposals that ask.** A proposal says who it comes from
(`origin`: `human`, `rule`, `import` or `ai`), which the inbox shows. One that
asks the person something carries `answer: { schema, label? }`: the inbox draws
a form from the JSON Schema (a field per property of a flat object: text, a
number, a choice, a yes or no; one text for any other schema), the kernel
checks the answer against the schema before it leaves (`OS0124`, the proposal
stays pending), and the module that filed it receives `{ decision: 'answer',
response }` at `onDecision`. Only a proposal that asks takes an answer
(`OS0123`); a schema larger than 20,000 characters, or one asking for a
password or a write-only member, is refused when filed. As with accepting, no
operation reaches it: the assistant cannot answer. An older desktop refuses a
proposal with `origin` or `answer`, and an older page refuses an `answer`
decision; the protocol stays 1. A run of `@tangleai/mas` that pauses for a
person files such a proposal from the application's server with
`@tangleai/mas/inbox`.

## Settings: one place for every application

`@tangleai/os/settings` is the desktop's Settings. It is the one place a
person finds the settings of the desktop and of every application on it, so
an application declares its settings rather than building a screen of its own.

```ts
import { settingsModule } from '@tangleai/os/settings';
const settings = settingsModule({ kernel, shipped, sections: [{ id: 'general', title: { en: 'General' }, mount: (node) => drawGeneral(node) }] });
kernel.install(settings.manifest, 'shipped');
shipped.settings = settings.mount;                    // the host's own sections first, then each application's
```

An application's manifest says where its settings live:

| `settings.kind` | For | The person sees | Who keeps the values |
|---|---|---|---|
| `mount` | a `shipped` module | the host's settings screen (`shipped[mount]`) in the Settings pane | the application |
| `page` | an `origin` module | the application's settings page, framed from its own origin (refused otherwise, `OS0004`), joined for theme and language but given no contract ports | the application |
| `form` | a `document` module | a form from the module's JSON Schema, saved as the person types, checked against the schema | the desktop, through `createKernel({ settings })`; never a secret (`OS0004`) |

```json
"settings": { "kind": "page", "url": "https://records.example/settings", "keywords": ["printer", "labels"] }
```

An application's values stay where it keeps them today (its server, its
tenant, its database): the desktop is where the person finds them, not a
second store. Only a document module, with no server of its own, has the
desktop keep its values (`kernel.settings`, `kernel.setSettings`, and
`onSettings` on the module side when they change).

The person reaches an application's section three ways: in Settings itself
(with a search over titles and `keywords`), from the window and dock menus,
and from the application, which opens its own section over its own port with
no grant (`connection.openSettings()` from a framed page, `context.openSettings()`
in a shipped one). `desktop.openSettings(moduleId?)` opens it from the host.

## Header bars: an application's items in its title bar

An application puts its toolbar in its window's title bar instead of in a row
of its own: buttons, toggles, menus, tabs that switch its view, and a search
field. It describes them as a JSON document; the desktop draws them. No
application paints its own bar, so every bar follows the theme and the writing
direction, works by keyboard and screen reader, fits a narrow window the same
way, and cannot show a false close button or a false desktop dialog. Every
item is plain data, so the assistant reads and uses the bar exactly as the
person does, under its grants and into the ledger.

```ts
const os = await connectToOs({ origins: ['https://desk.example'], onHeader: ({ item, value, by }) => {
  if (item === 'view') showView(value);              // by: 'person', 'assistant' or a module id
  if (item === 'more' && value === 'export') exportAll();
} });
await os.setHeader({
  start: [{ kind: 'button', id: 'back', label: 'Back', glyph: 'back' }],
  center: { kind: 'tabs', id: 'view', label: 'View', selected: 'inbox', items: [{ id: 'inbox', label: 'Inbox' }, { id: 'sent', label: 'Sent' }] },
  end: [
    { kind: 'search', id: 'find', label: 'Search mail' },
    { kind: 'button', id: 'compose', label: 'Compose', primary: true },
    { kind: 'menu', id: 'more', label: 'Mail menu', glyph: 'menu', entries: [{ id: 'export', label: 'Export…', shortcut: 'Ctrl+E' }, { separator: true }, { id: 'wipe', label: 'Delete all', assistant: false }] },
  ],
  subtitle: '3 unread',
});
```

A shipped module calls `context.setHeader(header)` and `context.onHeader(handler)`.

| Item | Uses it | `value` the application hears | The desktop keeps |
|---|---|---|---|
| `button` | a press | none | nothing |
| `toggle` | a press | `true` or `false` | `pressed` |
| `menu` | choosing an entry | the entry's id | nothing (an entry's `checked` is the application's) |
| `tabs` | choosing a tab (pointer, or arrow keys mirrored right to left) | the tab's id | `selected` |
| `search` | typing (a moment after it stops), Enter, Escape to clear | the text | `value` |

- **Layout.** `start` and `end` hold up to four items each; `center` holds tabs
  or a search, which take the title's place (the title stays the window's
  accessible name); `subtitle` sits under the title. A narrow window keeps what
  fits and moves the rest into one "More" menu: `primary` buttons stay longest,
  then the others in the order listed. Search fields and tabs shrink instead.
- **Bounded.** The header matches `HEADER_SCHEMA`; ids are unique across items,
  tabs and menu entries; glyphs come from the desktop's own set
  (`HEADER_GLYPHS`); every text is drawn as text. A header that does not match
  is refused with `OS0113`, with its code and reason on the module side.
- **State.** The application's document is the truth. The desktop shows a tab,
  a toggle or a search text as soon as it is used, and the application's next
  `setHeader` wins, except over the text the person is typing. A frame that
  reloads loses its bar until it sets it again.
- **Shortcuts** are hints shown in menus and tooltips. Keys pressed inside a
  framed application stay in that application, so it binds its own.
- **The assistant.** `tangle_os_header` is the kernel's own contract:
  `header.list` (every window's bar, with its state) and `header.activate`
  (`{ window, item, value? }`). A host grants it like any contract
  (`assistantGrants: ['tangle_os_header.*']`, or `'all'`), and then
  `kernel.tools()` and `kernel.operations()` include it. The person's own
  presses go through the same operation as the caller `shell`, so the ledger
  holds every use. An item or a menu entry with `assistant: false` is never
  listed to the assistant and cannot be used by it. What another caller used
  lights up in the bar, so the person sees what was done in their window.
- **Refusals.** `OS0114` no such item, `OS0115` disabled or kept from this
  caller, `OS0116` a value that does not fit the item, `OS0117` the application
  is not connected, `OS0118` the application refused (its reason). Items are
  disabled while the application is not connected.
- **Text.** The desktop adds one sentence of its own, `window/more`; a host's
  language pack translates it with the rest of its catalogue.

## The dock: the person's own arrangement

The dock is a JSON document the person owns: the order of its icons and
folders, and the icons they hid. Without one, the dock is every module in
install order, as before. It is kept with the rest of the desktop's state
(below); a recovery boot ignores it.

**Icons and launch entries.** A module is one icon. A module whose screens
live inside one page lists `entries`, and each entry is its own icon that
opens the module at that screen, or shows that screen in its open window:

```json
"entries": [
  { "id": "staff", "title": { "en": "Staff" }, "screen": "/staff", "folder": "people" },
  { "id": "rota", "title": { "en": "Rota" }, "screen": "/rota", "folder": "planning" }
],
"dock": { "folders": [{ "id": "people", "title": { "en": "People" } }, { "id": "planning", "title": { "en": "Planning" } }] }
```

A framed page reads the screen it opened with as `connection.screen` and
hears later ones at `onScreen(screen)`; a shipped module has `context.screen`
and `context.onScreen(listener)`. A suite of many modules shares folder ids:
each manifest says where its own icon goes (`dock.folder`) and may title the
folders. A manifest places only its own icons, and only the first time they
appear: once the person moves one, their dock wins. A launch entry or folder
named twice in one manifest is refused (`OS0005`). An older desktop refuses
a manifest with `entries` or `dock`, because the manifest is closed.

**Editing.** "Edit the dock" in the dock's and the desktop's menus. The icons
show they can move (a gentle wiggle, an outline with reduced motion), and the
person:

- drags an icon to a new place, or onto another icon to make a folder, or
  onto a folder to put it in; out of an open folder onto the dock takes it out;
- hides an icon with its "−" badge and shows it again from "Hidden icons";
- opens a folder to rename it;
- does every one of those without a pointer: the tile's menu (Hide, Put in
  a folder, Make a folder with its neighbour, Take out, Move back or forward,
  Rename) and the keyboard (Alt with the arrow keys moves, Delete hides,
  Escape is done).

A tap in edit mode opens nothing. Every icon appears exactly once (shown, in a
folder, or hidden); a folder left with one icon becomes that icon. A hidden
module that is running keeps a tile while it runs, so its window stays
reachable, and the desktop menu still lists every module.

**The assistant.** `tangle_os_dock` is the kernel's own contract:
`dock.read` (the arrangement, every icon's title, the revision) and
`dock.suggest` (`{ layout }`). A suggestion never changes the dock: it waits in
the inbox as the desktop's proposal, showing what would change in the
desktop's own words, and the person accepts or rejects it. It is refused
then if the dock changed meanwhile; a caller has one suggestion pending at a
time. The ids `shell`, `person` and `desktop` belong to the desktop: no module
takes them (`OS0012`).

## Desktop state: in the browser, or in the application's database

Everything the desktop keeps for a person (their dock, the settings of each
application they set in the desktop's Settings) or for the whole application
is a keyed JSON document in one store the host chooses:

```ts
import { createKernel, webStorageStore, contractStore } from '@tangleai/os';
createKernel({ state: webStorageStore(localStorage) });          // a page with no server (the Pages desktop)
createKernel({ state: contractStore(httpClient) });              // a desktop page signed in to its own server
createKernel({ state: { module: 'suite' } });                    // the framed application that is signed in serves it
```

The store is loaded once (`await kernel.ready()`), and every change shows at
once and is saved in the background: one save at a time per document, the
latest value winning, tried again (after 1, 2, 4 … 30 s) when the server
cannot be reached. Each document has a revision; a save made on an older one
is refused and the desktop takes the stored document, so another tab or
another device is never overwritten unseen (and a dock suggestion made before
goes stale). Until the state has loaded, nothing in it can change (`OS0121`):
a dock arranged before the person's own dock arrived would replace it. When it
cannot be loaded, or a change cannot be saved, the dock says so and offers to
try again; leaving the page sends what is unsaved.

A host keeps its own preferences there too, so they follow the person:
`kernel.setState('preferences', { scheme: 'dark' })`, `kernel.state('preferences')`,
with `scope: 'application'` for the whole application's (`OS0120` for a key
the desktop keeps itself). **Never a secret**: a provider key stays where the
host keeps it.

**The server side** is `@tangleai/os/state-server`, with no database driver of
its own. An application with a database (SQLite or PostgreSQL through
`@jarenjs/db`, or anything that can compare and set a row) makes a table from
`DESKTOP_STATE_MODEL`, implements a `StateRepository` (`list(owner)`,
`swap(owner, document, ifRevision)`, in one transaction) and serves
`tangle_os_state` with `serveDesktopState(repository, owner)`:

```ts
import { serveDesktopState } from '@tangleai/os/state-server';
const handlers = serveDesktopState(repository, (ctx) => ({ person: ctx.session.userId, application: ctx.session.tenantId }));
```

The owner always comes from the server's own session, never from the
request: a person reads their own documents and the application's, never
another person's. A desktop on its own origin that is not signed in itself
names the application that is (`{ module }`); that application serves the
contract from its framed page over its port (it declares
`STATE_CONTRACT` in its manifest's `provides`), and the desktop loads the
state when it connects. `createKernel({ settings })`, the earlier seam for a
host that keeps form settings itself, still works.

## Files: every application's documents in one place

`@tangleai/os/files` is the desktop's Files: one window for the person's own
files and every application's. An application shares its files by serving a
**file location**, a contract made from one template:

```ts
import { fileLocationContract, serveFileLocation } from '@tangleai/os';
const DOCS = fileLocationContract('records_files');
// manifest: provides: [DOCS], files: { contract: 'records_files', title: { en: 'Documents' } }
connectToOs({ origins, serve: [{ contract: DOCS, handlers: serveFileLocation({
  'files.info': () => ({ writable: false }),
  'files.list': ({ folder, cursor }) => listDocuments(folder, cursor),     // { entries, cursor? }
  'files.search': ({ query }) => searchDocuments(query),
  'files.read': ({ id }) => ({ entry, url: signedUrl(id) }),              // or { entry, data: base64 }, at most 10 MB
}) }] });
```

- **Entries** are `{ id, parent, name, kind, type?, size?, modified? }`, with
  opaque ids and a parent, never paths: a location whose files are rows
  serves them as they are. Lists and searches come a page at a time
  (`cursor`).
- **Reads** answer the bytes inline (base64, at most 10 MB) or an https
  address the location signed for a short while (http only for localhost).
- **Writing** (`files.write`, `files.mkdir`, `files.move`, `files.delete`) is
  a location's choice (`files.info` → `writable`); `serveFileLocation`
  answers the ones it leaves out as refused, and answers every refusal with
  its code and reason (`OS0601` missing, `OS0602` read-only, `OS0603` larger
  than 10 MB, `OS0604` a name taken, `OS0605` a folder into itself).
- **"This browser"** is the person's own files in the browser's private file
  system, offered only by a host that has no server for them:
  `filesModule({ kernel, browser: browserLocation(directory) })`, with a
  directory the host sets aside, never the file system's top (where the data
  studio keeps its databases).

The window has the locations on its side, a folder with clickable breadcrumbs,
back, forward, up, search, New folder and Upload in its header bar, and a
preview: an image only as an image, a PDF only as a PDF, text as text, and any
other type through a previewer the host passes (the Pages desktop draws
Markdown with `@jarenjs/md`, escaped). Nothing in a file ever runs as the
desktop's own markup. The person uploads (also by dropping files on the
window), makes folders, renames (F2), moves (by dragging onto a folder),
deletes after confirming in place, and downloads.

**Open with.** A module says which files it opens, as media types (a
subtype or type may be `*`): `"opens": [{ "type": "text/calendar" }]`. Files
offers "Open in …" for each application that opens the file's type, and
hands it the file: to its open window, or to a window it opens for it (the
file waits until the application has joined). A framed page takes it at
`onOpen(file)` (`{ name, type, data (base64) | url, source }`), a shipped
module at `context.onOpen(handler)`; either answers `{ refused: reason }` to
say why not, which Files shows. A shipped module hands a file to another one
with `context.openFile(module, file)`, and a host with `desktop.openFile`.
The Pages Calendar opens iCalendar files: their single, all-day and repeating
events join the month (`@jarenjs/josl/ical`), and what it cannot keep is
counted, never changed into something else.

**The assistant** reads files through the kernel's own `tangle_os_files`
contract: `files.locations`, `files.list`, `files.search` and `files.read`
(the first 6,000 characters of a text file; a binary file is described). It
never writes, moves or deletes: a location's own contract is never one of the
assistant's tools, whatever it is granted, and a location marked
`files: { assistant: false }` is not in `tangle_os_files` at all (`OS0122`).
Everything Files does goes through the location as the person's own hand, into
the ledger. A manifest whose `files.contract` is not one it provides is
refused (`OS0006`).

## The kernel

```ts
import { createKernel } from '@tangleai/os';
const kernel = createKernel();
kernel.install(manifest, 'shipped');           // or 'suite' or 'user'
kernel.patch('notes', [{ op: 'replace', path: '/title/en', value: 'Notes' }]);
kernel.undo();                                 // the person's last change
await kernel.call('labels', 'records', 'records.search', { query: 'oak' });
kernel.operations();                           // every granted operation, as plain data
```

`kernel.operations(caller)` lists what a caller may call as plain data (tool
name, contract, operation, kind, description, schemas), so an application with
its own agent runtime offers them as tools and calls back through
`kernel.call`. `kernel.tools(caller)` builds model tools with the host's tool
builder: `createKernel({ tools })`, where Tangle's `@tangleai/agents/toolbox`
fits as it is. The package itself depends on Jaren alone.

- **Layers.** A suite or a person changes a shipped module with an RFC 6902
  patch in a layer above it; the shipped document is never written. Every
  change of the person's is a journal entry with its inverse.
  `createKernel({ recovery: true })` boots without the person's layer.
- **The bus.** Every call between modules is a contract operation, checked
  against grants and written to a ledger. A shipped module, or a suite the host
  configured, is granted what its manifest `requires`. A suite joined from a
  link (`install(…, 'suite', { grant: false })`) and a module a person or the
  assistant made are granted nothing until the person grants it (`OS0101`).
  The assistant is granted nothing unless the host says so
  (`assistantGrants`).
- **One owner per contract.** Only the module whose manifest declares a
  contract may serve it, and a contract another module already declares is
  refused (`OS0011`), so a module cannot take over another's.
- **Own origin only.** An `origin` module on the desktop's own origin is
  refused (`OS0201`): framed with that origin's rights it could read the
  desktop's storage and keys.
- **Identity by port.** A framed module's calls arrive on the port it was
  handed, so a module cannot call or send mail as another.

## Joining a desktop from an application

```ts
import { connectToOs } from '@tangleai/os/module';
const desktop = await connectToOs({
  origins: ['https://desk.example'],
  serve: [{ contract: RECORDS, handlers: { 'records.search': ({ query }) => search(query) } }],
  context: () => ({ showing: 'catalogue' }),
});
await desktop.sendMail({ subject: '3 items out of stock' });
```

- **Bounded.** `connectTimeoutMs` bounds the wait for a desktop's answer and
  `signal` abandons it; either refuses with an `OsConnectError` (`OS0401` no
  answer in time, `OS0403` abandoned) and leaves no listener behind. A page
  that is not framed at all is refused at once (`OS0402`), so the same page
  runs on its own too. `timeoutMs` bounds each call once connected.
- **Presentation.** By default the desktop's theme tokens, colour scheme,
  language and direction land on the page's root. `presentation: 'none'`
  keeps the application's own look (it still hears `onTheme` and `onLocale`,
  and a press in the page still raises its window); `presentation: { root }`
  puts them on an element of the page's own.

The application lists its modules in a suite document the desktop reads:

```json
{ "$suite": "0.1", "id": "catalogue-suite",
  "modules": [{ "$module": "0.1", "id": "catalogue", "version": "1.0.0",
    "title": { "en": "Catalogue" },
    "host": { "kind": "origin", "url": "https://records.example/app" },
    "provides": [ { "$contract": "0.1", "id": "records", "operations": { … } } ] }] }
```

## Using the desktop from another repository

Every release keeps the package in this repository, so an application that
pulls it in as a git submodule needs no registry and no build of its own:

| File | What it is |
|---|---|
| `releases/os/tangleai-os-<version>.tgz` | The npm tarball the release build packed. It depends only on `@jarenjs/*` at the version the manifest names. |
| `releases/os/tangle-os-module.js` | The module side (`connectToOs`, `applyTheme`, `applyLocale`) as one self-contained ES module for the browser, for a page on any foundation or none. |
| `releases/os/manifest.json` | The version, the handshake protocol, each file's size, SHA-256 and integrity, and the Jaren foundation (version and commit). |

A release proves these files equal a fresh build, and installs the tarball
alone (with the Jaren tarballs, nothing else of Tangle) to join a desktop under
Node and Bun, through the package and through the single file.

```jsonc
// package.json of an application with this repository at vendor/tangleai
"dependencies": {
  "@tangleai/os": "file:vendor/tangleai/releases/os/tangleai-os-0.49.0.tgz"
}
```

A page that only joins a desktop can skip the install and import the single
file, from the submodule or from the desktop's own site, which serves the same
files under `os/`:

```ts
import { connectToOs } from './vendor/tangleai/releases/os/tangle-os-module.js';
```

The handshake names its protocol (`manifest.json` → `protocol`); a desktop and a
module that speak different protocols do not connect.

**A desktop on https, an application on the person's machine.** A desktop
served over https can install and frame an application on `http://127.0.0.1`.
Measured 2026-11-15 against the published desktop with a neutral application on
loopback: Firefox 151 joins with no prompt (suite read, framed, first call
answered in 259 ms); Chromium 149 refuses until the person allows the site to
reach their local network, then joins in 279 ms. The application's server must
let the desktop's origin read its suite document (CORS) and frame its page
(`Content-Security-Policy: frame-ancestors <desktop origin>`). Every project
page of one GitHub Pages account shares one origin, so an application that
allows a Pages desktop allows all of them; an application can also host the
desktop itself, since the shell is part of this package.

## Measured

2026-11-14, Chromium (Playwright), Linux x64, a local static server without CORS
headers for the desktop and a second origin for the application. The median
over five page loads; the first load was cold and loads two to five had a warm
HTTP cache. "Open to connected" ends when the shell hands the ports to the
module, not at the module's first painted frame. Round trips are the median of
seven calls each.

| Host kind | Open to connected | One contract call |
|---|---|---|
| shipped | synchronous | in-page |
| document (sandboxed frame) | 54.9 ms | 0.3 ms (`module.context`) |
| origin (second origin) | 41.1 ms | 0.2 ms (`records.search`) |

| Bundle | Minified | gzip |
|---|---|---|
| Desktop page (`os.js`: shell, kernel, contracts, toolbox) | 503 KB | 159 KB |
| Document module host (classic script) | 537 KB | 170 KB |
| `os.css` + `module.css` | 13 KB | 3.8 KB |

The browser tests (`.e2e/migration/os-skeleton.spec.mjs`, Chromium and Firefox)
cover the three hosts, the contract bus, mail, assistant tools, the document
frame's isolation (origin `null`, storage refused, no access to the desktop's
DOM), raising a window by a press inside its frame, and dragging a window
across a frame.
