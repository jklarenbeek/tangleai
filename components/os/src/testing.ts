/**
 * `@tangleai/os/testing`: the desktop without a browser, for an application's
 * own CI. `checkSuite` says whether a suite document will join a desktop, and
 * `createTestDesktop` runs its applications on a real kernel the way a person's
 * link would: joined with consent, their contracts served by the test's own
 * handlers, the assistant reaching only what the consent allows, proposals
 * filed and decided through the inbox's own path.
 */
import { createKernel, RESERVED_IDS, type Kernel, type Decider, type Outcome } from './kernel.ts';
import { validateManifest, type ModuleManifest } from './manifest.ts';
import { checkCapabilities, type CapabilityDocument } from './capability.ts';
import { memoryStore } from './state.ts';
import { scopesOf } from './consent.ts';
import { originHostProblem } from './shell-origin.ts';
import type { SuiteDocument } from './install-sheet.ts';

export type SuiteIssue = { code: string, level: 'error' | 'warning', path: string, message: string };

/** Contracts every desktop serves itself, which an application may require without providing them. */
const DESKTOP_CONTRACTS = ['tangle_os_header', 'tangle_os_dock', 'tangle_os_files', 'tangle_os_settings'];

/**
 * Whether a suite document will join a desktop. Errors keep it from joining
 * (not a suite, an invalid manifest, an id used twice or reserved, a contract
 * two applications provide, a page on the desktop's own origin, capabilities
 * that disagree); warnings say what will not work as it stands (a contract it
 * requires that nothing in the suite or the desktop provides).
 */
export function checkSuite(value: unknown, options: { desktopOrigin?: string, capabilities?: readonly CapabilityDocument[], provided?: readonly string[] } = {}): SuiteIssue[] {
  const issues: SuiteIssue[] = [];
  const error = (code: string, path: string, message: string) => issues.push({ code, level: 'error', path, message });
  const suite = value as SuiteDocument;
  if (!suite || typeof suite !== 'object' || suite.$suite !== '0.1') { error('OS0150', '/$suite', "not a suite document: '$suite' must be '0.1'"); return issues; }
  if (typeof suite.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(suite.id)) error('OS0150', '/id', 'a suite needs an id of lower-case letters, digits and hyphens');
  if (!Array.isArray(suite.modules) || !suite.modules.length) { error('OS0150', '/modules', 'a suite lists at least one application'); return issues; }
  const manifests: ModuleManifest[] = [];
  const ids = new Map<string, number>(), contracts = new Map<string, string>();
  for (const [i, raw] of suite.modules.entries()) {
    const verdict = validateManifest(raw);
    if (!verdict.ok) { for (const issue of verdict.issues) error(issue.code, `/modules/${i}${issue.path}`, issue.message); continue; }
    const m = verdict.manifest;
    if (ids.has(m.id)) error('OS0151', `/modules/${i}/id`, `'${m.id}' is listed twice (first at /modules/${ids.get(m.id)})`);
    ids.set(m.id, i);
    if ((RESERVED_IDS as readonly string[]).includes(m.id)) error('OS0012', `/modules/${i}/id`, `'${m.id}' is the desktop's own; an application takes another id`);
    for (const [j, c] of (m.provides ?? []).entries()) {
      if (contracts.has(c.id)) error('OS0011', `/modules/${i}/provides/${j}/id`, `the contract '${c.id}' is already provided by '${contracts.get(c.id)}'`);
      else contracts.set(c.id, m.id);
    }
    const host: any = m.host;
    if (host.kind === 'origin') { const problem = originHostProblem(host.url, options.desktopOrigin); if (problem) error('OS0201', `/modules/${i}/host/url`, problem); }
    manifests.push(m);
  }
  if (options.capabilities) for (const issue of checkCapabilities(options.capabilities, manifests)) error(issue.code, issue.path, issue.message);
  const known = new Set([...contracts.keys(), ...DESKTOP_CONTRACTS, ...(options.provided ?? [])]);
  for (const m of manifests) for (const [j, need] of (m.requires ?? []).entries()) {
    if (!known.has(need.contract)) issues.push({ code: 'OS0152', level: 'warning', path: `/modules/${ids.get(m.id)}/requires/${j}`, message: `'${m.id}' requires '${need.contract}', which nothing in the suite or the desktop provides` });
  }
  return issues;
}

