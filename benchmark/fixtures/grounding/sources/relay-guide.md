# Harbor Relay operations guide

The Harbor Relay is the fictional message forwarder this fixture documents. Everything in this corpus is Tangle-authored for the grounding benchmark and describes no real product.

The Harbor Relay listens on TCP port 7431 by default; operators may move it, but every quay profile ships with 7431 preconfigured.

A relay frame may carry at most 512 KiB of payload. An oversized frame is rejected with code FRAME_TOO_LARGE and is never truncated.

Delivery retries start at a 250 ms backoff and double on every failed attempt, up to a hard cap of 8 seconds between attempts.

The relay terminates TLS 1.3 only; earlier protocol versions are refused during the hello. Certificates are rotated with the quay tool's rotate-cert command.

Operators who need the frame budget raised should file a capacity note first; the relay does not read its budget from the environment.
