# Research papers

All reference PDFs are archived in [`docs/refs/`](refs/) for offline access and traceability
(carried over from the memflow prototype, where these designs were first implemented).
Each entry states where the idea stands in THIS codebase — ported, planned (with its
TODO order), or reference-only. memflow's original paper-to-module mapping is preserved
in [`docs/attic/memflow-PAPERS.md`](attic/memflow-PAPERS.md).

## Ported — running in this repo

- **LightMem: Lightweight and Efficient Memory-Augmented Generation** (arXiv:2510.18866v4, Fang et al., ICLR 2026)
  - The Tier-1 sensory novelty filter is `@tangleai/memory/novelty`. The STM/LTM tiers and
    sleep-time consolidation are TODO 04.
  - 📄 [`refs/2510.18866v4.pdf`](refs/2510.18866v4.pdf)

- **TradingAgents** (arXiv:2412.20138v7, Xiao et al., Jun 2025) — outcome-grounded memory
  - The success/failure/partial confidence adjustment against REAL outcomes is
    `@tangleai/memory/outcome` (evidence-mandatory, via `OUTCOME_REPORT_SCHEMA`).
    The full two-phase pending-decision → resolution → reflection loop is TODO 06.
  - 📄 [`refs/2412.20138v7.pdf`](refs/2412.20138v7.pdf)

- **Enhancing Efficiency in Text Splitting: Exploring Semantic Clustering Methods** (Traets, 2024)
  - The zero-dependency k-means (k-means++ seeding, injected RNG) is `@tangleai/core/clustering`.
  - 📄 [`refs/Exploring Semantic Clustering Methods.pdf`](refs/Exploring%20Semantic%20Clustering%20Methods.pdf)

Crystallization (near-duplicate merge) and contradiction supersession in
`@tangleai/memory` consolidate ideas that recur across the memory papers rather than
implementing any single one.

## Planned — an open TODO order names each

- **SimpleMem** (arXiv:2601.02553v3, Liu et al., Jan 2026) — write pipeline
  (compression → synthesis → structured index) and intent-aware read planning. TODO 04.
  - 📄 [`refs/2601.02553v3.pdf`](refs/2601.02553v3.pdf)
- **StructMem** (arXiv:2604.21748v1, Xu et al., Apr 2026) — dual-perspective extraction,
  cross-event consolidation. TODO 04.
  - 📄 [`refs/2604.21748v1.pdf`](refs/2604.21748v1.pdf)
- **Trace2Skill** (arXiv:2603.25158v4, Chen et al., Mar 2026) — trajectory clustering →
  skill merge → injection, through the @jarenjs/ai skill schema and refine gates. TODO 05.
  - 📄 [`refs/2603.25158v4.pdf`](refs/2603.25158v4.pdf)
- **Milkyway harness evolution** (arXiv:2604.15719v2, Xu et al., Apr 2026) — versioned
  prediction harnesses with retrospective validation. TODO 06.
  - 📄 [`refs/2604.15719v2.pdf`](refs/2604.15719v2.pdf)
- **HERA: Experience as a Compass** (arXiv:2604.00901v2, Li & Ramakrishnan, Apr 2026) —
  reward-guided topology + prompt evolution; informs the pattern layer. TODO 07.
  - 📄 [`refs/2604.00901v2.pdf`](refs/2604.00901v2.pdf)
- **MASFactory** (arXiv:2603.06007v1, Zhou et al., Mar 2026) — intent-to-workflow
  compilation; Tangle's version targets @jarenjs/flow documents. TODO 07.
  - 📄 [`refs/2603.06007v1.pdf`](refs/2603.06007v1.pdf)
- **S2 Chunking** (arXiv:2501.05485v1, Verma, Jan 2025) — spatial+semantic spectral
  chunking; port waits until ingestion of PDFs/DOCX returns (TODO 08 territory).
  - 📄 [`refs/2501.05485v1.pdf`](refs/2501.05485v1.pdf)

## Reference-only

- **LightRAG** (arXiv:2410.05779v3) — graph+vector fusion; informs the graph-store decision in TODO 10. 📄 [`refs/2410.05779v3.pdf`](refs/2410.05779v3.pdf)
- **PriHA / DRAG** (arXiv:2604.14215v1) — dual retrieval fusion. 📄 [`refs/2604.14215v1.pdf`](refs/2604.14215v1.pdf)
- **5 Proven Query Translation Techniques** (TDS, 2024) — HyDE, multi-query, step-back. 📄 [`refs/5 Proven Query Translation Techniques.pdf`](refs/5%20Proven%20Query%20Translation%20Techniques.pdf)
- **AutoSkill** (arXiv:2604.17614v1) — activation-space skill characterization. 📄 [`refs/2604.17614v1.pdf`](refs/2604.17614v1.pdf)
- **Memo, Not True Memory** (arXiv:2604.27707v1) — the generalization-ceiling argument for
  weight-based consolidation; the honest caveat under everything this repo does. 📄 [`refs/2604.27707v1.pdf`](refs/2604.27707v1.pdf)
- **OMNI-SIMPLEMEM** (arXiv:2604.01007v2) — autonomous experiment loops over memory configs. 📄 [`refs/2604.01007v2.pdf`](refs/2604.01007v2.pdf)
- **AutoResearchClaw** (aiming-lab, 2026) — self-evolving research pipelines. 📄 [`refs/AutoResearchClaw.pdf`](refs/AutoResearchClaw.pdf)
- **memflow S2Chunker notes** — 📄 [`refs/memflow-s2chunker.docx`](refs/memflow-s2chunker.docx)
