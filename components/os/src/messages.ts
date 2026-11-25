/**
 * Every sentence the desktop's chrome shows, keyed for all twelve languages.
 * English is built in; a language pack is a catalogue with the same keys.
 * Keys never carry English word order a translation would have to keep.
 */
export const osMessagesEn = {
  'desktop/label': 'Desktop',
  'dock/label': 'Applications',
  'dock/open': 'Open {title}',
  'window/close': 'Close',
  'window/minimize': 'Minimize',
  'window/maximize': 'Maximize',
  'window/restore': 'Restore',
  'window/failed': '{title} could not start: {detail}',
  'window/unanswered': '{title} did not answer. It may not be running, or it may refuse this desktop.',
  'window/retry': 'Try again',
  'window/local-network': 'It runs on this device or your local network: if your browser asked whether this page may reach it and it was refused, allow it in the site settings and try again.',
  'window/more': 'More',
  'mail/title': 'Mail',
  'mail/empty': 'No messages.',
  'mail/from': 'From {sender}',
  'mail/to-decide': 'To decide',
  'mail/evidence': 'Evidence',
  'mail/accept': 'Accept',
  'mail/reject': 'Reject',
  'mail/deciding': 'Deciding…',
  'mail/accepted': 'Accepted',
  'mail/rejected': 'Rejected',
  'mail/not-running': '{app} is not running. Open it, then decide again.',
  'mail/refused': 'Not done: {detail}',
  'mail/answer': 'Answer',
  'mail/answer-invalid': 'Not sent: {detail}',
  'mail/origin-human': 'Proposed by a person',
  'mail/origin-rule': 'Proposed by a rule',
  'mail/origin-import': 'From an import',
  'mail/origin-ai': 'Proposed by the assistant',
  'mail/roles': 'For: {roles}',
  'dock/edit': 'Edit the dock',
  'dock/done': 'Done',
  'dock/hide': 'Hide {title}',
  'dock/hidden': 'Hidden icons',
  'dock/show': 'Show {title}',
  'dock/folder': 'Folder',
  'dock/folder-open': 'Open the folder {title}',
  'dock/rename': 'Folder name',
  'dock/put-in': 'Put in {folder}',
  'dock/new-folder': 'Make a folder with {title}',
  'dock/take-out': 'Take out of the folder',
  'dock/move-back': 'Move back',
  'dock/move-forward': 'Move forward',
  'dock/suggestion': 'A new arrangement of the dock',
  'dock/suggested-by': 'Suggested by {sender}',
  'dock/changes-moved': 'Moves: {list}',
  'dock/changes-hidden': 'Hides: {list}',
  'dock/changes-shown': 'Shows: {list}',
  'dock/changes-folders': 'Folders: {list}',
  'files/title': 'Files',
  'files/locations': 'Locations',
  'files/contents': 'Files and folders',
  'files/preview': 'Preview',
  'files/this-browser': 'This browser',
  'files/back': 'Back',
  'files/forward': 'Forward',
  'files/up': 'Up one folder',
  'files/search': 'Search files',
  'files/new-folder': 'New folder',
  'files/new-folder-name': 'New folder',
  'files/menu': 'Files menu',
  'files/upload': 'Upload files…',
  'files/refresh': 'Refresh',
  'files/choose': 'Choose a location.',
  'files/no-locations': 'No application shares files here yet.',
  'files/loading': 'Loading…',
  'files/count': '{count} items',
  'files/count-one': '1 item',
  'files/path': 'Folder path',
  'files/empty': 'This folder is empty.',
  'files/no-match': 'Nothing matches.',
  'files/failed': 'Not done: {detail}',
  'files/no-preview': 'No preview for this kind of file. Download it to open it.',
  'files/download': 'Download',
  'files/open-in': 'Open in {app}',
  'files/rename': 'Rename',
  'files/delete': 'Delete',
  'files/cancel': 'Cancel',
  'files/delete-confirm': 'Delete {name}?',
  'files/too-large': '{name} is larger than 10 MB.',
  'web/title': 'Web', // Window and dock title of the Web reader
  'web/address': 'Address or search', // Web: the address bar's label and placeholder
  'web/go': 'Go', // Web: the button that reads the address
  'web/back': 'Back', // Web header bar: back
  'web/forward': 'Forward', // Web header bar: forward
  'web/reload': 'Reload', // Web header bar: read the page again
  'web/open-original': 'Open original', // Web: link that opens the page itself in a new tab
  'web/loading': 'Reading {address}…', // Web: status while a page is read
  'web/searching': 'Searching for {query}…', // Web: status while searching
  'web/results': '{count} results for {query}', // Web: how many search results
  'web/result-one': '1 result for {query}', // Web: one search result
  'web/no-results': 'No results for {query}.', // Web: a search with no results
  'web/results-label': 'Search results', // Web: accessible name of the results list
  'web/unconfigured': 'No web access is configured on this desktop.', // Web: no reader is configured
  'web/unconfigured-detail': 'Web pages are read by a service the desktop connects to. Name one in Settings to read and search the web here.', // Web: what web access is and where to set it up
  'web/configure': 'Open Settings', // Web: button to the desktop's Settings
  'web/refused': 'This address is refused: {address}. {reason}', // Web: an address the reader refuses (private, not http, a policy)
  'web/unreadable': 'This page could not be read: {address}. {reason}', // Web: a page that could not be read
  'web/failed': 'Not done: {detail}', // Web: any other failure
  'web/truncated': 'This page was cut at its size limit. Open the original to read the rest.', // Web: a page cut at the byte limit
  'web/start': 'Type an address, or the words you are looking for.', // Web: what the empty reader asks for
  'jobs/title': 'Jobs', // Window and dock title of the Jobs application: the background work a host runs
  'jobs/views': 'Views', // Jobs header bar: accessible name of the Schedules/Queue tabs
  'jobs/products': 'Products', // Jobs: name of the row of products a host runs background work for
  'jobs/product': 'Product: {product}', // Jobs: the header menu that chooses which product is shown; {product} is its title
  'jobs/product-summary': '{product}: {failed} failed, {waiting} waiting', // Jobs: one product's line in the products row; {failed} counts failed and given-up jobs
  'jobs/schedules': 'Schedules', // Jobs: tab and list of the recurring schedules
  'jobs/queue': 'Queue', // Jobs: tab with the jobs by state
  'jobs/refresh': 'Refresh', // Jobs header bar: read the host again
  'jobs/states': 'Jobs by state', // Jobs: accessible name of the row of state counts
  'jobs/state-pending': 'Waiting', // Jobs: state of a job that waits for its turn
  'jobs/state-leased': 'Running', // Jobs: state of a job a worker runs now
  'jobs/state-done': 'Done', // Jobs: state of a finished job
  'jobs/state-failed': 'Failed', // Jobs: state of a job that failed and will be tried again
  'jobs/state-dead': 'Given up', // Jobs: state of a job that failed every attempt
  'jobs/state-cancelled': 'Cancelled', // Jobs: state of a cancelled job
  'jobs/schedule-active': 'Active', // Jobs: a schedule that runs
  'jobs/schedule-unresolved': 'No time zone', // Jobs: a schedule that never runs because it has no time zone
  'jobs/schedule-stalled': 'Stalled', // Jobs: a schedule stopped at a run it could not compute
  'jobs/schedule-ended': 'Ended', // Jobs: a schedule with no runs left
  'jobs/stalled-detail': 'It stopped at a run it could not compute ({code}). The host resumes it by saving the schedule again.', // Jobs: why a schedule is stalled; {code} is the reason code
  'jobs/unresolved-detail': 'It does not run until the host gives it a time zone.', // Jobs: why a schedule without a zone never runs
  'jobs/next-runs': 'Next runs', // Jobs: heading of a schedule's upcoming runs
  'jobs/no-next': 'No further runs.', // Jobs: a schedule with no runs ahead
  'jobs/next-unknown': 'The next runs need time zone data this desktop does not have.', // Jobs: the runs of a wall-clock rule cannot be computed here
  'jobs/moved': 'moved by the clock change', // Jobs: a run the daylight-saving change moved to a later time
  'jobs/repeated': 'in the repeated hour, runs once', // Jobs: a run whose wall time occurs twice when the clocks go back
  'jobs/last-run': 'Last run {when}', // Jobs: when a schedule last ran; {when} is a relative and absolute time
  'jobs/never-run': 'Not run yet', // Jobs: a schedule that has not run
  'jobs/fired': 'Runs so far: {count}', // Jobs: how many jobs a schedule started
  'jobs/skipped': 'Skipped: {skipped}; passed while stopped: {uncounted}', // Jobs: runs a schedule skipped, and runs that went by while the host was stopped
  'jobs/remove': 'Remove', // Jobs: button that removes a schedule, and its confirmation
  'jobs/remove-confirm': 'Remove the schedule {title}? The jobs it ran stay.', // Jobs: the question before a schedule is removed
  'jobs/keep': 'Keep', // Jobs: button that takes a pending action back
  'jobs/removed': 'The schedule {title} is removed.', // Jobs: after a schedule was removed
  'jobs/no-schedules': 'No schedules.', // Jobs: the host has no recurring schedules
  'jobs/no-jobs': 'No jobs in this state.', // Jobs: an empty state of the queue
  'jobs/list': 'Jobs', // Jobs: accessible name of the list of jobs
  'jobs/more': 'Show more', // Jobs: button that loads the next page of jobs
  'jobs/attempts': 'Attempt {attempts} of {max}', // Jobs: how often a job was tried, of how often it may be
  'jobs/run-at': 'Due {when}', // Jobs: when a job is or was due; {when} is a relative and absolute time
  'jobs/detail': 'Job details', // Jobs: accessible name of a job's details
  'jobs/field-id': 'Job', // Jobs details: the job's id
  'jobs/field-kind': 'Kind', // Jobs details: what kind of work it is
  'jobs/field-state': 'State', // Jobs details: its state
  'jobs/field-attempts': 'Attempts', // Jobs details: its attempts
  'jobs/field-run-at': 'Due', // Jobs details: when it is due
  'jobs/field-lease': 'Held until', // Jobs details: until when a worker holds it
  'jobs/field-created': 'Added', // Jobs details: when it was added to the queue
  'jobs/field-updated': 'Last change', // Jobs details: when it last changed
  'jobs/field-error': 'Last error', // Jobs details: the last error it met
  'jobs/cancel': 'Cancel job', // Jobs: button that cancels a job, and its confirmation
  'jobs/cancel-confirm': 'Cancel the job {id}?', // Jobs: the question before a job is cancelled
  'jobs/requeue': 'Run again', // Jobs: button that puts a job back in the queue, and its confirmation
  'jobs/requeue-confirm': 'Put the job {id} back in the queue? Its attempts so far are kept.', // Jobs: the question before a job is run again
  'jobs/cancelled-ok': 'The job {id} is cancelled.', // Jobs: after a job was cancelled
  'jobs/requeued-ok': 'The job {id} is back in the queue.', // Jobs: after a job was put back in the queue
  'jobs/unchanged': 'Nothing changed: it already was so.', // Jobs: an action that found nothing to change
  'jobs/unknown': 'It is no longer there.', // Jobs: the job or schedule no longer exists (OS0191)
  'jobs/refused': 'Not possible in its current state: {detail}', // Jobs: the state forbids the action (OS0192)
  'jobs/held': 'Another process is running this job, so it cannot be cancelled from here.', // Jobs: a job another process runs (OS0193)
  'jobs/failed': 'Not done: {detail}', // Jobs: any other failure
  'jobs/unconfigured': 'No job host is configured on this desktop.', // Jobs: no host serves background work to this desktop (OS0190)
  'jobs/unconfigured-detail': 'Background work runs on a host the desktop connects to. Name it in Settings to see its schedules and jobs here.', // Jobs: what a job host is and where to set it up
  'jobs/configure': 'Open Settings', // Jobs: button to the desktop's Settings
  'jobs/loading': 'Reading the jobs…', // Jobs: status while the host is read
  'jobs/in-zone': '{rule}, {zone} time', // Jobs: a rule on a wall clock in a time zone; {zone} is a zone name such as Europe/Amsterdam
  'jobs/every-second': 'Every second', // Jobs: a rule that runs every second
  'jobs/every-minute': 'Every minute', // Jobs: a rule that runs every minute
  'jobs/every-hour': 'Every hour', // Jobs: a rule that runs every hour
  'jobs/every-interval': 'Every {interval}', // Jobs: a rule that runs at a fixed interval; {interval} is a number with its unit, such as 15 minutes
  'jobs/daily': 'Every day at {times}', // Jobs: a daily rule; {times} lists times of day
  'jobs/every-days': 'Every {interval} at {times}', // Jobs: a rule every few days; {interval} is a number of days
  'jobs/weekly': 'Every {days} at {times}', // Jobs: a weekly rule; {days} lists weekdays
  'jobs/every-weeks': 'Every {interval} on {days} at {times}', // Jobs: a rule every few weeks
  'jobs/monthly': 'Monthly on day {days} at {times}', // Jobs: a monthly rule; {days} lists days of the month
  'jobs/rule': 'Rule: {rule}', // Jobs: a rule the desktop shows as its RRULE text
  'jobs/run-now': 'Run now', // Jobs: button that runs a registered job at once
  'jobs/run-single-confirm': 'This sends once; it is not repeated. Run {title} now?', // Jobs: the in-place question before running a job that must never run twice; {title} is the job
  'jobs/run-ok': '{title} will run now.', // Jobs status: a registered job was queued to run at once
  'jobs/run-busy': 'A run of {title} is already waiting or under way.', // Jobs status: Run now refused because one waits or runs
  'jobs/attempts-title': 'Attempts', // Jobs: heading of a job's attempt history
  'jobs/attempt-n': 'Attempt {n}', // Jobs: one attempt in the history; {n} counts from 1
  'jobs/outcome-started': 'Under way', // Jobs: an attempt that has started and not finished
  'jobs/outcome-completed': 'Completed', // Jobs: an attempt that finished
  'jobs/outcome-failed': 'Failed', // Jobs: an attempt that failed
  'jobs/outcome-lost': 'Lost: the process running it stopped', // Jobs: an attempt cut off by a crash or restart
  'jobs/outcome-cancelled': 'Cancelled', // Jobs: an attempt that was cancelled
  'jobs/took': 'took {duration}', // Jobs: how long an attempt took; {duration} is a formatted duration
  'jobs/not-repeated': 'Not repeated: it may already have been sent; run it again only if it did not arrive.', // Jobs: a job that must never run twice was cut off and is not retried
  'jobs/budget-spent': 'Not run: the day\'s budget for this job is spent.', // Jobs: an attempt refused because its daily budget is used up
  'jobs/runtime-seen': 'Background runtime seen {when}', // Jobs: when the host's background runtime last reported; {when} is relative
  'jobs/runtime-stale': 'The background runtime has not reported for {duration}.', // Jobs warning: the host's background runtime stopped reporting; {duration} is formatted
  'jobs/starting': 'Background work is starting…', // Jobs: the background runtime in this browser has not answered yet (OS0195)
  'jobs/starting-detail': 'The runtime opens its store in a worker of an open desktop tab. Jobs reads it again in a moment.', // Jobs: below the starting message
  'jobs/twin-failed': 'Background work could not start in this browser: {detail}', // Jobs: the browser's background runtime failed to start; {detail} is the reason
  'jobs/ticks': '{count} schedule ticks so far, kept out of the list', // Jobs: how many times the schedules fired their small enqueue job; those jobs are not listed
  'jobs/sim-title': 'What will happen', // Jobs: heading of the panel that simulates the next days
  'jobs/sim-days': 'Days', // Jobs simulation: label of the number of days
  'jobs/sim-failures': 'Failure rate', // Jobs simulation: label of the share of attempts that fail
  'jobs/sim-run': 'Simulate', // Jobs simulation: button that runs it
  'jobs/sim-running': 'Simulating…', // Jobs simulation: while it runs
  'jobs/sim-note': 'Simulated on a separate copy with its own clock: nothing ran and nothing was sent.', // Jobs simulation: note under every result
  'jobs/sim-total': '{runs} runs over {days} days, simulated in {seconds} s', // Jobs simulation: summary; {runs} and {days} are numbers, {seconds} a decimal
  'jobs/sim-retried': '{count} retried', // Jobs simulation: attempts that were tried again
  'jobs/sim-given-up': '{count} given up', // Jobs simulation: jobs that failed every attempt
  'jobs/sim-not-repeated': '{count} not repeated', // Jobs simulation: single-send jobs that failed and are not repeated
  'jobs/sim-skipped': '{count} skipped by the budget', // Jobs simulation: runs refused by the job's daily budget
  'jobs/sim-left': 'Not simulated: {kinds}', // Jobs simulation: jobs it could not rebuild; {kinds} a list
  'jobs/sim-failed': 'The simulation could not run: {message}', // Jobs simulation: it failed; {message} the reason
  'jobs/sim-job': 'Job', // Jobs simulation: header of the job column
  'jobs/storage-durable': 'kept in this browser', // Jobs heartbeat line: the runtime's store survives a reload
  'jobs/storage-memory': 'not kept: this browser gives it no lasting storage', // Jobs heartbeat line: the runtime's store is in memory only
  'jobs/runs-here': 'runs in this tab', // Jobs heartbeat line: this tab's worker owns the runtime
  'state/unavailable': 'Your desktop could not be loaded, so changes are off until it is.',
  'state/failed': 'A change was not saved: {detail}.',
  'tray/theme-light': 'Switch to the light theme',
  'tray/theme-dark': 'Switch to the dark theme',
  'menu/label': 'Menu for {title}',
  'menu/back': 'Back', // An application's submenu: the item that returns to the menu it came from
  'menu/new-window': 'New window',
  'menu/show-desktop': 'Show the desktop',
  'menu/show-windows': 'Show all windows',
  'menu/close-all': 'Close all windows',
  'menu/settings': 'Settings',
  'settings/search': 'Search settings',
  'settings/sections': 'Settings sections',
  'settings/applications': 'Applications',
  'settings/no-match': 'No setting matches.',
  'settings/empty': 'There is nothing to set yet.',
  'settings/saved': 'Saved.',
  'settings/refused': 'Not saved: {detail}',
  'join/title': 'Add applications from {suite}',
  'join/from': 'Offered by {source}',
  'join/lead': 'Nothing is added until you choose Add. You can change or remove each application later in Settings, under Applications and access.',
  'join/again-origin': 'It now comes from another address, so it asks again.',
  'join/again-more': 'It now asks for more than you allowed before.',
  'join/origin': 'Runs from {origin}',
  'join/document': 'Runs inside the desktop, without a server of its own.',
  'join/provides': 'Offers: {contracts}',
  'join/asks': 'Asks to use',
  'join/scope-all': 'all of it',
  'join/assistant': 'Let the assistant use this application',
  'join/local-network': 'This application runs on this device or your local network. Your browser may ask whether this page may reach it: allow it to open the application. If it was refused, allow it in the site settings and open the application again.',
  'join/cancel': 'Cancel',
  'join/add': 'Add',
  'access/title': 'Applications and access',
  'access/lead': 'What each application may use, where it comes from and what it called recently. You can change or remove the applications you added.',
  'access/layer-shipped': 'Part of this desktop',
  'access/layer-suite': 'Added by the host',
  'access/layer-user': 'Added by you',
  'access/uses': 'Uses: {scopes}',
  'access/uses-nothing': 'Uses nothing beyond its own window.',
  'access/calls': 'Recent calls ({count})',
  'access/calls-none': 'No calls yet.',
  'access/call': '{time}: {caller} called {operation}',
  'access/call-refused': '{time}: {caller} was refused {operation} ({code})',
  'access/remove-confirm': 'Remove {title}?',
  'access/remove': 'Remove',
  'access/keep': 'Keep',
  'apps/offer': 'Add the application {title}',
  'apps/revise-offer': 'Change the application {title}',
  'apps/written-by': 'Written for you by {sender}',
  'apps/asks-nothing': 'It runs on its own and asks for nothing: it cannot reach your files, your other applications or the assistant.',
  'inbox/job-cancel': 'Cancel the job {id}',
  'inbox/job-requeue': 'Run the job {id} again',
  'inbox/job-unschedule': 'Remove the schedule {id}',
  'inbox/job-by': 'Proposed by {sender}',
  'inbox/job-note': 'This happens only when you accept, and only if the job has not changed since it was proposed.',
  'inbox/job-run': 'Run the job {kind} now', // Inbox: the subject of the assistant's suggestion to run a registered background job now; {kind} is the job's kind
  'inbox/job-run-note': 'It runs once when you accept; it is refused while a job of this kind waits or runs.', // Inbox: what happens when the person accepts a suggestion to run a job now
  'mail/attention': 'needs your attention', // Dock: added to the mail button's name while a desktop item asks for the person now
  'inbox/job-failed-dead': '{title} stopped after {attempts} attempts', // Inbox: subject of a background job that gave up; {title} the job, {attempts} a number
  'inbox/job-failed-not-repeated': '{title} was cut off and is not repeated', // Inbox: subject of a send-once job a crash cut off; {title} the job
  'inbox/job-failed-not-repeated-note': 'It may already have been sent. Run it again only if it did not arrive.', // Inbox: what the person should check before running a cut-off send-once job again
  'inbox/job-failed-failing': '{title} keeps failing ({attempts} attempts so far)', // Inbox: subject of a background job that failed three times or more; {attempts} a number
  'inbox/job-failed-error': 'Last error, as the other system wrote it: {error}', // Inbox: the job's last error, quoted from another system; {error} the text
  'inbox/job-failed-by': 'From the background work', // Inbox: the sender line of the desktop's own items about background work
  'inbox/job-failed-by-product': 'From the background work of {product}', // Inbox: the sender line of an item about one product's background work; {product} is its title
  'inbox/job-for-product': 'For {product}', // Inbox: under a suggested change to a background job, which product it is for; {product} is its title
  'inbox/job-failed-run': 'Run again', // Inbox: button that runs a failed background job once more
  'inbox/dismiss': 'Dismiss', // Inbox: button that sets an item about background work aside without doing anything
  'inbox/job-open': 'Open Jobs', // Inbox: button that opens the Jobs app
  'inbox/runtime-silent': 'The background work has not reported since {when}', // Inbox: subject when the background runtime stopped reporting; {when} a date and time
  'inbox/runtime-silent-note': 'Jobs may not be running. Open Jobs to see where it stands; the desktop app or its tab may need to be started again.', // Inbox: what a silent background runtime means and what to do
} as const;

export type OsMessageKey = keyof typeof osMessagesEn;
export type OsCatalogue = Record<OsMessageKey, string>;

/** Fill `{name}` placeholders. Values are inserted as text, never as markup. */
export function format(template: string, values: Record<string, string | number> = {}) {
  return template.replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

export function createOsMessages(catalogue: Partial<OsCatalogue> = {}) {
  const merged: OsCatalogue = { ...osMessagesEn, ...catalogue };
  return (key: OsMessageKey, values?: Record<string, string | number>) => format(merged[key], values);
}
