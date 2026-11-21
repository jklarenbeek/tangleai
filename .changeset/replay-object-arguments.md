---
"@tangleai/agents": patch
---

The agent replays every tool call with object arguments, the ones it ran with: a call a model sent with empty, non-object or malformed arguments goes back as `{}`, in this turn and from a stored history. A provider that keeps tool input as an object (Anthropic's, through a router such as OpenRouter) refused the next turn of such a conversation with HTTP 400.
