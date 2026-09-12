# AI mechanism obligations

Owned by the models, context, agents and Jaren integration packages. Received from Jaren commit `3491513e164dc30e429c84e709bd738841f4df16`; every open obligation remains open. This migration does not activate these later campaigns.

## Models, context and agents

The package now has three paths — a bounded tool loop, a ledger-backed agent that
survives a closed tab, and a recursive entry point that works a corpus larger than
the context by addressing it instead of reading it — and, across all three, an
embedder seam: an OpenAI-compatible `/embeddings` client and a deterministic
reference embedder, memories and skills that carry a vector with its identity, and
`recall({ near })` ranking by meaning through an embedder the host injects. All of
it is documented in the [agents](../packages/agents/README.md), [context](../packages/context/README.md), [models](../packages/models/README.md) and [Jaren integration](../packages/jaren/README.md) guides; what follows is only what is genuinely still open.

Most of these entries share a shape worth naming: the missing thing is a
**measurement**, not an implementation. This package refuses to add a ranker, an
evictor or a de-duplicator before the number that would say whether it helps, and
the ranker is the case that has now run its course: the instrument was committed
first, scored the policies that already existed, and only then was the ranked path
added and published whichever way it fell. It turned out to be the harder and more
valuable half both times. Repeated-refinement measurements now support opt-in
suppression of exact text/evidence/tag repeats. Seeded retention measurements
support reported archive budgets and lossless goal checkpoints; broader semantic
merging still needs its own outcome evidence.

- [ ] **Program reuse calibration beyond the scripted question stream.** Verified opt-in
  reuse now ships with current-environment compilation, suitability approval, an outcome
  checker and one fresh fallback. The committed question-stream frontier calibrates only
  its hash embedder and fixture labels. Real-language/provider calibration remains open.

- [ ] **Depth benefit on live models.** The original hierarchical corpus and depth-neutral
  evidence checker now run through depths zero through three. Scripted traversal remains
  correct while cost rises; current live rows fail before producing correct final answers.
  A deeper default needs the predeclared correctness/cost improvement on live models.

- [ ] **Reliable authoring under provider-enforced budgets.** Program/JSLT authoring and
  recursive live artifacts retain all failures with route identity, deadlines and usage.
  The unrecorded dense-model success claim is withdrawn. The injected router supports
  separate author/subcall routes, but current measurements do not support dense-first
  website policy; some providers exceed the requested reasoning ceiling.

- [ ] **Retrieval beyond the reference corpus remains externally unmeasured.**
  The [labelled instrument](../benchmark/README.md#labelled-recall-and-repeated-refinement)
  ships a checksum-pinned BEIR SciFact importer, live embedding cache and exact/
  approximate scorecards. The measured sparse-projection contender loses labelled
  relevance and end-to-end latency, so exact remains the choice. What remains
  open is a larger externally supplied labelled corpus and vectors sufficient to
  demonstrate a quality-preserving crossover beyond the measured exact ceiling;
  the small reference corpus cannot establish that claim. New contenders use
  the optional rank capability and the same predeclared recall/cost bars.

- [ ] **WebKit multi-writer localStorage coherence.** Exclusive Web Locks and
  reload-inside-lock still lost updates in the tested WebKit process model. The
  website therefore elects one writer tab in WebKit and explicitly refuses a
  second; closing the owner permits takeover. Chromium and Firefox use serialized
  multi-writer mutation. Re-enabling concurrent WebKit writers requires a storage
  host with demonstrated coherent reads; timing delays are not evidence of safety.


## Spatial authoring

- [ ] **The spatial authoring profile has not met a live model.** Its three
  refusals (a geohash prefix offered as proximity, planar arithmetic over a
  coordinate member, a geographic ask with no spatial operator) are proven on
  recorded fixtures and the repair round is shown to carry the code and the
  fix; no key or local runtime was available when it was built. The first live
  run belongs as a row beside the stylesheet author's measurements in the
  `@tangleai/jaren` authoring documentation. Its intent reader is an English word list — a question
  that says "in the neighbourhood of" without a listed word is not read as
  proximity, so a prefix document passes; a host can pass its own `gates`.
