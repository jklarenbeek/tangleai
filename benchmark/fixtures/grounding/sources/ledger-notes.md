# Anchor ledger notes

The Anchor ledger is the fixture's fictional durable log. These notes are Tangle-authored for the grounding benchmark.

The Anchor ledger compacts once it holds 4096 entries, and it also runs one compaction pass at every startup.

Ledger snapshots are written in the alder/2 format.

Ledger records are encoded as CBOR and the ledger file is strictly append-only.

A ledger that refuses to open should be inspected before any snapshot is restored; restoring over a live ledger is not supported.
