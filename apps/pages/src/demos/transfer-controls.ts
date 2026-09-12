import { exportBrowserData, importBrowserData, validateTransfer, TRANSFER_MEMBERS } from './storage-transfer.ts';
import type { TransferSlots } from './storage-transfer.ts';
/** Browser-only UI. Import closes this host before acquiring the destination ledger lock. */
export function mountTransferControls(node: HTMLElement | null, options: {
  slots: TransferSlots; secrets(): string[]; close(): Promise<unknown> | unknown;
  download(name: string, text: string): unknown; locks?: LockManager; reload(): void;
}) {
  if (!node) return () => {};
  const document = node.ownerDocument, listeners: Array<() => void> = [];
  const listen = (element: HTMLElement, type: string, fn: EventListener) => { element.addEventListener(type, fn); listeners.push(() => element.removeEventListener(type, fn)); };
  const selected = new Map<string, HTMLInputElement>();
  for (const member of TRANSFER_MEMBERS) {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = true;
    label.append(input, ' ' + member); node.append(label); selected.set(member, input);
  }
  const exportButton = document.createElement('button'); exportButton.textContent = 'Export browser data'; node.append(exportButton);
  const fileLabel = document.createElement('label'); fileLabel.textContent = 'Import browser data ';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json'; fileLabel.append(file); node.append(fileLabel);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); node.append(status);
  const reload = document.createElement('button'); reload.textContent = 'Resume Tangle'; reload.hidden = true; node.append(reload);
  listen(reload, 'click', () => options.reload());
  listen(exportButton, 'click', () => { try {
    const value = exportBrowserData(options.slots, TRANSFER_MEMBERS.filter(key => selected.get(key)!.checked), options.secrets());
    options.download('tangle-browser-data.json', JSON.stringify(value, null, 2)); status.textContent = 'Selected data exported. Settings are excluded.';
  } catch (error) { status.textContent = String(error); } });
  let busy = false;
  listen(file, 'change', () => { void (async () => {
    if (busy || !file.files?.[0]) return; busy = true; file.disabled = true;
    try {
      const value = validateTransfer(JSON.parse(await file.files[0].text()), options.secrets());
      if (!options.locks) throw new Error('Import requires browser locks so another ledger writer cannot race the transfer.');
      await options.close(); reload.hidden = false;
      const result = await options.locks.request('ledger-owner:tangle-ai-ledger', { ifAvailable: true }, lock => {
        if (!lock) throw new Error('Another Tangle tab owns the ledger. Close that tab before importing.');
        return options.locks!.request('ledger:tangle-ai-ledger', () => importBrowserData(value, options.slots, options.secrets()));
      });
      status.textContent = `Imported ${result.written.length} slots; ${result.unchanged.length} already matched. Resume Tangle to use the imported data.`;
    } catch (error) { status.textContent = String(error); }
    finally { busy = false; file.disabled = false; file.value = ''; }
  })(); });
  return () => { for (const remove of listeners) remove(); node.replaceChildren(); };
}
