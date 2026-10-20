/**
 * The oracle's seat, Tangle edition: a language model on the council,
 * reached through `@tangleai/models`.
 *
 * Once a session the council asks the seat for one amendment. The seat
 * asks a chat model for it with `createStructuredOutput`, constrained by
 * the contract's own `Change` grammar and validated locally — a provider's
 * structured output is an accelerator, never the authority — and the
 * council driver then checks the proposal twice more: against the
 * contract's `Proposal` schema, and against the program it would amend.
 * The id and the seat are the OS's to assign, never the model's.
 *
 * The model is reached only when the human has spoken to the council
 * since it last answered: the words are what the seat brings to a session
 * that the other members cannot. Every other session — and every session
 * of a browser with no model configured — is answered by the scripted
 * oracle, which runs offline through the very same client: a fetch that
 * answers like a chat endpoint, with a proposal the seat works out locally
 * from what was last said (more symmetry, more colour, livelier, calmer,
 * or plain harmony). So an OS without a key shows the seat's whole road,
 * and an OS with one spends a model call only when someone asks for it.
 */

import { createChatClient, createStructuredOutput } from '@tangleai/models';
import contractDoc from '../documents/os.contract.json' with { type: 'json' };
import { MEMBERS, SYMBOL_NAMES, TURN_NAMES, describeChange, propose } from './council.ts';
import type { Member, Proposal } from './council.ts';
import type { Taste } from './metrics.ts';
import { measure } from './metrics.ts';
import { fsmToRules } from './program.ts';
import type { Turn } from './program.ts';
import type { Oracle, OracleContext } from './session.ts';

/** What the model answers: a sign, a reason and one change. */
export const ORACLE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['title', 'why', 'change'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    why: { type: 'string', maxLength: 280 },
    change: { $ref: '#/$defs/Change' },
  },
  $defs: { Change: contractDoc.$defs.Change },
});

/** The chat settings the Tangle assistant keeps (`tangle-ai` in local storage). */
export type ModelSettings = { provider: string, baseUrl: string, model: string, apiKey: string };

/** A seat ready to sit: the oracle function, the label the status bar
 * shows, and a way to take new settings (the assistant's, changed in
 * another tab) without unseating the oracle. */
export type OracleSeat = { oracle: Oracle, readonly label: string, readonly live: boolean, configure: (settings: ModelSettings | null | undefined) => void };

/** Words that tell the scripted oracle which taste the human asked for. */
const LISTENING: ReadonlyArray<[RegExp, Taste]> = [
  [/symmetr|mirror|fold|both sides/i, 'symmetry'],
  [/colou?r|ink|paint|bright/i, 'balance'],
  [/mov|danc|faster|slower|tempo|aliv|lively/i, 'motion'],
  [/line|structur|order|edge|calm|tidy|clean/i, 'structure'],
];

/** The taste the latest human words ask for, or harmony. */
export function tasteHeard(chat: readonly any[]): Taste {
  const said = chat.find((m) => m?.by === 'human')?.text ?? '';
  for (const [words, taste] of LISTENING) if (words.test(said)) return taste;
  return 'harmony';
}

/** The scripted oracle's answer: the proposal the seat would make if it
 * had the taste the human asked for, or nothing when nothing helps. */
export function scriptedAnswer(context: OracleContext): { title: string, why: string, change: any } | null {
  const seat = MEMBERS.find((m) => m.id === 'oracle') as Member;
  const taste = tasteHeard(context.chat);
  const proposal = propose({ ...seat, taste }, context.program, context.world, context.seed);
  if (proposal === null) return null;
  const heard = taste === 'harmony' ? 'No one asked for anything, so the scripted oracle reaches for harmony' : `You asked for ${taste}`;
  return { title: proposal.title, why: `${heard}: ${proposal.why}`, change: proposal.change };
}

/** A fetch that answers like an OpenAI-compatible chat endpoint, with
 * whatever `answer` produces as the assistant message's content. */
