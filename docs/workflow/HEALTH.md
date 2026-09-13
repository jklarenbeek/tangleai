# HEALTH.md — the periodic tidy & hunt pass

jarenjs runs REFACTOR (moves, never behavior) and QUIRKS (behavior, with
reproductions) as separate rituals. At Tangle's size they are one pass
with two mandates — the distinction survives as rules:

- **Tidy findings** (duplication, drift, dead code) are resolved by
  MOVING or DELETING, never by changing behavior. Identify duplicates by
  shape, not by name.
- **Quirk findings** (wrong but not loud: lying counts, non-idempotent
  writes, swallowed failures, comments that describe code that no longer
  exists) may change behavior — but **every fix ships with its
  reproduction as a test first**. No reproduction, no fix; report it
  instead.

The pass is idempotent: running it twice in a row should find nothing
the second time, and "found nothing" is a valid, reportable outcome.

## The sweep, in order

1. Preflight: clean tree; baseline `npm run check` green (record test
   count and duration).
2. **Duplicates by shape** across `packages/*/src` and `apps/*/src`:
   same loop, same guard, same normalization in two places → collapse
   into the logical parent (the package lower in the dependency graph).
   The former standing case (a trigram embedder in `@tangleai/pipeline`
   and again inline in `examples/skeleton.ts`) closed on 2026-08-26: both
   now use `@tangleai/models/embed`'s hash embedder through the pipeline's
   `createOfflineEmbedder`. The parent may be BELOW this repo — a shape
   that jarenjs already ships (vector kernels, the embed wire) is deleted
   here, not collapsed here.
3. **Doc drift**: every number and command in README, ARCHITECTURE,
   BOUNDARY, PAPERS, this folder — re-derive from the repo. Fix the doc
   or the code, whichever lies.
4. **Dead code**: exports nothing imports (outside tests), branches no
   input reaches. Delete; the git history is the archive.
5. **Quirk hunt** with an adversarial mandate: read seams as if trying
   to catch them lying — counts that drift, errors swallowed into
   defaults (memflow's 17 bare `catch {}` sites are the cautionary
   tale), boundary validations that clone-then-mutate, sequence
   semantics assumed to be arrays.
6. Fix tidy findings freely; fix quirks reproduction-first; batch by
   layer with the gate between batches.
7. Report: what moved, what was fixed (each with its test), what was
   found and deliberately left, and the second-run-finds-nothing check.
   A hunt scoped for a campaign (CAMPAIGN.md) reports as three lists —
   confirmed in the campaign's path, confirmed beside it with its
   disposition, checked-and-dropped with the reason — so no executor
   re-investigates the same guard.

Within a campaign, include this pass in its work order's local green commit
under CONVENTIONS §5. A phase or health pass does not independently trigger a
version bump, tag or push. Run authorized release closeout only after the full
campaign is implemented and green. A separately requested standalone health
closeout follows the same release protocol after that pass is complete.

```json
{
  "$workflow": "health-pass",
  "stages": [
    { "id": "preflight", "run": "git status --porcelain && npm run check", "pass": "clean tree, exit==0, baseline recorded" },
    { "id": "sweep-duplicates", "needs": ["preflight"], "run": "shape-scan packages/*/src apps/*/src" },
    { "id": "sweep-docs", "needs": ["preflight"], "run": "re-derive every number/command in docs" },
    { "id": "sweep-dead", "needs": ["preflight"], "run": "unimported exports, unreachable branches" },
    { "id": "sweep-quirks", "needs": ["preflight"], "run": "adversarial seam read" },
    { "id": "fix-tidy", "needs": ["sweep-duplicates", "sweep-docs", "sweep-dead"], "run": "move/delete only" },
    { "id": "fix-quirks", "needs": ["sweep-quirks"], "run": "reproduction test first, then fix" },
    { "id": "gate", "needs": ["fix-tidy", "fix-quirks"], "run": "npm run check", "pass": "exit==0" },
    { "id": "report", "needs": ["gate"], "run": "moved/fixed/left + idempotency check" },
    { "id": "commit", "needs": ["report"], "run": "CONVENTIONS §5: local green work-order commit; authorized release closeout only at full campaign completion or standalone pass completion" }
  ]
}
```
