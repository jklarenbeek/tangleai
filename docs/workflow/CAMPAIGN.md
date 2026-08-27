# CAMPAIGN.md — authoring and running a multi-order campaign

A **campaign** is how this repository takes on a body of work too large for one
session: a **router** that settles the decisions once, and a series of numbered,
self-contained **work orders** that a fresh session can execute from the router,
the order and the repo alone. The LoCoMo instrument — the census, the recall
ceiling, the scorer at parity, the answer path and its baselines — was built as
one such series, and it is the model every campaign here follows.

This file is the **authoring** playbook — how to decompose the work, what the
router must contain, and the rails that keep a campaign honest.
[`CONVENTIONS.md`](CONVENTIONS.md) is the companion: it holds, once, the rules
every session obeys (repo model, gates, artifacts, documentation rules,
close-out) and binds the **executor**; the work-order and session-record shapes
referenced throughout are in [`templates/`](templates/), and
[`BOOTSTRAP.md`](BOOTSTRAP.md) is what a fresh executor session is handed. Read
those too; this one does not restate them.

Authoring a campaign is itself a deliverable. A router that is vague, unmeasured,
or that leaves a fork open is not a plan — it is a promise that every executor
session will improvise differently.

## Where a campaign comes from

[`docs/ROADMAP.md`](../ROADMAP.md) says **what this repository wants to have**
and does not yet: open work only, each entry a problem with the constraint that
makes it hard and the measurement that would close it. A campaign is what
happens when the operator picks one entry, or a coherent slice of one, and turns
it into a router and orders. The roadmap never carries orders, status or a
"next" marker; the router does. When the campaign ships, the roadmap entry is
retired or narrowed to what is still genuinely open — that is the campaign's
last order, not an afterthought.

Nothing decides which entry is next except the operator. A drafted campaign —
a router written, orders written, nothing executed — is a proposal until the
operator ratifies it, and what happens after any order lands (commit, re-scope,
park, abandon) is the operator's call, every time.

## When a campaign is the right shape

| The work | The shape |
|---|---|
| One change, one session, one checklist | a single work order (`templates/work-order.md`), no router |
| Duplication, drift, dead code, quiet bugs — no new capability | [`HEALTH.md`](HEALTH.md), which is idempotent and may find nothing |
| A capability that needs several dependent steps, shared decisions, and a nameable end state | **a campaign** |
| A list of unrelated wants | [`ROADMAP.md`](../ROADMAP.md) — not a campaign |

The test: **can you name the end state in one sentence, and does getting there
require decisions that more than one order would otherwise re-litigate?** If yes,
write a campaign. If the second half is no, write one work order.

A campaign is **not** a container for everything touching a package. Unrelated
work that happens to live in the same directory belongs in its own campaign or in
the roadmap. A paper is not a campaign either: an audit of what a paper requires
against what the tree has is a **campaign basis** — kept as scratch, named in the
local index — and becomes a campaign only once it has been measured and scoped
under this file.

## The artifacts and their names

- **Router** — `TODO_<PROGRAM>.md`. One per campaign. The charter, the measured
  baseline, the fixed decisions, the order table, the status ledger.
- **Orders** — `TODO_<PROGRAM>_NN.md`, numbered from `01` in execution order,
  restarting at `01` for every campaign. Each is self-contained.
- **Session record** — `TODO_<PROGRAM>_NN_RECORD.md`, written by the executor
  after the order is green ([`templates/session-record.md`](templates/session-record.md));
  its Handoff section carries what the next session must know.
- **The local index** — `TODO.md`. One per checkout: which campaign is in
  flight, which bases are drafted and which roadmap entry each serves, and what
  earlier campaigns shipped, with their commits. It is the combining factor
  between the scratch files, and nothing more — no orders live in it.

`<PROGRAM>` is a short upper-case slug naming the capability, not the package
path. Numbering never renumbers: an order that turns out to be two orders becomes
`NN` plus a **new highest number**, never `NN_a`/`NN_b`.

