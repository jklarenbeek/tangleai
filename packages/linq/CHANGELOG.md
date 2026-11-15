# @tangleai/linq

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.

## 0.45.2

No changes in this release.

## 0.45.1

No changes in this release.

## 0.45.0

No changes in this release.

## 0.44.0

No changes in this release.

## 0.43.1

No changes in this release.

## 0.43.0

No changes in this release.

## 0.42.1

No changes in this release.

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

## 0.41.0

No changes in this release.

## 0.40.0

No changes in this release.

## 0.39.0

No changes in this release.

## 0.38.0

No changes in this release.

## 0.37.0

No changes in this release.

## 0.36.0

No changes in this release.

## 0.35.0

No changes in this release.

## 0.34.0

No changes in this release.

## 0.33.0

No changes in this release.

## 0.32.0

No changes in this release.

## 0.31.0

No changes in this release.

## 0.30.1

No changes in this release.

## 0.30.0

No changes in this release.

## 0.29.8

No changes in this release.

## 0.29.7

No changes in this release.

## 0.29.6

No changes in this release.

## 0.29.5

No changes in this release.

## 0.29.4

No changes in this release.

## 0.29.3

No changes in this release.

## 0.29.2

No changes in this release.

## 0.29.1

No changes in this release.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.3

No changes in this release.

## 0.27.2

No changes in this release.

## 0.27.1

No changes in this release.

## 0.27.0

No changes in this release.

## 0.26.3

No changes in this release.

## 0.26.2

No changes in this release.

## 0.26.1

No changes in this release.

## 0.26.0

No changes in this release.

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.

## 0.25.0

No changes in this release.

## 0.24.1

No changes in this release.

## 0.24.0

No changes in this release.

## 0.23.0

No changes in this release.

## 0.22.0

### Minor Changes

- Convert the migrated source, tests, benchmarks and hosts to strict TypeScript,
  with JavaScript and declarations emitted through one release build. Move the
  program pen from `@tangleai/jaren/program` and the Jaren integration barrel to
  `@tangleai/linq/program`, preserving its JSON format and phantom binding types.
  The new `@tangleai/linq` root exposes the program namespace and shared build error.

  Match the embedder declarations to unknown widths before the first response,
  retain precise ledger result variants, and enforce the refinement-pressure
  instrument's stated 60-second deadline through the chat client's abort signal.
