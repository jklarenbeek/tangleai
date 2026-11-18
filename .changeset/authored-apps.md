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

The assistant can write an application for the person. The desktop's own contract `tangle_os_apps` gives it the crib (`apps.crib`), a check against the gate and its own probes (`apps.check`), and `apps.suggest`, which files the finished document in the person's inbox as the desktop's own proposal, refused (`OS0160`) when it does not pass the gate. The inbox says who wrote it and that it asks for nothing; when the person accepts, it joins their layer as a document module with no grants, opens, and runs in its sandboxed frame. The kernel loads the authoring code only when the assistant uses it, and the Pages assistant is told when and how to write one. Measured through that assistant (a headless desktop, its system prompt and the kernel's tools, one turn): every one of 32 plain requests, 16 in English and 16 in Dutch, ended with an application in the inbox that works when the person uses it (docs/AUTHORING_BENCHMARK.md).
