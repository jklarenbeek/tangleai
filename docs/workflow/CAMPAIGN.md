# CAMPAIGN.md — authoring and executing orders in TODO.md

Tangle runs ONE campaign and it lives, committed, in
[`TODO.md`](../../TODO.md): the standing rule at the top, `## Done` as the
ledger, `## Open` as the numbered orders. This file is how orders are
written and executed. [`CONVENTIONS.md`](CONVENTIONS.md) binds throughout.

## The shape of an order

Each `## Open` entry carries, in prose, exactly five things:

1. **A number and a name** — numbering never renumbers; a split order
   takes the next free number.
2. **The goal** — the observable end state, one or two sentences.
3. **The design decisions already settled** — enough that a fresh session
   with only `TODO.md` and the repo can execute without re-litigating.
4. **Salvage pointers** — where in `docs/attic/` the tuned knowledge for
   this order lives (thresholds, specs, seed data). An order that ignores
   its salvage re-derives what memflow already paid for.
5. **The measurement** — the line starting `*Measurement:*`. This is the
   definition of done. An order without a checkable measurement is not an
   order yet.

## The law: measure first

Inherited from jarenjs, sharpened by memflow's death: **an order is
closed by its measurement, not by its merge**, and no policy or
self-evolving capability ships before the instrument that can call it an
improvement. Order 02 (LoCoMo) exists precisely to be that instrument;
orders 03+ that make quality claims are gated on it. Surface work
(order 11) may ship early but may only SHOW what a run actually did —
never claim what has not been measured.

Before authoring or re-scoping an order: re-derive the current numbers
from a run (`npm run check`, `npm run skeleton`, the benchmark once it
exists). The ledger and README are claims; the run is evidence.

## Executing an order

1. Preflight: clean tree (`git status --porcelain` empty), read the
   order, its salvage pointers, and the files it names.
2. Work in the smallest reviewable steps; keep the gate green between
   steps, not only at the end.
3. Tests are part of the deliverable: new seams get contract tests, new
   lessons get pinned (the two ordering rules are the model).
4. Close out per CONVENTIONS §5. Move the order to `## Done` with a
   one-line record: what shipped, the measurement's number, divergences.

## When the shape is wrong

- One small change with no open decisions → just do it under the gate;
  no order needed.
- Duplication, drift, quiet bugs → [`HEALTH.md`](HEALTH.md).
- A second independent campaign → don't. Finish or explicitly park the
  first; two campaigns editing one small repo produce unattributable
  regressions.

```json
{
  "$workflow": "campaign-order",
  "stages": [
    { "id": "preflight", "run": "git status --porcelain", "pass": "output empty" },
    { "id": "read", "needs": ["preflight"], "run": "read TODO.md order + salvage + named files" },
    { "id": "implement", "needs": ["read"], "run": "smallest reviewable steps, gate green between" },
    { "id": "gate", "needs": ["implement"], "run": "npm run check", "pass": "exit==0" },
    { "id": "measure", "needs": ["gate"], "run": "the order's *Measurement:* line", "pass": "number recorded" },
    { "id": "ledger", "needs": ["measure"], "run": "move order to Done with number + divergences" },
    { "id": "commit", "needs": ["ledger"], "run": "CONVENTIONS close-out" }
  ]
}
```
