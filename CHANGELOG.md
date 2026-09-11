# Tangle releases

## 0.20.1

Wait for npm publish-time scanning before verifying fresh installations. Upload the complete suite, then poll full and install package indexes for up to 20 minutes, requiring matching versions, integrity and latest tags. Keep mismatched artifacts fatal and report packages that remain unavailable, so direct main releases can finish without manually retrying normal scan delays. Complete each release from the successful publication attempt's exact artifact ID, preserving earlier failed receipts without selecting them.

## 0.20.0

Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.
