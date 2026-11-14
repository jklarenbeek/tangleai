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

## The kernel

```ts
import { createKernel } from '@tangleai/os';
const kernel = createKernel();
kernel.install(manifest, 'shipped');           // or 'suite' or 'user'
kernel.patch('notes', [{ op: 'replace', path: '/title/en', value: 'Notes' }]);
kernel.undo();                                 // the person's last change
await kernel.call('labels', 'records', 'records.search', { query: 'oak' });
kernel.tools();                                // every granted operation as an assistant tool
```

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

The application lists its modules in a suite document the desktop reads:

```json
{ "$suite": "0.1", "id": "catalogue-suite",
  "modules": [{ "$module": "0.1", "id": "catalogue", "version": "1.0.0",
    "title": { "en": "Catalogue" },
    "host": { "kind": "origin", "url": "https://records.example/app" },
    "provides": [ { "$contract": "0.1", "id": "records", "operations": { … } } ] }] }
```

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