type Handlers = Record<string, (input: any) => unknown>;

/**
 * A headless desktop with a suite's applications joined. By default each is
 * joined as a person who allows everything it asks for and lets the assistant
 * use it would; `consent` narrows that per application. `serve` gives the
 * handlers of each contract an application provides (the test stands in for
 * its pages); `assistantGrants` is the host's, `'all'` by default.
 */
export async function createTestDesktop(options: {
  suite?: SuiteDocument,
  modules?: unknown[],
  consent?: Record<string, { scopes?: string[], assistant?: boolean }>,
  serve?: Record<string, Handlers>,
  capabilities?: CapabilityDocument[],
  assistantGrants?: 'all' | string[],
  now?: () => number,
} = {}) {
  const store = memoryStore();
  const kernel: Kernel = createKernel({ assistantGrants: options.assistantGrants ?? 'all', state: store, ...(options.now ? { now: options.now } : {}) });
  await kernel.ready();
  for (const capability of options.capabilities ?? []) {
    const installed = kernel.installCapability(capability, 'suite');
    if (!installed.ok) throw Object.assign(new Error(installed.error.message), { code: installed.error.code });
  }
  const joined: string[] = [];
  for (const raw of [...(options.suite?.modules ?? []), ...(options.modules ?? [])]) {
    const verdict = validateManifest(raw);
    if (!verdict.ok) throw Object.assign(new Error(`${(raw as any)?.id ?? '?'}: ${verdict.issues.map(i => `${i.path} ${i.message}`).join('; ')}`), { code: verdict.issues[0]?.code });
    const m = verdict.manifest, allow = options.consent?.[m.id];
    const outcome = kernel.join(m, { scopes: allow?.scopes ?? scopesOf(m), assistant: allow?.assistant ?? true, ...(options.suite ? { source: `test:${options.suite.id}` } : {}) });
    if (!outcome.ok) throw Object.assign(new Error(`${m.id}: ${outcome.error.message}`), { code: outcome.error.code });
    joined.push(m.id);
  }
  for (const [contract, handlers] of Object.entries(options.serve ?? {})) {
    const owner = kernel.modules().find(m => (m.provides ?? []).some(c => c.id === contract));
    if (!owner) throw Object.assign(new Error(`no joined application provides '${contract}'`), { code: 'OS0011' });
    kernel.provideLocal(owner.id, owner.provides!.find(c => c.id === contract), handlers);
  }
  const decisions: { module: string, decision: Parameters<Decider>[0] }[] = [];
  return {
    kernel,
    /** The applications joined, in order. */
    joined,
    /** What the desktop kept in the person's state (the joined applications and their consent among it). */
    state: () => store.documents(),
    /** One operation as a caller makes it: a module id, `assistant`, or `shell` for the person's own hand. */
    call: (caller: string, contract: string, op: string, input: unknown = {}): Promise<Outcome> => kernel.call(caller, contract, op, input),
    /** What the assistant is offered, as plain data, and a call it makes. */
    assistant: {
      operations: () => kernel.operations('assistant'),
      call: (contract: string, op: string, input: unknown = {}) => kernel.call('assistant', contract, op, input),
    },
    /** File a proposal as an application. */
    propose: (module: string, proposal: unknown) => kernel.propose(module, proposal),
    /** Where an application's decisions arrive; by default each is accepted by the test and recorded. */
    onDecision: (module: string, decide: Decider = () => {}) => kernel.registerDecider(module, 'test', async (decision) => { decisions.push({ module, decision }); return decide(decision); }),
    /** Decide a proposal in the inbox as the person would. */
    decide: (mailId: string, decision: 'accept' | 'reject' | 'answer', response?: unknown) => kernel.decide(mailId, decision, response),
    /** Every decision that reached an application through `onDecision`. */
    decisions: () => decisions.map(d => ({ ...d })),
    mail: () => kernel.mail(),
    ledger: () => kernel.ledger(),
  };
}

export type TestDesktop = Awaited<ReturnType<typeof createTestDesktop>>;
