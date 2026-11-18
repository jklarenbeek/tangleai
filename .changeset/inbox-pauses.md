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

Paused runs wait in the desktop's inbox. A proposal says who it comes from (`origin`: human, rule, import or ai) and may ask the person something (`answer: { schema, label }`): the inbox draws a form from the schema, the kernel checks the answer before it reaches the module that filed it as `{ decision: 'answer', response }`, and nothing gives the assistant a way to answer. `@tangleai/mas/inbox` turns a run's waiting interactions into such proposals on the application's server and an answer back into the interaction's response with a derived response key (a rejection cancels it); `listWaitingInteractions` lists the waits by status, with no table change. An older desktop refuses a proposal with `origin` or `answer`, and an older page refuses an `answer` decision; the protocol stays 1.
