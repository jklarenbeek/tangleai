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
