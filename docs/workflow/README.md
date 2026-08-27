# The workflow — how this repository is changed and proved

Process lives here; product documentation lives one level up in `docs/`
(`ARCHITECTURE.md`, `BOUNDARY.md`, `ROADMAP.md`, `PAPERS.md`,
`JARENASK.md`, the benchmark documents).

This is jarenjs's `docs/workflow/` re-derived for a smaller, younger repo —
the same spine (rules once → build → tidy → ship), the same campaign model
(a gitignored router that settles decisions once, self-contained orders, a
session record per order, and a committed roadmap that lists only what is
still open), two deliberate efficiencies, and one experiment:

1. **One health pass instead of two.** jarenjs separates REFACTOR (moves,
   never behavior) from QUIRKS (behavior, with reproductions). At this size
   one pass with two mandates is enough — [`HEALTH.md`](HEALTH.md) keeps the
   distinction as rules, not as documents.
2. **Machine-readable stages.** Every workflow file ends with a `stages`
   JSON block — the same information as the prose, as data. Today it is
   documentation with teeth (a reader can diff prose against stages);
   [`EVOLVE.md`](EVOLVE.md) is the design for executing and eventually
   optimizing these as `jaren-dag` documents inside the desktop app.

Read in this order:

| File | Role |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | **The rules, once** — repo model, gates (by exit code), artifacts, documentation rules, close-out & commit protocol, decisions & authority. Every other file here points at it. |
| [`BOOTSTRAP.md`](BOOTSTRAP.md) | The prompt a fresh session is handed to execute one work order from the router, the order and the repo alone. |
| [`CAMPAIGN.md`](CAMPAIGN.md) | **Build** — authoring a multi-order campaign from a `docs/ROADMAP.md` entry: measure first, settle decisions once in a router, write self-contained orders; an order is closed by its measurement, not by its merge. |
| [`templates/`](templates/) | The work-order and session-record shapes — each the template followed by a filled-in one against this repository. The router's shape is specified in `CAMPAIGN.md` §"The router". |
| [`HEALTH.md`](HEALTH.md) | **Tidy & hunt** — the idempotent duplicate/drift/quirk pass. |
| [`RELEASE.md`](RELEASE.md) | **Ship** — tags, the compiled binary, the pages deploy; no npm yet. |
| [`EVOLVE.md`](EVOLVE.md) | The experiment — workflows as executable, measurable, evolvable DAGs. Design, explicitly gated. |

Campaign files are gitignored scratch — `TODO.md` (the local index),
`TODO_<PROGRAM>.md` (router), `TODO_<PROGRAM>_NN.md` (orders),
`TODO_<PROGRAM>_NN_RECORD.md` (records) — `CONVENTIONS.md` §3. What the
repository wants to have is the committed [`docs/ROADMAP.md`](../ROADMAP.md);
the operator picks an entry, a campaign is drafted from it locally, and what
happens after each order lands is the operator's decision.
