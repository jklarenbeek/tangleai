# @tangleai/trace2skill

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/agents@0.47.0
  - @tangleai/mas@0.47.0
  - @tangleai/outcomes@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/agents@0.46.0
  - @tangleai/mas@0.46.0
  - @tangleai/models@0.46.0
  - @tangleai/outcomes@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/outcomes@0.45.2
  - @tangleai/agents@0.45.2
  - @tangleai/mas@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/outcomes@0.45.1
  - @tangleai/agents@0.45.1
  - @tangleai/mas@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/agents@0.45.0
  - @tangleai/models@0.45.0
  - @tangleai/mas@0.45.0
  - @tangleai/outcomes@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/agents@0.44.0
  - @tangleai/mas@0.44.0
  - @tangleai/models@0.44.0
  - @tangleai/outcomes@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/agents@0.43.1
  - @tangleai/mas@0.43.1
  - @tangleai/models@0.43.1
  - @tangleai/outcomes@0.43.1

## 0.43.0

### Patch Changes

- @tangleai/outcomes@0.43.0
  - @tangleai/agents@0.43.0
  - @tangleai/mas@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1
  - @tangleai/agents@0.42.1
  - @tangleai/models@0.42.1
  - @tangleai/outcomes@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/agents@0.42.0
  - @tangleai/mas@0.42.0
  - @tangleai/outcomes@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/agents@0.41.0
  - @tangleai/mas@0.41.0
  - @tangleai/models@0.41.0
  - @tangleai/outcomes@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [a8765d5]
- Updated dependencies [1beddfc]
  - @tangleai/outcomes@0.40.0
  - @tangleai/agents@0.40.0
  - @tangleai/mas@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Minor Changes

- aa45527: Retain origin-bound research lessons and stage held-out-validated procedure
  candidates through the native guarded compiler and atomic research transaction.
  Expose the native candidate diff calculation for shared compiler receipts.
  Generate bounded source-class proposals, qualify immutable sets through native
  outcome promotion and rollback, and freeze their procedures into workflow and
  export provenance. Retain actual lesson measurements and refusals with writeback
  disabled by default.

### Patch Changes

- @tangleai/agents@0.39.0
  - @tangleai/mas@0.39.0
  - @tangleai/models@0.39.0
  - @tangleai/outcomes@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [e6a6f5c]
- Updated dependencies [8a5af48]
  - @tangleai/mas@0.38.0
  - @tangleai/outcomes@0.38.0
  - @tangleai/agents@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- @tangleai/outcomes@0.37.0
  - @tangleai/agents@0.37.0
  - @tangleai/mas@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [43cfab8]
  - @tangleai/mas@0.36.0
  - @tangleai/agents@0.36.0
  - @tangleai/models@0.36.0
  - @tangleai/outcomes@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/agents@0.35.0
  - @tangleai/mas@0.35.0
  - @tangleai/models@0.35.0
  - @tangleai/outcomes@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [c643e1e]
- Updated dependencies [8e34634]
  - @tangleai/mas@0.34.0
  - @tangleai/agents@0.34.0
  - @tangleai/models@0.34.0
  - @tangleai/outcomes@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
- Updated dependencies [2d64db7]
  - @tangleai/models@0.33.0
  - @tangleai/outcomes@0.33.0
  - @tangleai/agents@0.33.0
  - @tangleai/mas@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [a2b9c9d]
  - @tangleai/mas@0.32.0
  - @tangleai/agents@0.32.0
  - @tangleai/models@0.32.0
  - @tangleai/outcomes@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/agents@0.31.0
  - @tangleai/mas@0.31.0
  - @tangleai/models@0.31.0
  - @tangleai/outcomes@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/agents@0.30.1
  - @tangleai/mas@0.30.1
  - @tangleai/models@0.30.1
  - @tangleai/outcomes@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/outcomes@0.30.0
  - @tangleai/agents@0.30.0
  - @tangleai/mas@0.30.0
  - @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/agents@0.29.8
  - @tangleai/mas@0.29.8
  - @tangleai/models@0.29.8
  - @tangleai/outcomes@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/agents@0.29.7
  - @tangleai/mas@0.29.7
  - @tangleai/models@0.29.7
  - @tangleai/outcomes@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/agents@0.29.6
  - @tangleai/mas@0.29.6
  - @tangleai/models@0.29.6
  - @tangleai/outcomes@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/agents@0.29.5
  - @tangleai/mas@0.29.5
  - @tangleai/models@0.29.5
  - @tangleai/outcomes@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/agents@0.29.4
  - @tangleai/mas@0.29.4
  - @tangleai/models@0.29.4
  - @tangleai/outcomes@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/agents@0.29.3
  - @tangleai/mas@0.29.3
  - @tangleai/models@0.29.3
  - @tangleai/outcomes@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/agents@0.29.2
  - @tangleai/mas@0.29.2
  - @tangleai/models@0.29.2
  - @tangleai/outcomes@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/agents@0.29.1
  - @tangleai/mas@0.29.1
  - @tangleai/models@0.29.1
  - @tangleai/outcomes@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/agents@0.29.0
  - @tangleai/mas@0.29.0
  - @tangleai/models@0.29.0
  - @tangleai/outcomes@0.29.0

## 0.28.0

### Minor Changes

- f2eb14d: Add immutable skill directories, the anchored directory-patch compiler and revision-fenced activation, with in-memory and SQLite storage, plus starting-directory import, a trajectory-blind draft, a bounded executor that uses a directory directly, a resumable labeled-rollout fan-out, and one independent analyst per rollout whose failure path may propose a patch only after the host evaluator passes over a repair made in an in-memory sandbox, and hierarchical conflict-free consolidation of the whole patch population into one patch applied exactly once through a guarded editor into a staged immutable candidate. Role prompts ship as five versioned TOML packs compiled into an immutable artifact set published at `./artifacts`, whose revisions are the prompt versions a run's idempotency keys name, and a host can use an active directory directly — its root page composed into the request as data and one read-only tool over the rest — with no retrieval index between the directory and the task.

### Patch Changes

- Updated dependencies [f2eb14d]
  - @tangleai/outcomes@0.28.0
  - @tangleai/agents@0.28.0
  - @tangleai/mas@0.28.0
  - @tangleai/models@0.28.0