**These files are gitignored scratch** (`TODO*.md`) — the naming, where session
records live, and why nothing committed may point at them are
[`CONVENTIONS.md`](CONVENTIONS.md) §3 and §4. Two consequences bind every
campaign: no committed file names a specific `TODO_*` file or an order number
(restate the intent where it belongs instead), and before clearing a campaign the
router's ledger is checked for unexecuted orders whose intent must first move to
[`ROADMAP.md`](../ROADMAP.md).

## Preflight — abort unless all three hold

1. **The working tree is clean** — `git status --porcelain` prints nothing. A
   campaign that begins on top of unrelated in-flight work cannot be reviewed as a
   sequence of clean diffs. If the tree is dirty, say so and ask the operator to
   commit or stash first. (Gitignored scratch does not count — the command already
   ignores it. The `benchmark/locomo` submodule counts: a stray file inside it is
   dirt.)
2. **No other campaign is in flight**, or the interaction is stated in the router.
   Two campaigns editing this small repo produce unattributable regressions.
3. **You have measured** — see the next section. Authoring from a document alone
   is the single most common way a campaign starts wrong.

## Authoring rule 1 — measure before you write a word of plan

**The roadmap, the READMEs, the benchmark documents and the last campaign's
records are claims, not evidence.** They were true when written. Re-derive every
number and every diagnosis the campaign will act on, from the code and from a
run, *before* deciding what the orders are.

This is not ceremony. The LoCoMo work started by measuring the release instead
of reading the paper, and four things a reading would have produced were wrong:

- The paper's session count. The release transcribes **272** sessions, not 288 —
  one conversation timestamps 35 and ships 19, so sixteen sessions exist only as
  dates. A harness that timelined the stamps would report a conversation months
  longer than its transcript.
- The oracle ceiling. **Nine of 2,815** evidence ids resolve to no turn, so an
  oracle row cannot score 1.000 honestly; the one that does is a global lookup
  reading another conversation. The ceiling is published as less than one, per
  k, and the gate compares each k to its own.
- The instrument's first win. The answer path's first table had the shipped
  policies ahead in every category — under a run in which the upstream
  rate-limited a fifth of the calls and the two rows answered unequal sets. The
  next run, without wire failures, reversed it.
- The document chunker's default. Three chunkers scored 100 % Recall@5 on the
  fixture corpus, which is the ceiling of a six-chunk corpus, not agreement; the
  default was chosen on cost and the table says SATURATED above it.

A campaign authored from the sentences instead of the runs would have shipped
real work against the wrong target. **Measure first, and put the measurement in
the router.**

How to do it well:

- **Classify by cause, not by count.** "The policies cost 0.9 points" is not
  actionable; "six filtered by the gate, 63 superseded by the judge, 339 absorbed
  by the crystallizer — and the questions could no longer retrieve what those
  removed" is. A census bucketed by cause is what lets orders be scoped so they
  do not overlap.
- **Verify the classification you inherit.** Read the actual expected-vs-actual
  output, not the summary.
- **Prefer a run to an intuition**, and say which you have. An assumption
  recorded as an assumption is useful; an assumption recorded as a fact poisons
  every order downstream.
- **Record the recipe, not just the result**, so a later session can re-run it.
  Inline the recipe in the router; do not leave the campaign depending on a
  scratch script. The instruments in `benchmark/` are the recipes this repo
  already has — a campaign that measures memory quality runs them, and a
  campaign that needs a new number writes a new instrument as its early order.
- **Audit the suite before you design anything.** [`docs/BOUNDARY.md`](../BOUNDARY.md)
  §"What the suite already has" is the dated inventory of what `@jarenjs/*`
  publishes at the pinned version. The expensive mistake in this repo is not
  putting a capability on the wrong side of the boundary; it is building one the
  boundary already has. Re-audit against the sibling checkout when the pin moved.

**A scoped quirk hunt is part of measuring.** Before authoring, run the hunt
half of [`HEALTH.md`](HEALTH.md) over the packages the campaign will touch —
readers with the adversarial mandate, every finding reproduced by you. What it
returns changes the plan in three ways, which is why it comes before the order
list and not after:

