# @tangleai/gmpl

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/mas@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/mas@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/mas@0.45.1

## 0.45.0

### Patch Changes

- @tangleai/mas@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/mas@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/mas@0.43.1

## 0.43.0

### Patch Changes

- @tangleai/mas@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/mas@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/mas@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/mas@0.39.0

## 0.38.0

### Patch Changes

- 802642f: Run evidence-linked synthesis, hypothesis generation and preregistration through
  native single-agent or GMPL debate stages, with read-only tools, retained model
  costs, atomic plan freezing and advisory novelty replay. Bind participant-specific
  GMPL prompts without changing pattern topology and preserve typed native refusals.
- Updated dependencies [e6a6f5c]
- Updated dependencies [8a5af48]
  - @tangleai/mas@0.38.0

## 0.37.0

### Patch Changes

- @tangleai/mas@0.37.0

## 0.36.0

### Patch Changes

- ac6f698: Ship compiled trading prompts and concurrent evidence-bound analyst lanes with read-only cutoff-scoped tools. Reuse GMPL's reachable-schema projection for domain prompt contracts.
- Updated dependencies [43cfab8]
  - @tangleai/mas@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/mas@0.35.0

## 0.34.0

### Minor Changes

- 8e34634: Add rules-first intent triage, durable one-question clarification and pinned atomic
  query plans with host-response fact projection. Compile grounding prompt packs,
  share enclosing call budgets with MAS, expose intent-only GMPL clarification and
  bind the existing SQLite queue to the optimizer. Retain native response fencing,
  replay, turn limits and explicit budget failure accounting.

### Patch Changes

- Updated dependencies [c643e1e]
- Updated dependencies [8e34634]
  - @tangleai/mas@0.34.0

## 0.33.0

### Patch Changes

- @tangleai/mas@0.33.0

## 0.32.0

### Patch Changes

- 9ca82cd: Introduce evaluated orchestration contracts, immutable role artifacts and scope-bound learning state with version-and-revision activation fences. GMPL prompt artifacts accept namespaced pattern identifiers while its six executable recipe families remain closed.
- Updated dependencies [a2b9c9d]
  - @tangleai/mas@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/mas@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/mas@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/mas@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/mas@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/mas@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/mas@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/mas@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/mas@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/mas@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/mas@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/mas@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/mas@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/mas@0.28.0

## 0.27.3

### Patch Changes

- @tangleai/mas@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/mas@0.27.2

## 0.27.1

### Patch Changes

- @tangleai/mas@0.27.1

## 0.27.0

### Patch Changes

- @tangleai/mas@0.27.0

## 0.26.3

### Patch Changes

- @tangleai/mas@0.26.3

## 0.26.2

### Patch Changes

- @tangleai/mas@0.26.2

## 0.26.1

### Patch Changes

- bc6dcb8: Normalize native repository paths before discovering GMPL prompt packs, selecting stage schemas and hashing benchmark source manifests. Share one development inventory across artifact and benchmark builds so Windows excludes the outcome pack consistently with POSIX hosts. Preserve the fourteen shipped prompt artifacts and existing benchmark controls.
- @tangleai/mas@0.26.1

## 0.26.0

### Patch Changes

- @tangleai/mas@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/mas@0.25.1

## 0.25.0

### Minor Changes

- Add immutable schema-bound prompt artifacts, evidence-preserving pattern recipes and pure host bindings for the MAS runtime.

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.25.0
