---
"@tangleai/models": patch
"@tangleai/context": patch
"@tangleai/agents": patch
"@tangleai/linq": patch
"@tangleai/jaren": patch
"@tangleai/assistant": patch
"@tangleai/os": patch
"@tangleai/core": patch
"@tangleai/config": patch
"@tangleai/mas": patch
"@tangleai/documents": patch
"@tangleai/memory": patch
"@tangleai/search": patch
"@tangleai/pipeline": patch
"@tangleai/outcomes": patch
"@tangleai/trace2skill": patch
"@tangleai/evolve": patch
"@tangleai/gmpl": patch
"@tangleai/hera": patch
"@tangleai/forecast": patch
"@tangleai/grounding": patch
"@tangleai/lightrag": patch
"@tangleai/trading": patch
"@tangleai/research": patch
"@tangleai/experiential": patch
"@tangleai/store": patch
---

A settle records a cleanup receipt, so a terminal experiment no longer stands for a cleaned workspace by itself. `settleExperiment` writes a `cleanup-intent` key before its swap (the revision and status the swap produces, the workspace's instance token, whether the branch goes) and `cleanup-done` once the workspace is gone; `reconcileCleanups({ store, host })` finishes every intent without completion, only while the experiment sits where the swap left it and only for the workspace instance the intent names, finishing each git step only if it is still needed. A workspace recreated at the same path is refused and left alone, and a completed cleanup is never reapplied. The worktree host gains `instance`, `pathOf` and an idempotent `finish`; `create` writes the instance token into the worktree's git administration directory, outside the tracked tree.
