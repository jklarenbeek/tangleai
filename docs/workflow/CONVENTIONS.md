# Conventions — the rules, once

Every other workflow file points here instead of restating these.

## 1. Repo model (invariants every change preserves)

- **Strict TypeScript source, JavaScript npm distributions.** Node ≥ 24 runs
  workspace `.ts` source and tests directly. Public package exports are compiled
  to ESM JavaScript and `.d.ts` declarations in an ignored staging directory for
  npm publication; JSON schema paths are preserved. The packed consumer gate
  verifies installed artifacts on Node, Bun and supported browser surfaces.
  Erasable syntax, `verbatimModuleSyntax` and strict typing remain mandatory.
- **One development version.** All workspaces share the public fixed group's
  version, starting at `0.20.0`. Major versions remain zero. Changesets records
  patch or minor intent; preparation updates the full suite before a release
  commit is pushed. Private workspaces remain private regardless of version.
- **jarenjs-only dependencies.** Runtime dependencies are `@jarenjs/*`
  and `@tangleai/*`, nothing else. Bun and Node are runtimes/toolchains,
  not dependencies. Dev-only tooling that never ships (typescript,
  @types/node) is exempt; a new exemption is a decision to record in
  the README, not a default.
- **The boundary** (`docs/BOUNDARY.md`): contracts and seams live in
  jarenjs; policies and infrastructure live here. Friction with the
  suite's published types is not worked around silently — it is recorded in
  the local gitignored upstream brief with the upstream fix path.
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
| Release | `npm run release:verify` (full gate, version record, JavaScript tarballs, external consumers and Pages build) | before release closeout |
| Skeleton | `npm run skeleton` | when the loop's policies or core schemas changed |
| Desktop e2e | `.e2e/desktop.e2e.mjs` via the `ubuntu-playwright` distrobox (usage header in the script) | when the desktop UI or contract changed |
| Pages build | `bun apps/pages/build.ts` (+ `.e2e/pages.e2e.mjs`) | when apps/pages or the pipeline document changed |
| Instruments | `npm run documents:benchmark`, `npm run benchmark:locomo:census`, `npm run benchmark:locomo:recall`, `npm run benchmark:locomo:qa` (keyless; `--live` spends a key and is never a gate) | when a measured claim, a chunker, or a benchmark's corpus changed |
| Binary | `npm run desktop:compile`, then run `dist/tangle` from a foreign cwd | when the server, static layer or embed script changed |

A gate passes when its **exit code is 0**. Grepping output for the word
"pass" once declared a crashed linter green in jarenjs; the lesson is
inherited, not relearned. A flaky e2e failure is rerun in isolation
before it is believed.

## 3. Artifacts

- **Campaign files are gitignored scratch** (`TODO*.md`). The **router** —
  one per campaign: charter, measured baseline, fixed D-number decisions,
  the order table, the status ledger — is `TODO_<PROGRAM>.md`, specified
  section by section in [`CAMPAIGN.md`](CAMPAIGN.md) §"The router". The
  **work order** — one per step, self-contained, ending in an acceptance
  checklist that IS the definition of done — is `TODO_<PROGRAM>_NN.md`,
  and the **session record** — one per executed order, written after the
  work is green — is `TODO_<PROGRAM>_NN_RECORD.md`; both have a template
  in [`templates/`](templates/). The local **index** `TODO.md` says which
  campaign is in flight, which bases are drafted, and what earlier ones
  shipped. Never write a record under any other name, never create a
  `PROGRESS*.md`, and never force-add any of them: they will not exist in
  a fresh clone and are not recoverable once deleted — before clearing a
  campaign, move any unexecuted intent into `docs/ROADMAP.md`.
- **`docs/ROADMAP.md`** (committed) is what the repository wants to have
  and does not yet: open work only, each entry a problem with the
  constraint that makes it hard and the measurement that would close it.
  It carries no orders, no status and no "next" marker; a campaign is
  what the operator makes of an entry.
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

- Docs state what IS, dated when it matters; wants live in
  `docs/ROADMAP.md` (open work only — a shipped capability moves into the
  package docs and its entry leaves) and plans in campaign scratch, never
  in product docs.
- Numbers in docs are derived from runs, never asserted. Losses are
  published beside wins — a comparison that only reports victories is
  marketing, and this repo does not ship marketing.
- **Never reference a gitignored file from committed code, comments,
  documentation or a commit message** — not a `TODO_*` file, not an order
  number, not a D-number. Naming the *convention* (as this file does) is
  fine; naming "order 08" is the rot the rule prevents. When intent must
  survive, restate the meaning where it belongs — never flatten it into a
  hollow word.
- Comments state intent and constraints, not history: no "moved from X",
  no "added in order 04". The source is the source of truth when prose
  disagrees; the prose is repaired, never the behavior invented.

## 5. Close-out & commit protocol

The executable protocol is `npm run release:closeout`; [RELEASE.md](RELEASE.md)
describes it. It runs when the operator requests closeout. Prepare a reviewable
change, record its Changesets impact and update stale documentation first.

1. Run `npm run release:prepare` before committing. The command updates every
   workspace version and internal reference, the lockfile, changelogs and release
   record. Major release intent is refused. If fixes follow preparation, review
   them and run `npm run release:prepare -- --refresh` before closeout.
2. Run `npm run release:closeout -- --message "Short present-tense message"`.
   It verifies the release, runs the complete gate and packed consumer checks,
   reviews whitespace/stub invariants, and commits as Joham. Starting on `main`
   creates a release branch for the checked pull request.
3. Use one short present-tense commit message, with no attribution footer, tool
   names or version numbers. Annotated tags carry versions.
4. Add `--push` when pushing is authorized. The pre-push hook checks the actual
   refs and version advancement; the required CI check enforces the same rule
   before merging into `main`.
5. After merge, the release workflow tags the accepted commit, verifies npm
   publication and installs, then deploys and verifies Pages. Completion requires
   all these checks. Never report a site deployment as proof of npm publication.

Abort at the first failure. A failed preparation restores its version, lockfile,
changeset and changelog writes. An interrupted npm publication resumes against
immutable artifact identities; it cannot be rolled back as one transaction.

## 6. Decisions and authority

An order's text binds its executor, and a router's D-numbers are
immutable for the life of the campaign: an executor who believes one is
wrong records the conflict in the session record, and only the operator
amends the router. Divergence from an order is recorded in the session
record ("diverged: …why"). A conflict between an order and these
conventions is a stop-and-ask, not a judgment call. Preflight is a clean
tree: every pass and every order starts from `git status --porcelain`
printing nothing (scratch does not count), so the work is one reviewable
diff against a known commit. The standing rule — **no self-evolving
capability ships before the instrument that can call it an
improvement** — outranks everything in this folder, including EVOLVE.md's
ambitions; the instrument is the LoCoMo pair in `docs/`.

```json
{
  "$workflow": "conventions",
  "stages": [],
  "gates": {
    "check": { "cmd": "npm run check", "pass": "exit==0" },
    "skeleton": { "cmd": "npm run skeleton", "pass": "exit==0" },
    "e2e-desktop": { "cmd": "distrobox: node .e2e/desktop.e2e.mjs", "pass": "exit==0" },
    "pages": { "cmd": "bun apps/pages/build.ts", "pass": "exit==0" },
    "instruments": { "cmd": "npm run documents:benchmark && npm run benchmark:locomo:census && npm run benchmark:locomo:recall && npm run benchmark:locomo:qa", "pass": "exit==0" },
    "binary": { "cmd": "npm run desktop:compile", "pass": "exit==0" }
  }
}
```
