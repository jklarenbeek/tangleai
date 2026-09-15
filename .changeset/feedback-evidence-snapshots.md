---
"@tangleai/store": minor
---

Keep the evidence an accepted verdict was recorded against. The model gains `feedback_notes` — one row per evidence source, addressed by the source id the resolution names and indexed by the message it is about, holding the sealed snapshot with the digest that snapshot hashes to. A trusted evidence resolver reads that row back rather than rebuilding it, so a snapshot that is gone or whose bytes have moved is refused by the outcome lifecycle instead of quietly re-agreeing with itself. The transcript rows gain the decision a reply is and the verdict recorded against it, so a surface can show what was recorded without re-deriving it.
