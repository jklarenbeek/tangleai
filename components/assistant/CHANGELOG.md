# @tangleai/assistant

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/context@0.48.1
  - @tangleai/agents@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/context@0.48.0
  - @tangleai/agents@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/context@0.47.0
  - @tangleai/agents@0.47.0

## 0.46.0

### Minor Changes

- Ship an assistant pack for every language `@jarenjs/locales` ships. `@tangleai/assistant/messages/ja`, `/ko`, `/ru`, `/tr` and `/zh-tw` export formal Japanese, Korean, Russian, Turkish and Traditional Chinese (Taiwan) catalogues with exactly the English keys, under the names Jaren's packs use (`zhTW` from `/messages/zh-tw`), so a host passes the assistant pack and the Jaren pack of one language side by side. Russian agrees the words around a count with its one, few and many forms; Japanese, Korean and Chinese count with counters; Turkish keeps the noun singular after a number. The catalogue gains `md/page-break`, `md/permalink`, `md/permalink-section`, `md/backref` and `md/backref-occurrence`, and a reply's page breaks, heading permalinks and footnote back-references are named from them, in each pack with the wording of the same language's Jaren pack; English output is unchanged. The Pages game's validation-language switch offers all eleven Jaren packs.

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/agents@0.46.0
  - @tangleai/context@0.46.0
  - @tangleai/models@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/agents@0.45.2
  - @tangleai/context@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/agents@0.45.1
  - @tangleai/context@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/agents@0.45.0
  - @tangleai/context@0.45.0
  - @tangleai/models@0.45.0

## 0.44.0

### Minor Changes

- 4dfc966: Render every sentence of the assistant panel from one message catalogue. `@tangleai/assistant/messages` exports the English catalogue and `createAssistantMessages`; `createAssistantController`, `mountAssistant` and `createAssistantWidget` accept a `messages` catalogue that merges over English and refuse an unknown key when it is built. Text another package writes is shown verbatim inside a catalogue message, explicit presentation options still take precedence, and the Markdown footnotes label comes from the catalogue. The panel's projection no longer reaches the model client. English output is unchanged except five counts of one, which now read singular. `@tangleai/assistant/messages/nl`, `/de`, `/fr`, `/es`, `/pt` and `/ar` export formal Dutch, German, French, Spanish, Brazilian Portuguese and Modern Standard Arabic catalogues with exactly the English keys and each language's plurals and digits; pass one as `messages`. Arabic phrases every count around a fixed count noun and keeps Latin digits. Words a language shares with English, setting examples, product names, text another package wrote and Jaren's Markdown labels stay as written. The panel and the view take `lang` and `dir` options for the assistant's root, and the stylesheet sets no physical side, so `dir: 'rtl'` lays the assistant out right to left. `@tangleai/assistant/view` mounts the panel for a host that runs the assistant elsewhere: `mountAssistantView` and `createAssistantViewWidget` render the host's report of its run (`status`, `runId`, `messages`, `pending`, `progress`, `links`, `notice`, `error`, `conversation`) with the panel's rules and catalogue, hand a start and a cancel to the host's transport and opening, closing and following a link to `onIntent`, refuse a malformed report with a `TypeError` naming its member, and never cancel a run when disposed; `update` replaces the report. Its static imports and its browser bundle contain no model, agent or context module.

### Patch Changes

- @tangleai/agents@0.44.0
  - @tangleai/context@0.44.0
  - @tangleai/models@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/agents@0.43.1
  - @tangleai/context@0.43.1
  - @tangleai/models@0.43.1

## 0.43.0

### Patch Changes

- @tangleai/agents@0.43.0
  - @tangleai/context@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/agents@0.42.1
  - @tangleai/context@0.42.1
  - @tangleai/models@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/agents@0.42.0
  - @tangleai/context@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/agents@0.41.0
  - @tangleai/context@0.41.0
  - @tangleai/models@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/agents@0.40.0
  - @tangleai/context@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/agents@0.39.0
  - @tangleai/context@0.39.0
  - @tangleai/models@0.39.0

## 0.38.0

### Patch Changes

- @tangleai/agents@0.38.0
  - @tangleai/context@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- @tangleai/agents@0.37.0
  - @tangleai/context@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/agents@0.36.0
  - @tangleai/context@0.36.0
  - @tangleai/models@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/agents@0.35.0
  - @tangleai/context@0.35.0
  - @tangleai/models@0.35.0

