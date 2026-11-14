/**
 * The kernel: the modules installed on a desktop, in layers; the journal of
 * every change a person made, with undo and a recovery boot; and the one bus
 * between modules — contract operations, checked against grants and written
 * to a ledger. It holds no DOM and no key, so it runs and is tested in Node.
 */
import { applyJSONPatch, createJSONPatch } from '@jarenjs/json/patch';
import { cloneJson } from '@jarenjs/core/object';
import { compileContract } from '@jarenjs/contract';
import { servePort } from '@jarenjs/contract/port';
import { openPortClient } from '@jarenjs/contract/port';
import { openLocalClient } from '@jarenjs/contract/local';
import { toolboxFromContract, createToolbox } from '@tangleai/agents/toolbox';
import { validateManifest, type ModuleManifest, type ManifestIssue } from './manifest.ts';
import { systemContracts } from './contracts.ts';

export type Layer = 'shipped' | 'suite' | 'user';
export type JournalEntry = { seq: number, at: number, layer: Layer, module: string, kind: 'install' | 'patch' | 'remove', patch?: unknown[], inverse?: unknown[] };
export type LedgerEntry = { seq: number, at: number, caller: string, contract: string, op: string, ok: boolean, code?: string, ms: number };
export type MailEnvelope = { id: string, at: number, from: string, to: string, subject: string, body?: string, data?: unknown, read: boolean };
export type Outcome = { ok: true, value: unknown } | { ok: false, error: { code: string, message: string } };
export type KernelEvent = { kind: 'modules' | 'mail' | 'ledger' | 'providers' | 'title', module?: string, title?: string };

type Entry = { base: ModuleManifest, layer: Layer, overlays: { layer: Layer, patch: unknown[] }[] };
/** Any contract client: an object with `invoke`, as every Jaren binding returns. */
export type ContractClient = { invoke: (op: string, input: unknown, ctx?: unknown) => Promise<any>, close?: () => void };
/** A served contract: what `servePort` returns. */
export type ServedContract = { close?: () => void };
type Provider = { module: string, owner: string, contract: any, client: ContractClient };

/** Callers the kernel trusts as the person's own hand: the shell's chrome. */
const TRUSTED = new Set(['shell']);

const refusal = (code: string, message: string): Outcome => ({ ok: false, error: { code, message } });
const scopeOf = (contract: string, op: string) => [`${contract}.${op}`, `${contract}.*`];

/**
 * `assistantGrants`: what the assistant may call — `'all'`, or scopes
 * (`contract.op`, `contract.*`). Nothing by default: a host decides.
 */
