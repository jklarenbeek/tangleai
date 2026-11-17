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
import { validateManifest, type ModuleManifest, type ManifestIssue } from './manifest.ts';
import { JarenValidator } from '@jarenjs/validate';
import { systemContracts, PROPOSAL_SCHEMA } from './contracts.ts';

export type Layer = 'shipped' | 'suite' | 'user';
export type JournalEntry = { seq: number, at: number, layer: Layer, module: string, kind: 'install' | 'patch' | 'remove', patch?: unknown[], inverse?: unknown[] };
export type LedgerEntry = { seq: number, at: number, caller: string, contract: string, op: string, ok: boolean, code?: string, ms: number };
/**
 * A proposal in the inbox, kept by the kernel: its kind, status and sender come
 * from the module's port and manifest, never from what the module wrote.
 */
export type Proposal = {
  id: string, kind: string, status: 'pending' | 'deciding' | 'accepted' | 'rejected',
  summary?: string, payload?: unknown, evidence?: { label: string, href?: string }[], revision?: string,
  /** Why the last decision did not take effect; the proposal stays pending. */
  reason?: { code: string, message: string },
};
export type MailEnvelope = { id: string, at: number, from: string, to: string, subject: string, body?: string, data?: unknown, read: boolean, proposal?: Proposal };
/** How a decision reaches the module that filed the proposal: its own control channel, never the bus. */
export type Decider = (decision: { id: string, kind: string, decision: 'accept' | 'reject', revision?: string, payload?: unknown }) => Promise<{ refused?: string } | void> | { refused?: string } | void;
export type Outcome = { ok: true, value: unknown } | { ok: false, error: { code: string, message: string } };
export type KernelEvent = { kind: 'modules' | 'mail' | 'ledger' | 'providers' | 'title' | 'settings', module?: string, title?: string };
/**
 * Where the desktop keeps the values of a `form` module's settings (a module
 * with no server of its own). A host passes its own storage; the default keeps
 * them for the page's lifetime. Never secrets: a form refuses them.
 */
export type SettingsStore = { read(module: string): unknown, write(module: string, values: unknown): void };

type Entry = { base: ModuleManifest, layer: Layer, overlays: { layer: Layer, patch: unknown[] }[] };
/** Any contract client: an object with `invoke`, as every Jaren binding returns. */
export type ContractClient = { invoke: (op: string, input: unknown, ctx?: unknown) => Promise<any>, close?: () => void };
/** A served contract: what `servePort` returns. */
export type ServedContract = { close?: () => void };
type Provider = { module: string, owner: string, contract: any, client: ContractClient };
/** One operation a caller may call, as plain data: what any agent stack needs to offer it as a tool. */
export type GrantedOperation = { tool: string, contract: string, op: string, kind: string, doc?: string, input?: unknown, output?: unknown };
/**
 * The host's tool builder, so the kernel names no agent runtime: Tangle's
 * `@tangleai/agents/toolbox` fits as it is (`createKernel({ tools: toolbox })`).
 */
