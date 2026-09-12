# @tangleai/store

## 0.24.0

### Minor Changes

- Add the outcomes package for independently evidenced decisions, deterministic scoring, atomic confidence projection, bounded artifact refinement and explicitly approved promotion and rollback. The public operation contract, two-domain adapter kit and keyless example share the same scoped request receipts, one-use held-out gates, full head revision checks and interruption recovery.

  The store adapter owns outcome records and memory changes in one SQLite transaction. The new pure confidence helper preserves fact fields; existing applyOutcome calls retain their original duplicate-citation and timestamp behavior and do not acquire a durable replay guarantee. No existing persisted memory format changes. Hosts opt into the new lifecycle, provide evidence and approval authority, and use a new artifact key for schema or policy changes. Scripted paired measurements and Node/Bun packed consumers qualify the mechanism; downstream domain integrations and automatic promotion remain separate work.

### Patch Changes

- Updated dependencies
  - @tangleai/outcomes@0.24.0
  - @tangleai/memory@0.24.0
  - @tangleai/config@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/documents@0.24.0
  - @tangleai/mas@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.23.0
  - @tangleai/config@0.23.0
  - @tangleai/core@0.23.0
  - @tangleai/documents@0.23.0
  - @tangleai/mas@0.23.0

## 0.22.0

### Patch Changes

- @tangleai/config@0.22.0
  - @tangleai/core@0.22.0
  - @tangleai/documents@0.22.0
  - @tangleai/mas@0.22.0
  - @tangleai/memory@0.22.0

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.
- Updated dependencies
  - @tangleai/core@0.21.1
  - @tangleai/config@0.21.1
  - @tangleai/mas@0.21.1
  - @tangleai/documents@0.21.1
  - @tangleai/memory@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.21.0
  - @tangleai/config@0.21.0
  - @tangleai/mas@0.21.0
  - @tangleai/documents@0.21.0
  - @tangleai/memory@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.1
  - @tangleai/config@0.20.1
  - @tangleai/documents@0.20.1
  - @tangleai/mas@0.20.1
  - @tangleai/memory@0.20.1

## 0.20.0

### Minor Changes

- Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.0
  - @tangleai/config@0.20.0
  - @tangleai/mas@0.20.0
  - @tangleai/documents@0.20.0
  - @tangleai/memory@0.20.0
