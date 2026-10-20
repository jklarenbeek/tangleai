# Ask: Tangle AI — change requests from the websites

Jaren requests: `packages/website/WEBSITE_ASK_JARENJS.md` in the jarenjs repository

Radiant OS runs in two editions: the Jaren edition on the Jaren website, and the
**Tangle edition**, `apps/pages/src/os/` here, where a language model can sit on
the council, play the crew of the studio and answer the Library's questions. The
crew's seat (`apps/pages/src/os/kernel/crew-seat.ts`) builds through the OS
contract with `createContractToolbox` (`@tangleai/jaren/contract-tools`), sized to
the model by `modelProfile` (`@tangleai/models/profile`) and staged by
`stageTools` (`@tangleai/agents/staging`); the docs' voice
(`apps/pages/src/os/kernel/docs-voice.ts`) answers from the library's passages.

Building them turned up the requests below. Each one says what the OS does today
to work around it, so that workaround can go once the change ships. Paths are
relative to this repository.

**Blocking** means a website feature cannot ship without the change.
**Non-blocking** means the OS has a working workaround meanwhile. Please say when
a request should be shaped differently; the websites will adapt.

## Overview

| Id | Request | Package | Blocking | Status |
| --- | --- | --- | --- | --- |
| TW-1 | Hold a direct or catalog call to the budget by its argument, not only by the schema's estimate | agents (staging) | No | Requested 2026-10-19 |
| TW-2 | A published reader for the assistant's model settings | assistant | No | Requested |
| TW-3 | A grounded answer over host passages, with citations checked | agents or context | No | Requested |
| TW-4 | A measured tool budget for a configured endpoint | models (profile) | No | Requested |

## TW-1 — Hold a call to the budget by its argument, not only by the schema's estimate

**Today.** `stageTools` decides once, from `estimateArgumentChars(inputSchema)`,
whether a tool is offered whole or as a draft. The estimate is a typical size: it
follows `$ref`s and takes a union's largest branch, but it counts a string or an
array at a typical length, not at its `maxLength` or `maxItems`. The OS's
`crew.build` takes a `block` that is a `oneOf` of eight kinds, and with the seat
pinned its input estimates at 144 characters, so no tier stages it. Yet its
checklist block allows twelve items of up to 60 characters each. Under the `tiny`
budget (`maxArgumentChars` 300), a `tool_call` that carries a 370-character
`crew_build` input (400 characters of arguments) is accepted in one piece. A
budget meant to keep a small model's calls short holds only for inputs near their
typical size.

**Why.** The OS's blocks are mostly small, so the catalog alone serves a small
model well today. A long input, such as a full checklist, a board import or a
letter, reaches a small model whole. That is the failure the budget exists to
prevent.

**Request.** Check the argument a direct or `tool_call` call actually carries and
refuse one over `maxArgumentChars` with the draft hint, as `draft_set` already
does for its values. Or stage a tool by its schema's bounds when they allow an
input larger than the budget.

**Acceptance.** Under `tiny`, the 400-character `tool_call` above is refused with
a hint to build `crew_build` as a draft, or `crew_build` is staged from the start.

## TW-2 — A published reader for the assistant's model settings

**Today.** The OS seats the oracle, the crew and the docs' voice with the model the
Tangle assistant is configured with. It reads the assistant's storage slot itself
(`localStorage['tangle-ai']`, `{ provider, baseUrl, model, apiKey }`) and listens
for `storage` events to follow a change made in another tab
(`apps/pages/src/os/main.ts`, `readSettings` and the `storage` listener).

**Why.** The slot and its shape are the assistant's private format. A change to
either would silently unseat every model in the OS.

**Request.** `@tangleai/assistant` exports `readAssistantSettings(storage)` and
`watchAssistantSettings(window, onChange)`, with the settings type.

**Acceptance.** The OS reads and follows the settings only through the exports,
and the assistant's tests pin the format they read.

## TW-3 — A grounded answer over host passages, with citations checked

**Today.** The docs' voice hands the model the library's best passages numbered,
asks it to answer only from them citing each as `[n]`, reads the citations back,
keeps an answer only when it cites a passage it was given, and otherwise answers
offline with the passages themselves (`apps/pages/src/os/kernel/docs-voice.ts`,
`docsPrompt`, `citedIn`).

**Why.** Evidence is mandatory here: an answer cites what it rests on. Every host
that answers from its own documents writes this prompt and this check again.

**Request.** A helper — for example `answerFromPassages(client, { question,
passages })` → `{ text, cited }` — that refuses an answer citing nothing, or
citing what it was not given.

**Acceptance.** The docs' voice is the helper plus the OS's own passages, and the
helper's tests pin both refusals.

## TW-4 — A measured tool budget for a configured endpoint

**Today.** `modelProfile` reads a model's budget from its name, which is right for
the models it knows. Bench Arena, the OS's benchmark game, forecasts a model's
best budget by racing every tier against a reliability model of how often a call
of a given length breaks (`apps/pages/src/os/games/arena/budget.ts`); the person
then applies the winner as the OS's tool-budget setting. Neither measures the
endpoint the person actually configured.

**Why.** The same model behaves differently on another provider, quantization or
context length. The tool budget is the setting that most decides whether a small
model succeeds.

**Request.** A probe in `@tangleai/models/profile` — for example
`measureToolBudget(client, { sizes, tries })` — that sends tool calls of growing
argument size to a configured client and answers the tier whose calls come back
valid, with the counts it saw.

**Acceptance.** The Arena can race real calls against the configured model when
the person asks it to, and the probe's tests pin its answer on a scripted endpoint.
