/**
 * The Radiant OS program: the finite control of a two-dimensional
 * Turing machine (a turmite), written as a jaren-fsm document.
 *
 * A turmite is the classic Turing machine with its tape folded into a
 * grid. Each head carries a direction and a control state; one step
 * reads the symbol under the head, and the transition table answers
 * with a symbol to write, a way to turn and the next control state;
 * then the head moves one cell forward. The table is exactly what a
 * jaren-fsm document is — control state lives in the machine, data
 * state (the tape, the heads) lives in the host — so the OS keeps its
 * program in that format and nowhere else:
 *
 *   - one `read` transition per (state, symbol), in that order, guarded
 *     by `$.payload.symbol`, so transition `q * symbols + s` is the rule
 *     for state `q` reading `s` and an amendment can address it by
 *     pointer (`/transitions/7/effects/1/with`);
 *   - the rule's output is two effect descriptors returned as data —
 *     `write` with the symbol, `turn` with `L`/`R`/`U`/`N` — which the
 *     tape unit (`machine.ts`) performs. The engine never touches the
 *     tape, which is what keeps a step pure and a simulation honest.
 *
 * The rule table is a derived view for people (`fsmToRules`); the
 * document is the program, the thing the council amends with RFC 6902
 * patches and the thing the Source app sculpts.
 */

/** The tape alphabet: 0 is the blank paper, 1–5 are the palette inks. */
export const SYMBOLS = 6;

/** The four turns, relative to the head's heading. */
export const TURNS = ['L', 'R', 'U', 'N'] as const;

export type Turn = typeof TURNS[number];
export type Rule = { write: number, turn: Turn, next: string };
/** rules[state][symbol] */
export type RuleTable = Record<string, Rule[]>;
/** A jaren-fsm document in the program layout: JSON, as stored and amended. */
export type ProgramDocument = {
  $fsm: string,
  initial: string,
  states: Array<string | { id: string }>,
  transitions: Array<{ from: string, event: string, guard: any, to: string, effects: Array<{ run: string, with: any }> }>,
};

/**
 * The machine every fresh OS boots with. Two control states over six
 * symbols, picked from a seeded search over random two-state tables for
 * what a turmite on a folded tape usually lacks: it keeps rewriting the
 * floor instead of settling into a cycle that repaints what it just
 * painted, it uses every ink, and its harmony stays middling — there must
 * be something left for the council to improve
 * (`test/pages/os-kernel.test.ts` pins all three).
 */
export const DEFAULT_RULES: Readonly<RuleTable> = Object.freeze({
  dance: [
    { write: 1, turn: 'L', next: 'dance' },
    { write: 0, turn: 'R', next: 'leap' },
    { write: 0, turn: 'R', next: 'leap' },
    { write: 5, turn: 'L', next: 'dance' },
    { write: 0, turn: 'L', next: 'leap' },
    { write: 1, turn: 'L', next: 'leap' },
  ],
  leap: [
    { write: 4, turn: 'R', next: 'leap' },
    { write: 5, turn: 'L', next: 'leap' },
    { write: 0, turn: 'R', next: 'dance' },
    { write: 2, turn: 'R', next: 'leap' },
    { write: 2, turn: 'L', next: 'dance' },
    { write: 3, turn: 'L', next: 'leap' },
  ],
});

/** The rule table as an executable jaren-fsm document. */
export function rulesToFsm(rules: Readonly<RuleTable>, options: { initial?: string, symbols?: number } = {}): ProgramDocument {
  const symbols = options.symbols ?? SYMBOLS;
  const states = Object.keys(rules);
  if (states.length === 0) throw new RangeError('a program needs at least one control state');
  const transitions: ProgramDocument['transitions'] = [];
  for (const from of states) {
    const row = rules[from];
    if (!Array.isArray(row) || row.length !== symbols) {
      throw new RangeError(`state ${from} must answer each of the ${symbols} symbols`);
    }
    for (let symbol = 0; symbol < symbols; symbol++) {
      const rule = row[symbol];
      transitions.push({
        from,
        event: 'read',
        guard: { $eq: ['$.payload.symbol', symbol] },
        to: rule.next,
        effects: [
          { run: 'write', with: rule.write },
          { run: 'turn', with: rule.turn },
        ],
      });
    }
  }
  return {
    $fsm: '0.1',
    initial: options.initial ?? states[0],
    states,
    transitions,
  };
}

/**
 * Read the rule table back out of a program document — the inverse of
 * {@link rulesToFsm} for every document the council can produce. A
 * transition the table cannot place (an unguarded or foreign one)
 * throws: the Source view must never show a table that is not the
 * program it claims to be.
 */
export function fsmToRules(doc: any, symbols = SYMBOLS): RuleTable {
  const rules: RuleTable = {};
  for (const state of doc.states) rules[typeof state === 'string' ? state : state.id] = [];
  doc.transitions.forEach((t: any, index: number) => {
    const symbol = index % symbols;
    const expected = doc.states[Math.floor(index / symbols)];
    const state = typeof expected === 'string' ? expected : expected?.id;
    if (t.from !== state || t.guard?.$eq?.[1] !== symbol) {
      throw new RangeError(`transition ${index} is not the rule for (${state}, ${symbol})`);
    }
    const write = t.effects?.find((e: any) => e.run === 'write')?.with;
    const turn = t.effects?.find((e: any) => e.run === 'turn')?.with;
    rules[t.from][symbol] = { write, turn, next: t.to };
  });
  return rules;
}

/** The pointer of one rule member inside the program document. */
export function rulePointer(states: readonly string[], state: string, symbol: number, member: 'write' | 'turn' | 'next', symbols = SYMBOLS) {
  const q = states.indexOf(state);
  if (q < 0) throw new RangeError(`unknown control state ${state}`);
  const index = q * symbols + symbol;
  if (member === 'next') return `/transitions/${index}/to`;
  return `/transitions/${index}/effects/${member === 'write' ? 0 : 1}/with`;
}

/** The state ids of a program document, in declaration order. */
export function programStates(doc: any): string[] {
  return doc.states.map((s: any) => (typeof s === 'string' ? s : s.id));
}

/**
 * True when a document is a program in the layout this OS runs: every
 * (state, symbol) answered, in order; every write a symbol, every turn a
 * turn, every next state one of its own. A program that arrives from
 * storage — a kept artwork, a saved session — must pass this before it
 * replaces the running one, or one bad record would stop the machine on
 * every boot.
 */
export function isProgram(doc: any, symbols = SYMBOLS): boolean {
  if (doc?.$fsm !== '0.1' || !Array.isArray(doc.states) || !Array.isArray(doc.transitions)) return false;
  try {
    const states = programStates(doc);
    if (!states.includes(doc.initial) || doc.transitions.length !== states.length * symbols) return false;
    return Object.values(fsmToRules(doc, symbols)).every((row) => row.every((rule) => Number.isInteger(rule.write)
      && rule.write >= 0 && rule.write < symbols && (TURNS as readonly string[]).includes(rule.turn) && states.includes(rule.next)));
  }
  catch {
    return false;
  }
}
