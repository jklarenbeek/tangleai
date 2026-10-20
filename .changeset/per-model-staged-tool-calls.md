---
"@tangleai/models": minor
"@tangleai/agents": minor
"@tangleai/jaren": minor
---

Size tool calls to the model that makes them. `@tangleai/models/profile` reads a
model id into a profile with a tool budget (`modelProfile`, `resolveToolBudget`,
`TOOL_BUDGETS`): a mixture of experts is tiered by its active parameters, a dense
model by its size, with overridable heuristic defaults. `@tangleai/agents/staging`
(`stageTools`, `estimateArgumentChars`) builds any tool whose typical input exceeds
the budget as a draft in budget-sized, sub-schema-checked calls and commits it
through the tool's own validation, offers small catalogs to small budgets, and
refuses duplicate tool names. A tool call cut off at the reply's length limit now
says where it was cut and points at the drafts. `@tangleai/jaren/contract-tools`
(`createContractToolbox`) turns a Jaren contract into such tools, with host-pinned
input members and outcomes shaped for a model; `@tangleai/jaren` now depends on
`@jarenjs/contract` 0.91.4. Existing exports are unchanged.
