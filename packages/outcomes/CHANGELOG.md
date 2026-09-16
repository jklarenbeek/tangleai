# @tangleai/outcomes

## 0.29.8

### Patch Changes

- @tangleai/agents@0.29.8
  - @tangleai/config@0.29.8
  - @tangleai/core@0.29.8
  - @tangleai/memory@0.29.8
  - @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/agents@0.29.7
  - @tangleai/config@0.29.7
  - @tangleai/core@0.29.7
  - @tangleai/memory@0.29.7
  - @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/agents@0.29.6
  - @tangleai/config@0.29.6
  - @tangleai/core@0.29.6
  - @tangleai/memory@0.29.6
  - @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/agents@0.29.5
  - @tangleai/config@0.29.5
  - @tangleai/core@0.29.5
  - @tangleai/memory@0.29.5
  - @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/agents@0.29.4
  - @tangleai/config@0.29.4
  - @tangleai/core@0.29.4
  - @tangleai/memory@0.29.4
  - @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/agents@0.29.3
  - @tangleai/config@0.29.3
  - @tangleai/core@0.29.3
  - @tangleai/memory@0.29.3
  - @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/agents@0.29.2
  - @tangleai/config@0.29.2
  - @tangleai/core@0.29.2
  - @tangleai/memory@0.29.2
  - @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/agents@0.29.1
  - @tangleai/config@0.29.1
  - @tangleai/core@0.29.1
  - @tangleai/memory@0.29.1
  - @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/agents@0.29.0
  - @tangleai/config@0.29.0
  - @tangleai/core@0.29.0
  - @tangleai/memory@0.29.0
  - @tangleai/models@0.29.0

## 0.28.0

### Minor Changes

- f2eb14d: Publish the adapter-construction kit a host needs to register its own outcome domain: `adapterIdentity` builds the pinned schema-and-scorer identity the service re-hashes at registration, `domainValidator` compiles one domain schema into the validator that boundary uses, and `checkedAdapter` composes an adapter's four validators with its payload check. They were already the recipe every in-tree adapter follows; an out-of-tree host previously had to reimplement the identity hash to be accepted, and a reimplementation that drifted by one byte was refused as an unregistered revision rather than as the mistake it was.

### Patch Changes

- @tangleai/agents@0.28.0
  - @tangleai/config@0.28.0
  - @tangleai/core@0.28.0
  - @tangleai/memory@0.28.0
  - @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- Updated dependencies [9f7d8c8]
  - @tangleai/core@0.27.3
  - @tangleai/agents@0.27.3
  - @tangleai/config@0.27.3
  - @tangleai/memory@0.27.3
  - @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/agents@0.27.2
  - @tangleai/config@0.27.2
  - @tangleai/core@0.27.2
  - @tangleai/memory@0.27.2
  - @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- Updated dependencies [422afcd]
  - @tangleai/memory@0.27.1
  - @tangleai/agents@0.27.1
  - @tangleai/config@0.27.1
  - @tangleai/core@0.27.1
  - @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- Updated dependencies [84fe0a2]
- Updated dependencies [6dcfde9]
- Updated dependencies [a6fa7f3]
- Updated dependencies [d4d8d0b]
- Updated dependencies [63504f3]
- Updated dependencies [7f2e26f]
  - @tangleai/memory@0.27.0
  - @tangleai/core@0.27.0
  - @tangleai/agents@0.27.0
  - @tangleai/config@0.27.0
  - @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- 36b6a1d: Qualify concurrent outcome promotions without assuming which request wins, and replay the actual winning receipt while retaining every stale-head assertion.
- Updated dependencies [9cc91c1]
  - @tangleai/memory@0.26.3
  - @tangleai/agents@0.26.3
  - @tangleai/config@0.26.3
  - @tangleai/core@0.26.3
  - @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- Updated dependencies [4c42ba1]
  - @tangleai/memory@0.26.2
  - @tangleai/agents@0.26.2
  - @tangleai/config@0.26.2
  - @tangleai/core@0.26.2
  - @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/agents@0.26.1
  - @tangleai/config@0.26.1
  - @tangleai/core@0.26.1
  - @tangleai/memory@0.26.1
  - @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [6e0f5be]
  - @tangleai/core@0.26.0
  - @tangleai/memory@0.26.0
  - @tangleai/agents@0.26.0
  - @tangleai/config@0.26.0
  - @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1
  - @tangleai/agents@0.25.1
  - @tangleai/core@0.25.1
  - @tangleai/config@0.25.1
  - @tangleai/memory@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/agents@0.25.0
  - @tangleai/config@0.25.0
  - @tangleai/core@0.25.0
  - @tangleai/memory@0.25.0
  - @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/agents@0.24.1
  - @tangleai/config@0.24.1
  - @tangleai/core@0.24.1
  - @tangleai/memory@0.24.1
  - @tangleai/models@0.24.1

## 0.24.0

### Minor Changes

- Add the outcomes package for independently evidenced decisions, deterministic scoring, atomic confidence projection, bounded artifact refinement and explicitly approved promotion and rollback. The public operation contract, two-domain adapter kit and keyless example share the same scoped request receipts, one-use held-out gates, full head revision checks and interruption recovery.

  The store adapter owns outcome records and memory changes in one SQLite transaction. The new pure confidence helper preserves fact fields; existing applyOutcome calls retain their original duplicate-citation and timestamp behavior and do not acquire a durable replay guarantee. No existing persisted memory format changes. Hosts opt into the new lifecycle, provide evidence and approval authority, and use a new artifact key for schema or policy changes. Scripted paired measurements and Node/Bun packed consumers qualify the mechanism; downstream domain integrations and automatic promotion remain separate work.

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.24.0
  - @tangleai/agents@0.24.0
  - @tangleai/config@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/models@0.24.0
