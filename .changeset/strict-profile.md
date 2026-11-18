---
"@tangleai/models": minor
"@tangleai/context": minor
"@tangleai/agents": minor
"@tangleai/linq": minor
"@tangleai/jaren": minor
"@tangleai/assistant": minor
"@tangleai/os": minor
"@tangleai/core": minor
"@tangleai/config": minor
"@tangleai/mas": minor
"@tangleai/documents": minor
"@tangleai/memory": minor
"@tangleai/search": minor
"@tangleai/pipeline": minor
"@tangleai/outcomes": minor
"@tangleai/trace2skill": minor
"@tangleai/evolve": minor
"@tangleai/gmpl": minor
"@tangleai/hera": minor
"@tangleai/forecast": minor
"@tangleai/grounding": minor
"@tangleai/lightrag": minor
"@tangleai/trading": minor
"@tangleai/research": minor
"@tangleai/experiential": minor
"@tangleai/store": minor
---

`createStructuredOutput({ profile: 'strict' })` sends, on a `json_schema` tier, the schema's strict profile (`deriveStrictProfile` from `@jarenjs/validate/strict-profile`) with `strict: true`, maps each answer back and validates it against the original schema, which stays the authority. Measured with Claude Haiku 5.5: the provider refused 3 of 4 of the suite's schemas as they are and 1 of 4 as their profile (a grammar-size limit); every profile answer validated (docs/STRICT_PROFILE_BENCHMARK.md).
