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

## Planned — an open roadmap entry names each

- **Trace2Skill** (arXiv:2603.25158v4, Chen et al., Mar 2026) — trajectory clustering →
  skill merge → injection, through the @jarenjs/ai skill schema and refine gates. The skill
  loop — whose entry records that the salvaged design reproduces the paper's retrieval
  baseline, not its method.
  - 📄 [`refs/2603.25158v4.pdf`](refs/2603.25158v4.pdf)
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
- **memflow S2Chunker notes** — 📄 [`refs/memflow-s2chunker.docx`](refs/memflow-s2chunker.docx)
