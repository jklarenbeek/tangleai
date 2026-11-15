# @tangleai/pipeline

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/core@0.48.0
  - @tangleai/memory@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/core@0.47.0
  - @tangleai/memory@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/core@0.46.0
  - @tangleai/memory@0.46.0
  - @tangleai/models@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/memory@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/memory@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.45.0
  - @tangleai/core@0.45.0
  - @tangleai/memory@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/memory@0.44.0
  - @tangleai/models@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/memory@0.43.1
  - @tangleai/models@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.0
  - @tangleai/memory@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/core@0.42.1
  - @tangleai/memory@0.42.1
  - @tangleai/models@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/memory@0.42.0
  - @tangleai/core@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/core@0.41.0
  - @tangleai/memory@0.41.0
  - @tangleai/models@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/core@0.40.0
  - @tangleai/memory@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/core@0.39.0
  - @tangleai/memory@0.39.0
  - @tangleai/models@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [e229e63]
  - @tangleai/core@0.38.0
  - @tangleai/memory@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/memory@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/core@0.36.0
  - @tangleai/memory@0.36.0
  - @tangleai/models@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/core@0.35.0
  - @tangleai/memory@0.35.0
  - @tangleai/models@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [2dce4bd]
- Updated dependencies [a542379]
  - @tangleai/core@0.34.0
  - @tangleai/memory@0.34.0
  - @tangleai/models@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
  - @tangleai/models@0.33.0
  - @tangleai/memory@0.33.0
  - @tangleai/core@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/core@0.32.0
  - @tangleai/memory@0.32.0
  - @tangleai/models@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/core@0.31.0
  - @tangleai/memory@0.31.0
  - @tangleai/models@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/core@0.30.1
  - @tangleai/memory@0.30.1
  - @tangleai/models@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.30.0
  - @tangleai/core@0.30.0
  - @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/core@0.29.8
  - @tangleai/memory@0.29.8
  - @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/core@0.29.7
  - @tangleai/memory@0.29.7
  - @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/core@0.29.6
  - @tangleai/memory@0.29.6
  - @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/core@0.29.5
  - @tangleai/memory@0.29.5
  - @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/core@0.29.4
  - @tangleai/memory@0.29.4
  - @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/core@0.29.3
  - @tangleai/memory@0.29.3
  - @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/core@0.29.2
  - @tangleai/memory@0.29.2
  - @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/core@0.29.1
  - @tangleai/memory@0.29.1
  - @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/core@0.29.0
  - @tangleai/memory@0.29.0
  - @tangleai/models@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/core@0.28.0
  - @tangleai/memory@0.28.0
  - @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- Updated dependencies [9f7d8c8]
  - @tangleai/core@0.27.3
  - @tangleai/memory@0.27.3
  - @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/core@0.27.2
  - @tangleai/memory@0.27.2
  - @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- Updated dependencies [422afcd]
  - @tangleai/memory@0.27.1
  - @tangleai/core@0.27.1
  - @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- Updated dependencies [84fe0a2]
- Updated dependencies [6dcfde9]
- Updated dependencies [a6fa7f3]
- Updated dependencies [d4d8d0b]
- Updated dependencies [63504f3]
- Updated dependencies [7f2e26f]
  - @tangleai/memory@0.27.0
  - @tangleai/core@0.27.0
  - @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- Updated dependencies [9cc91c1]
  - @tangleai/memory@0.26.3
  - @tangleai/core@0.26.3
  - @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- Updated dependencies [4c42ba1]
  - @tangleai/memory@0.26.2
  - @tangleai/core@0.26.2
  - @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/core@0.26.1
  - @tangleai/memory@0.26.1
  - @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [6e0f5be]
  - @tangleai/core@0.26.0
  - @tangleai/memory@0.26.0
  - @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1
  - @tangleai/core@0.25.1
  - @tangleai/memory@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/core@0.25.0
  - @tangleai/memory@0.25.0
  - @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/core@0.24.1
  - @tangleai/memory@0.24.1
  - @tangleai/models@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/models@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.23.0
  - @tangleai/core@0.23.0
  - @tangleai/models@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.22.0
  - @tangleai/core@0.22.0
  - @tangleai/memory@0.22.0

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.
- Updated dependencies
  - @tangleai/models@0.21.1
  - @tangleai/core@0.21.1
  - @tangleai/memory@0.21.1

## 0.21.0

### Minor Changes

- Use the models, context and agents owners of the inherited AI mechanisms. MAS
  executable identity version 3 names all executed mechanism versions; an old
  executable checkpoint is refused intact through the existing mismatch path.
  Memory and ledger records retain their schemas and projection contracts.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/core@0.21.0
  - @tangleai/memory@0.21.0
  - @tangleai/models@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.1
  - @tangleai/memory@0.20.1

## 0.20.0

### Minor Changes

- Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.0
  - @tangleai/memory@0.20.0
