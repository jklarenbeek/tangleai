---
"@tangleai/experiential": minor
"@tangleai/store": minor
---

Register immutable evaluation inputs before measuring a candidate and enforce
recorded learning, retention, security and operational gates in atomic state
transitions. Publish reproducible scripted candidate losses and refusals without
claiming training quality or activation.

Evaluation records now require the complete registration and measurement
bindings. Generic writes no longer grant evaluation or artifact transition
authority; callers use `startEvaluation` and `recordEvaluation` with retained
policies, datasets and artifact receipts.
