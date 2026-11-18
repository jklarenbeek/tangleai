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

Text bounds measure UTF-8 bytes with `utf8ByteLength` from `@jarenjs/core/string` instead of encoding the text with `TextEncoder`: forecast screening, classifier items, harness components, feedback items, guidance and skill instructions, the retrospective summary and `forecastBytes`; outcomes reflection and proposal text and `jsonBytes`; the research patch, artifact, lesson-proposal, workspace-path and CSV bounds; the trace2skill path and per-file bounds; the hera prompt byte cap; the run log's frame-body and replay-page bounds and the MAS trace budget; the temporal input ceiling; the context ledger's `jsonBytes`; an agent's default reservation estimate; and the experiential render budget. Every string measures as before, a lone surrogate as 3 bytes. Where a non-string can reach a bound, it is refused with that bound's own code rather than Jaren's TypeError: the volatile-fact classifier refuses a guidance item whose text is not a string with TFCT1001, and `validateFormat` refuses a file whose content is neither text nor null with TT2S1005 before `draftSize` measures it; the other raw-text bounds already refuse a non-string with their own code (TT2S1003 for a skill path, TRSH1006 for CSV input, the screening TypeError) or through the shape check that runs before them. The context ledger keeps counting a value JSON leaves out as 0 bytes, and the temporal ceiling keeps measuring a request body as its text.
