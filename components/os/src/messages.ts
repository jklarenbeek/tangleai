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
  'tray/theme-light': 'Switch to the light theme',
  'tray/theme-dark': 'Switch to the dark theme',
  'menu/label': 'Menu for {title}',
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
