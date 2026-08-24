# The workflow — how this repository is changed and proved

Process lives here; product documentation lives one level up in `docs/`
(`ARCHITECTURE.md`, `BOUNDARY.md`, `PAPERS.md`, `JARENASK.md`).

This is jarenjs's `docs/workflow/` re-derived for a smaller, younger repo —
same spine (rules once → build → tidy → ship), three deliberate efficiencies,
and one experiment:

1. **One committed ledger instead of scratch trios.** jarenjs runs campaigns
   as gitignored `TODO_<PROGRAM>.md` + per-order files + per-order session
   records. Tangle has ONE campaign and it is young: the router, the orders
   and the status ledger are all [`TODO.md`](../../TODO.md), committed. A
   finished order's record is its ledger entry plus its commit — three
   artifacts collapse into one file and history.
2. **One health pass instead of two.** jarenjs separates REFACTOR (moves,
   never behavior) from QUIRKS (behavior, with reproductions). At this size
   one pass with two mandates is enough — [`HEALTH.md`](HEALTH.md) keeps the
   distinction as rules, not as documents.
3. **Machine-readable stages.** Every workflow file ends with a `stages`
   JSON block — the same information as the prose, as data. Today it is
   documentation with teeth (a reader can diff prose against stages);
   [`EVOLVE.md`](EVOLVE.md) is the design for executing and eventually
   optimizing these as `jaren-dag` documents inside the desktop app.

Read in this order:

| File | Role |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | The rules, once — repo model, gates (by exit code), artifacts, docs rules, close-out & commit protocol. |
| [`CAMPAIGN.md`](CAMPAIGN.md) | Build — how orders in `TODO.md` are authored and executed; measurement-first is the law here. |
| [`HEALTH.md`](HEALTH.md) | Tidy & hunt — the idempotent duplicate/drift/quirk pass. |
| [`RELEASE.md`](RELEASE.md) | Ship — tags, the compiled binary, the pages deploy; no npm yet. |
| [`EVOLVE.md`](EVOLVE.md) | The experiment — workflows as executable, measurable, evolvable DAGs. Design, explicitly gated. |
