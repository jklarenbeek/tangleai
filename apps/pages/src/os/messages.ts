/**
 * Every sentence the Pages desktop's own applications show a person, keyed
 * `<area>/<name>` by where it renders, in English. A language pack is a
 * catalogue with the same keys (any subset: a missing key renders English);
 * `./i18n.ts` compiles it over this one. An entry is a template string with
 * `{name}` placeholders (`{{` for a literal brace) or, where the wording
 * depends on a number, a closure that takes the parameters and returns the
 * sentence. Product and provider names, model ids, URLs, code tokens and file
 * formats stay as written in every language; dates, times and numbers are
 * formatted with `Intl` before they reach a sentence.
 *
 * The comment beside each key says where it appears and what it is.
 */

export const pagesMessagesEn = {
  // ── manifests: the names of the desktop's applications (dock, window title, Settings) ──
  'apps/welcome': 'Welcome', // Dock and window title: the Welcome application
  'apps/assistant': 'Assistant', // Dock and window title: the Assistant application
  'apps/calendar': 'Calendar', // Dock and window title, and its Settings section: the Calendar application
  'apps/calendar-keywords': 'working hours, hours, agenda, find a time', // Settings search: comma-separated words that find the Calendar's section
  'apps/studio': 'Studio', // Dock and window title: Studio, where a Jaren application is built from documents
  'apps/playground': 'Playground', // Dock and window title: Playground, to try every Jaren engine
  'apps/flow': 'Flow', // Dock and window title: Flow, to draw and run state machines and pipelines
  'apps/data': 'Data', // Dock and window title: Data, a database in this browser
  'apps/calculator': 'Calculator', // Dock and window title: the Calculator application
  'apps/converter': 'Converter', // Dock and window title: the unit and currency Converter
  'apps/loop': 'Memory loop', // Dock and window title: the memory loop demonstration
  'apps/adventure': 'Adventure', // Dock and window title: a small pirate story game
  'apps/transfer': 'Move data', // Dock and window title: export and import this browser's data
  'apps/settings': 'Settings', // Dock and window title: the desktop's Settings
  'apps/about': 'About Tangle OS', // Dock and window title: About this desktop
  'apps/todo': 'To do', // Dock and window title: the to-do list application

  // ── About window ──
  'about/lead': 'One desktop where every Jaren application is a window, every contract is a tool, and everything you or the assistant design is a document.', // About window: the paragraph under the title
  'about/build': 'Build', // About window: label of the row holding the build's commit id

  // ── To do (a document application) ──
  'todo/title': 'To do', // To-do window: the heading
  'todo/open-of': ' open of ', // To-do window: the words between two counts, "3 open of 5" (keep the spaces at both ends)
  'todo/new-item': 'New item', // To-do window: placeholder and label of the field for a new item
  'todo/add': 'Add', // To-do window: button that adds the typed item
  'todo/sent': 'Summary sent', // To-do window: the mail button after the summary was sent
  'todo/mail': 'Mail me a summary', // To-do window: button that mails a summary to the desktop's Mail
  'todo/remove': 'Remove', // To-do window: button beside an item that removes it
  'todo/tasks-open': ' tasks open', // To-do window: subject of the summary mail, after the count, "2 tasks open" (keep the leading space)
  'todo/seed-manual': 'Read the manual', // To-do window: the first example item a new list starts with
  'todo/seed-calculator': 'Try the calculator', // To-do window: the second example item a new list starts with

  // ── Welcome window ──
  'welcome/lead': 'Applications and an assistant on one desktop, in your browser. What you build here is a document you can read, share and undo.', // Welcome window: the paragraph under the title
  'welcome/assistant': 'Ask in plain words; it uses the applications on this desktop to answer.', // Welcome window: what the Assistant does, under its name
  'welcome/calendar': 'Plan your weeks, repeat what recurs, and find a free hour in your working day.', // Welcome window: what the Calendar does, under its name
  'welcome/studio': 'Build a Jaren application from documents, and run it as you type.', // Welcome window: what Studio does, under its name
  'welcome/playground': 'Try every Jaren engine: queries, schemas, stylesheets, charts and more.', // Welcome window: what Playground does, under its name
  'welcome/flow': 'Draw a state machine or a pipeline, then run it step by step.', // Welcome window: what Flow does, under its name
  'welcome/data': 'A real database in this browser, queried with Jaren\'s query language.', // Welcome window: what Data does, under its name
  'welcome/loop': 'Watch Tangle\'s memory gate, merge and resolve what it is told.', // Welcome window: what the memory loop does, under its name
  'welcome/adventure': 'A small pirate story whose characters can answer through a model.', // Welcome window: what Adventure does, under its name
  'welcome/settings': 'Pick a theme, a wallpaper and the model the assistant uses.', // Welcome window: what Settings does, under its name
  'welcome/contracts-title': 'Applications talk through contracts', // Welcome window: heading of the first fact
  'welcome/contracts-text': 'Every call between applications is a declared operation, checked and written down. The assistant gets the same operations as tools.', // Welcome window: text of the first fact
  'welcome/documents-title': 'Documents, not code', // Welcome window: heading of the second fact
  'welcome/documents-text': 'What you or the assistant make here is JSON that Jaren runs. A window from a document cannot reach your keys or your other data.', // Welcome window: text of the second fact
  'welcome/key-title': 'Your key stays here', // Welcome window: heading of the third fact
  'welcome/key-text': 'Bring a key for a model provider in Settings. It is stored in this browser and sent only to that provider.', // Welcome window: text of the third fact
  'welcome/source': 'Source on GitHub', // Welcome window: link to the source code
  'welcome/guide': 'Read the guide', // Welcome window: link to the guide

  // ── Assistant window ──
  'assistant/title': 'Assistant', // Assistant window: the panel's title
  'assistant/launch': 'Open the assistant', // Assistant window: tooltip of the panel's launcher
  'assistant/intro': 'Ask about anything on this desktop. The assistant can use every application that is open and has granted it access.', // Assistant window: the greeting before the first message
  'assistant/can-search': 'Search and read what open applications serve', // Assistant window: first item of the list of what it can do
  'assistant/can-cite': 'Answer with the application it used', // Assistant window: second item of the list of what it can do
  'assistant/can-keep': 'Keep the conversation in this browser', // Assistant window: third item of the list of what it can do
  'assistant/settings-hint': 'Your key stays in this browser and is sent only to its own provider. Settings has every provider, the model list and your starred models.', // Assistant window: note above the panel's own settings form
  'assistant/model': 'Model', // Assistant window footer: label of the menu that switches between your models
  'assistant/providers': 'Providers and models', // Assistant window footer: link that opens Settings at the providers and models

  // ── Settings: Providers ──
  'providers/title': 'Providers', // Settings: name of the Providers section, and its heading
  'providers/keywords': 'key, api key, openrouter, anthropic, endpoint, provider', // Settings search: comma-separated words that find the Providers section
  'providers/custom': 'OpenAI-compatible', // Providers section and Assistant footer: name of the provider choice for any OpenAI-compatible endpoint
  'providers/lead': 'The assistant talks to a model through the provider in use. Each provider keeps its own key, so you can set up several and switch between them; a key is only ever sent to its own provider.', // Providers section: the paragraph under the heading
  'providers/in-use': 'Provider in use', // Providers section: label of the menu that picks the provider
  'providers/key-label': '{provider} API key', // Providers section: label of the key field; {provider} is a provider name such as OpenRouter
  'providers/key-placeholder': 'API key', // Providers section: placeholder of the key field (OpenRouter shows its key format instead)
  'providers/openrouter-hint': 'Create one at openrouter.ai/keys. A key with a credit limit is the safest choice for a browser.', // Providers section: note under the OpenRouter key field
  'providers/show': 'Show', // Providers section: button that shows the typed key
  'providers/hide': 'Hide', // Providers section: the same button while the key is shown, which hides it again
  'providers/save': 'Save key', // Providers section: button that saves the API key
  'providers/check': 'Check key', // Providers section: button that checks the key with the provider
  'providers/test': 'Test connection', // Providers section: button that checks a provider that needs no key, or a custom endpoint
  'providers/forget': 'Forget key', // Providers section: button that removes this provider's key from the browser
  'providers/not-saved': 'Not saved yet.', // Providers section status: the key field was edited and not saved
  'providers/key-saved': '{provider} key saved in this browser.', // Providers section status: the key was saved
  'providers/key-removed': 'Key removed.', // Providers section status: an empty key was saved, so the key is gone
  'providers/save-refused': 'This browser refused to save it (private mode or storage full).', // Providers section status: the browser's storage refused the key
  'providers/key-forgotten': '{provider} key removed from this browser.', // Providers section status: after Forget key
  'providers/enter-key': 'Enter a key first.', // Providers section status: Check key was pressed with an empty field
  'providers/checking': 'Checking…', // Providers section status: the key or connection is being checked
  'providers/key-refused': '{provider} refused this key.', // Providers section status: the provider answered that the key is not valid
  'providers/http-status': '{provider} answered HTTP {status}.', // Providers section status: the provider answered with an HTTP error code
  // Providers section status: the key works; with OpenRouter also the credit used ({used} is an amount such as $1.20), the limit, and whether it is a free-tier key
  'providers/key-works': (p: { used?: string, limit?: string | null, freeTier?: boolean }) =>
    `The key works${p.used !== undefined ? ` · ${p.used} used${p.limit === undefined ? '' : p.limit === null ? ', no limit' : ` of ${p.limit}`}` : ''}${p.freeTier ? ' · free tier' : ''}.`,
  // Providers section status: a provider without a key answered, with how many models it serves
  'providers/connected': (p: { count: number }) => `Connected · ${p.count} models available.`,
  'providers/no-connection': 'No connection: {detail}', // Providers section status: the provider could not be reached; {detail} is the browser's error
  'providers/region': 'Region', // Providers section: label of the OpenRouter region menu
  'providers/region-any': 'Any region (default)', // Providers section: region menu option that lets OpenRouter route anywhere
  'providers/region-eu': 'Europe · {host}', // Providers section: region menu option that keeps inference in Europe; {host} is the address
  'providers/region-us': 'United States · {host}', // Providers section: region menu option that keeps inference in the United States; {host} is the address
  'providers/region-hint': 'Any region lets OpenRouter use every provider of a model, wherever it runs. Europe and United States keep inference in that region; they need an OpenRouter Business or Enterprise plan, and a model with no endpoint there fails instead of leaving it.', // Providers section: note under the region menu
  'providers/region-saved': 'Region saved.', // Providers section status: a region was picked and saved
  'providers/venice-hint': 'Create a key in your Venice account under API. The model list marks which models are private (Venice keeps no record of the prompt) and which are anonymized (served by a third party without your identity).', // Providers section: note shown for Venice
  'providers/server-address': 'Server address', // Providers section: label of the address field of a local runtime (Ollama, LM Studio)
  'providers/ollama-hint': 'Ollama must allow this page: start it with OLLAMA_ORIGINS={origin}. Leave the address empty for {address}.', // Providers section: note under Ollama's address field; {origin} is this page's origin, {address} the default address
  'providers/lmstudio-hint': 'Turn on CORS in LM Studio\'s server settings so this page may call it. Leave the address empty for {address}.', // Providers section: note under LM Studio's address field; {address} is the default address
  'providers/base-url': 'Base URL', // Providers section: label of a custom endpoint's address field
  'providers/custom-hint': 'Any OpenAI-compatible endpoint that answers /chat/completions and allows this page (CORS).', // Providers section: note under the custom endpoint's address field
  'providers/remember': 'Remember keys in this browser', // Providers section: checkbox that keeps keys after the tab closes
  'providers/remembered': 'Keys are kept in this browser until you forget them.', // Providers section status: the checkbox was ticked
  'providers/session-only': 'Keys are kept only until this tab closes.', // Providers section status: the checkbox was cleared
  'providers/requests-key': 'Requests go from this browser straight to {host}. Applications on the desktop run in isolated frames and cannot read the key.', // Providers section: note on where requests go, for a provider with a key; {host} is its address
  'providers/requests-local': 'Requests go from this browser straight to {host}; nothing passes through a Tangle server.', // Providers section: note on where requests go, for a provider without a key; {host} is its address
  'providers/yours': 'Your providers', // Providers section: heading of the table of every provider
  'providers/column-provider': 'Provider', // Providers table: column heading for the provider's name
  'providers/column-key': 'Key', // Providers table: column heading for whether a key is saved
  'providers/column-model': 'Model', // Providers table: column heading for the provider's chosen model
  'providers/badge-in-use': 'in use', // Providers table: small badge beside the provider in use
  'providers/key-present': 'saved', // Providers table: the Key cell when a key is saved
  'providers/key-not-needed': 'not needed', // Providers table: the Key cell of a provider that needs no key

  // ── Settings: Models ──
  'models/title': 'Models', // Settings: name of the Models section, and its heading
  'models/keywords': 'model, assistant, haiku, qwen', // Settings search: comma-separated words that find the Models section
  'models/lead': 'The assistant writes Jaren JSON documents and calls tools; only a few models do that reliably. On OpenRouter, anthropic/claude-haiku-5.5 and qwen/qwen3.8-27b are a good start.', // Models section: the paragraph under the heading (keep the model ids)
  'models/in-use': 'In use: ', // Models section: words before the provider and model in use, "In use: OpenRouter · model-id" (keep the trailing space)
  'models/none-yet': 'no model yet', // Models section: shown instead of a model id when none is chosen
  'models/use-favourite': 'Use {model} through {provider}', // Models section: tooltip of a starred model's button
  'models/no-favourites': 'Star models below to keep them here, from any provider. The Assistant window switches between them too.', // Models section: shown while no model is starred
  'models/yours': 'Your models', // Models section: label of the row of starred models
  'models/search-label': '{provider} models', // Models section: label of the model search field; {provider} is the provider in use
  'models/search': 'Search models, or type a model id', // Models section: placeholder of the model search field
  'models/tools-only': 'Only models that can use tools', // Models section: checkbox that hides models without tool calls
  'models/list': 'Models', // Models section: accessible name of the list of models
  'models/context': '{tokens} context', // Model row: the context window, {tokens} such as 128k or 1M
  'models/price': '{prompt} in · {completion} out per 1M', // Model row: price per million tokens of prompt and of reply, each such as $0.80
  'models/free': 'free', // Model row: the price of a free model
  'models/tools': 'tools', // Model row: the model can call tools
  'models/recommended': 'recommended', // Model row: small badge on the recommended models
  'models/private': 'private', // Model row (Venice): badge for a model whose provider keeps no record of the prompt
  'models/anonymized': 'anonymized', // Model row (Venice): badge for a model served by a third party without your identity
  'models/star': 'Add {model} to your models', // Model row: accessible name of the star that adds the model to your models
  'models/unstar': 'Remove {model} from your models', // Model row: accessible name of the star that removes the model from your models
  'models/star-title': 'Add to your models', // Model row: tooltip of the star that adds the model
  'models/unstar-title': 'Remove from your models', // Model row: tooltip of the star that removes the model
  'models/list-failed': 'The model list did not load ({detail}). You can still type a model id.', // Models section status: the provider's list failed; {detail} is the error
  'models/load-hint': 'Load the models this provider serves, or type an id.', // Models section status: a local or custom provider before its list is loaded
  'models/loading': 'Loading models…', // Models section status: the list is loading
  // Models section status: more models match than are shown
  'models/match-limited': (p: { count: number, limit: number }) => `${p.count} models match; showing ${p.limit}. Narrow the search.`,
  // Models section status: how many models match the search
  'models/match': (p: { count: number }) => `${p.count} models match.`,
  'models/use-id': 'Use this id', // Models section: the row that uses the typed text as a model id
  'models/load': 'Load models', // Models section: button that loads a local or custom provider's models

  // ── Settings: Appearance ──
  'appearance/title': 'Appearance', // Settings: name of the Appearance section, and its heading
  'appearance/keywords': 'theme, dark, light, wallpaper, colour, color, accent, kit', // Settings search: comma-separated words that find the Appearance section
  'appearance/language': 'Language', // Appearance section: label of the menu that picks the desktop's language
  'appearance/language-system': 'Same as this browser ({language})', // Appearance section: the first option, which follows the browser's language; {language} is that language's own name
  'appearance/language-note': 'The desktop starts again in the language you choose.', // Appearance section: hint under the language menu
  'appearance/kit-loom': 'Loom', // Appearance section: the name of the "Loom" theme kit (a look named after a printing or drawing technique)
  'appearance/kit-loom-about': 'Threads woven across fog, with knots where they cross.', // Appearance section: one line under the "Loom" theme kit describing its wallpaper
  'appearance/kit-topograph': 'Topograph', // Appearance section: the name of the "Topograph" theme kit (a look named after a printing or drawing technique)
  'appearance/kit-topograph-about': 'A surveyor\'s sheet: contour lines of a landscape that is only yours.', // Appearance section: one line under the "Topograph" theme kit describing its wallpaper
  'appearance/kit-risograph': 'Risograph', // Appearance section: the name of the "Risograph" theme kit (a look named after a printing or drawing technique)
  'appearance/kit-risograph-about': 'Two fluorescent inks printed a hair off register.', // Appearance section: one line under the "Risograph" theme kit describing its wallpaper
  'appearance/kit-cyanotype': 'Cyanotype', // Appearance section: the name of the "Cyanotype" theme kit (a look named after a printing or drawing technique)
  'appearance/kit-cyanotype-about': 'Plants laid on blue paper and left in the sun.', // Appearance section: one line under the "Cyanotype" theme kit describing its wallpaper
  'appearance/kit-tide': 'Tide', // Appearance section: the name of the "Tide" theme kit (a look named after a printing or drawing technique)
  'appearance/kit-tide-about': 'Two swells meeting, drawn as rings that interfere.', // Appearance section: one line under the "Tide" theme kit describing its wallpaper
  'appearance/mode': 'Mode', // Appearance section: legend of the light/dark choice
  'appearance/mode-system': 'Follow the system', // Appearance section: mode choice that follows the device
  'appearance/mode-light': 'Light', // Appearance section: mode choice for the light scheme
  'appearance/mode-dark': 'Dark', // Appearance section: mode choice for the dark scheme
  'appearance/theme': 'Theme', // Appearance section: heading of the theme gallery, and its accessible name
  'appearance/make-yours': 'Make it yours', // Appearance section: heading of the customisations
  'appearance/accent': 'Accent', // Appearance section: label of the accent colour swatches
  'appearance/accent-colour': 'Accent colour', // Appearance section: accessible name of the accent colour picker
  'appearance/highlights': 'Highlights', // Appearance section: label of the highlight (knot) colour
  'appearance/knot-colour': 'Knot colour', // Appearance section: accessible name of the highlight colour picker
  'appearance/theme-own': 'Use the theme\'s own', // Appearance section: link that drops a custom colour and uses the theme's
  'appearance/wallpaper': 'Wallpaper', // Appearance section: label of the wallpaper patterns
  'appearance/wallpaper-pattern': 'Wallpaper pattern', // Appearance section: accessible name of the pattern choices
  'appearance/pattern-weave': 'Threads', // Appearance section: name of the woven-threads wallpaper pattern
  'appearance/pattern-contours': 'Contours', // Appearance section: name of the contour-lines wallpaper pattern
  'appearance/pattern-halftone': 'Halftone', // Appearance section: name of the halftone-dots wallpaper pattern
  'appearance/pattern-sunprint': 'Sun print', // Appearance section: name of the sun-print (cyanotype) wallpaper pattern
  'appearance/pattern-moire': 'Moiré', // Appearance section: name of the moiré wallpaper pattern
  'appearance/shuffle': 'Shuffle the pattern', // Appearance section: button that draws the pattern from a new random number
  'appearance/pattern-number': 'Pattern number {number}', // Appearance section: which random number the pattern is drawn from
  'appearance/density': 'Pattern density', // Appearance section: slider for how dense the pattern is
  'appearance/glass': 'Glass', // Appearance section: slider for how translucent windows are
  'appearance/corners': 'Corners', // Appearance section: legend of the corner shape choice
  'appearance/corners-sharp': 'Sharp', // Appearance section: square corners
  'appearance/corners-soft': 'Soft', // Appearance section: slightly rounded corners
  'appearance/corners-round': 'Round', // Appearance section: well rounded corners
  'appearance/spacing': 'Spacing', // Appearance section: legend of the spacing choice
  'appearance/spacing-compact': 'Compact', // Appearance section: tight spacing
  'appearance/spacing-comfortable': 'Comfortable', // Appearance section: roomy spacing
  'appearance/export': 'Export theme', // Appearance section: button that saves the theme as a file
  'appearance/import': 'Import theme', // Appearance section: button that loads a theme file
  'appearance/reset': 'Reset to the theme', // Appearance section: button that drops every customisation
  'appearance/exported': 'Theme exported.', // Appearance section status: the theme file was saved
  'appearance/not-a-theme': 'This file is not a Tangle theme.', // Appearance section status detail: the chosen file is not a theme
  'appearance/import-failed': 'The theme was not imported: {detail}', // Appearance section status: the import failed; {detail} says why

  // ── Settings: Privacy and data ──
  'privacy/title': 'Privacy and data', // Settings: name of the Privacy and data section, and its heading
  'privacy/keywords': 'privacy, forget, storage, data, reset', // Settings search: comma-separated words that find the Privacy and data section
  'privacy/fact-storage': 'Your keys, models and appearance are kept in this browser\'s storage, never on a server.', // Privacy section: first fact
  'privacy/fact-header': 'Each key is sent only to its own provider, in the request\'s Authorization header. It is never part of a page address.', // Privacy section: second fact (Authorization is an HTTP header name)
  'privacy/fact-frames': 'Applications on the desktop run in isolated frames (another origin, or none) and cannot read this storage. The assistant\'s tools never see a key.', // Privacy section: third fact
  'privacy/fact-shared': 'Other pages served from this same address (every github.io project of this account) share this browser storage. Use keys with a credit limit, and forget them on a shared computer.', // Privacy section: fourth fact
  'privacy/forget-keys': 'Forget all keys', // Privacy section: button that removes every provider's key
  'privacy/clear-chat': 'Clear the conversation', // Privacy section: button that clears the assistant's conversation
  'privacy/forget-everything': 'Forget everything', // Privacy section: button that removes everything this desktop keeps
  'privacy/confirm': 'Click again to forget everything', // Privacy section: the same button after one click, asking for a second
  'privacy/keys-removed': 'Every key removed.', // Privacy section status: after Forget all keys
  'privacy/chat-cleared': 'Conversation cleared.', // Privacy section status: after Clear the conversation
  'privacy/everything-removed': 'Removed every key, the models, the conversation and the appearance from this browser.', // Privacy section status: after Forget everything

  // ── Calendar ──
  'calendar/repeat-none': 'Does not repeat', // Calendar editor: repeat menu option for a single event
  'calendar/repeat-daily': 'Every day', // Calendar editor and agenda: the event repeats daily
  'calendar/repeat-weekdays': 'Every weekday', // Calendar editor and agenda: the event repeats Monday to Friday
  'calendar/repeat-weekly': 'Every week', // Calendar editor and agenda: the event repeats weekly
  'calendar/repeat-monthly': 'Every month', // Calendar editor and agenda: the event repeats monthly
  'calendar/repeat-yearly': 'Every year', // Calendar editor and agenda: the event repeats yearly
  // Calendar month: the last line of a day cell when it holds more events than fit
  'calendar/more': (p: { count: number }) => `+${p.count} more`,
  'calendar/nothing-planned': 'Nothing planned. Add an event, or find a free time below.', // Calendar day panel: the selected day has no events
  'calendar/all-day': 'All day', // Calendar day panel and editor: an event without times
  'calendar/edit': 'Edit', // Calendar day panel: link that opens an event in the editor
  'calendar/skip-day': 'Skip this day', // Calendar day panel: link that skips one day of a repeating event
  'calendar/delete-all': 'Delete all', // Calendar day panel: link that deletes every day of a repeating event
  'calendar/delete': 'Delete', // Calendar day panel and editor: link that deletes an event
  'calendar/find': 'Find a time', // Calendar day panel: heading of the free-time finder
  'calendar/length': 'Length', // Calendar finder: accessible name of the meeting length choices
  // Calendar finder: a length in minutes, on a choice button
  'calendar/minutes': (p: { count: number }) => `${p.count} min`,
  // Calendar finder: a length in hours (1, 1.5, 2), on a choice button
  'calendar/hours': (p: { count: number }) => `${p.count} h`.replace('.5 h', '½ h'),
  'calendar/within-hours': 'Within your working hours, {start}–{end} on {days}, over the next 7 days.', // Calendar finder: where it searches; {start} and {end} are times, {days} a list of weekdays
  'calendar/search': 'Search', // Calendar finder: button that searches free time
  'calendar/no-free-time': 'No free time of that length in your working hours this week.', // Calendar finder: nothing was found
  'calendar/what': 'What is it?', // Calendar editor: placeholder of the event's title field
  'calendar/title-field': 'Title', // Calendar editor: accessible name of the event's title field
  'calendar/date': 'Date', // Calendar editor: accessible name of the date field
  'calendar/starts': 'Starts', // Calendar editor and its Settings: the start time field
  'calendar/ends': 'Ends', // Calendar editor and its Settings: the end time field
  'calendar/repeat': 'Repeat', // Calendar editor: accessible name of the repeat menu
  'calendar/colour': 'Colour', // Calendar editor: accessible name of the colour choices
  'calendar/colour-teal': 'teal', // Calendar editor: accessible name of the teal colour swatch
  'calendar/colour-blue': 'blue', // Calendar editor: accessible name of the blue colour swatch
  'calendar/colour-violet': 'violet', // Calendar editor: accessible name of the violet colour swatch
  'calendar/colour-rose': 'rose', // Calendar editor: accessible name of the rose (pink) colour swatch
  'calendar/colour-amber': 'amber', // Calendar editor: accessible name of the amber colour swatch
  'calendar/colour-slate': 'slate', // Calendar editor: accessible name of the slate (grey) colour swatch
  'calendar/notes': 'Notes', // Calendar editor: placeholder and accessible name of the notes field
  'calendar/new-event': 'New event', // Calendar header button, and the editor's heading for a new event
  'calendar/edit-event': 'Edit event', // Calendar editor: heading while an existing event is edited
  'calendar/save': 'Save', // Calendar editor: button that saves the event
  'calendar/cancel': 'Cancel', // Calendar editor: button that closes the editor without saving
  'calendar/previous-month': 'Previous month', // Calendar header: button that shows the month before
  'calendar/next-month': 'Next month', // Calendar header: button that shows the month after
  'calendar/today': 'Today', // Calendar header: button that returns to today
  'calendar/menu': 'Calendar menu', // Calendar header: accessible name of the menu
  'calendar/export': 'Export .ics', // Calendar menu: saves the calendar as an iCalendar (.ics) file
  'calendar/no-item': 'Calendar has no \'{item}\'', // Calendar: refusal when asked for a header control it does not have
  'calendar/unreadable': '{name} is not a calendar this one can read: {detail}', // Calendar: refusal when a file opened from Files is not iCalendar; {name} is the file
  'calendar/no-events': '{name} holds no event this calendar can keep', // Calendar: refusal when an opened file has no usable event; {name} is the file
  // Calendar editor: hint under the repeat menu for a monthly event on the 29th, 30th or 31st, which months without that day skip
  'calendar/skip-months': (p: { day: number }) => `Months without a ${p.day}${p.day === 31 ? 'st' : 'th'} are skipped.`,
  'calendar/leap-years': 'Repeats only in leap years.', // Calendar editor: hint under the repeat menu for a yearly event on 29 February
  'calendar/needs-title': 'An event needs a title.', // Calendar editor error: the title is empty
  'calendar/date-format': 'The date must be YYYY-MM-DD.', // Calendar error: a date in the wrong form (keep YYYY-MM-DD)
  'calendar/time-format': 'Times must be HH:MM.', // Calendar error: a time in the wrong form (keep HH:MM)
  'calendar/end-after': 'The event must end after it starts.', // Calendar editor error: the end time is not after the start
  'calendar/repeat-unavailable': 'Repeating {repeat} is not available in this calendar engine.', // Calendar error: a repeat this engine cannot expand; {repeat} is its id
  'calendar/untitled': 'Event', // Calendar: the title of an imported event that has none
  'calendar/seed-plan': 'Plan the week', // Calendar: the weekly example event a new calendar starts with
  'calendar/seed-lunch': 'Lunch walk', // Calendar: the weekday example event a new calendar starts with
  'calendar/settings-saved': 'Saved.', // Calendar's Settings section status: the working hours were saved
  'calendar/working-hours': 'Working hours', // Calendar's Settings section: heading
  'calendar/working-hours-lead': '"Find a time" offers free time only within these hours, and never time no hours cover.', // Calendar's Settings section: paragraph under the heading ("Find a time" names the finder)
  'calendar/days': 'Days', // Calendar's Settings section: legend of the working days
  'calendar/day-end-after': 'The day must end after it starts.', // Calendar's Settings section error: the end time is not after the start

  // ── Memory loop ──
  'loop/title': 'The memory loop', // Memory loop window: the heading
  'loop/lead': 'Six observations go in: a repeat, a paraphrase, and two rate limits that cannot both be true. The loop keeps what is new, merges what is the same, and resolves what conflicts, with evidence on every record.', // Memory loop window: the paragraph under the heading
  'loop/caption': 'Drawn from the same jaren-dag document the pipeline executes; every stage also writes its counts to the report.', // Memory loop window: caption of the pipeline diagram (jaren-dag is a format name)
  'loop/steps': 'Pipeline steps', // Memory loop window: accessible name of the list of pipeline steps
  'loop/ms': '{value} ms', // Memory loop window: a duration in milliseconds
  'loop/run': 'Run the loop', // Memory loop window: button that runs the pipeline
  'loop/run-again': 'Run it again', // Memory loop window: the same button after a run
  // Memory loop window: the policy the run uses; each flag is on or off, {dims} the embedding's dimensions
  'loop/policy': (p: { novelty: boolean, contradiction: boolean, crystallization: boolean, dims: number }) =>
    `Novelty ${p.novelty ? 'on' : 'off'}, contradiction ${p.contradiction ? 'on' : 'off'}, crystallization ${p.crystallization ? 'on' : 'off'}; ${p.dims}-dimension hash matching in this browser.`,
  'loop/stage-observations': 'observations', // Memory loop: a node of the pipeline diagram, the stage that does the observations it reads (one or two words)
  'loop/stage-embed': 'embed', // Memory loop: a node of the pipeline diagram, the stage that does turning text into vectors (one or two words)
  'loop/stage-novelty': 'novelty', // Memory loop: a node of the pipeline diagram, the stage that does checking what is new (one or two words)
  'loop/stage-contradiction': 'contradiction', // Memory loop: a node of the pipeline diagram, the stage that does checking what contradicts (one or two words)
  'loop/stage-crystallize': 'crystallize', // Memory loop: a node of the pipeline diagram, the stage that does merging into lasting memory (one or two words)
  'loop/stage-report': 'report', // Memory loop: a node of the pipeline diagram, the stage that does the counts it reports (one or two words)
  'loop/observations': 'Observations', // Memory loop report: how many observations went in
  'loop/gated': 'Repeats gated', // Memory loop report: how many repeats were kept out
  'loop/resolved': 'Contradictions resolved', // Memory loop report: how many contradictions were resolved
  'loop/merged': 'Paraphrases merged', // Memory loop report: how many paraphrases were merged
  'loop/live': 'Live records', // Memory loop report: how many records are live
  'loop/live-of': '{live} of {total}', // Memory loop report: live records out of all records
  'loop/ask': 'Ask the memory', // Memory loop window: heading of the question form
  'loop/question-placeholder': 'What is the current API rate limit?', // Memory loop window: example question in the question field
  'loop/question': 'Question', // Memory loop window: accessible name of the question field
  'loop/recall': 'Recall', // Memory loop window: button that recalls answers to the question
  'loop/nothing-recalled': 'Nothing recalled. Run the loop first.', // Memory loop window: the recall found nothing
  'loop/measured': 'Measured, losses included', // Memory loop window: heading of the measurements
  'loop/history': 'History measured on JarenJS {version}, {date}. An ordered cursor returns the same 50 runs while loading 50 records instead of 5,000.', // Memory loop window: paragraph above the speed table; {version} is a JarenJS version, {date} when it was measured
  'loop/runtime': 'Runtime', // Memory loop speed table: column heading for the JavaScript runtime
  'loop/before': 'Before, p95', // Memory loop speed table: column heading for the 95th percentile before the change
  'loop/cursor': 'Cursor, p95', // Memory loop speed table: column heading for the 95th percentile with the cursor
  'loop/faster': 'Faster', // Memory loop speed table: column heading for how many times faster
  'loop/answers': 'Dated answer measurements with {model}: F1 is answer overlap, recall is how much gold evidence reached the model.', // Memory loop window: paragraph above the answer table; {model} is a model id
  'loop/strategy': 'Strategy', // Memory loop answer table: column heading for the memory strategy
  'loop/valid': 'Valid replies', // Memory loop answer table: column heading for valid replies out of planned
  'loop/f-score': 'F1', // Memory loop answer table: column heading for the F1 score (keep F1 unless your language names it otherwise)
  'loop/recall-column': 'Recall', // Memory loop answer table: column heading for evidence recall
  'loop/strategy-long-context': 'Full conversation', // Memory loop answer table: the whole conversation in the prompt
  'loop/strategy-near-raw': 'Raw dialogue', // Memory loop answer table: retrieved raw dialogue turns
  'loop/strategy-rag-observation': 'Observations', // Memory loop answer table: retrieved observations
  'loop/strategy-rag-summary': 'Session summaries', // Memory loop answer table: retrieved session summaries
  'loop/strategy-long-horizon': 'Bounded agent', // Memory loop answer table: an agent with a bounded context
  'loop/strategy-near': 'Historical Tangle', // Memory loop answer table: an earlier Tangle memory
  'loop/note': 'These are historical measurements with different coverage per strategy; they do not establish current answer quality. ', // Memory loop window: note under the answer table, followed by the methods link (keep the trailing space)
  'loop/methods': 'Methods and raw results', // Memory loop window: link to the benchmark's methods and raw results

  // ── Work surfaces ──
  'surfaces/transfer-lead': 'Export your projects, sessions, conversation and game to a file, or import such a file into empty places. Settings and keys never leave this browser. Close other Tangle tabs first.', // Move data window: the paragraph above the export and import controls
} as const;

export type PagesMessageKey = keyof typeof pagesMessagesEn;
/** A language pack: any subset of the keys, each a template string or a closure taking the entry's parameters. */
export type PagesCatalogue = Partial<Record<PagesMessageKey, string | ((params: any) => string)>>;
