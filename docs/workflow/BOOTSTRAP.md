# Bootstrap prompt — context-free work-order execution

You are an AI engineer executing ONE work order against this repository.
You have no prior conversation and need none: everything required is
this file, the campaign router, the work order named to you, and the
repo itself.

## What this repository is

Tangle AI: memory policies and infrastructure on top of the jarenjs
suite — a TypeScript-only npm workspace (`packages/*`, `apps/*`,
`benchmark/`) that Node ≥ 24 runs without a build step; tests are plain
`node --test` under repo-root `test/`, mirroring package names. The
invariants an executor must preserve are `CONVENTIONS.md` §1 (this
folder) and are binding: runtime dependencies are `@jarenjs/*` and
`@tangleai/*` only; the boundary in `docs/BOUNDARY.md` (contracts and
seams below, policies and infrastructure here — and **use what the suite
already publishes, do not write it again**); dependency injection at
every seam; errors as values at content boundaries; evidence mandatory on
every memory; the two test-pinned ordering rules; match the surrounding
style.

## How to execute a work order

1. Read the router (the program's charter, measured baseline and fixed
   D-number decisions) and your work order, fully, before touching
   anything — including every file in the order's "Read first" list and
   the salvage it names under `docs/attic/` (read-only: port out of it,
   never import from it).
2. Fixed decisions (D-numbers) are settled. Do not reopen them; if the
   code contradicts one, stop and record the conflict in your session
   record instead of improvising.
3. Work in small verified steps toward the work order's acceptance
   checklist. The checklist is the definition of done — nothing more,
   nothing less. An order is closed by its measurement, not by its merge:
   run the instrument the order names and record the number.
4. Prove it green before you call it done, from the repo root:
   **`npm run check`** — strict typecheck and every test suite, by exit
   code (`CONVENTIONS.md` §2) — plus `npm run skeleton` when a policy or a
   core schema moved, the instrument when a measured claim, a chunker or a
   corpus moved (the keyless tiers only; `--live` spends a key and is never
   a gate), and the e2e or the binary smoke when a surface moved. A test
   that pins a generated document (`docs/LOCOMO_*.md`) goes red when the
   rendering changes: regenerate through the instrument, never by hand.
5. Write the session record (`templates/session-record.md`) after the
   work is green — its Handoff section carries what a next session must
   know — under the gitignored name `CONVENTIONS.md` §3 fixes
   (`TODO_<PROGRAM>_NN_RECORD.md`), never a tracked path. Tick the order in
   the router's status ledger.

## Operator conventions (binding)

- Work lands on `main`, uncommitted, for human review. Never commit,
  tag, push, or branch on your own initiative; the close-out protocol
  in `CONVENTIONS.md` §5 runs only when the operator explicitly asks,
  and what happens to an order after it lands is the operator's decision.
  Once closeout is requested, that protocol includes the version tag and both
  pushes by default; follow RELEASE.md through remote-ref confirmation without
  asking again. An explicit local-only request ends at the verified commit.
  npm publication remains a separate manual author action.
- Committed code, comments and docs never reference scratch planning
  files or their order numbers (anything gitignored) — module headers
  describe the current role of the code, not its extraction history
  (`CONVENTIONS.md` §4).
- Comments state intent and constraints, not narration; the source is
  the source of truth when prose disagrees.
- Failures are counted values. Never a bare `catch`, never a silent
  default: a skipped question, a refused window, a rate-limited call is a
  number in the report.
- Claims stay gated. A surface may SHOW what a run did; nobody writes an
  improvement into a README that the instrument has not measured, and a
  loss is published beside the win.
