# Optional dynamic renderer

Normal Tangle document ingestion does not use this service. Run it only when a page is a
client-rendered shell and a sandboxed browser is acceptable.

The service binds `127.0.0.1:4720`, creates an isolated Playwright context for every job,
blocks images/media/fonts, validates the main URL and every routed HTTP(S) subrequest, and
applies time, actual transferred-byte, concurrency, and queue budgets. A non-loopback bind
is rejected unless `TANGLE_SCRAPER_TOKEN` is set.

On this Fedora-family host, run it in the existing browser distrobox:

```sh
distrobox enter ubuntu-playwright -- bash -lc \
  'cd ~/projects/jp/tangleai && bun apps/scraper/src/main.ts'
```

Configure the desktop browser mode as `remote` and the endpoint as
`http://127.0.0.1:4720`.

For a hermetic server profile, build from the repository root and keep the required token
in the environment:

```sh
export TANGLE_SCRAPER_TOKEN='replace-with-a-long-random-value'
docker compose -f compose/scraper.yml up --build
```

The compose profile uses the non-root Playwright user, a read-only filesystem, no added
capabilities, `no-new-privileges`, bounded shared memory/tmpfs, and a loopback-only port.
Tune the bounded queue with `TANGLE_SCRAPER_QUEUE` (default 16) if needed.
