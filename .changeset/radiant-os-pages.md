---
"@tangleai/models": patch
---

Host Radiant OS on the Pages site at `os/`: an installable, offline browser OS
that is a two-dimensional Turing machine governed by a council of its own parts
under the human's veto. The oracle's seat is answered through `createChatClient`
and `createStructuredOutput`, constrained by the OS contract's `Change` grammar
and validated locally; a configured model is called only when the human has
spoken to the council, and a scripted oracle runs the same client offline. No
package API changes.
