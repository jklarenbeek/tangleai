# Harbor Relay engine history

This note records which queue engine the Harbor Relay builds against. It is revised whenever the engine changes, and only the newest revision describes the shipping relay.

The Harbor Relay queues outbound frames through the cedar engine, a single-writer log borrowed from the original prototype.

Cedar was chosen for the prototype because it required no compaction thread; its write amplification is the reason a replacement has been under discussion.
