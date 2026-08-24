# RELEASE.md — shipping Tangle

Tangle does not publish to npm yet (the packages are consumed inside this
workspace; publishing becomes a decision when something outside needs
them). A release today is three artifacts from one green tree:

1. **The tag.** Gate green (CONVENTIONS §2, exit codes), versions bumped
   in the workspace `package.json`s in one commit, then an annotated tag
   `v<version>`. The version lives in the tag, never in the commit
   message.
2. **The binary.** `npm run desktop:compile` → `dist/tangle`; smoke-test
   it from a foreign cwd (index 200, `/app.js` 200, `/api/status`
   answers). Cross-targets via
   `bun build --compile --target=bun-<os>-<arch>` after
   `bun scripts/embed-assets.ts`. The populated `assets.gen.ts` must not
   be committed (the stub is the committed form).
3. **The site.** Pushing `main` deploys `apps/pages` via
   `.github/workflows/pages.yml` (the workflow runs the gate first).
   After a push that should deploy: verify the live page actually
   changed before calling it shipped — a deploy that was not observed
   live did not happen.

Order: bump → gate → commit → tag → push (with tags) → verify live.

```json
{
  "$workflow": "release",
  "stages": [
    { "id": "gate", "run": "npm run check", "pass": "exit==0" },
    { "id": "bump", "needs": ["gate"], "run": "workspace package.json versions, one commit" },
    { "id": "binary", "needs": ["gate"], "run": "npm run desktop:compile + foreign-cwd smoke", "pass": "exit==0, 200s" },
    { "id": "commit", "needs": ["bump"], "run": "CONVENTIONS close-out" },
    { "id": "tag", "needs": ["commit"], "run": "git tag v<version>" },
    { "id": "push", "needs": ["tag"], "run": "git push && git push --tags (when asked)" },
    { "id": "verify-live", "needs": ["push"], "run": "pages deploy observed live", "pass": "content matches tree" }
  ]
}
```
