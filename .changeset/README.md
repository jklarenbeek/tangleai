# Release intent

Run `npm run changeset` to record a change's impact and explanation. Choose a
patch for a compatible fix or a minor for a new capability. During development,
breaking changes also use a minor and must include migration notes. Major release
intent is refused while the suite remains at major zero.

The explicitly listed public packages form one fixed group. The highest
impact across pending records determines the shared next version. Application
and tooling changes that ship with the product also need a release record; select
the affected public package or core for suite-wide maintenance.

Run `npm run release:prepare` before committing or pushing a release. It consumes
the records into package changelogs and the tracked release record, synchronizes
all workspace versions and references, and updates the lockfile. Do not run the
bare Changesets version/publish commands: the Tangle wrapper also handles private
workspaces and the verified npm distribution boundary.

See [the release protocol](../docs/workflow/RELEASE.md) for closeout and recovery.