export type ToolBuilder = {
  createToolbox: () => any,
  toolboxFromContract: (contract: any, client: { invoke: (op: string, input: unknown) => Promise<unknown> }, options: { toolbox: any, ops: string[], name: (op: string) => string }) => unknown,
};
/** A tool's name: `<contract>__<operation>` with every character outside [A-Za-z0-9_-] as `_`, at most 64. */
export const toolName = (contract: string, op: string) => `${contract}__${op.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

/** Callers the kernel trusts as the person's own hand: the shell's chrome. */
const TRUSTED = new Set(['shell']);

const refusal = (code: string, message: string): Outcome => ({ ok: false, error: { code, message } });
const scopeOf = (contract: string, op: string) => [`${contract}.${op}`, `${contract}.*`];

/**
 * `assistantGrants`: what the assistant may call — `'all'`, or scopes
 * (`contract.op`, `contract.*`). Nothing by default: a host decides.
 */
export function createKernel(options: { recovery?: boolean, now?: () => number, assistantGrants?: 'all' | string[], tools?: ToolBuilder, settings?: SettingsStore } = {}) {
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
  /** Per module, the windows that can carry a decision to it, most recent last. */
  const deciders = new Map<string, { owner: string, decide: Decider }[]>();
  let proposalCheck: ((value: unknown) => any) | null = null;
  const kept = new Map<string, unknown>();
  const store: SettingsStore = options.settings ?? { read: (module) => kept.get(module), write: (module, values) => { kept.set(module, values); } };
  const checkers = new Map<string, { key: string, check: (value: unknown) => any }>();
  /** The compiled schema of a form module's settings, compiled again only when its manifest changes it. */
  function checker(module: string, schema: Record<string, unknown>) {
    const key = JSON.stringify(schema), known = checkers.get(module);
    if (known?.key === key) return known.check;
    const check = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' }).compile(schema) as any;
    checkers.set(module, { key, check });
    return check;
  }

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
    /** A `form` module's settings as the person set them (`{}` until they do); `{}` for a module that keeps its own. */
    settings(module: string): unknown {
      const manifest = kernel.effective(module);
      if (manifest?.settings?.kind !== 'form') return {};
      return cloneJson(store.read(module) ?? {});
    },

    /**
     * The person sets a `form` module's settings in the desktop's Settings:
     * checked against the module's schema, kept, and reported (`settings`).
     * Refused for a module that keeps its own (`OS0105`) or values its schema
     * refuses (`OS0106`).
     */
    setSettings(module: string, values: unknown): Outcome {
      const manifest = kernel.effective(module);
      if (manifest?.settings?.kind !== 'form') return refusal('OS0105', `'${module}' keeps its own settings`);
      const outcome = checker(module, manifest.settings.schema)(values);
      const valid = typeof outcome === 'object' && outcome !== null ? outcome.valid : outcome === true;
      if (!valid) {
        const first = (outcome?.errors ?? [])[0];
        return refusal('OS0106', `the settings of '${module}' are refused${first ? `: ${first.instancePath || '/'} ${first.message ?? ''}`.trimEnd() : ''}`);
      }
      store.write(module, cloneJson(values));
      emit({ kind: 'settings', module });
      return { ok: true, value: cloneJson(values) };
    },

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
     * File a proposal in the inbox for the person. The kind must be one the
     * module's manifest declares (`OS0107`) and the proposal must match its
     * schema (`OS0108`); filing the same id again replaces it, pending again.
     * The module keeps its proposals: the inbox lives as long as the page.
     */
    propose(module: string, input: unknown): Outcome {
      const manifest = kernel.effective(module);
      if (!manifest) return refusal('OS0108', `no module '${module}'`);
      proposalCheck ??= new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' }).compile(PROPOSAL_SCHEMA as any) as any;
      const outcome = proposalCheck!(input);
      if (!(typeof outcome === 'object' && outcome !== null ? outcome.valid : outcome === true)) {
        const first = (outcome?.errors ?? [])[0];
        return refusal('OS0108', `the proposal is refused${first ? `: ${first.instancePath || '/'} ${first.message ?? ''}`.trimEnd() : ''}`);
      }
      const p = input as { id: string, kind: string, title: string, summary?: string, payload?: unknown, evidence?: { label: string, href?: string }[], revision?: string };
      if (!(manifest.proposals ?? []).some(d => d.kind === p.kind)) return refusal('OS0107', `'${module}' declares no proposals of kind '${p.kind}'`);
      const proposal: Proposal = { id: p.id, kind: p.kind, status: 'pending',
        ...(p.summary !== undefined ? { summary: p.summary } : {}), ...(p.payload !== undefined ? { payload: cloneJson(p.payload) } : {}),
        ...(p.evidence !== undefined ? { evidence: cloneJson(p.evidence) } : {}), ...(p.revision !== undefined ? { revision: p.revision } : {}) };
      const existing = mail.find(m => m.from === module && m.proposal?.id === p.id);
      if (existing?.proposal?.status === 'deciding') return refusal('OS0111', `the proposal '${p.id}' is being decided`);
      if (existing) { existing.subject = p.title; existing.proposal = proposal; existing.read = false; existing.at = now(); }
      else mail.push({ id: `m${++mailSeq}`, at: now(), from: module, to: 'person', subject: p.title, read: false, proposal });
      emit({ kind: 'mail', module });
      return { ok: true, value: { id: p.id } };
    },

    /** Take back a module's pending proposal. */
    withdrawProposal(module: string, id: string): Outcome {
      const index = mail.findIndex(m => m.from === module && m.proposal?.id === id);
      if (index < 0) return refusal('OS0109', `no proposal '${id}' from '${module}'`);
      if (mail[index].proposal!.status !== 'pending') return refusal('OS0111', `the proposal '${id}' is ${mail[index].proposal!.status}`);
      mail.splice(index, 1);
      emit({ kind: 'mail', module });
      return { ok: true, value: {} };
    },

    /**
     * Where a module's decisions go while one of its windows can take them:
     * the shell registers the window's control channel. Returns the release.
     */
    registerDecider(module: string, owner: string, decide: Decider) {
      const list = (deciders.get(module) ?? []).filter(d => d.owner !== owner);
      list.push({ owner, decide });
      deciders.set(module, list);
      return () => { const kept = (deciders.get(module) ?? []).filter(d => d.owner !== owner); if (kept.length) deciders.set(module, kept); else deciders.delete(module); };
    },

    /**
     * The person accepts or rejects a proposal. The decision goes to the
     * module that filed it, over its own channel, never as a contract
     * operation, so neither the assistant nor another module can decide. One
     * decision at a time; a module that is not running (`OS0110`), refuses
     * (`OS0112`, e.g. its revision moved) or fails leaves the proposal pending
     * with the reason.
     */
    async decide(mailId: string, decision: 'accept' | 'reject'): Promise<Outcome> {
      const item = mail.find(m => m.id === mailId);
      const p = item?.proposal;
      if (!item || !p) return refusal('OS0109', `no proposal '${mailId}'`);
      if (p.status !== 'pending') return refusal('OS0111', `the proposal is ${p.status}`);
      const settle = (status: Proposal['status'], reason?: Proposal['reason']) => {
        item.proposal = { ...item.proposal!, status, ...(reason ? { reason } : {}) };
        if (!reason) delete item.proposal.reason;
        emit({ kind: 'mail', module: item.from });
      };
      const target = (deciders.get(item.from) ?? []).at(-1);
      if (!target) { settle('pending', { code: 'OS0110', message: `'${item.from}' is not running` }); return refusal('OS0110', `'${item.from}' is not running`); }
      settle('deciding');
      try {
        const answer = await target.decide({ id: p.id, kind: p.kind, decision, ...(p.revision !== undefined ? { revision: p.revision } : {}), ...(p.payload !== undefined ? { payload: cloneJson(p.payload) } : {}) });
        if (answer && typeof answer.refused === 'string') { settle('pending', { code: 'OS0112', message: answer.refused }); return refusal('OS0112', answer.refused); }
      } catch (error: any) {
        const message = String(error?.message ?? error);
        settle('pending', { code: 'OS0112', message }); return refusal('OS0112', message);
      }
      settle(decision === 'accept' ? 'accepted' : 'rejected');
      return { ok: true, value: { status: item.proposal!.status } };
    },

    /**
     * Serve `tangle_os` to one module over its own port. The module's id is
     * bound here, by the port it was handed, never taken from its input.
     */
    serveModule(module: string, port: any, hooks: { setTitle?: (title: string) => void, openSettings?: () => void } = {}): ServedContract {
      const { os } = systemContracts();
      return servePort(os, {
        'os.call': async ({ contract, op, input }: any) => kernel.call(module, contract, op, input ?? {}),
        'mail.send': ({ to, subject, body, data }: any) => ({ id: kernel.sendMail(module, { to, subject, body, data }).id }),
        'mail.propose': (input: any) => { const outcome = kernel.propose(module, input); if (!outcome.ok) throw Object.assign(new Error(outcome.error.message), { code: outcome.error.code }); return outcome.value as { id: string }; },
        'mail.withdraw': ({ id }: any) => { const outcome = kernel.withdrawProposal(module, id); if (!outcome.ok) throw Object.assign(new Error(outcome.error.message), { code: outcome.error.code }); return {}; },
        'window.title': ({ title }: any) => { hooks.setTitle?.(title); emit({ kind: 'title', module, title }); return {}; },
        'settings.get': () => ({ values: kernel.settings(module) }),
        'settings.open': () => { hooks.openSettings?.(); return {}; },
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
     * Every served operation `caller` may call, as plain data (tool name,
     * contract, operation, kind, description, input and output schemas): an
     * application with its own agent runtime offers these as tools and calls
     * back through `call`, so grants and the ledger still apply.
     */
    operations(caller = 'assistant'): GrantedOperation[] {
      const out: GrantedOperation[] = [];
      for (const [id, list] of providers) {
        const ops = list.at(-1)!.contract.doc?.operations ?? {};
        for (const [op, spec] of Object.entries<any>(ops)) if (kernel.allowed(caller, id, op))
          out.push({ tool: toolName(id, op), contract: id, op, kind: spec?.kind ?? 'read', ...(spec?.doc ? { doc: spec.doc } : {}), ...(spec?.input ? { input: spec.input } : {}), ...(spec?.output ? { output: spec.output } : {}) });
      }
      return out;
    },

    /**
     * The assistant's tools: every served contract the assistant may call, as
     * model tools built by the host's tool builder, each routed through `call`
     * so grants and the ledger apply. Names are {@link toolName}.
     */
    tools(caller = 'assistant') {
      if (!options.tools) throw new Error('OS0301: this desktop was created without a tool builder (createKernel({ tools }))');
      const toolbox = options.tools.createToolbox();
      for (const [id, list] of providers) {
        const provider = list.at(-1)!;
        const ops = Object.keys(provider.contract.doc?.operations ?? {}).filter(op => kernel.allowed(caller, id, op));
        if (ops.length === 0) continue;
        const client = { invoke: (op: string, input: unknown) => kernel.call(caller, id, op, input) };
        options.tools.toolboxFromContract(provider.contract, client, { toolbox, ops, name: (op: string) => toolName(id, op) });
      }
      return toolbox;
    },

    subscribe(listener: (event: KernelEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return kernel;
}

export type Kernel = ReturnType<typeof createKernel>;