- A confirmed quirk *in the campaign's path* becomes a **Step 0** or its own early
  order, so no later order builds on it. Building a new lane on top of an
  importer that duplicates rows on run one is a campaign that fails in order 04
  for a reason authored in order 00.
- A confirmed quirk *beside* the path goes to the roadmap or to a reserved order —
  named, not fixed in passing, because a campaign never widens.
- The **checked-and-dropped list** goes into the router verbatim. It is the
  cheapest section a router has: it stops seven executors from each
  re-investigating the same suspicious-looking guard.

The result goes in the router under a heading that says **measured on `<date>`
with `<runtime>` — do not re-derive**, so seven orders do not each spend a session
rediscovering it. The same device works for what already exists: a dated
"verified, do not re-derive" section establishing that the mechanism a campaign
intended to build **is already in the suite** is what lets a campaign be three
small orders instead of a rewrite.

## Authoring rule 2 — settle the forks with the operator, not in the orders

Where two readings of the goal produce **materially different campaigns**, stop
and ask the operator before authoring. Ask concretely: name the fork, give the
options, state which you recommend and why, and show what each costs.

The temporal lane has such forks written into its roadmap entry — whether the
model or the kernel decides interval membership, whether a superseded record
answers for the window it was true in — and each answer changes the order list.
Asked up front they take one exchange; discovered mid-campaign they invalidate
finished orders.

Every answer becomes a **D-number** in the router. That is the point of asking.

## The router — required sections, in this order

1. **Title and charter.** One paragraph a fresh session can act on: what this
   campaign builds, which packages it touches, and the end state. Include a
   **north-star statement** — one sentence, set off as a block quote, that an
   executor can hold the whole campaign against. Name the roadmap entry the
   campaign serves. Vague charters produce vague orders.
2. **The measured baseline.** Dated, with the runtime, marked *do not re-derive*.
   Tables, not adjectives. Include the numbers the campaign will be judged on —
   **especially the ones that currently look bad.** A campaign that hides its
   starting loss cannot prove it closed it. Include the pre-campaign quirk hunt's
   three lists (confirmed-in-path, confirmed-beside-path with disposition,
   checked-and-dropped with reasons) — see Authoring rule 1.
3. **Fixed decisions (D1, D2, …).** See below.
4. **Cross-cutting contracts.** The constraints every order obeys that are not
   decisions but obligations: the invariants of CONVENTIONS §1 the campaign
   leans on, the boundary (what stays Tangle's, what is consumed from the suite,
   what must never migrate down), the gates, where shared code must land, the
   claim discipline for any surface the campaign touches. A campaign with a
   recurring theme gives it its own named section and says which orders it binds.
5. **Preflight**, if this campaign needs something done before order 01 (landing
   overlapping work, a submodule, a version bump of the suite, a decision from
   the operator).
6. **The order table** — number, file, one-line scope, size estimate (S/M/L), and
   whether it releases (RELEASE.md) or reaches a surface.
7. **Sequencing** — the dependencies in prose, with the *reason* for each. "02
   before 03 because 02 settles what the scorer measures" is a reason; "02
   before 03" is not.
8. **Definition of done (program-wide)** — what must be true when the last order
   lands, beyond each order's own checklist. This is where the campaign commits to
   retiring or narrowing its roadmap entry, publishing measurements, and
   documenting capability.
9. **The status ledger** — a checklist, one line per order, updated as records
   land: `- [x] TODO_<PROGRAM>_01 — <title> (DONE <date>, commit <hash> |
   uncommitted on master)`. The router is the single place progress lives.

An **append-only discoveries section** after the ledger is allowed, and
recommended for a campaign that expects its premises to move: an order that
finds its own premise wrong stops, records it there and in its session record,
and asks the operator rather than improvising a different order.

## D-numbers — what qualifies

A D-number is a decision that **more than one order would otherwise re-open**. It
is immutable for the life of the campaign. An executor who believes one is wrong
records the conflict in the session record; **only the operator amends the
router.**

Qualifies:

- A boundary — what the campaign will never do, and why.
- A default, especially a surprising one, **with its reason attached**. A default
  whose rationale is not written down gets "fixed" by a later reader.
- A home — which package owns a shared concept, so two orders do not each grow
  their own copy.
