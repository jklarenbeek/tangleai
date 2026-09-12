# Moving selected browser data

Jaren and Tangle use separate browser origins and storage keys. Tangle starts
fresh; it never reads another origin. The original Jaren data remains there.
Provider settings and API keys are not part of this transfer. Review transcripts
and saved documents for secrets you pasted yourself before sharing any file.
The exporter also refuses credential fields and the configured key appearing in
selected data. It does not rewrite ledger content, IDs, counters or metadata.

In Tangle Pages, open **Move browser data**, select the desired members and
choose **Export browser data**. This exports the saved transcript, ledger,
adventure save and saved Studio/Playground work. Unsaved editor buffers are not
part of a browser-storage export; save or download those documents first.

For the old Jaren origin, open its page, stop pending requests, close other tabs
on that origin, and run this explicit snippet in that page's developer console.
Change `selected` to include only the data you want. It reads the named slots
only. `projects` receives the old shared IDE store, including legacy playground
records; Tangle's loader recognizes their original record shapes.

```js
const selected = ['transcript', 'ledger', 'game', 'projects'];
const keys = { transcript: 'jaren-ai-chat', ledger: 'jaren-ai-ledger',
  game: 'jaren-game', projects: 'jaren-ide' };
const data = {};
for (const member of selected) {
  if (!Object.hasOwn(keys, member)) throw Error('Unknown selected member');
  const raw = localStorage.getItem(keys[member]);
  if (raw !== null) data[member] = member === 'game' ? raw : JSON.parse(raw);
}
const key = JSON.parse(localStorage.getItem('jaren-ai') ?? 'null')?.apiKey;
function inspect(value) {
  if (typeof value === 'string' && key && value.includes(key))
    throw Error('A configured credential appears in the selected data');
  if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) {
    if (/^(?:api[-_]?key|authorization|access[-_]?token|password|secret|__proto__|constructor|prototype)$/i.test(name))
      throw Error('A private or unsafe field appears in the selected data: ' + name);
    inspect(child);
  }
}
inspect(data);
const file = JSON.stringify({ format: 'tangle-browser-data', version: 1, data }, null, 2);
const url = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
const link = document.createElement('a'); link.href = url;
link.download = 'jaren-browser-data.json'; document.body.append(link);
link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
```

Close other Tangle tabs. In Tangle's **Move browser data**, choose the file under
**Import browser data**. Import stops local requests and releases local writer
ownership, then acquires the destination ledger locks. A different existing
slot is refused before any writes. Use a fresh browser profile, or explicitly
export and clear that particular destination slot first. Identical slots are
left unchanged, so importing the same file twice makes no extra writes or IDs.
Choose **Resume Tangle** after import to reconstruct the hosts from storage.

Browser slots do not provide a transaction across all five stores. A failed
write reports its slot and completed writes. Retrying the same file skips
completed slots and resumes safely. Storage quotas, denied browser locks and
malformed data remain visible failures. No database-format conversion, new
schema identity, silent overwrite or cross-origin access is involved.

The Pages ledger requests one writer on every browser, through injected Web
Locks; it uses no browser sniffing. A second writer is refused until the owner
closes. Context's reusable adapter also supports atomic multi-tab mode when the
host qualifies its storage coherence. Chromium and Firefox exercise that mode
in the retained ledger browser suite; WebKit exercises explicit owner election.
Without locks, atomic retention is refused rather than reported durable.
