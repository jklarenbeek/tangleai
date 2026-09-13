# Saved CI configuration

[`ci-with-windows.yml`](ci-with-windows.yml) is an exact backup of
`.github/workflows/ci.yml` at commit
`482f5bd876af5a141c092fb125080402f875185e`, before Windows jobs were removed
on 2026-09-13 to reduce CI runtime and cost. It retains the Linux/Windows
release matrix, Windows checkout settings and shared release gates.

This directory is outside `.github/workflows/`, so the backup is inactive.
Windows validation is reserved for reconsideration when preparing Tangle 1.0.0;
there is no automatic version-triggered reactivation.

To restore Windows coverage, compare the backup with the then-current active
workflow. Reintroduce `windows-latest` in the package matrix and its pre-checkout
`core.autocrlf false` step while preserving intervening toolchain, action pins,
security settings and release changes. Keep `fail-fast: false`, the Windows
source/installed-consumer gate and Linux-only binary/artifact steps. Run the
restored matrix and require successful Windows results before claiming Windows
release qualification. Update the current release documentation at that time.