- A trust or safety rule that several orders could erode independently — the
  evidence rule, the no-clock rule, what a mutator may never touch.
- A reporting rule — how the campaign's numbers get published, so a late order
  cannot quietly drop an unflattering one.

Does not qualify: an implementation detail inside one order (that belongs in its
Design section), a preference with no cross-order effect, or a restatement of an
existing house rule (cross-reference it instead).

Write each as **`D<n> — <short name>.`** then the decision, the rationale in a
sentence, and what an executor must therefore never do. The last clause is what
makes it enforceable.

## The order file — required sections

Per [`templates/work-order.md`](templates/work-order.md), plus two
campaign-specific obligations:

- **A router pointer and the binding D-numbers**, first line. Then **"Read
  first:"** — the specific files, with the functions and line references that
  matter, whose conventions the new code must match; and **"Salvage:"** — where
  in `docs/attic/` the tuned knowledge for this order lives (thresholds, specs,
  seed data), or "none". A fresh session cannot infer either, and an order that
  ignores its salvage re-derives what the predecessor already paid for.
- **Goal** — the observable end state, not the activity.
- **Design** — the intended shape: module boundaries, data shapes, error surfaces,
  edge rules, and **the reasoning behind any non-obvious choice**. Decisions made
  here are made; an executor extends them, it does not re-litigate them. Where an
  order carries a diagnosis (a bug's root cause, a group of failures sharing one
  fix), put it here in full — with the concrete input and the expected-vs-actual
  output.
- **Files** — what changes, with one clause each.
- **Steps** — ordered, each small enough to test, with `npm run check` between
  batches so a regression is attributable.
- **Acceptance checklist** — behavioral assertions, each independently checkable,
  with exact names, outputs and error codes, and **the measurement** — the number
  the order exists to move, and where it is published. **This IS the definition
  of done.** It always ends with the full gate and the session record.

**An order is closed by its measurement, not by its merge.** An order whose
acceptance names no number is not an order yet, unless it is surface or plumbing
work whose checklist says so explicitly and whose surfaces may only SHOW what a
run did.

**"Step 0 — re-measure" is mandatory when an earlier order moves this order's
target.** State it as the first step, with the reason. The policy matrix opens by
re-running the recall instrument, because any order before it that touches the
embedder or a threshold moves the baseline row it is measured against.

## Sizing and sequencing

- **3–9 orders** is the observed range. Fewer means it was probably one order;
  more means the campaign is really two, or the orders are too small to justify a
  session each.
- **Sequence by dependency first, then by risk.** The order that *settles a
  measurement target* or *establishes a shared home* goes early, so later orders
  are not measured against a moving baseline. The order that touches **committed
  documents** or public surfaces goes late, when the thing being documented has
  stopped changing.
- **The instrument comes before the capability it judges.** This is the standing
  rule of the repository (CONVENTIONS §6), and in a campaign it is a sequencing
  rule: no policy, tier, loop or self-evolving mechanism ships in an order that
  precedes the order which can call it an improvement.
- **Deliver something visible early.** The smallest order with a user-facing
  effect is a good `01`: it proves the campaign's plumbing and gives the operator
  something to review.
- **Long campaigns take phases.** Group orders into phases with a **close-out
  order at each boundary** that proves the phase whole — docs, benchmarks, gates
  — rather than trailing loose ends into the next phase.
- **A reserved order is allowed** — numbered, written, and explicitly marked not
  scheduled — when a campaign wants to prove its model generalizes without
  committing to build it now.
- **An order's open tail becomes a new numbered order**, never a silent extension
  of the finished one and never a reopened D-number.
- **Every campaign ends with a close-out order**: the roadmap entry retired or
  narrowed, capability documented where a stranger would look, measurements
  regenerated and published with the loss beside the win, the pinned tests
  extended to cover what the campaign made worth pinning, surfaces updated under
  the claim discipline — **and a scoped [`HEALTH.md`](HEALTH.md) hunt over what
  the campaign built.** New capability is where quirks are born (a new importer is
  non-idempotent until proven otherwise; a new lane's failure is a bare catch until
  a test says it is a counted value). The close-out record carries the hunt's
  three lists next to the baseline table.

