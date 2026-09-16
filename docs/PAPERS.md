# Research papers

All reference PDFs are archived in [`docs/refs/`](refs/) for offline access and traceability
(carried over from the memflow prototype, where these designs were first implemented).
Each entry states where the idea stands in THIS codebase — ported, planned (its
[`ROADMAP.md`](ROADMAP.md) entry named), or reference-only. memflow's original paper-to-module mapping is preserved
in [`docs/attic/memflow-PAPERS.md`](attic/memflow-PAPERS.md), and its per-module design
docs — the tuned thresholds and fallback behaviors each implementation earned — are
salvaged under [`docs/attic/memflow-modules/`](attic/memflow-modules/) (full manifest:
[`docs/attic/SALVAGE.md`](attic/SALVAGE.md)).

## Ported — running in this repo

- **LightMem: Lightweight and Efficient Memory-Augmented Generation** (arXiv:2510.18866v4, Fang et al., ICLR 2026)
  - The sensory novelty filter is `@tangleai/memory/novelty`. The opt-in
    `@tangleai/memory/consolidation` API supplies bounded segmentation/previews,
    supported synthesis, immutable evidence and host-driven scheduling. These
    are selected mechanisms, not a reproduction of the full paper's system;
    live quality/cost and host adoption remain in the roadmap.
  - 📄 [`refs/2510.18866v4.pdf`](refs/2510.18866v4.pdf)

- **TradingAgents** (arXiv:2412.20138v7, Xiao et al., Jun 2025) — outcome-grounded memory
  - The success/failure/partial confidence adjustment against REAL outcomes is
    `@tangleai/memory/outcome` (evidence-mandatory, via `OUTCOME_REPORT_SCHEMA`).
    The generic pending-decision → resolution → scoring/proposal lifecycle is
    `@tangleai/outcomes`, with atomic storage and explicit promotion/rollback.
    Domain quality remains unqualified; the trading system is its own roadmap entry.
  - 📄 [`refs/2412.20138v7.pdf`](refs/2412.20138v7.pdf)

- **Trace2Skill: Distill Trajectory-Local Lessons into Transferable Agent Skills**
  (arXiv:2603.25158v4, Chen et al., Mar 2026)
  - `@tangleai/trace2skill` implements the method, not the retrieval baseline:
    one frozen skill directory per bounded scope, labeled rollouts over a
    disjoint evolve split, one independent analyst per trajectory (a single
    structured pass for a success, a bounded agentic loop for a failure whose
    proposal is admitted only after the host's real evaluator passed over a
    repair), a trajectory-local patch pool merged hierarchically and
    prevalence-aware into ONE patch, deterministic conflict and format gates
    (anchors that resolve exactly once, base-hash line intervals, withheld
    overlaps, atomic create/link groups), one guarded application to the frozen
    directory, a held-out comparison against no directory and the frozen one,
    and direct use of the evolved directory with no retrieval index at test
    time. Both modes ship: deepening from a human directory and creation from a
    trajectory-blind draft.
  - Not implemented: the paper's datasets (SpreadsheetBench, WikiTQ, DAPO/AIME,
    DocVQA), its GPU scale and its 128-way analyst fan-out, and its
    cross-model and out-of-distribution transfer tiers — the instrument
    publishes those two rows as `not-run` because it builds no second executor
    identity and registers a single domain. Every number this repository
    publishes comes from a Tangle-authored keyless fixture with a scripted
    model wire ([measurement](TRACE2SKILL_BENCHMARK.md)), so what is
    established is mechanism behavior and its cost, never model quality; live
    quality is a roadmap entry. The salvaged cluster-then-retrieve design
    reproduces the paper's retrieval-memory baseline and survives only as the
    `retrieval-bank` ablation row, which loses to the evolved directory by
    0.250 on the held-out split.
  - 📄 [`refs/2603.25158v4.pdf`](refs/2603.25158v4.pdf)

- **S2 Chunking** (arXiv:2501.05485v1, Verma, Jan 2025)
  - A corrected, capped experiment is `S2DocumentChunker` in `@tangleai/documents`:
    deterministic k-means, convergence diagnostics, atomic hard-limit fallback, and
    contiguous output runs. It remains behind a strategy setting; the fixed benchmark did
    not earn a default change from recursive heading-aware chunks.
  - 📄 [`refs/2501.05485v1.pdf`](refs/2501.05485v1.pdf)

Crystallization (near-duplicate merge) and contradiction supersession in
`@tangleai/memory` consolidate ideas that recur across the memory papers rather than
implementing any single one.

- **SimpleMem** (arXiv:2601.02553v3, Liu et al., Jan 2026) — write pipeline
  - Selected write/index mechanisms are in `@tangleai/memory/consolidation`:
    deterministic previews, structured supported claims and public Jaren lexical
    routing. Retained source evidence and measured retrieval gains do not establish
    the paper's full method or live answer-quality improvement. Intent-aware read
    planning is not implemented by this lane.
  - 📄 [`refs/2601.02553v3.pdf`](refs/2601.02553v3.pdf)
