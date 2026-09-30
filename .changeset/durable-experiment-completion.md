---
"@tangleai/evolve": minor
"@tangleai/store": patch
---

Complete conditional experiment workflows over durable MAS jobs, preserve settled worker evidence across response loss, and match effect responses to their own stages. Registry consumers now await evolveRegistryDocument with the workflow profile and experiment ceiling to pin its embedded graph versions.

Add deterministic strategy selectors and an injected, budgeted structured proposal seam. Publish the registered keyless selection comparison with an inconclusive result and retain the unranked default. Surface workspace census and effect-job lease failures.

Semantic key kinds now reject empty values, whitespace and NUL with TEVO1001 in both evolve stores, preventing namespace collisions. Existing valid key encodings and opaque key values remain compatible.
