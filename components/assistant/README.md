# @tangleai/assistant

Reusable assistant state, actions and request lifecycle. The headless root imports
no renderer or DOM. Hosts inject their toolbox, system instructions, state access,
settings/transcript stores and ledger. Dispose aborts requests and releases the
optional owned storage; cancel prevents late stream results from reappearing.

```js
import { mountAssistant } from '@tangleai/assistant/component';
import '@tangleai/assistant/styles/assistant.css';
import '@jarenjs/md/styles/md.css';
const assistant = mountAssistant(document.querySelector('#assistant'), {
  title: 'My workspace', capabilities: ['Inspect a document'], toolbox,
  system: 'Help with the tools this workspace provides.',
  aiStorage: settingsSlot, aiChat: transcriptSlot, ledger,
  onDispose: () => ownedLedgerStorage.close(),
});
assistant.update({ title: 'Review workspace' }); // retains the draft and request
await assistant.dispose();
```

`mountAssistant(node, options)` returns `read`, `dispatch`, `subscribe`,
`update` and asynchronous, idempotent `dispose`, plus its headless controller.
`createAssistantWidget(options)` supplies app widget mount/update/unmount hooks.
Presentation options include title, launcher text, intro, capabilities and
settings hint. The host supplies its toolbox, system prompt, provider fetch and
settings/transcript slots; omitted slots and ledger are in memory. Slot writes
must throw or return false on failure. An injected ledger remains host-owned
unless `onDispose` explicitly closes it. Never put provider settings in a data
export. See [browser data transfer](../../docs/migrations/jaren-ai/BROWSER_DATA.md).

The root exports state/actions/controller without rendering dependencies.
`/component` imports the Jaren app, Markdown and Mermaid renderers. CSS selectors
are scoped to `.tangle-assistant`; host tokens have fallbacks. Each mount owns
its datalist IDs, draft, stream and fragment links. Cancelling or disposing
aborts current requests and ignores late results from non-cooperating providers.
Disposed controls cannot dispatch into the host. Presentation updates retain
input nodes and do not reset selection or the active request.

The controller exposes its current request `signal`. Hosts can combine it with
their own lifetime signal for child authoring requests. Cancellation fences
later tool calls and Pages refuses late authoring results before publication.

Markdown replies use Jaren's native page-break marker: a standalone
`<!-- pagebreak -->` line renders as an accessible separator. Import the Jaren
Markdown stylesheet for its dashed screen divider and print boundary. Code and
inline markers retain their ordinary Markdown meaning. Print pagination follows
the host layout; the assistant's fixed, scrolling panel is not a document export
service. Hosts may provide `renderMarkdown` for a different presentation.

## View-only entry

`@tangleai/assistant/view` renders the same panel for a host that runs the
assistant elsewhere, typically on its server beside the provider keys. The host
reports its run as state; the view hands the person's intents back. It keeps no
clock, request or poll of its own.

```js
import { mountAssistantView } from '@tangleai/assistant/view';
import { nl } from '@tangleai/assistant/messages/nl';
import '@tangleai/assistant/styles/assistant.css';
import '@jarenjs/md/styles/md.css';
const view = mountAssistantView(document.querySelector('#assistant'), {
  messages: nl, title: 'Bestellingen',
  transport: { start: (message, { conversation, signal }) => api.start(message, conversation, signal), cancel: runId => api.cancel(runId) },
  state: { status: 'idle', messages: [] },
  onIntent: intent => { if (intent.type === 'link') openProposal(intent.id); },
});
view.update({ status: 'running', runId, messages, progress: { step: 2, stage: 'Orders lezen' } });
await view.dispose(); // detaches; the run goes on
```

