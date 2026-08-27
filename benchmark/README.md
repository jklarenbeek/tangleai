# The measurement workspace

Every number this repository publishes is produced by an instrument in this
folder, and every instrument names the command that reproduces it. Nothing
here is needed to *use* Tangle — it is needed to *believe* it.

The shape is jarenjs's benchmark workspace, re-derived for this repo: upstream
suites arrive as git submodules, tools are plain scripts run from the
repository root, and a shared `lib/` holds the few primitives the suite below
us does not publish.

## Why this is a workspace of its own

`package.json` here is private and separate on purpose. CONVENTIONS §1 binds
the shipped packages to `@jarenjs/*` and `@tangleai/*` only — but a benchmark
earns its credibility by measuring against **rivals**, and a rival is a
third-party dependency. Keeping them in this workspace is how a comparison
against another memory system can ever be run without a single new dependency
entering the packages a user installs. jarenjs does exactly this: turf,
sqlite-vec, ajv, XState and a dozen others live in its benchmark workspace and
nowhere else.

## Contents

| Instrument | What it answers | Command |
|---|---|---|
| [`locomo-census.ts`](./locomo-census.ts) | What is actually in the LoCoMo release — categories, ground truth, parseable timestamps, and how many evidence ids resolve | `npm run benchmark:locomo:census` |

`lib/` holds what the suite does not publish and what therefore must exist
exactly once here:

| Module | Why it is not an import |
|---|---|
| [`lib/stats.ts`](./lib/stats.ts) | `@jarenjs/core/math` is the graphics/numeric kernel — no median, no percentile anywhere in a published package. This is the only place in the repo that computes a quantile. |
| [`lib/table.ts`](./lib/table.ts) | The Markdown table idiom `docs/DOCUMENT_BENCHMARK.md` already publishes, extracted so a second instrument does not invent a second format. |
| [`lib/args.ts`](./lib/args.ts) | An unknown flag is an error, not a silent default — a benchmark that ignored `--sizes` would publish the wrong row under the right name. |
| [`lib/locomo.ts`](./lib/locomo.ts) | Loading, validating and reading the LoCoMo release. Nothing is repaired here. |

## The submodules

| Path | Upstream | Licence |
|---|---|---|
| `locomo/` | [`snap-research/locomo`](https://github.com/snap-research/locomo) — the ACL 2024 benchmark, data and official evaluator | **CC BY-NC 4.0** |

```
git submodule update --init benchmark/locomo
```

A submodule rather than a vendored copy, for three reasons that are all
licence or honesty reasons:

- LoCoMo is **CC BY-NC 4.0** and this repository is MIT. A submodule is a
  pointer; nothing here redistributes the data.
- A submodule pins an exact upstream commit, so *which* LoCoMo produced a
  number is a hash in `.gitmodules` rather than a sentence in a README.
- The release ships `data/locomo10.json` in the repository itself, so there is
  no dataset URL to guess and no checksum to compare against a typed number.

**Every instrument degrades to a stated skip when its submodule is absent.**
A plain `git clone` does not fetch one, and a contributor who never runs a
benchmark should not meet a red gate. Pass `--require` to turn the skip into
an exit 1 where a run genuinely must have the data.

## The rules an instrument here follows

Inherited from jarenjs's harness, where each was learned by getting it wrong:

1. **A gate passes by exit code, never by grepping output.** Once, in jarenjs,
   a crashed linter was declared green because something printed the word
   "pass".
2. **Prove the scorer before printing a score.** An oracle row must be exactly
   right and a seeded random row must land inside its analytic band, or the run
   exits 1 naming the row. This is what catches a corpus whose gold ids do not
   exist — and LoCoMo has nine of those, which `locomo-census.ts` counts.
3. **Publish the ceiling beside the score.** A model-free ceiling — was the
   evidence in the request at all — is keyless, deterministic and cheap enough
   for CI. The gap between it and a real model's score is what says whether a
   miss was retrieval or prompting.
4. **A missing key is a stated skip, not a failure**, and a run that would
   exceed its call ceiling is skipped up front rather than half-spent.
5. **Losses are published beside wins.** A comparison that only reports
   victories is marketing, and this repo does not ship marketing.
6. **Nothing is repaired silently.** Malformed upstream data is counted and
   named. A benchmark that quietly fixes its own ground truth can no longer be
   compared with the published numbers.

## Attribution

LoCoMo — *Evaluating Very Long-Term Conversational Memory of LLM Agents*,
Maharana, Lee, Tulyakov, Bansal, Barbieri and Fang, ACL 2024
([arXiv:2402.17753](https://arxiv.org/abs/2402.17753)). Data and evaluation
code © Snap Inc., CC BY-NC 4.0.
