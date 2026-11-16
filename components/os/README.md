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