## 0.34.0

### Patch Changes

- @tangleai/agents@0.34.0
  - @tangleai/context@0.34.0
  - @tangleai/models@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
  - @tangleai/models@0.33.0
  - @tangleai/agents@0.33.0
  - @tangleai/context@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/agents@0.32.0
  - @tangleai/context@0.32.0
  - @tangleai/models@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/agents@0.31.0
  - @tangleai/context@0.31.0
  - @tangleai/models@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/agents@0.30.1
  - @tangleai/context@0.30.1
  - @tangleai/models@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/agents@0.30.0
  - @tangleai/context@0.30.0
  - @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/agents@0.29.8
  - @tangleai/context@0.29.8
  - @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/agents@0.29.7
  - @tangleai/context@0.29.7
  - @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/agents@0.29.6
  - @tangleai/context@0.29.6
  - @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/agents@0.29.5
  - @tangleai/context@0.29.5
  - @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/agents@0.29.4
  - @tangleai/context@0.29.4
  - @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/agents@0.29.3
  - @tangleai/context@0.29.3
  - @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/agents@0.29.2
  - @tangleai/context@0.29.2
  - @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/agents@0.29.1
  - @tangleai/context@0.29.1
  - @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/agents@0.29.0
  - @tangleai/context@0.29.0
  - @tangleai/models@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/agents@0.28.0
  - @tangleai/context@0.28.0
  - @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- @tangleai/agents@0.27.3
  - @tangleai/context@0.27.3
  - @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- 1a1cf01: Integrate the Jaren 0.89.0 registry foundation and source pin. Qualify guarded host migrations with preserved Tangle evidence, durable replay and failure isolation, and native Markdown page breaks through the existing assistant renderer. Preserve the selected memory policy and requalify current benchmark evidence.
- @tangleai/agents@0.27.2
  - @tangleai/context@0.27.2
  - @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- @tangleai/agents@0.27.1
  - @tangleai/context@0.27.1
  - @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- Updated dependencies [6dcfde9]
  - @tangleai/context@0.27.0
  - @tangleai/agents@0.27.0
  - @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- @tangleai/agents@0.26.3
  - @tangleai/context@0.26.3
  - @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- @tangleai/agents@0.26.2
  - @tangleai/context@0.26.2
  - @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/agents@0.26.1
  - @tangleai/context@0.26.1
  - @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- @tangleai/agents@0.26.0
  - @tangleai/context@0.26.0
  - @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1
  - @tangleai/context@0.25.1
  - @tangleai/agents@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/agents@0.25.0
  - @tangleai/context@0.25.0
  - @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/agents@0.24.1
  - @tangleai/context@0.24.1
  - @tangleai/models@0.24.1

## 0.24.0

### Patch Changes

- @tangleai/agents@0.24.0
  - @tangleai/context@0.24.0
  - @tangleai/models@0.24.0

## 0.23.0

### Patch Changes

- @tangleai/agents@0.23.0
  - @tangleai/context@0.23.0
  - @tangleai/models@0.23.0

## 0.22.0

### Patch Changes

- Convert the migrated source, tests, benchmarks and hosts to strict TypeScript,
  with JavaScript and declarations emitted through one release build. Move the
  program pen from `@tangleai/jaren/program` and the Jaren integration barrel to
  `@tangleai/linq/program`, preserving its JSON format and phantom binding types.
  The new `@tangleai/linq` root exposes the program namespace and shared build error.

  Match the embedder declarations to unknown widths before the first response,
  retain precise ledger result variants, and enforce the refinement-pressure
  instrument's stated 60-second deadline through the chat client's abort signal.
- Updated dependencies
  - @tangleai/models@0.22.0
  - @tangleai/context@0.22.0
  - @tangleai/agents@0.22.0

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
  - @tangleai/context@0.21.1
  - @tangleai/agents@0.21.1

## 0.21.0

### Minor Changes

- Receive the reusable assistant and injected slot ledger storage, preserving
  streaming, transcript and evidenced-memory behavior with owned cleanup.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.21.0
  - @tangleai/context@0.21.0
  - @tangleai/agents@0.21.0

## Unreleased

Received the existing assistant with injected host services and owned lifecycle.