export function scriptedFetch(answer: () => unknown): typeof fetch {
  return (async () => new Response(JSON.stringify({
    id: 'scripted', object: 'chat.completion',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer()) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

/** The program, the floor's tastes and the words said, as the model reads them. */
export function oraclePrompt(context: OracleContext): Array<{ role: string, content: string }> {
  const rules = fsmToRules(context.program.machine);
  const states = Object.keys(rules);
  const lines = states.flatMap((state) => rules[state].map((rule, symbol) =>
    `${state} reads ${SYMBOL_NAMES[symbol]} → paint ${SYMBOL_NAMES[rule.write]}, ${TURN_NAMES[rule.turn as Turn]}, become ${rule.next}`));
  const tastes = measure(context.world);
  const said = context.chat.filter((m) => typeof m?.text === 'string').slice(0, 6)
    .map((m) => `${m.by === 'human' ? 'The human' : m.by}: ${m.text}`);
  return [
    {
      role: 'system',
      content: 'You sit on the council of Radiant OS as the Oracle. The OS is a two-dimensional Turing machine: '
        + `four heads walk a ${context.world.width}×${context.world.height} torus of cells, each holding a symbol 0–5 `
        + `(${SYMBOL_NAMES.map((name, i) => `${i} ${name}`).join(', ')}). For each control state and symbol read, the program `
        + 'paints a symbol, turns (L left, R right, U around, N straight) and becomes a next state. Every member proposes '
        + 'one amendment a session; the others judge it by simulation; the human may veto. Propose exactly one change '
        + 'that serves what the human asked for without lowering harmony. A change is a rule change '
        + `({"kind":"rule","state":one of ${JSON.stringify(states)},"symbol":0-5,"member":"write"|"turn"|"next","value":…}), `
        + 'a tape change ({"kind":"tape","op":"mirror"|"clear"}) or a tempo change ({"kind":"tempo","tempo":2-30}). '
        + 'Answer with a short title for the sign, one sentence why, and the change.',
    },
    {
      role: 'user',
      content: [
        `The program at tick ${context.world.tick}:`, ...lines, '',
        `The council's tastes now (0 to 1): ${Object.entries(tastes).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}.`,
        said.length > 0 ? `What was said, newest first:\n${said.join('\n')}` : 'Nobody has said anything yet.',
      ].join('\n'),
    },
  ];
}

/** True when the assistant's settings name a model the seat can call. */
export function isLive(settings: ModelSettings | null | undefined): settings is ModelSettings {
  if (!settings || typeof settings.model !== 'string' || settings.model.trim() === '') return false;
  if (settings.provider === 'custom') return typeof settings.baseUrl === 'string' && settings.baseUrl.trim() !== '';
  if (settings.provider === 'openrouter') return typeof settings.apiKey === 'string' && settings.apiKey.trim() !== '';
  return true;
}

/**
 * Seat the oracle: the scripted one always, a live model when the
 * assistant's settings name one. `onError` hears a live call that failed;
 * the session then goes on without the seat's proposal.
 */
export function createOracleSeat(options: { settings?: ModelSettings | null, fetch?: typeof fetch, onError?: (error: unknown) => void } = {}): OracleSeat {
  // what the scripted endpoint answers next: worked out before the call
  let next: unknown = null;
  const scripted = createStructuredOutput({
    client: createChatClient({ provider: 'custom', baseUrl: 'https://oracle.invalid/v1', model: 'radiant-scripted-oracle', fetch: scriptedFetch(() => next) }),
    schema: ORACLE_SCHEMA, name: 'amendment', maxRepairs: 0,
  });
  let settings: ModelSettings | null = null;
  let live: ReturnType<typeof createStructuredOutput> | null = null;
  const configure = (next: ModelSettings | null | undefined) => {
    settings = isLive(next) ? { ...next } : null;
    live = settings === null ? null : createStructuredOutput({
      client: createChatClient({
        provider: settings.provider, baseUrl: settings.baseUrl || undefined, apiKey: settings.apiKey || undefined,
        model: settings.model, fetch: options.fetch, maxTokens: 600,
      }),
      // a provider's strict mode refuses the grammar's oneOf; local validation still holds it
      schema: ORACLE_SCHEMA, name: 'amendment', strict: false, maxRepairs: 1,
    });
  };
  configure(options.settings);
  let answered: string | null = null;

  const oracle: Oracle = async (asked, signal) => {
    const latest = asked.chat.find((m: any) => m?.by === 'human');
    const model = live;
    const spokenTo = model !== null && latest !== undefined && latest.id !== answered;
    let reply;
    if (spokenTo) {
      answered = latest.id;
      try {
        reply = await model.generate(oraclePrompt(asked), { signal });
      }
      catch (error) {
        options.onError?.(error);
        return null;
      }
    }
    else {
      next = scriptedAnswer(asked);
      if (next === null) return null;
      reply = await scripted.generate(oraclePrompt(asked), { signal });
    }
    if (reply.value === undefined) {
      if (spokenTo) options.onError?.(new Error(`the model's answer did not fit the grammar: ${JSON.stringify(reply.errors).slice(0, 200)}`));
      return null;
    }
    const proposal: Proposal = {
      id: `oracle-${asked.seed.toString(36)}`,
      by: 'oracle',
      title: String(reply.value.title ?? describeChange(reply.value.change)).slice(0, 80),
      why: String(reply.value.why ?? '').slice(0, 280),
      change: reply.value.change,
    };
    return proposal;
  };
  return {
    oracle,
    get label() { return settings === null ? 'scripted' : settings.model; },
    get live() { return settings !== null; },
    configure,
  };
}
