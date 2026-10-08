# @tangleai/experiential

## 0.40.0

### Minor Changes

- dcfaf59: Add disabled-by-default host ticks with durable cadence and budget reservations,
  stale-parent cancellation or rebasing, and counted replay and no-op outcomes.
  Retain episode lineage through atomic archival with dependency, rollback-window,
  hold and sole-provenance checks. Include a keyless native SQLite tick walkthrough.
- 5d6ee92: Add a closed HTTP training service contract, bounded idempotent backend adapter,
  verified artifact downloads and credential-free training configuration.
- 4259b10: Add closed experiential record contracts with credential-free, synchronous validation.
- c092814: Run bounded training through durable native DAG jobs, preserve uncertain submissions and consumed poll credits across restarts, and atomically stage independently verified artifacts.
- 4259b10: Add content-addressed experiential lineage, checked lifecycle plans and atomic memory and SQLite persistence with replay and native deployment-head comparison.
- 4ce4158: Expose eight native read-only operations over atomic experiential snapshots,
  with schema-derived redacted views, retained log digests and pure retention
  previews. Publish the registered scientific claim as not-run beside a real
  scripted rollback receipt, and qualify installed Node, Bun and browser APIs.
  Preserve native persistence refusal codes through inspection, lineage, inference
  startup, artifact byte reads, policy revision and scheduling without exposing raw
  diagnostics or nesting causes outside the closed issue schema.
- a8765d5: Bind serving deployments to approved evaluations, deterministic canaries, immutable run pins and atomic rollback. Register the resolved base role before serving; deployment approvals now bind the deployment revision and canary fraction, and new pins use the checked pin command. Export the existing native head assertion so read-time fences use the same comparison as transitions.
- 460156f: Register immutable evaluation inputs before measuring a candidate and enforce
  recorded learning, retention, security and operational gates in atomic state
  transitions. Publish reproducible scripted candidate losses and refusals without
  claiming training quality or activation.

  Evaluation records now require the complete registration and measurement
  bindings. Generic writes no longer grant evaluation or artifact transition
  authority; callers use `startEvaluation` and `recordEvaluation` with retained
  policies, datasets and artifact receipts.
- 1beddfc: Restore an experiential deployment to its exact registered base under explicit rollback authority. Bind the base role digest, fence both revisions, retain an incremented null learned head, and atomically archive failed routing with its audit. Preserve learned evaluations and in-flight pins across rollback, reopen and later activation; keep learned-target approval gates unchanged.
- 8d246e0: Add independent evidence-bound selection, retained duplicate and episode grouping, deterministic dataset partitions and pinned JTLT example rendering. Recheck selection authority and leakage at dataset admission.
- c092814: Define the injected training backend and verify artifact bytes, submission ancestry and configured runtime before registration.

### Patch Changes

- Updated dependencies [a8765d5]
- Updated dependencies [1beddfc]
  - @tangleai/outcomes@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/documents@0.40.0
  - @tangleai/models@0.40.0
