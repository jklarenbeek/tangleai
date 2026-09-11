# Shipping Tangle

Tangle uses Changesets with one fixed group of eight public libraries. Every
workspace shares the release version, beginning at `0.20.0`; the private root,
applications and benchmark are never published. `release.config.json` is the
explicit publication inventory and dependency order. The major version remains
zero until an intentional, reviewed policy change enables a stable public API.

## Prepare before pushing

Use the Node version in `.nvmrc`, npm from the root `packageManager`, and Bun from
`release.config.json`. CI reads those same pins. Install with `npm ci
--ignore-scripts`; no private installation patch is required. Install the local
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
   Reviewed fixes on an unmerged release branch can retain the prepared version.
5. Run `npm run release:closeout -- --message "Fix the affected behavior"`.
   The command runs `release:verify`, checks the diff and asset stub, and commits
   the complete versioned change as Joham. On `main`, it creates a
   `release/v<version>` branch. Add `--push` when pushing is authorized.
6. Open and merge the checked pull request. The required `release-ready` CI check
   rejects missing preparation, stale versions, dependency/lock drift, modified
   prepared inputs and failed consumer tests. Require this check through a main
   branch ruleset; a local hook alone is bypassable.

For example, a patch after `0.20.0` produces `0.20.1`; a minor produces `0.21.0`.
A change to one library still advances all eight public packages. Neither root
version edits alone nor a later automatic release PR on `main` satisfy this
protocol: the version must already be in the release commit.

The starting version override, `release:prepare -- --initial`, is restricted to
the configured initial commit and old version. It establishes exactly `0.20.0`.
Ordinary releases must use the version computed from their Changesets records.

## Verify the published distribution

`npm run release:verify` runs the full source gate, release-record checks, package
build, packed consumers and Pages build. `release:build` emits ESM JavaScript and
TypeScript declarations into a staging directory, preserves public subpaths,
copies JSON schemas, and creates eight tarballs with package documentation,
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

## Publish and deploy

Merging to `main` runs `.github/workflows/release.yml`. It waits for the complete
CI gate, retrieves its exact verified Linux tarballs, and creates an annotated
`v<version>` tag on that commit. npm publication follows the dependency order in
`release.config.json`. Publication runs serially and is not cancelled by a newer
push.

Normal publication uses a GitHub-hosted runner with npm trusted publishing. Each
public package must trust `jklarenbeek/tangleai`, workflow `release.yml`, environment
`npm`, with direct publishing enabled. The job has `id-token: write`. Public
repository/package releases through this path receive npm provenance. The package
repository metadata and trusted publisher identity must agree.

`npm run release:publish` is a read-only preflight by default. In the release job,
`npm run release:publish -- --execute` requires a clean committed tree, the exact
annotated tag, GitHub identity and consumer verification. It publishes the tested
`.tgz` files with lifecycle scripts disabled and explicit public registry/access.
It never publishes private workspaces. A complete gate receipt binds the source
checks, packed consumers and artifact identities; closeout reuses it only while
those inputs and artifacts are unchanged.

`release:verify-registry` checks each package's version, exports, integrity and
`latest` tag, then installs the published versions in another fresh project and
runs the consumer gate. Only a complete verification allows the reusable Pages
workflow to build and deploy the same commit. The live `build.json` must identify
the expected version, commit and complete package set. The GitHub release is
finalized only after publication and deployment verification succeed. The Linux
x64 desktop binary is compiled and smoke-tested from a foreign directory before
publication, then attached to the release beside its npm tarballs.

The website labels historical benchmarks with the version that actually produced
them. A version bump never rewrites old measurements to imply a fresh run.

## First-publication setup

Verify ownership of the `tangleai` npm scope and authenticated maintainer access.
New package names must exist before their npm trusted publishers can be configured.
The initial release therefore supports one explicit local bootstrap:

```sh
# At the accepted, committed release revision:
node scripts/release/tag.ts
npm run release:verify
npm run release:publish -- --bootstrap --execute
npm run release:verify-registry
```

The bootstrap is restricted to the initial `0.20.0` release, uses the maintainer's
npm authentication, and does not claim GitHub OIDC provenance. It has the same
artifact and consumer checks. npm may require account authentication or 2FA.

Configure the trusted publisher for each of the eight newly created packages.
For npm's documented trust-management CLI, use npm 11.15 or newer; the following
command uses an isolated CLI without changing JarenJS's or Tangle's build pin:

```sh
npm exec --yes --package=npm@11.19.1 -- npm trust github @tangleai/core \
  --repository jklarenbeek/tangleai --file release.yml --environment npm \
  --allow-publish --yes
```

Repeat for config, mas, documents, memory, search, pipeline and store. Verify the
saved relationships with `npm trust list`. Trust management requires npm account
2FA and does not accept bypass-2FA granular tokens. A package bootstrap token alone
is not proof that trusted publishing has been configured. Retry the initial
GitHub release workflow after setup; already published matching tarballs are
recognized instead of republished.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Recover without inventing a new release

A failed preparation restores its manifest, lockfile, changelog and changeset
writes. If the process was killed before cleanup, `release:prepare -- --recover`
restores its saved preparation snapshot; inspect current edits first. An identical
successful preparation is a no-op when rerun.

npm publication is not atomic across packages. Preflight checks the whole set
before the first publish, and a receipt records each accepted package. If a later
publish fails, rerun the same workflow at the same commit. Matching existing
versions are verified and skipped; missing ones are published in dependency order.
A version already present with different bytes is refused. Published defects need
a new patch version; never retag or overwrite a released artifact. Moving `latest`
backwards is refused.

Artifacts and partial receipts are retained by Actions even when publication
fails. An incomplete publication cannot deploy Pages or finish the GitHub release.
A failed Pages deployment can be retried after registry verification, using the
same source identity. Normal workflow retries do not advance package versions.

This policy currently accepts numeric development releases on `latest`. A separate
prerelease channel or a future major release requires an explicit policy change;
raw Changesets prerelease mode is refused rather than silently bypassing the
shared version and verification rules.
