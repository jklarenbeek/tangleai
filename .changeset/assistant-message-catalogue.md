---
"@tangleai/assistant": minor
---

Render every sentence of the assistant panel from one message catalogue. `@tangleai/assistant/messages` exports the English catalogue and `createAssistantMessages`; `createAssistantController`, `mountAssistant` and `createAssistantWidget` accept a `messages` catalogue that merges over English and refuse an unknown key when it is built. Text another package writes is shown verbatim inside a catalogue message, explicit presentation options still take precedence, and the Markdown footnotes label comes from the catalogue. The panel's projection no longer reaches the model client. English output is unchanged except five counts of one, which now read singular.
