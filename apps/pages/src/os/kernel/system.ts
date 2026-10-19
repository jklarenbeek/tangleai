/**
 * The system call table: `os.contract.json` compiled once, served
 * in-process, and the one way anything — the human's buttons, a local
 * member, a language model behind WebMCP or the Tangle oracle — asks the
 * OS to do something.
 *
 * Every call is validated on the way in and on the way out by the same
 * compiled contract, so a model's malformed proposal is refused with a
 * pointer to the member that broke it before any handler runs, and a
 * handler that answered off-contract is a fault, not a render. Three
 * operations are the human's alone — the veto, the early approval and
 * the repeal — and carry `audience: "server"`: they are served like the
 * rest but kept out of every projection, so no tool list an agent is
 * handed contains them. The input schema says the same thing a second
 * time (`by` must be `human`).
 */

import { compileContract } from '@jarenjs/contract';
import { openLocalClient } from '@jarenjs/contract/local';
import { contractTools } from '@jarenjs/contract/project';
import { JarenValidator } from '@jarenjs/validate';
import { renderToString } from '@jarenjs/view';
import contractDoc from '../documents/os.contract.json' with { type: 'json' };
import { MEMBERS, describeChange, fitsProgram, isTempo } from './council.ts';
import type { Proposal } from './council.ts';
import { programStates, isProgram } from './program.ts';
import { isWorld } from './machine.ts';
import { renderArt, FORMATS } from './exports.ts';
import { roundMeasure } from './metrics.ts';
import { QUEUE_MAX } from './session.ts';
import type { CouncilDriver } from './session.ts';
import { sceneOf } from '../app/scene.ts';
import { stillFrame } from '../stage/widget.ts';

/** The OS contract, compiled with a collecting validator. */
export const osContract: any = compileContract(contractDoc as any, { validator: new JarenValidator({ collectErrors: true }) } as any);

/** The operations any caller may be told about — every one but the
 * human's, read from the document's own policy. */
const PUBLIC_OPERATIONS: readonly string[] = Object.freeze(Object.entries(contractDoc.operations)
  .filter(([, op]) => (op as any).policy?.audience !== 'server')
  .map(([id]) => id));

/** A proposal validator compiled from the contract's own `$defs`, for
 * proposals that arrive by another road than `council.propose` (the
 * oracle seam). */
const proposalCheck = new JarenValidator().compile({ $defs: contractDoc.$defs, $ref: '#/$defs/Proposal' } as any);

export const isProposal = (proposal: unknown): proposal is Proposal => proposalCheck(proposal) === true;

/** Any outcome a contract client answers with. */
export type Outcome = { ok: boolean, value?: any, kind?: string, error?: { code?: string, message?: string, details?: any } };
export type StorePort = { invoke: (op: string, input?: any) => Promise<Outcome> };
export type SystemHost = {
  edition: string,
  title: string,
  getState: () => any,
  dispatch: (action: string, payload?: any) => void,
  council: Pick<CouncilDriver, 'open' | 'convene' | 'verdict' | 'repeal'>,
  store: StorePort | null,
  ids?: () => string,
};
export type Tool = { name: string, description: string, inputSchema: any, execute: (args: any, ctx?: any) => Promise<any> };

