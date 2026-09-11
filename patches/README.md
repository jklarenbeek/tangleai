# JarenJS AI pending upstream release

`jarenjs-ai-0.83.2.patch` carries the local upstream program fixes into the
installed `@jarenjs/ai` 0.83.2 package. Its JavaScript and generated TypeScript
declarations come from the same JarenJS source changes. No dependency or
submodule version is advanced to an unpublished release.

Upstream source: [commit 3491513e, tagged v0.83.3](https://github.com/jklarenbeek/jarenjs/commit/3491513e164dc30e429c84e709bd738841f4df16).
The patch retains the installed 0.83.2 package metadata and changes only the
eight source/declaration files listed in its manifest.

`npm ci` / `npm install` apply it through the root `postinstall`. With lifecycle
scripts disabled, run `npm run jaren:patch` explicitly before building or testing;
CI does this. Node 24 and Git are required. `npm run jaren:check` verifies the
release pins and every patched file. Reapplying the patch is a no-op. Changed
preimages, partially patched files and a different package version are refused
before writing, so installation cannot silently patch an unrelated release.

The JSON manifest records SHA-256 hashes for the patch and each file before and
after application. The source submodule remains an unmodified 0.83.2 reference;
the manifest identifies this additional runtime patch. Historical benchmark
reports retain their original identities and measurements.

The patch includes error envelopes with `value: null`, bounded complete child
answer reads, failure accounting, preview truncation, and public runner result
types. Tangle consumes `readProgramAnswer` for its checked evidence slot. Generic
execution remains owned by JarenJS; QA coverage, evidence checking and synthesis
remain Tangle policies.

To refresh this patch, build `@jarenjs/ai` declarations in the upstream checkout,
compare the listed source and declaration files against a pristine npm 0.83.2
package, and regenerate the unified diff and manifest hashes together. Verify
the installed files match upstream, then run `npm run check` and the installed
consumer tests on Node and Bun. Do not regenerate against an already patched
package or mutate the source submodule to conceal the difference.

Once a published release contains these fixes, update the release and submodule
pins together, remove this patch, its install hook and installation test, and
retain the program integration regressions and shared answer reader.
