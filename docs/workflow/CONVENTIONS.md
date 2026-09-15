# Conventions — the rules, once

Every other workflow file points here instead of restating these.

## 1. Repo model (invariants every change preserves)

- **Strict TypeScript source, JavaScript npm distributions.** Node ≥ 24 runs
  workspace `.ts` source and tests directly. Public package exports are compiled
  to ESM JavaScript and `.d.ts` declarations in an ignored staging directory for
  npm publication; JSON schema paths are preserved. The packed consumer gate
  verifies installed artifacts on Node, Bun and supported browser surfaces.
  Erasable syntax, `verbatimModuleSyntax` and strict typing remain mandatory.
- **One TypeScript source gate.** Models, context, agents, Jaren integrations,
  the assistant, Pages demos, benchmarks and tests use the same strict compiler
  settings. Vendor submodules retain their upstream languages; generated browser
  assets and `.mjs` browser/release harnesses remain JavaScript. Declaration
  files are emitted from TypeScript and checked by installed consumers with
  `skipLibCheck: false`.
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
| Outcome lifecycle | `npm run outcomes:smoke`, `npm run benchmark:outcome -- --require complete`, `npm run outcomes:contract:check` | when outcome schemas, lifecycle, guards, storage or measurement change |
| Policy contract | `npm run policy:check`, `npm run policy:contract:check`, `npm run emit:policy -- --check` (also in `check`) | when memory defaults or their contract change |
| Skeleton | `npm run skeleton` | when the loop's policies or core schemas changed |
| Desktop e2e | `.e2e/desktop.e2e.mjs` via the `ubuntu-playwright` distrobox (usage header in the script) | when the desktop UI or contract changed |
| Pages build | `bun apps/pages/build.ts` (+ `.e2e/pages.e2e.mjs`) | when apps/pages or the pipeline document changed |
| Migrated Pages browsers | `npm run pages:test:browser` against the built site; same Playwright toolchain as desktop, selected by `PLAYWRIGHT_PACKAGE` | when assistant, game or editor hosts change |
| Instruments | `npm run documents:benchmark`, `npm run benchmark:locomo:census`, `npm run benchmark:locomo:recall`, `npm run benchmark:locomo:qa`, `npm run benchmark:locomo:policy` (keyless; `--live` spends a key and is never a gate) | when a measured claim, a chunker, or a benchmark's corpus changed |
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

## 5. Work-order commits and campaign close-out

Commit each implemented work order locally on `main` after its acceptance
checklist, `npm run check` and applicable additional gates pass. Review the
complete diff, update affected documentation, check whitespace and the desktop
asset stub, and write the session record before committing. Stage only the
reviewed changes; keep scratch files ignored and preserve unrelated author edits.
Use the same author identity as release closeout (Joham
`jklarenbeek@gmail.com`) and one single-line, present-tense message of at most
72 characters, with
no attribution footer, tool names, version numbers or scratch references.
Record the resulting commit hash in the scratch record and router ledger.

These local commits are checkpoints: they do not prepare a version, run release
closeout, create tags or push any refs. Continue the next authorized order from
the committed state. A failed gate leaves that order uncommitted until fixed and
verified. Campaign release closeout starts only after the entire campaign is
implemented and green, including its final documentation, measurements and
scoped health review. Earlier authorization to close out when complete remains
valid; do not request it again at each order or release step.

The close-out protocol uses `npm run release:closeout` and the tag/push commands
in [RELEASE.md](RELEASE.md). An operator request to run closeout authorizes the
complete versioned Git release: prepare, verify, commit, create the annotated
version tag, and push both `main` and that tag to `origin`. Complete these steps
without requesting separate tag or push approval, unless the operator explicitly
requests a local-only closeout. Version preparation alone does not authorize
tagging or pushing. Prepare a reviewable change, record its Changesets impact
and update stale documentation first.