- **StructMem** (arXiv:2604.21748v1, Xu et al., Apr 2026) — dual-perspective extraction,
  cross-event consolidation.
  - The consolidation lane exposes supported cross-event claims and explicit
    count/time/manual host requests. It preserves exact sources, counts failed
    callbacks and stages recoverable results. Dual-perspective extraction and
    the complete paper system are not implemented; the roadmap retains live
    qualification and explicit host adoption.
  - 📄 [`refs/2604.21748v1.pdf`](refs/2604.21748v1.pdf)
- **Ecdysis** (arXiv:2609.11677v1, Yue, Cui et al., Sep 2026) — cross-instance
  failure aggregation for evolving agent runtime harnesses.
  - The experiment lane aggregates a round of decided experiments above the
    per-experiment verdict: failures become records, records group into
    patterns at two levels, and a pattern counts as systematic only when at
    least two DISTINCT instances produced it. A round reduces to one scalar
    and a candidate is accepted only on a strict improvement of it. Not
    implemented: the paper's multi-role collaborative refinement, any
    self-modifying harness, and the model-accommodation ratio — that number
    needs modification decisions to exist, and nothing in this repo modifies
    itself. The roadmap retains harness-level evolution.
  - 📄 [`refs/2609.11677v1.pdf`](refs/2609.11677v1.pdf)

## Planned — an open roadmap entry names each

- **Milkyway harness evolution** (arXiv:2604.15719v2, Xu et al., Apr 2026) — versioned
  prediction harnesses with retrospective validation. Harness evolution for forecasting.
  - 📄 [`refs/2604.15719v2.pdf`](refs/2604.15719v2.pdf)
- **HERA: Experience as a Compass** (arXiv:2604.00901v2, Li & Ramakrishnan, Apr 2026) —
  reward-guided topology + prompt evolution. Experience-guided orchestration.
  - 📄 [`refs/2604.00901v2.pdf`](refs/2604.00901v2.pdf)
- **MASFactory** (arXiv:2603.06007v1, Zhou et al., Mar 2026) — intent-to-workflow
  compilation; Tangle's version targets @jarenjs/flow documents. The runtime
  mechanism tier is implemented and measured (2026-09-01): one canonical
  workflow IR with agent/task/graph/loop/switch/interaction nodes lowered to
  jaren-dag/jaren-fsm, durable resumable runs, and 11/11 positive plus 7/7
  negative conformance oracles (`MAS_RUNTIME_BENCHMARK.md`). The
  natural-language authoring tier ("vibe graphing") and any paper
  benchmark/cost/LOC reproduction remain open roadmap work.
  - 📄 [`refs/2603.06007v1.pdf`](refs/2603.06007v1.pdf)

## Reference-only

- **LightRAG** (arXiv:2410.05779v3) — graph+vector fusion; the roadmap's graph question names its mechanism as the candidate. 📄 [`refs/2410.05779v3.pdf`](refs/2410.05779v3.pdf)
- **PriHA / DRAG** (arXiv:2604.14215v1) — dual retrieval fusion; a roadmap entry of its own. 📄 [`refs/2604.14215v1.pdf`](refs/2604.14215v1.pdf)
- **5 Proven Query Translation Techniques** (TDS, 2024) — HyDE, multi-query, step-back. 📄 [`refs/5 Proven Query Translation Techniques.pdf`](refs/5%20Proven%20Query%20Translation%20Techniques.pdf)
- **AutoSkill** (arXiv:2604.17614v1) — activation-space skill characterization. 📄 [`refs/2604.17614v1.pdf`](refs/2604.17614v1.pdf)
- **Memo, Not True Memory** (arXiv:2604.27707v1) — the generalization-ceiling argument for
  weight-based consolidation; the honest caveat under everything this repo does, and the
  roadmap's experiential-memory entry operationalizes its builder requirements. 📄 [`refs/2604.27707v1.pdf`](refs/2604.27707v1.pdf)
- **OMNI-SIMPLEMEM** (arXiv:2604.01007v2) — autonomous experiment loops over memory configs. 📄 [`refs/2604.01007v2.pdf`](refs/2604.01007v2.pdf)
- **AutoResearchClaw** (aiming-lab, 2026) — self-evolving research pipelines; the roadmap's
  verifiable-autonomous-research entry. 📄 [`refs/AutoResearchClaw.pdf`](refs/AutoResearchClaw.pdf)
- **Enhancing Efficiency in Text Splitting: Exploring Semantic Clustering Methods**
  (Traets, 2024) — a supervised boundary classifier over embedding-window differences,
  PCA, and SVM/forest/boosting models. Tangle's deterministic k-means utility is unrelated;
  `SemanticBoundaryChunker` is only an untrained adjacent-similarity comparison baseline,
  not an implementation of this paper. 📄 [`refs/Exploring Semantic Clustering Methods.pdf`](refs/Exploring%20Semantic%20Clustering%20Methods.pdf)
- **Topological Necessities** (arXiv:2609.11014v1, Shi & Li, Sep 2026) — executor-independent
  subgoals for offline goal-conditioned control: the unavoidable stages every successful
  trajectory crosses, read by homology over a transport-weighted carrier and certified per gate.
  Tangle has no reinforcement-learning or control lane; no roadmap entry names it.
  📄 [`refs/2609.11014v1.pdf`](refs/2609.11014v1.pdf)
- **memflow S2Chunker notes** — 📄 [`refs/memflow-s2chunker.docx`](refs/memflow-s2chunker.docx)
