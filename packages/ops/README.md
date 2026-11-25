# @tangleai/ops

Tangle AI operations — a Jaren store's job queue and recurring schedules, served to the desktop through the
`job_queue` contract (`@tangleai/os/jobs`). The work runs in the host's background process; the desktop reads
it and the person steers it with the queue's own fenced calls.

Install with `npm install @tangleai/ops`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.
