---
"@tangleai/os": minor
---

The Pages desktop's Calendar shows the background work's upcoming runs as a quiet, read-only layer under the person's own events. A run shows by its registered job's title. A schedule that runs more often than daily is one line a day with its count: every minute is "1,440 runs", never 1,440 items, and a 23-hour clock-change day counts 1,380. A run the spring clock change moved is marked as moved. A month cell with several runs shows a compact count, with the runs in its tooltip, and the selected day lists them under "Background work". The Calendar's menu, and its section in Settings, hide and show the layer. "Export upcoming runs (.ics)" writes the next 30 days as an iCalendar file with only each run's title, UTC start and identity (`<schedule>@<recurrence>`), and a frequent schedule as one all-day count a day. Runs are never the person's busy time. Without a job host, or while it starts, the Calendar draws no runs and offers no run export.

`scheduledRuns(schedules, registry, from, to)` in `@tangleai/os/jobs-app` gives a range of runs as a calendar shows them. `nextRuns` now compiles a schedule's series again from its JSON. A series that crossed a contract is JSON, which Jaren's calendar does not expand as it is, so Jobs showed no next runs for a real host's floating schedule. Each run also carries Jaren's recurrence id.