## Non-negotiables (inherited, not restated)

Every order obeys [`CONVENTIONS.md`](CONVENTIONS.md) — the repo model (§1), the
gates by exit code with numbers in the record (§2), the documentation rules (§4),
the clean-tree preflight and the uncommitted-for-review rule (§5, §6) — and the
router says so once. Three rules are campaign-specific enough to state here:

- **No redundancy, enforced during the campaign.** A campaign is where duplication
  is born: two orders each need a cosine, an identity check, a stats helper. The
  [`HEALTH.md`](HEALTH.md) placement rule applies *while* building, not
  afterwards — and the logical parent may be BELOW this repo: a shape the suite
  already ships is consumed, never re-written. Make it checkable: an order that
  could grow a duplicate carries an acceptance line asserting **exactly one
  implementation exists**, grep-proven in the record.
- **Anything an order builds that imports, syncs, ingests or reconciles passes the
  two-run check** before its record is written: the second run on identical input
  changes nothing, bumps no version, and reports zero — asserted by a test, not by
  running it twice by hand. And every instrument passes the determinism check:
  two runs over the same dataset and options produce byte-identical reports, with
  no clock reading in the document.
- **Failures are counted values.** A skipped question, a refused window, an
  unresolved evidence id, a rate-limited call, a citation the prompt did not list
  — each is a number in the report, never a bare catch and never a silent default.
  The predecessor's tiers dropped memories on persistence failure and nobody knew;
  that is the failure this rule exists to prevent.

## Documentation & reference rules

[`CONVENTIONS.md`](CONVENTIONS.md) §4, in full — with three of its rules being the
ones a campaign most often breaks: **no committed file references a campaign's
scratch files or its order numbers** (not code, not comments, not documentation,
not a commit message — restate the intent, never flatten it into a hollow word);
**`ROADMAP.md` lists open work only** (a campaign *closes* entries by moving
shipped capability into the package docs and `docs/`, and narrows what stays open
to an accurate decision); and **published figures are derived, never typed** — the
campaign that re-measures regenerates the documents through the instruments, and
**reports the loss** beside the win.

## Running the campaign

1. Author the router (§"The router") and every order (`templates/work-order.md`).
   Settle the D-numbers there, once. Register the campaign in the local `TODO.md`
   index. Hand the campaign to the operator for review **before** executing.
2. Per order: a fresh session holding [`BOOTSTRAP.md`](BOOTSTRAP.md), the router
   and that order. It executes, proves the gates, writes the session record,
   updates the router's status ledger; the record's Handoff section carries what
   must cross the session boundary.
3. **Work lands on `master`, uncommitted, for review.** No executor commits, tags,
   pushes or branches on its own initiative. No `PROGRESS*.md` is created for a
   run — the session record and, later, the commit message carry the summary.
4. The operator reviews and decides: run the close-out (CONVENTIONS §5), re-scope,
   park, or abandon. Every one of those is a legitimate outcome of an order, and
   only the operator picks.

## Close-out & commit protocol

Per order, and only when the operator explicitly asks, run
[`CONVENTIONS.md`](CONVENTIONS.md) §5 unchanged. `git add -A` stages the work —
confirm the gitignored campaign files are excluded, never force-add them. An order
that releases follows [`RELEASE.md`](RELEASE.md) on top.

## Acceptance checklist — for the authoring pass

- [ ] Preflight held: clean tree, no other campaign in flight, and the baseline
      was **measured**, not copied from existing documentation — including a scoped
      quirk hunt over the packages in scope, its findings dispositioned (Step 0 /
      early order / roadmap / dropped-with-reason) in the router.
- [ ] The suite was audited against the pinned version before any order was
      designed; every capability the campaign consumes from `@jarenjs/*` is named
      in the router, and nothing the suite publishes is scheduled to be rebuilt.
- [ ] Every fork that would change the order list was put to the operator and
      answered; each answer is a D-number.
- [ ] The router has all nine required sections, names its roadmap entry, and
      the baseline is dated, names its runtime, and is marked *do not re-derive*.