The report is a closed object: `status` (`idle`, `running`, `succeeded`,
`failed` or `cancelled`), `runId`, `messages` (user turns render as text,
assistant turns as Markdown), `pending` (a reply still streaming, shown as plain
text), `progress` (`step`, `stage`), `links` (`id`, `label`), `notice`, `error`
(shown inside the catalogue's error frame) and `conversation` (JSON at most
64 levels deep, handed back to `start`). `update` replaces the whole report,
and a member the view does not know, or one of the wrong type, throws a
`TypeError` that names it.
`transport.start(message, { conversation, signal })` returns the run id or a
promise of it: the composer waits until it settles or the host reports the run
running, and a rejection shows its reason (an `Error`'s message or a string;
otherwise the sentence alone) and keeps the draft. Text typed meanwhile stays.
`transport.cancel(runId)` is offered while the host reports a running run with
an id, once per report: the next report answers it, and a rejection that
arrives first shows why and re-enables the control while that run is still
running. `onIntent` receives `{ type: 'open' }` and `{ type: 'close' }` from
the launcher and `{ type: 'link', id }` from a link; the view navigates nowhere
itself. `dispose` aborts a start in flight through its `signal`, removes the
DOM and listeners, and never cancels the host's run.
`createAssistantViewWidget(options)` supplies the app widget hooks.

The view's static imports reach no `@tangleai/models`, `@tangleai/agents` or
`@tangleai/context` module, and its browser bundle parses none.
`test/assistant/import-graph.test.ts` walks the source graph, and
`npm run test:tree-shaking` bundles every entry, counting each parsed input, against the sizes
pinned in `docs/migrations/jaren-ai/assistant-bundles.json`. Both checks are
needed: those packages declare `"sideEffects": false`, so a bundler may skip a
module that is imported but unused. The bundle shows that no such module is
loaded, the graph that none is imported.

[`examples/assistant-view.ts`](../../examples/assistant-view.ts) feeds the view
from Jaren's `createRunObservation` or from a polled run summary
(`GET {base}/runs/:id` answering `{ status, stage, steps, answer, proposals,
usage, stopReason, error }`), and starts and stops runs over HTTP with a
request timeout. The observation feed stops at the page that ends the run and,
given a `wait`, resumes after a failed read; `test/assistant/view-host.test.ts`
runs it end to end.

## Messages and languages

Every sentence the panel and the view show comes from one catalogue. Pass
`messages` to `mountAssistant`, `mountAssistantView`, either widget or
`createAssistantController`. `@tangleai/assistant/messages` exports the English
catalogue `assistantMessagesEn` and `createAssistantMessages`; `/messages/nl`,
`/messages/de`, `/messages/fr`, `/messages/es`, `/messages/pt` and
`/messages/ar` export formal Dutch, German, French, Spanish, Brazilian
Portuguese and Modern Standard Arabic packs with exactly the English keys. A
host catalogue merges over English: a key it leaves out renders English, and an
unknown key throws when the catalogue is built. Presentation options take
precedence over the catalogue. Changing language means mounting with another
catalogue; turns already in the transcript stay as they were written. The
default system instruction and the cancelled-tool result are written to the
model, never shown, and stay English; a host sets `system` in its own language.

Counts follow each language's plural rules and digits; Arabic phrases every
count around a fixed count noun and keeps Latin digits. Both mounts take `lang`
and `dir` (`ltr`, `rtl` or `auto`) and write them on the assistant's root;
without them the page's language and direction apply. The stylesheet sets no
physical side, so with `dir: 'rtl'` the launcher and the panel sit at the left
edge and the panel's own layout mirrors. A Markdown reply keeps the sides
Jaren's Markdown stylesheet sets (list indents, the quote rule, table
alignment) until that stylesheet is direction-neutral.

What a translated render still shows in English, by owner: product names and
the setting examples, as written; text another package wrote, such as a
provider error, shown verbatim inside the catalogue's error frame; and Jaren's
Markdown accessibility labels for heading permalinks, page breaks and footnote
back-references, which its renderer writes (only the footnotes heading is
configurable). `test/assistant/census.test.ts` renders every pinned state in
every pack and fails on any other English.
