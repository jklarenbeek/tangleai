---
"@tangleai/os": minor
---

The Pages desktop runs its background work in the browser when no job host address is set. The jobs run in a worker of an open desktop tab, and that tab's worker serves them to every tab. Under automation this browser twin is off unless a page asks for it with `?twin=1`, and `?twin=0` turns it off. A twin that cannot start never stops the desktop. Jobs then says it could not start in this browser, and why.

The showcase registry is a document with two jobs. Calendar reminders runs every minute and files one inbox message per calendar event starting within 15 minutes, keyed by the event's occurrence, so a run in another tab sends nothing twice. Inbox tidy count runs daily at 03:00 in the person's own time zone and counts the read messages older than 30 days. It deletes nothing. Watching a web page is not scheduled by default.

Settings → Background work says where the work runs. Forget everything also deletes the store the twin keeps in this browser, and the privacy text names it.

Jobs keeps the schedules' own enqueue jobs (`ops.fire`) out of its list and out of the waiting count, and says in one quiet line how many there were. While the browser twin has not answered yet (`OS0195`), Jobs says it is starting instead of offering Settings. The heartbeat line says whether the runtime's store is kept in this browser and whether this tab runs it.
