# EVOLVE.md — workflows as executable, measurable, evolvable DAGs

**Status: PARTLY BUILT.** The loop below ships as `@tangleai/evolve`:
propose, isolate, apply, gate, measure, decide, settle, record, over git
worktrees, with the authority to land a change absent from the vocabulary
rather than defended at a call site. What it has been run against is an
authored oracle — sixteen adversarial proposals whose verdicts were
written down before any of them could run, published as
`docs/EVOLVE_BENCHMARK.md`. That measures the mechanism; it does not
measure a model, and it does not measure this repository. Still unbuilt:
the prose-block → jaren-dag loader, the desktop wiring that would make an
experiment a dag run, proposal operators that generate rather than
replay, and any sequence of experiments against a real repository — which
is why the standing rule (CONVENTIONS §6) still governs the rest: *no
self-evolving capability ships before the instrument that can call it an
improvement.* This is the capability that rule was written for.
`docs/ROADMAP.md` carries it as the evolution-loop entry, still open; the
skill loop remains its prerequisite. The generic evidenced lifecycle
ships in `@tangleai/outcomes` and an experiment binds to it through the
`evolve-experiment/v1` adapter; neither establishes repository evolution
quality.

## The idea

Every workflow in this folder already ends with a `stages` JSON block —
stage ids, dependencies, run descriptions, pass conditions. That is a
`jaren-dag` document wearing prose clothing. The desktop app already
executes dag documents (`@tangleai/pipeline` → `@jarenjs/flow`), records
every node of every run (`@tangleai/store` run log), streams them live
(`run.live`), and moves memory confidence on real outcomes
(`@tangleai/memory` `applyOutcome`).

So: point the desktop's workspace folder at a REPOSITORY (this one, or
jarenjs) instead of a notes folder, load a workflow's stage block as the
dag, and let the app run **experiments**: a health pass, a refactor
candidate, a campaign order, a perf hypothesis. Each experiment is one
dag run — proposed, isolated, gated, measured, then kept or abandoned —
and the record of what worked feeds back into what gets proposed next.
The self-evolving research-pipeline shape (see
`docs/refs/AutoResearchClaw.pdf`, and Milkyway's versioned-harness
pattern in `docs/attic/memflow-modules/evolution.md`) with the fitness
signal this repo insists on.

## The experiment loop (one dag run)

1. **Propose.** A strategy — initially hand-authored, later an LLM over
   the strategy memory — names one small change: a duplicate to
   collapse, an order step, a threshold to try, a hot path to rewrite.
   Proposals are memory units: text + evidence + confidence, so recall
   ranks WHICH strategy to try by what has actually worked here before.
2. **Isolate.** `git worktree add` a throwaway branch. Experiments never
   touch the working tree, never touch `main`.
3. **Apply.** The proposal's patch lands in the worktree. Two hard
   refusals, enforced before the gate ever runs: an experiment that
   modifies test files, gate scripts, or CI **auto-abandons** (a change
   that improves its score by moving the goalposts is the classic
   failure of exactly this kind of system); and a patch above a size
   budget auto-abandons (small steps are reviewable, big ones are not).
4. **Gate.** The target repo's own gate, by exit code — for tangle
   `npm run check`; for jarenjs its lint+test+build chain. A red gate is
   an abandon, never a "fix it harder" loop inside the same experiment.
5. **Measure.** Fitness beyond "still green", per run type:
   - health/refactor: duplicate count, dead exports, doc-drift findings
     — behavior must be UNCHANGED (the gate is the proof);
   - perf: the repo's own benchmark numbers, N runs, medians;
   - memory-policy experiments: the LoCoMo number
     (`docs/LOCOMO_BENCHMARK.md`, keyless tier) — the instrument exists;
     what gates this file now is the policy matrix over it and the two
     prerequisite loops;
   - flakiness discipline inherited: a moving failure is rerun in
     isolation before it is believed.
6. **Decide.** Strict improvement with green gate → commit **on the
   experiment branch** and surface it for human merge. Anything else →
   `git worktree remove`, gone. Abandon is the DEFAULT path and must be
   cheap, unremarkable, and logged.
7. **Record.** The run log keeps the whole dag trace; `applyOutcome`
   moves the proposing strategy's confidence (failure teaches more than
   success — the asymmetric boost already in `@tangleai/memory`). Over
   runs, recall starts proposing what works in THIS repo and stops
   proposing what doesn't. That — not mutating prompts at random — is
   the evolution.

## What exists vs what is missing

| Piece | Status |
|---|---|
| dag execution with per-node records | exists (`@tangleai/pipeline`, `@jarenjs/flow`) |
| run history + live streaming surface | exists (`@tangleai/store`, desktop `runs.live`/`run.live`) |
| outcome-driven strategy fitness | exists for one experiment (`@tangleai/outcomes` + the `evolve-experiment/v1` adapter: a kept change scores success, an equal one partial, a refusal a strategy failure); measured fitness over a real repository remains downstream |
| proposal discipline | exists and is wired here — an RFC 6902 patch over a file map with `move`, `copy` and `test` absent from the vocabulary, five ordered detections, and a second rename check over git's own staged view |
| stage blocks as loadable dag documents | this folder; needs a tiny prose-block → jaren-dag loader |
| worktree executor (add/apply/gate/measure/remove) | exists (`@tangleai/evolve` host) — `node:child_process` over an allow-list of whole git argument vectors, each run one fenced leg of an external effect, no new dependencies |
| mutation/proposal operators | missing — the sixteen registered proposals are hand-authored; LLM-backed via `createStructuredOutput` later |
| round-level failure evidence | exists — failures group into patterns and read as systematic only on recurrence across distinct instances; a round reduces to one scalar and a candidate is accepted only on a strict improvement of it |
| the fitness instrument for memory policies | exists — `benchmark/locomo-qa.ts`, published as `docs/LOCOMO_BENCHMARK.md`; the policy matrix over it is the open roadmap entry |

## The rails (non-negotiable, written before the first run)

- Worktrees only; `main` is never a write target; merges are human.
- The mutator may not touch tests, gates, or CI — auto-abandon.
- Budgets on everything: attempts per session, wall-clock per
  experiment, patch size, model tokens. Exhausted budget = abandon.
- Every experiment leaves a run-log trace with the proposal's evidence,
  the gate's exit codes, and the measured numbers — the audit trail IS
  the product; an experiment that cannot be replayed did not happen.
- Claims stay gated: the surfaces may show experiment history; nobody
  writes "self-improving" in a README until the ledger shows a
  strategy's confidence rising across runs for measured reasons.

```json
{
  "$workflow": "experiment",
  "stages": [
    { "id": "propose", "run": "rank strategies by recall, pick one small change", "pass": "patch + evidence + budget ok" },
    { "id": "isolate", "needs": ["propose"], "run": "git worktree add <tmp> -b exp/<id>" },
    { "id": "apply", "needs": ["isolate"], "run": "apply patch", "pass": "touches no tests/gates/CI, within size budget" },
    { "id": "gate", "needs": ["apply"], "run": "target repo's own gate", "pass": "exit==0" },
    { "id": "measure", "needs": ["gate"], "run": "fitness per run type, N runs where noisy" },
    { "id": "decide", "needs": ["measure"], "run": "strict improvement ? commit on branch : abandon (default)" },
    { "id": "record", "needs": ["decide"], "run": "run log + applyOutcome on the proposing strategy" }
  ]
}
```