1. Run `npm run release:prepare` before the release commit. The command updates every
   workspace version and internal reference, the lockfile, changelogs and release
   record. Major release intent is refused. A version bump moves every published
   contract's `version`, so a surface that removed or narrowed nothing since the
   frozen release must name that release in its `compat` list, and one that did
   must not. The contract gate refuses a claim its own classified diff
   contradicts, and its failure message names the edit to make. If fixes follow preparation, review
   them and run `npm run release:prepare -- --refresh` before closeout.
2. Run `npm run release:closeout -- --message "Short present-tense message" --push`.
   It verifies the release, runs the complete gate and packed consumer checks,
   reviews whitespace/stub invariants, commits as Joham directly on `main`, and
   pushes `main`. No release branch or pull request is created. For an explicit
   local-only closeout, omit `--push` and stop after the verified local commit.
3. Use one short present-tense commit message, with no attribution footer, tool
   names or version numbers. Annotated tags carry versions.
4. After the verified commit, create or verify its annotated `v<version>` tag
   with `node scripts/release/tag.ts`, then push that exact tag to `origin` using
   the commands in RELEASE.md. The current closeout helper does not create or
   push tags itself; its successful exit is one step of this protocol. The
   pre-push hook checks the actual refs, version advancement and complete gate
   receipt, and requires the tag's commit to be on `origin/main`. Confirm remote
   `main` and the peeled tag both identify the release commit and the working
   tree is clean before reporting the Git release complete. Skip tagging and
   pushing for an explicit local-only request.
5. The author runs `npm run publish` from the clean committed release checkout.
   It verifies final-commit archives, verifies or creates the local tag, publishes
   using local npm authentication, and verifies registry installs. `-- --dry-run` verifies without
   tagging or uploading. Publishing and pushing are separate actions. After a
   main push, CI verifies the release and independently deploys Pages; it does
   not publish npm packages. Never report a site deployment as proof of npm
   publication. See RELEASE.md for unrelated edits and retry handling.

Abort at the first failure. If a push fails after the commit or tag exists,
retain those identities and resume the missing step as described in RELEASE.md;
never force-push, move a release tag, or bump again just to retry. A failed
preparation restores its version, lockfile, changeset and changelog writes.
An interrupted npm publication resumes against
immutable artifact identities; it cannot be rolled back as one transaction.

## 6. Decisions and authority

An order's text binds its executor, and a router's D-numbers are
immutable for the life of the campaign: an executor who believes one is
wrong records the conflict in the session record, and only the operator
amends the router. Divergence from an order is recorded in the session
record ("diverged: …why"). A conflict between an order and these
conventions is recorded and resolved against the operator's existing instructions
before asking for clarification; explicit operator instructions take precedence.
Preflight is a clean
tree: every pass and every order starts from `git status --porcelain`
printing nothing (scratch does not count), so the work is one reviewable
diff against a known commit. If the operator has already authorized continuing
an existing diff, record its starting state and ownership instead of asking to
commit or stash it again. Never discard or silently include unrelated edits.
The standing rule — **no self-evolving
capability ships before the instrument that can call it an
improvement** — outranks everything in this folder, including EVOLVE.md's
ambitions; the instrument is the LoCoMo pair in `docs/`.

```json
{
  "$workflow": "conventions",
  "stages": [],
  "gates": {
    "check": { "cmd": "npm run check", "pass": "exit==0" },
    "policy-contract": { "cmd": "npm run policy:check && npm run policy:contract:check && npm run emit:policy -- --check", "pass": "exit==0" },
    "skeleton": { "cmd": "npm run skeleton", "pass": "exit==0" },
    "e2e-desktop": { "cmd": "distrobox: node .e2e/desktop.e2e.mjs", "pass": "exit==0" },
    "pages": { "cmd": "bun apps/pages/build.ts", "pass": "exit==0" },
    "instruments": { "cmd": "npm run documents:benchmark && npm run benchmark:locomo:census && npm run benchmark:locomo:recall && npm run benchmark:locomo:qa && npm run benchmark:locomo:policy", "pass": "exit==0" },
    "binary": { "cmd": "npm run desktop:compile", "pass": "exit==0" }
  }
}
```
