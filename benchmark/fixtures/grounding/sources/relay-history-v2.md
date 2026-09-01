# Harbor Relay engine history

This note records which queue engine the Harbor Relay builds against. It is revised whenever the engine changes, and only the newest revision describes the shipping relay.

Since release 0.9 the Harbor Relay queues outbound frames through the rowan engine; rowan replaced the earlier cedar engine, which is no longer built.

Rowan keeps cedar's single-writer log format on disk, so an operator upgrading from 0.8 replays the existing log without a migration step.