export function createKernel(options: { recovery?: boolean, now?: () => number, assistantGrants?: 'all' | string[] } = {}) {
  const now = options.now ?? (() => Date.now());
  const recovery = options.recovery === true;
  const entries = new Map<string, Entry>();
  const journal: JournalEntry[] = [];
  const grants = new Map<string, Set<string>>();
  /** Per contract, its registrations in order; the last one answers. Each belongs to one module and one owner (a window). */
  const providers = new Map<string, Provider[]>();
  const ledger: LedgerEntry[] = [];
  const mail: MailEnvelope[] = [];
  const listeners = new Set<(event: KernelEvent) => void>();
  let seq = 0, mailSeq = 0;

  const emit = (event: KernelEvent) => { for (const listener of listeners) listener(event); };
  const record = (entry: Omit<JournalEntry, 'seq' | 'at'>) => journal.push({ seq: ++seq, at: now(), ...entry });

  function visible(entry: Entry) {
    return !(recovery && entry.layer === 'user');
  }
  function compose(entry: Entry): ModuleManifest {
    let doc: any = cloneJson(entry.base);
    for (const overlay of entry.overlays) {
      if (recovery && overlay.layer === 'user') continue;
      doc = applyJSONPatch(doc, overlay.patch as any);
    }
    return doc;
  }
  function grantRequires(manifest: ModuleManifest, layer: Layer) {
    if (layer === 'user') return; // a module a person or the assistant made asks first
    const set = grants.get(manifest.id) ?? new Set<string>();
    for (const need of manifest.requires ?? []) {
      if (need.operations?.length) for (const op of need.operations) set.add(`${need.contract}.${op}`);
      else set.add(`${need.contract}.*`);
    }
    grants.set(manifest.id, set);
  }

  /** Only the module whose manifest declares a contract may serve it, and only while no other module does. */
  function mayServe(module: string, id: string) {
    const declared = kernel.effective(module)?.provides?.some(c => c.id === id);
    const taken = (providers.get(id) ?? []).find(p => p.module !== module);
    if (!declared || taken) throw Object.assign(new Error(`'${module}' may not serve '${id}'${taken ? `: '${taken.module}' serves it` : ': its manifest does not declare it'}`), { code: 'OS0011' });
  }

  const kernel = {
    recovery,

    /**
     * Install a whole module in a layer. A shipped or suite module is granted
     * what it declares it requires, unless `grant: false`: a suite joined
     * from a link is installed without grants, so a link cannot hand a
     * module access. A contract another module already declares is refused.
     */
    install(value: unknown, layer: Layer = 'shipped', install: { grant?: boolean } = {}): { ok: true, manifest: ModuleManifest } | { ok: false, issues: ManifestIssue[] } {
      const verdict = validateManifest(value);
      if (!verdict.ok) return verdict;
      const { manifest } = verdict;
      const existing = entries.get(manifest.id);
      if (existing && existing.layer !== layer) {
        return { ok: false, issues: [{ code: 'OS0004', path: '/id', message: `'${manifest.id}' is already installed in the ${existing.layer} layer; change it with a patch instead` }] };
      }
      for (const [index, contract] of (manifest.provides ?? []).entries()) {
        const other = [...entries.values()].find(e => e.base.id !== manifest.id && (e.base.provides ?? []).some(c => c.id === contract.id));
        if (other) return { ok: false, issues: [{ code: 'OS0011', path: `/provides/${index}/id`, message: `the contract '${contract.id}' is already provided by '${other.base.id}'` }] };
      }
      entries.set(manifest.id, { base: manifest, layer, overlays: existing?.overlays ?? [] });
      if (install.grant !== false) grantRequires(manifest, layer);
      if (layer === 'user') record({ layer, module: manifest.id, kind: 'install' });
      emit({ kind: 'modules', module: manifest.id });
      return { ok: true, manifest };
    },

    /**
     * Change an installed module with an RFC 6902 patch in a layer above its
     * own. The shipped document is never written; the result must still be a
     * valid manifest, or the patch is refused and nothing changes.
     */
    patch(id: string, patch: unknown[], layer: Layer = 'user'): Outcome {
      const entry = entries.get(id);
      if (!entry) return refusal('OS0005', `no module '${id}'`);
      const before = compose(entry);
      let after: unknown;
      try { after = applyJSONPatch(before, patch as any); }
      catch (error: any) { return refusal('OS0006', `the patch does not apply: ${error?.message ?? error}`); }
      const verdict = validateManifest(after);
      if (!verdict.ok) return refusal('OS0007', `the patched module is not valid: ${verdict.issues.map(i => `${i.path} ${i.message}`).join('; ')}`);
      if ((after as ModuleManifest).id !== id) return refusal('OS0008', 'a patch cannot change a module\'s id');
      entry.overlays.push({ layer, patch: cloneJson(patch) });
      record({ layer, module: id, kind: 'patch', patch: cloneJson(patch), inverse: createJSONPatch(after, before) });
      emit({ kind: 'modules', module: id });
      return { ok: true, value: verdict.manifest };
    },

    /** Remove a module a person installed. Shipped and suite modules are not removable, only hidden by a patch. */
    remove(id: string): Outcome {
      const entry = entries.get(id);
      if (!entry) return refusal('OS0005', `no module '${id}'`);
      if (entry.layer !== 'user') return refusal('OS0009', `'${id}' belongs to the ${entry.layer} layer and cannot be removed`);
      entries.delete(id);
      grants.delete(id);
      record({ layer: 'user', module: id, kind: 'remove', patch: [], inverse: [{ op: 'add', path: '', value: cloneJson(entry.base) }] });
      emit({ kind: 'modules', module: id });
      return { ok: true, value: null };
    },

    /** Undo the person's last change. */
    undo(): Outcome {
      const last = [...journal].reverse().find(e => e.layer === 'user');
      if (!last) return refusal('OS0010', 'nothing to undo');
      journal.splice(journal.indexOf(last), 1);
      const entry = entries.get(last.module);
      if (last.kind === 'install') entries.delete(last.module);
      else if (last.kind === 'patch' && entry) {
        const index = entry.overlays.map(o => o.layer).lastIndexOf('user');
        if (index >= 0) entry.overlays.splice(index, 1);
      }
      else if (last.kind === 'remove') {
        const base = (last.inverse?.[0] as any)?.value as ModuleManifest;
        entries.set(last.module, { base, layer: 'user', overlays: [] });
      }
      emit({ kind: 'modules', module: last.module });
      return { ok: true, value: { undone: last.seq } };
    },

    effective(id: string): ModuleManifest | null {
      const entry = entries.get(id);
      return entry && visible(entry) ? compose(entry) : null;
    },
    modules(): ModuleManifest[] {
      return [...entries.values()].filter(visible).map(compose);
    },
    layerOf(id: string): Layer | null { return entries.get(id)?.layer ?? null; },
    journal(): JournalEntry[] { return cloneJson(journal); },

    grant(caller: string, scope: string) { const set = grants.get(caller) ?? new Set<string>(); set.add(scope); grants.set(caller, set); emit({ kind: 'modules', module: caller }); },
    revoke(caller: string, scope: string) { grants.get(caller)?.delete(scope); emit({ kind: 'modules', module: caller }); },
    grants(): Record<string, string[]> { return Object.fromEntries([...grants].map(([k, v]) => [k, [...v].sort()])); },
    allowed(caller: string, contract: string, op: string): boolean {
      if (TRUSTED.has(caller)) return true;
      if (caller === 'assistant' && options.assistantGrants === 'all') return true;
      const set = caller === 'assistant' ? new Set(Array.isArray(options.assistantGrants) ? options.assistantGrants : []) : grants.get(caller);
      return !!set && scopeOf(contract, op).some(s => set.has(s));
    },

    /**
     * Make a contract callable: the client reaches the module that serves it.
     * Only the module whose manifest declares the contract may serve it
     * (`OS0011` otherwise), so one module cannot take over another's.
     */
    provide(module: string, contractDoc: unknown, client: Provider['client'], owner = module) {
      const contract = compileContract(contractDoc as any);
      const id = contract.doc?.id ?? (contractDoc as any).id;
      mayServe(module, id);
      providers.set(id, [...(providers.get(id) ?? []).filter(p => p.owner !== owner), { module, owner, contract, client }]);
      emit({ kind: 'providers', module });
    },
    /** A shipped module serves a contract from inside the page. */
    provideLocal(module: string, contractDoc: unknown, handlers: Record<string, (input: any) => unknown>, owner = module) {
      mayServe(module, (contractDoc as any)?.id);
      const contract = compileContract(contractDoc as any);
      kernel.provide(module, contractDoc, openLocalClient(contract, handlers as any) as any, owner);
    },
    /** Withdraw what one owner (a window) registered; another window of the same module keeps serving. */
    withdraw(module: string, owner = module) {
      for (const [id, list] of providers) {
        const kept = list.filter(p => !(p.module === module && p.owner === owner));
        if (kept.length) providers.set(id, kept); else providers.delete(id);
      }
      emit({ kind: 'providers', module });
    },
    providers(): { contract: string, module: string, operations: string[] }[] {
      return [...providers].map(([contract, list]) => { const p = list.at(-1)!; return { contract, module: p.module, operations: Object.keys(p.contract.doc?.operations ?? {}) }; });
    },

    /** The bus: one operation of one contract, for one caller, under grants, into the ledger. */
    async call(caller: string, contract: string, op: string, input: unknown = {}): Promise<Outcome> {
      const started = now();
      const write = (outcome: Outcome) => {
        ledger.push({ seq: ledger.length + 1, at: started, caller, contract, op, ok: outcome.ok, ...(outcome.ok ? {} : { code: outcome.error.code }), ms: now() - started });
        emit({ kind: 'ledger' });
        return outcome;
      };
      const provider = providers.get(contract)?.at(-1);
      if (!provider) return write(refusal('OS0102', `no module serves '${contract}'`));
      if (!kernel.allowed(caller, contract, op)) return write(refusal('OS0101', `'${caller}' is not granted ${contract}.${op}`));
      try {
        const outcome = await provider.client.invoke(op, input);
        if (outcome?.ok) return write({ ok: true, value: outcome.value });
        return write(refusal(outcome?.error?.code ?? 'OS0103', outcome?.error?.message ?? 'the operation failed'));
      } catch (error: any) {
        return write(refusal('OS0103', String(error?.message ?? error)));
      }
    },
    ledger(): LedgerEntry[] { return cloneJson(ledger); },

    sendMail(from: string, envelope: { to?: string, subject: string, body?: string, data?: unknown }): MailEnvelope {
      const item: MailEnvelope = { id: `m${++mailSeq}`, at: now(), from, to: envelope.to ?? 'person', subject: envelope.subject, ...(envelope.body !== undefined ? { body: envelope.body } : {}), ...(envelope.data !== undefined ? { data: cloneJson(envelope.data) } : {}), read: false };
      mail.push(item);
      emit({ kind: 'mail', module: from });
      return item;
    },
    mail(): MailEnvelope[] { return cloneJson(mail); },
    markRead(id: string) { const item = mail.find(m => m.id === id); if (item && !item.read) { item.read = true; emit({ kind: 'mail' }); } },

    /**
     * Serve `tangle_os` to one module over its own port. The module's id is
     * bound here, by the port it was handed, never taken from its input.
     */
    serveModule(module: string, port: any, hooks: { setTitle?: (title: string) => void } = {}): ServedContract {
      const { os } = systemContracts();
      return servePort(os, {
        'os.call': async ({ contract, op, input }: any) => kernel.call(module, contract, op, input ?? {}),
        'mail.send': ({ to, subject, body, data }: any) => ({ id: kernel.sendMail(module, { to, subject, body, data }).id }),
        'window.title': ({ title }: any) => { hooks.setTitle?.(title); emit({ kind: 'title', module, title }); return {}; },
      }, { channel: port }) as ServedContract;
    },

    /** Open a client on a port where a module serves one of its contracts, and make it callable. */
    connectProvider(module: string, contractDoc: unknown, port: any, timeoutMs = 10_000, owner = module): ContractClient {
      mayServe(module, (contractDoc as any)?.id);
      const contract = compileContract(contractDoc as any);
      const client = openPortClient(contract, { channel: port, timeoutMs }) as unknown as ContractClient;
      port.start?.();
      kernel.provide(module, contractDoc, client, owner);
      return client;
    },

    /**
     * The assistant's tools: every served contract the assistant may call, as
     * model tools, each routed through `call` so grants and the ledger apply.
     * Names are `<contract>__<operation>` with dots as underscores.
     */
    tools(caller = 'assistant') {
      const toolbox = createToolbox();
      for (const [id, list] of providers) {
        const provider = list.at(-1)!;
        const ops = Object.keys(provider.contract.doc?.operations ?? {}).filter(op => kernel.allowed(caller, id, op));
        if (ops.length === 0) continue;
        const client = { invoke: (op: string, input: unknown) => kernel.call(caller, id, op, input) };
        toolboxFromContract(provider.contract, client, { toolbox, ops, name: (op: string) => `${id}__${op.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64) } as any);
      }
      return toolbox;
    },

    subscribe(listener: (event: KernelEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return kernel;
}

export type Kernel = ReturnType<typeof createKernel>;
