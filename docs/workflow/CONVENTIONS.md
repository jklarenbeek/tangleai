# Conventions — the rules, once

Every other workflow file points here instead of restating these.

## 1. Repo model (invariants every change preserves)

- **TypeScript-only, no build step.** Node ≥ 24 runs `.ts` directly
  (type stripping); package `exports` point at `./src/*.ts`. Erasable
  syntax only, `verbatimModuleSyntax`, strict. There is no `dist/` for
  packages — the source is the artifact.
- **jarenjs-only dependencies.** Runtime dependencies are `@jarenjs/*`
  and `@tangleai/*`, nothing else. Bun and Node are runtimes/toolchains,
  not dependencies. Dev-only tooling that never ships (typescript,
  @types/node) is exempt; a new exemption is a decision to record in
  the README, not a default.
- **The boundary** (`docs/BOUNDARY.md`): contracts and seams live in
  jarenjs; policies and infrastructure live here. Friction with the
  suite's published types is not worked around silently — it is recorded
  in `JARENASK.md` with the upstream fix path.
- **Dependency injection at every seam**: store, embedder, judge, clock,
  fetch, driver. A module that reaches for a global has a design bug.
- **Errors are values** at content boundaries (`TangleError` codes
  TA0001/2/3, contract failures, `{ error }` shapes). Throwing is for
  caller bugs.
- **Evidence is mandatory.** A memory without evidence is refused at the
  store boundary; an answer cites record ids. This rule outranks
  convenience everywhere it applies.
- **Two ordering rules are load-bearing and test-pinned**: the novelty
  gate filters near-verbatim only; contradictions resolve BEFORE
  crystallization; a judge resolution equal to the winner's text writes
  nothing.

## 2. The gates — verified by exit code, never by reading output

| Gate | Command | When |
|---|---|---|
| The gate | `npm run check` (strict tsc + all `node --test` suites) | every change, before every commit |
| Skeleton | `npm run skeleton` | when the loop's policies or core schemas changed |
| Desktop e2e | `.e2e/desktop.e2e.mjs` via the `ubuntu-playwright` distrobox (usage header in the script) | when the desktop UI or contract changed |
| Pages build | `bun apps/pages/build.ts` (+ `.e2e/pages.e2e.mjs`) | when apps/pages or the pipeline document changed |
| Instruments | `npm run documents:benchmark`, `npm run benchmark:locomo:census` | when a measured claim, a chunker, or a benchmark's corpus changed |
| Binary | `npm run desktop:compile`, then run `dist/tangle` from a foreign cwd | when the server, static layer or embed script changed |

A gate passes when its **exit code is 0**. Grepping output for the word
"pass" once declared a crashed linter green in jarenjs; the lesson is
inherited, not relearned. A flaky e2e failure is rerun in isolation
before it is believed.

## 3. Artifacts

- **`TODO.md`** (committed) is router, orders and status ledger in one:
  the campaign rule at the top, `## Done` as the ledger, `## Open` as
  the orders. There are no per-order files and no session-record files —
  an order's record is its ledger entry plus its commit.
- **`benchmark/`** (committed) is the measurement workspace: the instruments
  every published number names, a private `package.json` so a rival's
  dependencies never reach a shipped package, and upstream suites as git
  submodules (`benchmark/locomo` is CC BY-NC 4.0 and is never vendored). An
  instrument degrades to a stated skip when its submodule is absent — see
  [`benchmark/README.md`](../../benchmark/README.md) for the six rules one
  follows.
- **`docs/attic/`** is salvage: read-only source material from the
  predecessors. Never import from it; port out of it.
- **`.e2e/`** holds the browser-verification scripts (committed) and
  their screenshots (gitignored).
- Generated, never committed: `apps/desktop/public/app.js`,
  `apps/desktop/public/vendor.css`, `apps/pages/dist/`, `dist/`, and a
  POPULATED `apps/desktop/src/assets.gen.ts` (the committed version is
  the empty stub — see its header).

## 4. Documentation rules

- Docs state what IS, dated when it matters; plans live in `TODO.md`
  orders, not in product docs.
- Numbers in docs are derived from runs, never asserted. Losses are
  published beside wins — a comparison that only reports victories is
  marketing, and this repo does not ship marketing.
- Committed files may reference `TODO.md` (it is committed here, unlike
  jarenjs's scratch): use order numbers, e.g. "TODO 08".

## 5. Close-out & commit protocol

1. Run the gate (§2) — exit code 0, on the full suite, not a subset.
2. Re-read the diff (`git diff` / `git status`) — nothing generated,
   nothing populated-stub, nothing accidental.
3. Update what the change made stale: `TODO.md` ledger, README counts,
   `docs/` claims.
4. Commit as Joham. **One short message, present tense, no attribution
   footer, no tool names, no version numbers in the message.** Tags
   carry versions when releasing (RELEASE.md).
5. Push only when asked.

## 6. Decisions and authority

An order's text binds its executor. Divergence from an order is
recorded in the ledger entry ("diverged: …why"). A conflict between an
order and these conventions is a stop-and-ask, not a judgment call.
The campaign rule at the top of `TODO.md` — **no self-evolving
capability before its instrument** — outranks everything in this
folder, including EVOLVE.md's ambitions.

```json
{
  "$workflow": "conventions",
  "stages": [],
  "gates": {
    "check": { "cmd": "npm run check", "pass": "exit==0" },
    "skeleton": { "cmd": "npm run skeleton", "pass": "exit==0" },
    "e2e-desktop": { "cmd": "distrobox: node .e2e/desktop.e2e.mjs", "pass": "exit==0" },
    "pages": { "cmd": "bun apps/pages/build.ts", "pass": "exit==0" },
    "instruments": { "cmd": "npm run documents:benchmark && npm run benchmark:locomo:census && npm run benchmark:locomo:recall", "pass": "exit==0" },
    "binary": { "cmd": "npm run desktop:compile", "pass": "exit==0" }
  }
}
```