/** Bind the contract to a running OS. */
export function createSystem(host: SystemHost) {
  let counter = 0;
  const nextId = host.ids ?? (() => `${Date.now().toString(36)}-${(counter++).toString(36)}`);

  /** Call the storage port; a refusal there is this contract's `storage` failure. */
  async function stored(ctx: any, op: string, input?: any) {
    if (!host.store) return ctx.fail('storage', null, { reason: 'no database is attached' });
    const outcome = await host.store.invoke(op, input);
    if (!outcome.ok) return ctx.fail('storage', null, { reason: outcome.error?.message ?? 'the database refused' });
    return { value: outcome.value };
  }

  const handlers: Record<string, (input: any, ctx: any) => any> = {
    'os.describe': () => {
      const state = host.getState();
      return {
        edition: host.edition,
        title: host.title,
        members: membersOf(state),
        operations: [...PUBLIC_OPERATIONS],
      };
    },

    'machine.read': (input) => {
      const state = host.getState();
      return {
        program: state.program.machine,
        tempo: state.program.tempo,
        running: state.machine.running,
        tick: state.world.tick,
        width: state.world.width,
        height: state.world.height,
        heads: state.world.heads,
        ...(input?.tape ? { tape: state.world.tape } : {}),
        measure: roundMeasure(state.machine.measure),
      };
    },

    'machine.control': (input) => {
      const state = host.getState();
      if (input.action === 'step') {
        host.dispatch('machine/tick', { steps: input.steps ?? 1 });
        return { running: state.machine.running, tick: state.world.tick + (input.steps ?? 1) };
      }
      host.dispatch('machine/run', input.action === 'run');
      return { running: input.action === 'run', tick: state.world.tick };
    },

    'council.read': () => sessionOf(host.getState()),

    'council.propose': (input, ctx) => {
      const state = host.getState();
      const change = input.change;
      if (!fitsProgram(change, state.program.machine)) {
        return ctx.fail('unknown-state', null, { states: programStates(state.program.machine) });
      }
      const queue = state.council.queue ?? [];
      if (queue.length >= QUEUE_MAX) return ctx.fail('queue-full', null, { max: QUEUE_MAX });
      const proposal = {
        id: `${input.by}-q${nextId()}`,
        by: input.by,
        title: input.title ?? describeChange(change),
        why: input.why ?? '',
        change,
      };
      host.dispatch('council/enqueue', proposal);
      return { id: proposal.id, queued: queue.length + 1 };
    },

    'council.say': (input) => {
      const id = `m${nextId()}`;
      host.dispatch('council/said', { id, by: input.by, text: input.text, at: new Date().toISOString() });
      return { id };
    },

    'council.convene': async (_input, ctx) => {
      if (host.council.open) return ctx.fail('in-session');
      const result = await host.council.convene();
      if (!result) return ctx.fail('in-session');
      return result;
    },

    'council.veto': async (input, ctx) => {
      const session = host.getState().council.session;
      if (!(await host.council.verdict('veto', input.proposal))) return ctx.fail('not-awaiting');
      return { session, vetoed: input.proposal };
    },

    'council.approve': async (input, ctx) => {
      const session = host.getState().council.session;
      if (!(await host.council.verdict('approve', input.proposal))) return ctx.fail('not-awaiting');
      return { session, enacted: input.proposal };
    },

    'council.repeal': (input, ctx) => {
      const result = host.council.repeal(input.amendment);
      if (result !== 'repealed') return ctx.fail(result);
      return { repealed: input.amendment };
    },

    'art.export': async (input) => {
      const state = host.getState();
      const svg = renderToString(stillFrame(sceneOf(state), { width: 1200, height: 800, title: `Radiant OS at tick ${state.world.tick}` }) as any);
      const format = input.format as keyof typeof FORMATS;
      const meta = FORMATS[format];
      if (format === 'svg') return { name: meta.name, mime: meta.mime, text: svg };
      const art = await renderArt(state, { svg });
      return { name: meta.name, mime: meta.mime, text: art[format] };
    },

    'gallery.save': async (input, ctx) => {
      const state = host.getState();
      const at = new Date().toISOString();
      const artwork = {
        id: `art-${nextId()}`,
        title: input.title,
        at,
        tick: state.world.tick,
        harmony: Math.round((state.machine.measure?.harmony ?? 0) * 10000) / 10000,
        world: state.world,
        program: { machine: state.program.machine, tempo: state.program.tempo },
        merits: state.council.merits,
      };
      const result = await stored(ctx, 'artwork.put', { artwork });
      if (!('value' in result)) return result;
      host.dispatch('gallery/saved', { id: artwork.id, title: artwork.title, at, harmony: artwork.harmony, tick: artwork.tick });
      return { id: artwork.id, at };
    },

    'gallery.list': async (_input, ctx) => {
      const result = await stored(ctx, 'artwork.list');
      if (!('value' in result)) return result;
      const info = await host.store?.invoke('store.info');
      return { items: result.value, storage: info?.ok ? info.value.mode : 'unknown' };
    },

    'gallery.open': async (input, ctx) => {
      const result = await stored(ctx, 'artwork.get', { id: input.id });
      if (!('value' in result)) return result;
      const kept = result.value;
      if (kept === null) return ctx.fail('not-found');
      // a kept artwork is data at rest: put back only what this OS can run
      if (!isProgram(kept.program?.machine) || !isTempo(kept.program.tempo) || !isWorld(kept.world)) return ctx.fail('unreadable');
      host.dispatch('gallery/opened', kept);
      return { opened: input.id };
    },
  };

  const client: { invoke: (op: string, input?: any) => Promise<Outcome> } = openLocalClient(osContract, handlers as any, {
    validateOutput: 'always',
    // the in-process binding needs no globally unique trace; a counter
    // keeps every call traceable without reaching for crypto.randomUUID
    // (absent on a plain-HTTP origin)
    trace: () => `os-${(counter++).toString(36)}`,
  } as any) as any;

  return {
    contract: osContract,
    client,
    handlers,
    /**
     * The contract as agent tools — every public operation, none of the
     * human's. `by` is pinned to the seat the agent sits in, so a tool
     * call can speak only for that seat.
     */
    tools(options: { seat?: string, prefix?: string } = {}): Tool[] {
      const seat = options.seat ?? 'oracle';
      const prefix = options.prefix ?? 'radiant_';
      return (contractTools(osContract, client as any, { name: (id: string) => `${prefix}${id.replace(/\./g, '_')}` } as any) as Tool[])
        .map((tool) => ({
          ...tool,
          execute: (args: any, ctx?: any) => tool.execute(
            args && typeof args === 'object' && 'by' in args ? { ...args, by: seat } : args, ctx),
        }));
    },
  };
}

/** The council's members with their merits. */
export function membersOf(state: any) {
  return MEMBERS.map((m) => ({
    id: m.id, name: m.name, taste: m.taste, motto: m.motto,
    merit: Math.round((Number(state.council.merits?.[m.id]) || 1) * 1000) / 1000,
  }));
}

/** The `council.read` answer. */
export function sessionOf(state: any) {
  const c = state.council;
  return {
    phase: c.phase,
    session: c.session,
    members: membersOf(state),
    proposals: (c.proposals ?? []).map(stripScore),
    winner: c.winner ? stripScore(c.winner) : null,
    deadline: c.deadline ?? null,
    log: (c.log ?? []).slice(0, 12).map((a: any) => ({
      id: a.id, session: a.session, by: a.by, title: a.title, status: a.status, change: a.change,
      score: a.score ?? 0, reward: a.reward ?? null,
    })),
  };
}

/** A proposal as the contract's Proposal schema states it. */
const stripScore = (p: any) => ({ id: p.id, by: p.by, title: p.title, why: p.why ?? '', change: p.change });
