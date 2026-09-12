# Shipping Tangle

Tangle uses Changesets with one fixed group of public libraries. Every
workspace shares the release version, beginning at `0.20.0`; the private root,
applications and benchmark are never published. `release.config.json` is the
explicit publication inventory and dependency order. The major version remains
zero until an intentional, reviewed policy change enables a stable public API.

## Prepare before pushing

The current checkout consumes Jaren 0.86.0 registry packages. The
[registry receipt](../integration/jaren-0.86.0-registry.json) verifies downloaded
archives against the exact lock. Archived 0.84.3 migration receipts retain their
historical source/archive comparison. Ordinary `npm ci --ignore-scripts` needs
no foundation bootstrap. The candidate instructions below apply only to a
checkout with an active `docs/migrations/jaren-ai/foundations.json`.

Use the Node version in `.nvmrc`, npm from the root `packageManager`, and Bun from
`release.config.json`. CI reads those same pins. In candidate foundation mode,
initialize `vendor/jarenjs` and run `node scripts/jaren-artifacts.ts --bootstrap`
with the Node/npm pins in `docs/migrations/jaren-ai/foundations.json`, then
restore Tangle's toolchain before `npm ci --ignore-scripts`. CI performs these
steps in the same order, including its minimum-Node and Windows jobs. The source
patch is applied only in a disposable build checkout; no installed package is
patched. When the source state is `committed`, the gitlink names that exact
revision and the patch must be empty; bootstrap builds the commit directly.
Candidate artifact mode still means unpublished local tarballs, even when their
source is committed. In registry mode, install directly with `npm ci --ignore-scripts`.
Install the local
push check with `npm run release:install-hook`. Existing custom hooks are
preserved and require explicit integration.

1. Finish the change and update its documentation and relevant measurements.
2. Run `npm run changeset` and record the reason plus patch or minor impact.
   Compatible fixes use patch. Features use minor. Breaking development changes
   use minor with migration notes. A major changeset is refused. Multiple records
   combine into one release at their highest impact.
3. Run `npm run release:prepare`. Changesets calculates public versions and
   changelogs. The wrapper synchronizes the root, private versions, every internal
   reference and the lockfile. Public libraries use `^<suite version>`; private
   consumers use the exact suite version.
4. Review the generated change. If fixes are needed before committing, apply them
   and run `npm run release:prepare -- --refresh`. This refreshes the reviewed
   input fingerprint without advancing the version again. New changesets require
   a new plan; a tagged release or one accepted on main cannot be refreshed in place.
   Reviewed local fixes before the main push can retain the prepared version.
5. Run `npm run release:closeout -- --message "Fix the affected behavior"`.
   The command runs `release:verify`, checks the diff and asset stub, and commits
   the complete versioned change as Joham directly on `main`. Add `--push` when
   pushing is authorized; closeout fetches main, requires a fast-forward and
   checks version advancement before committing. It creates no pull request.
6. Push directly to `main`. The pre-push hook requires the prepared version and
   a complete gate receipt for the exact source and tarballs. CI then independently
   rejects stale versions, dependency/lock drift, modified inputs and failed
   consumers before Pages deployment. The main
   ruleset prevents deletion and force pushes; it deliberately has no PR or
   pre-push GitHub status requirement. Local hooks can be bypassed, so CI remains
   the deployment backstop rather than a main-branch admission gate.

For example, a patch after `0.20.0` produces `0.20.1`; a minor produces `0.21.0`.
A change to one library still advances every public package. Neither root
version edits alone nor a later automatic release PR on `main` satisfy this
protocol: the version must already be in the release commit.

An already committed local release may be followed by another release before
either is pushed. Preparation uses the commit carrying that prior release record
as its version base and retains the current HEAD as its preparation commit.
Ordinary draft commits with no version change still use remote main as their
base. A version edit without a committed release record cannot establish a base.

The starting version override, `release:prepare -- --initial`, is restricted to
the configured initial commit and old version. It establishes exactly `0.20.0`.
Ordinary releases must use the version computed from their Changesets records.

## Verify the published distribution

`npm run release:verify` runs the full source gate, release-record checks, package
build, packed consumers and Pages build. `release:build` emits ESM JavaScript and
TypeScript declarations into a staging directory, preserves public subpaths,
copies JSON schemas, and creates the configured tarballs with package documentation,
license and changelog. Workspace manifests continue to serve TypeScript during
development. Their lifecycle guards refuse direct source publication.

`release:test` installs the tarballs in a temporary external project. It exercises
all declared exports in Node and Bun, schema imports, cited memory validation,
SQLite persistence and HTML extraction. A TypeScript consumer checks declarations
with `skipLibCheck: false`; a browser bundle exercises the supported core, memory
and pipeline surface. JSON import attributes are preserved in emitted declarations.
The CI matrix includes Linux, Windows and the minimum supported Node 24 runtime.

The publisher requires these exact verified tarballs. A modified archive or stale
verification receipt is refused. Generated files remain uncommitted; the tracked
release record binds versions and release intent to a fingerprint of the source,
configuration, documentation, lockfile and submodule identities.

