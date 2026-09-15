# The consumer gate

A recommended, executable gate for any application that depends on the
`@jarenjs/*` suite — and, by the same shape, on `@tangleai/*`. It answers two
questions a lockfile alone cannot: **is the dependency pin exact, complete and
auditable**, and **do the packages this repository publishes actually work when
a stranger installs them from a registry archive?**

Tangle runs this gate on every change. The scripts named below are the
reference implementation; they are small, dependency-light and meant to be read
and copied rather than imported. Nothing here is Tangle-specific except the
package names and the fixtures.

## 1. The exact-pin gate

[`scripts/check-jaren.ts`](../scripts/check-jaren.ts), wired as `npm run
jaren:check` and run first in `npm run check`, so a pin defect fails in seconds
rather than after the suite.

It walks every workspace manifest — the root, `benchmark/`, and each directory
under `packages/`, `components/` and `apps/` — and asserts, for each dependency
section:

- Every `@jarenjs/*` range is the **exact version string**, never a caret, tilde
  or range. One version governs the whole workspace.
- The lockfile's dependency declarations **deep-equal** the manifest's. A
  lockfile that has drifted from the manifest it claims to lock is a defect, not
  a detail.
- Every installed `@jarenjs/*` package resolves to the **exact npm archive URL**
  for that version, and the version recorded in the lock matches the version in
  the package's own installed `package.json`.
- The vendored source submodule's **gitlink** is the expected commit
  (`git ls-files --stage` — the index entry, not the checkout), and when the
  submodule is checked out, its `HEAD` and its `package.json` version agree with
  the pin.
- A forbidden legacy package name appears in no manifest and enters no closure.

The gate prints one line naming the version, the number of exact references, the
number of installed packages and the short source commit. That line is the
receipt.

**Why the gitlink matters.** Reading the submodule's working tree proves what is
checked out on this machine; reading the index proves what the next clone will
get. The gate checks both and refuses if they disagree.

## 2. The packed-consumer gate

[`scripts/release/consumers.ts`](../scripts/release/consumers.ts) with
[`scripts/runtime-fixture.ts`](../scripts/runtime-fixture.ts). This is the part
most projects skip, and it is the part that catches the failures users see
first: a missing file in the published tarball, an `exports` map that resolves
under the workspace but not after install, a type declaration that only compiles
because a sibling source file happened to be nearby.

It builds real publication tarballs, then:

- Creates a temporary directory **outside the checkout** and writes a throwaway
  `package.json` whose dependencies are `file:` references to those tarballs.
  No workspace symlink, no `link:`, no `workspace:` protocol — the consumer sees
  exactly what a registry install produces. (Passing `--registry` runs the same
  fixtures against the published versions instead, which verifies the upload.)
- Verifies each tarball's integrity against the recorded build artifacts, and
  refuses if the build inputs changed since the tarballs were made.
- Runs every runtime fixture under **both Node and Bun**, including native
  SQLite tests, so a binding that only works on one runtime cannot pass quietly.
- Typechecks a generated module that imports **every export of every published
  package** — one `import * as` per `exports` entry, JSON entries with an import
  attribute — under `strict: true` and, critically, **`skipLibCheck: false`**.
  Most projects ship broken `.d.ts` files precisely because `skipLibCheck` hides
  them. The same module carries `@ts-expect-error` probes, so a declaration that
  silently widens to `any` fails instead of passing.
- Bundles a browser entry with `bun build --target=browser --format=iife`, runs
  it in a `node:vm` context furnished with only browser globals, and asserts on
  the values it produces. A package that reaches for a Node builtin in a
  browser path fails here rather than in someone's application.
- Enforces a **tree-shaking byte ceiling**
  ([`scripts/check-program-bundle.ts`](../scripts/check-program-bundle.ts), also
  `npm run test:tree-shaking`): the minimal entry bundles to at most 18,000
  bytes and retains no runtime engine or model mechanism. A ceiling makes an
  accidental import of a heavy subsystem a build failure instead of a slow
  regression nobody measures.

`runRuntimeFixture` is the small piece that makes the above reliable: the parent
Node process owns a scratch directory whose name contains a space and a
non-ASCII character, passes it to the child by environment variable, and cleans
up **only after the child has closed** — including on the error and timeout
paths. Cleaning up while a child can still hold a native database handle is a
flaky test generator; this ordering removes the whole class.

## 3. The toolchain pin

[`.github/actions/setup/action.yml`](../.github/actions/setup/action.yml) is a
composite action that reads the toolchain out of the repository rather than
restating it in a workflow:

- Node from `.nvmrc`.
- npm from `package.json`'s `packageManager` field, asserted to match
  `npm@x.y.z`, then installed globally at that exact version.
- Bun from `release.config.json`, asserted to match `x.y.z`.
- `npm ci --ignore-scripts` for the install itself.

Asserting the shape of each pinned value before using it means a malformed pin
fails at setup with a clear message, instead of silently installing "latest".

## 4. The pnpm variant

The gate's three parts port to pnpm with two real changes and one caveat.

**The lockfile check.** `pnpm-lock.yaml` is not `package-lock.json`: there is no
`packages[""]` entry mirroring the root manifest, and resolutions live under
`packages`/`snapshots` keyed by `name@version`. Replace the deep-equal
comparison with pnpm's own importer view — `pnpm ls --depth=-1 --json` for the
declared ranges, and a parse of `pnpm-lock.yaml`'s `importers` section for the
per-workspace declarations. Keep the two assertions that matter: every
`@jarenjs/*` range is an exact version, and every resolution is the registry
archive for that exact version. `pnpm install --frozen-lockfile` replaces
`npm ci`.

**The consumer install.** pnpm symlinks by default, which would defeat the point
of the gate. Install the tarballs with `pnpm install --ignore-scripts
--node-linker=hoisted` (or set `node-linker=hoisted` in an `.npmrc` written into
the temporary directory) so the consumer gets a real, flat `node_modules` rather
than a store link. Verify it worked: the assertion to copy is the one in
[`scripts/jaren-artifacts.ts`](../scripts/jaren-artifacts.ts), which refuses an
installed package directory that is a link (`realpathSync(dir) === dir`). Under
pnpm that assertion stops being a formality — it is what proves the gate is
testing an install rather than a store link.

**The caveat.** Tangle qualifies npm only. The pnpm guidance above is derived
from the same invariants, not measured by this repository's gates, so a project
adopting it should keep the assertions and re-derive the commands against its
own pnpm version.

## What this gate does not claim

It proves **publication and consumption integrity**: the archives install, the
exports resolve, the declarations compile, both runtimes execute, the browser
path stays browser-safe and the minimal bundle stays small. It does not measure
application quality, and it does not compare published bytes against a source
rebuild — the registry receipt records downloaded-archive integrity against the
lock, and says so rather than implying reproducibility it has not established.

The [integration audit](JARENJS_INTEGRATION.md) records which suite APIs this
repository adopts and where the ownership boundary sits; the
[release protocol](workflow/RELEASE.md) records where in a release these gates
run.
