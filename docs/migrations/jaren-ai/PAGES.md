# Tangle Pages hosts

The existing landing page and pipeline remain in `apps/pages`. Studio (`#/project`,
with `#/studio` as an alias), Playground (`#/play`), Flow (`#/flow`), Data (`#/data`)
and Adventure (`#/game`) are private host compositions. Studio, Data and Flow
mount the complete public Jaren components. Tangle owns routes, example seeds,
provider policy, storage identities, downloads and private worker bootstraps.
No private Jaren website controller, renderer, router or worker protocol is used.

The assistant is `@tangleai/assistant/component`, with a headless package root.
Each mount owns its requests, listeners and optional writer close callback.
Flow starts at its original template picker. Shared project links initialize
their actual document before mounting, then run through the public operation;
they do not briefly expose a different starter's state. Route changes keep
Studio/Flow editing state. Data's public `setActive` releases worker/stream
ownership and resumes the accepted model while preserving raw, unfinished
buffers. The game stops pending NPC requests on exit and clears only its
transient thinking flag on remount. Unconfigured play needs no provider.

## Tool mapping

Every original tool name remains stable so saved tool descriptions and callers
can find the same operations. Descriptions and input schemas are retained;
`jaren_navigate` additionally recognizes Data and Adventure.

| Tools | Public operation in this host |
|---|---|
| `jaren_validate`, `jaren_run_engine` | Open Playground, apply its public session and run the existing engine boundary |
| `jaren_list_engines`, `jaren_get_examples` | Public Play engine descriptors and example catalog |
| `jaren_get_state`, `jaren_navigate` | Visible private Pages route and current public editor snapshot |
| `jaren_project_files`, `jaren_project_author`, `jaren_project_write`, `jaren_project_run` | Studio read/validate/replace/run through `@tangleai/jaren/studio`; assembled imports and file routes are preserved |
| `jaren_studio_write`, `jaren_studio_patch`, `jaren_studio_read`, `jaren_get_templates` | Designated project app file, public artifact writer, JSON Pointer and original templates |
| `jaren_flow_write`, `jaren_flow_patch`, `jaren_flow_check`, `jaren_flow_get_templates` | Complete Flow editor, full grammar/compiler validation, shared undo history and original templates |
| `jaren_save_experiment`, `jaren_list_experiments`, `jaren_load_experiment`, `jaren_share_link` | Explicit private host persistence, legacy saved-record loading and clipboard/share links |
| New `jaren_flow_author`, `jaren_data_author`, `jaren_data_run` | Revision-bound AI candidates; explicit real execution after publication |

Changing a Flow document's kind creates a new mounted identity; an old proposal
cannot publish into it. Data authoring changes only model/query buffers; store
recreation requires an explicit `open` operation. Invalid and stale candidates
return their refusal without overwriting human work. Cancelling an assistant
turn also aborts its child authoring requests and refuses late candidates; late
provider tool calls cannot mutate the host after that cancellation. Queries return settled
results and plans. Optional Jaren-only documentation, chart gallery, calculator
route and benchmark services return explicit refusals. Offline project ejection
is unavailable unless a host provides an export service; JSON download and
portable share links remain available.

## Browser and storage boundaries

The private Pages build pins `@sqlite.org/sqlite-wasm@3.53.0-build1` and verifies
its installed version and WASM asset. Its two worker entries only initialize the
official driver and inject identities into Jaren's public Data worker factories.
No initializer enters a published package. The real browser suite exercises
owner/client transport, live registration counts, independent simultaneous
queries, migrations, spatial execution/plans, worker failure/timeout/retry and
teardown. WebKit's supported IndexedDB snapshot fallback is reported honestly;
OPFS ownership cases are conditioned on actual OPFS availability.

[Browser data transfer](BROWSER_DATA.md) describes explicit old-origin export,
selected non-secret slots, conflict refusal, partial-write reporting and
idempotent import. The Pages host conservatively elects a single ledger writer
on every browser. Hosts may separately qualify the adapter's atomic mode.

WebMCP goes through `@tangleai/agents` → `@jarenjs/contract/webmcp`. Automatic
discovery prefers usable `document.modelContext`, then `navigator.modelContext`.
Current `registerTool` and legacy `provideContext` are independent of root.
`webmcp.context`, including an own `undefined` or `null`, is authoritative.
Await `host.webmcp.ready`; `status` is not success while pending. Guarded getters,
pre-mutation unsupported fallback, refusal after partial registration, owned
rollback, pending disposal and late explicit refresh use that same adapter.
Cleanup is pinned to the selected context. A context without native removal
gets deactivated callbacks and an explicit removal limitation; a foreign catalog
is never cleared. Native browser availability is recorded separately from the
injected matrix. Focus requests a fresh binding after an unavailable result;
there is no browser sniffing, import-time cache or polling timer.

## Reproduce the browser checks

Run `npm run pages:build`, serve `apps/pages/dist` on `127.0.0.1:4715`, then run
`npm run pages:test:browser` in the existing `ubuntu-playwright` environment.
`PAGES_URL` overrides the server; `PLAYWRIGHT_PACKAGE` names the package.json of
the qualified Playwright installation (the existing sibling Jaren development
installation by default). This is test tooling only. The Pages runtime and
published packages consume installed Jaren artifacts, never sibling source.
Also retain `.e2e/pages.e2e.mjs` for the landing pipeline and the existing desktop
source/binary browser checks. Scripted provider responses use fixture endpoints;
no paid model call is needed for this campaign.
