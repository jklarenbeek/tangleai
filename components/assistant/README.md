# @tangleai/assistant

Reusable assistant state, actions and request lifecycle. The headless root imports
no renderer or DOM. Hosts inject their toolbox, system instructions, state access,
settings/transcript stores and ledger. Dispose aborts requests and releases the
optional owned storage; cancel prevents late stream results from reappearing.

```js
import { mountAssistant } from '@tangleai/assistant/component';
import '@tangleai/assistant/styles/assistant.css';
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