- [ ] The charter's end state is one sentence, and every order visibly serves it.
- [ ] Every order is **self-contained**: a fresh session with the bootstrap, the
      router, that order and the repo could execute it — no conversation context,
      no reference to another order's internals, no pointer to a scratch file.
- [ ] Every order names its "Read first" files and its salvage, carries its
      diagnosis in full, ends in a checklist of independently checkable assertions
      plus the gate, and names the measurement that closes it.
- [ ] Orders whose target an earlier order moves open with **Step 0 — re-measure**.
- [ ] Dependencies are stated **with reasons**; the instrument precedes what it
      judges; document-touching orders are late.
- [ ] The campaign closes or narrows the roadmap entry it claims to, and the
      close-out order says how.
- [ ] No committed file references the campaign's scratch files or order numbers.
- [ ] The campaign is registered in the local `TODO.md` index.

## Acceptance checklist — for the finished campaign

- [ ] Every order's status is recorded in the ledger with its date and commit.
- [ ] The end state named in the charter is true, and demonstrably so — the
      close-out record puts the router's baseline table beside the final numbers.
- [ ] The roadmap entry the campaign targeted is retired, or narrowed to
      accurately-stated open decisions.
- [ ] Capability is documented where a stranger would look: the package `README`,
      `docs/ARCHITECTURE.md`, `docs/BOUNDARY.md` where the seam moved, and the
      benchmark document for anything measured.
- [ ] Measurements regenerated through the instruments and re-derived into the
      prose; the pinned-document tests pass.
- [ ] The pinned tests extended to cover what this campaign made worth pinning — a
      test that would have caught the drift the campaign found is worth more than
      a paragraph promising not to drift again.
- [ ] The close-out quirk hunt ran over what the campaign built; its three lists
      are in the close-out record; every confirmed quirk in the campaign's own
      code is fixed with a regression test or named in the roadmap with its reason.
- [ ] No committed code, comment or document references a scratch file or an
      order number.

## Out of scope

- Executing orders while authoring. Authoring produces the plan; the operator
  reviews it before any code moves.
- Committing, tagging, pushing or deploying on the campaign's own initiative.
- Creating a `PROGRESS*.md`, or any scratch planning file beyond the index, the
  router, the orders and the session records.
- Amending a D-number from inside an order.
- Widening a campaign mid-flight. New work found while executing goes to the
  roadmap or to a new numbered order — never into an order already under way.
- Deciding what happens after an order lands. That is the operator's.

```json
{
  "$workflow": "campaign",
  "stages": [
    { "id": "pick", "run": "operator picks a docs/ROADMAP.md entry (or ratifies a drafted basis)" },
    { "id": "preflight", "needs": ["pick"], "run": "git status --porcelain; no other campaign in flight", "pass": "output empty" },
    { "id": "measure", "needs": ["preflight"], "run": "re-derive every number from a run; audit the suite (BOUNDARY §what-the-suite-has); scoped HEALTH hunt", "pass": "baseline table dated + runtime + three quirk lists" },
    { "id": "forks", "needs": ["measure"], "run": "put every campaign-shaping fork to the operator", "pass": "each answer is a D-number" },
    { "id": "author", "needs": ["forks"], "run": "router (nine sections) + TODO_<PROGRAM>_NN.md orders per templates/work-order.md; register in local TODO.md", "pass": "authoring checklist all ticked" },
    { "id": "review", "needs": ["author"], "run": "operator reviews the plan before any code moves" },
    { "id": "execute", "needs": ["review"], "run": "per order: fresh session with BOOTSTRAP.md + router + order; npm run check between batches; measurement recorded; session record; ledger ticked", "pass": "acceptance checklist, gate exit==0, number recorded" },
    { "id": "decide", "needs": ["execute"], "run": "operator: close-out (CONVENTIONS §5) | re-scope | park | abandon" },
    { "id": "close-out", "needs": ["decide"], "run": "last order: ROADMAP entry retired/narrowed, docs, measurements regenerated, pins extended, scoped HEALTH hunt", "pass": "finished-campaign checklist all ticked" }
  ]
}
```