## Publish manually

Publishing npm packages is a manual author action. From the clean committed
release checkout, using the pinned Node/npm and Bun toolchains, run:

```sh
npm run publish -- --dry-run  # verify and inspect; no tag or upload
npm run publish              # verify, tag locally, upload and verify installation
```

The author authenticates to npm locally (for example with `npm login`) and must
have publish access to the `@tangleai` scope. npm may request account confirmation
or 2FA. The command uses the existing authenticated npm configuration; it does
not require GitHub Actions, OIDC or a special first-version bootstrap. Do not run
`npm publish --workspaces`: source workspaces are not the tested distributions.

The command checks the release record and clean tree first. It reuses a complete
gate only when both the source fingerprint and artifact commit match the current
HEAD; otherwise it runs `release:verify` to build and test the final committed
revision. Closeout verifies before committing, so the first publication check
normally rebuilds to bind its artifacts to that new commit. No version bump is
needed for this rebuild.

It preflights all 15 public packages, creates or verifies the exact annotated
local tag, publishes the tested archives in dependency order, then runs the
registry installation and consumer gate. It never publishes private workspaces
or pushes Git refs. A dry run may rebuild ignored artifacts but creates no tag
and uploads nothing. Published versions with matching bytes are skipped; an
existing version with different bytes or a newer `latest` is refused.

`npm run release:publish` remains the lower-level read-only preflight; it expects
already verified artifacts. `npm run release:publish -- --execute` only uploads
already verified, tagged artifacts from a clean local checkout. Prefer the
complete `npm run publish` workflow, including its registry verification.

### Changed release inputs

The fingerprint includes tracked examples and documentation, including
`.env.example`. A restored edit changes the working-tree fingerprint even when
the committed release is valid. Check `git status --short` before publishing.
If those edits belong to the release, review them and follow the existing
prepare/refresh and closeout protocol. If they are separate work, stash just
those paths or publish from a clean checkout of the release commit; restore the
edits afterward. Do not refresh a release merely to bypass unrelated changes.

For a checkout whose only separate edit is `.env.example`:

```sh
git stash push -m "Keep env example edits outside publication" -- .env.example
npm run publish
# After the command finishes (including failure), restore that saved entry:
git stash pop
```

Select the saved entry explicitly if other stashes were created in between.
Ignored `.env` credentials are not release inputs and are not copied into npm
archives. No workflow should stash, commit or discard the author's edits silently.

Candidate foundation mode still refuses publication. Publish and verify the
AI-free Jaren closure first, then switch Tangle's exact dependencies, source pin
and lock to that registry release and repeat the consumer gate. A Git tag or
local tarball does not establish npm availability.

An accepted upload can remain unavailable while npm scans it. The publisher
uploads the suite in dependency order, recording accepted uploads, then
`release:verify-registry` polls both full and install indexes for up to 20 minutes.
It checks versions, tarball integrity and `latest` in both formats before an
external consumer install. Matching upload receipts alone do not establish an
installable release. A longer npm hold fails with the unavailable package names;
retry at the same commit without changing the artifacts.

## Push and deploy

Pushing `main` runs `.github/workflows/release.yml`: CI verifies the prepared
release, packed consumers and instruments, then Pages independently builds,
deploys and verifies the accepted commit. CI does not publish npm packages,
create release tags or complete a GitHub package release. Publication remains
the author's separate local command. Push the annotated version tag separately
when desired; the publication command does not push it.

Pages builds local Tangle source with its recorded Jaren foundation mode. It
refuses published Tangle dependencies or Jaren source links. Its `build.json`
must identify the expected version, commit, complete package set and dependency
sources. Website deployment requires no npm publication or publishing credentials,
and a deployed website is not proof of package publication.

The website labels historical benchmarks with the version that produced them.
A version bump never rewrites old measurements to imply a fresh run.

## Recover without inventing a new release

A failed preparation restores its manifest, lockfile, changelog and changeset
writes. If the process was killed before cleanup, `release:prepare -- --recover`
restores its saved preparation snapshot; inspect current edits first. An identical
successful preparation is a no-op when rerun.

npm publication is not atomic across packages. Preflight checks the whole set
before the first publish, and a receipt records each accepted package. If a later
publish fails, rerun `npm run publish` at the same commit. Matching existing
versions are verified and skipped; missing ones are published in dependency order.
A version already present with different bytes is refused. Published defects need
a new patch version; never retag or overwrite a released artifact. Moving `latest`
backwards is refused.

Local artifacts and partial publication receipts remain in `dist/release/` after
failure. CI separately retains its verified distribution artifacts. An incomplete
npm publication does not block Pages. A failed Pages deployment can be retried
with the same checked source identity. Retries do not advance package versions.

This policy currently accepts numeric development releases on `latest`. A separate
prerelease channel or a future major release requires an explicit policy change;
raw Changesets prerelease mode is refused rather than silently bypassing the
shared version and verification rules.
