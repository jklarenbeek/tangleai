/**
 * The crew game: finishing a project together, as a turn-based game for
 * the people at one keyboard. The people are the employers — they take
 * turns adding ideas — and the crew does the work: the council's four
 * members (and the oracle, when a language model sits in its seat) turn
 * each idea into one building block of a real app (`blocks.ts`). Then
 * the employers review what was built: approve it into the app, or veto
 * it — absolutely, as everywhere in this OS — and the crew tries again
 * next round. The project ships when enough blocks are approved; fewer
 * rounds earn more stars, approved ideas score for whoever had them.
 *
 * The turn order is a jaren-fsm document (`CREW_FLOW`): employer turns
 * until the last player passes, the crew's turn, the review, then either
 * another round or the launch. Everything here is pure; the contract
 * handlers (`system.ts`) are the only road in, for people and models alike.
 */

import { compileFsm } from '@jarenjs/flow';
import { isBlock, buildApp, describeBlock, planBlock } from './blocks.ts';
import type { Block } from './blocks.ts';

export type Employer = { id: string, name: string, color: string, score: number };
export type Idea = {
  id: string, by: string, text: string, kind: 'feature' | 'polish' | 'fix' | 'fun',
  status: 'new' | 'built' | 'approved' | 'vetoed' | 'dropped', tries: number,
};
export type Task = { id: string, idea: string, by: string, block: Block, status: 'review' | 'approved' | 'vetoed', round: number };
export type Project = {
  id: string, title: string, brief: string, phase: 'employer' | 'crew' | 'review' | 'shipped', round: number, turn: number,
  added: number, players: Employer[], points: Record<string, number>, ideas: Idea[], tasks: Task[], goal: number, seq: number, stars: number,
};

/** Ideas an employer may add in one turn. */
export const IDEAS_PER_TURN = 2;
/** Blocks the crew builds in one round, at most. */
export const BUILDS_PER_ROUND = 4;
/** How often an idea may be vetoed before it is dropped. */
export const MAX_TRIES = 2;
/** The crew: the council's members, each with the blocks it likes to build. */
export const CREW: ReadonlyArray<{ id: string, name: string, builds: Array<Block['kind']>, line: string }> = Object.freeze([
  { id: 'architect', name: 'Architect', builds: ['title', 'checklist', 'input'], line: 'I will lay this out as' },
  { id: 'dancer', name: 'Dancer', builds: ['counter', 'toggle'], line: 'Let us make it move:' },
  { id: 'painter', name: 'Painter', builds: ['palette'], line: 'Colour first —' },
  { id: 'critic', name: 'Critic', builds: ['quiz', 'note'], line: 'Someone has to explain it:' },
] as Array<{ id: string, name: string, builds: Array<Block['kind']>, line: string }>);
/** The employers' colours, in seat order. */
export const EMPLOYER_COLORS: readonly string[] = Object.freeze(['#f97316', '#2563eb', '#16a34a', '#fbbf24']);

/** The turn order of a round. */
export const CREW_FLOW = Object.freeze({
  $fsm: '0.1',
  initial: 'employer',
  states: ['employer', 'crew', 'review', { id: 'shipped', final: true }],
  transitions: [
    { from: 'employer', event: 'pass', guard: { $not: '$.payload.last' }, to: 'employer', effects: [{ run: 'next-employer' }] },
    { from: 'employer', event: 'pass', to: 'crew', effects: [{ run: 'crew-turn' }] },
    { from: 'crew', event: 'done', to: 'review' },
    { from: 'review', event: 'reviewed', guard: { $ge: ['$.payload.approved', '$.payload.goal'] }, to: 'shipped', effects: [{ run: 'launch' }] },
    { from: 'review', event: 'reviewed', to: 'employer', effects: [{ run: 'next-round' }] },
  ],
});

let flow: ReturnType<typeof compileFsm> | null = null;

/** Where an event moves a round. */
export function crewStep(phase: string, event: string, payload: Record<string, any>): { phase: string, effects: string[] } {
  flow ??= compileFsm(CREW_FLOW);
  const result = flow.step(phase, event, { payload });
  return { phase: result.state, effects: result.effects.map((e: { run: string }) => e.run) };
}

/**
 * A new project: the brief, the people at the keyboard, how many
 * approved blocks ship it.
 */
export function newProject(input: { id?: string, title: string, brief?: string, players: string[], goal?: number }): Project {
  const players = input.players.slice(0, 4).map((name, i) => ({ id: `p${i + 1}`, name: name.trim().slice(0, 24) || `Employer ${i + 1}`, color: EMPLOYER_COLORS[i], score: 0 }));
  return {
    id: input.id ?? 'project',
    title: input.title.trim().slice(0, 60) || 'Untitled project',
    brief: (input.brief ?? '').trim().slice(0, 280),
    phase: 'employer',
    round: 1,
    turn: 0,
    added: 0,
    players: players.length > 0 ? players : [{ id: 'p1', name: 'Employer', color: EMPLOYER_COLORS[0], score: 0 }],
    points: Object.fromEntries(CREW.map((c) => [c.id, 0])),
    ideas: [],
    tasks: [],
    goal: Math.max(2, Math.min(12, Math.round(input.goal ?? 4))),
    seq: 0,
    stars: 0,
  };
}

/** The employer whose turn it is. */
export const currentEmployer = (p: Project) => p.players[p.turn] ?? p.players[0];

/** The current employer adds an idea. */
export function addIdea(p: Project, input: { text: string, kind?: Idea['kind'] }): { project: Project, id: string } | { error: 'not-your-turn' | 'turn-full' | 'empty' } {
  if (p.phase !== 'employer') return { error: 'not-your-turn' };
  if (p.added >= IDEAS_PER_TURN) return { error: 'turn-full' };
  const text = input.text.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (text.length === 0) return { error: 'empty' };
  const seq = p.seq + 1;
  const idea: Idea = { id: `i${seq}`, by: currentEmployer(p).id, text, kind: input.kind ?? 'feature', status: 'new', tries: 0 };
  return { project: { ...p, ideas: [...p.ideas, idea], added: p.added + 1, seq }, id: idea.id };
}

/**
 * The current employer passes: the next one's turn, or — after the last —
 * the crew's.
 */
export function endTurn(p: Project): { project: Project, effects: string[] } | { error: 'not-your-turn' } {
  if (p.phase !== 'employer') return { error: 'not-your-turn' };
  const step = crewStep(p.phase, 'pass', { last: p.turn >= p.players.length - 1 });
  const next: Project = step.effects.includes('next-employer') ? { ...p, turn: p.turn + 1, added: 0 } : { ...p, phase: 'crew', added: 0 };
  return { project: next, effects: step.effects };
}

/** The ideas waiting for the crew. */
export const openIdeas = (p: Project) => p.ideas.filter((i) => i.status === 'new');

/** A crew member (or the oracle) builds one block for an idea. */
export function build(p: Project, input: { by: string, idea: string, block: any }): { project: Project, task: string } | { error: 'not-crew-turn' | 'not-found' | 'invalid-block' | 'round-full' } {
  if (p.phase !== 'crew') return { error: 'not-crew-turn' };
  const idea = p.ideas.find((i) => i.id === input.idea && i.status === 'new');
  if (!idea) return { error: 'not-found' };
  if (!isBlock(input.block)) return { error: 'invalid-block' };
  if (p.tasks.filter((t) => t.round === p.round).length >= BUILDS_PER_ROUND) return { error: 'round-full' };
  const seq = p.seq + 1;
  const task: Task = { id: `k${seq}`, idea: idea.id, by: input.by, block: input.block, status: 'review', round: p.round };
  return {
    project: { ...p, seq, tasks: [...p.tasks, task], ideas: p.ideas.map((i) => (i.id === idea.id ? { ...i, status: 'built' as const } : i)) },
    task: task.id,
  };
}

/**
 * The crew is done for the round: the review starts. A round with
 * nothing built goes straight back to the employers.
 */
export function crewDone(p: Project): { project: Project, effects: string[] } | { error: 'not-crew-turn' } {
  if (p.phase !== 'crew') return { error: 'not-crew-turn' };
  const step = crewStep('crew', 'done', {});
  const pending = p.tasks.some((t) => t.status === 'review');
  if (!pending) return { project: { ...p, phase: 'employer', turn: 0, added: 0, round: p.round + 1 }, effects: ['next-round'] };
  return { project: { ...p, phase: step.phase as Project['phase'] }, effects: step.effects };
}

/**
 * An employer's verdict on a built block: approved into the app, or
 * vetoed — the idea goes back to the crew, until it has failed too often.
 * The last verdict of a review closes the round.
 */
export function review(p: Project, input: { task: string, verdict: 'approve' | 'veto' }): { project: Project, effects: string[] } | { error: 'not-in-review' | 'not-found' } {
  if (p.phase !== 'review') return { error: 'not-in-review' };
  const task = p.tasks.find((t) => t.id === input.task && t.status === 'review');
  if (!task) return { error: 'not-found' };
  const approved = input.verdict === 'approve';
  const idea = p.ideas.find((i) => i.id === task.idea) as Idea;
  const tries = idea.tries + (approved ? 0 : 1);
  const status = approved ? 'approved' : tries >= MAX_TRIES ? 'dropped' : 'new';
  let next: Project = {
    ...p,
    tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, status: approved ? 'approved' : 'vetoed' } : t)),
    ideas: p.ideas.map((i) => (i.id === idea.id ? { ...i, status: status as Idea['status'], tries } : i)),
    points: { ...p.points, [task.by]: (p.points[task.by] ?? 0) + (approved ? 2 : -1) },
    players: p.players.map((e) => (approved && e.id === idea.by ? { ...e, score: e.score + 2 } : e)),
  };
  if (next.tasks.some((t) => t.status === 'review')) return { project: next, effects: [] };
  const count = next.tasks.filter((t) => t.status === 'approved').length;
  const step = crewStep('review', 'reviewed', { approved: count, goal: next.goal });
  if (step.phase === 'shipped') {
    next = { ...next, phase: 'shipped', stars: next.round <= 2 ? 3 : next.round <= 3 ? 2 : 1 };
  }
  else {
    next = { ...next, phase: 'employer', turn: 0, added: 0, round: next.round + 1 };
  }
  return { project: next, effects: step.effects };
}

/** The approved blocks, in the order they were built — the app as it ships. */
export const approvedBlocks = (p: Project) => p.tasks.filter((t) => t.status === 'approved').map((t) => t.block);

/**
 * The app as it stands: approved blocks, plus — while a review is open —
 * the ones awaiting a verdict, so the employers try them before deciding.
 */
export function projectApp(p: Project) {
  const blocks = p.tasks.filter((t) => t.status === 'approved' || (p.phase === 'review' && t.status === 'review')).map((t) => t.block);
  return buildApp(blocks, { title: p.title });
}

/**
 * The scripted crew's turn: for each waiting idea (up to the round's
 * limit) who builds it, what they say, and the block. A language model
 * in the crew's seats makes the same moves through the same contract.
 */
export function scriptedCrew(p: Project): Array<{ by: string, idea: string, say: string, block: Block }> {
  const room = BUILDS_PER_ROUND - p.tasks.filter((t) => t.round === p.round).length;
  return openIdeas(p).slice(0, Math.max(0, room)).map((idea, n) => {
    const block = planBlock(idea.text);
    const member = CREW.find((c) => c.builds.includes(block.kind)) ?? CREW[n % CREW.length];
    return { by: member.id, idea: idea.id, say: `${member.line} ${describeBlock(block)}.`, block };
  });
}

/** Whether a value is a project this OS can restore. */
export function isProject(v: any): v is Project {
  return Boolean(v) && typeof v.id === 'string' && typeof v.title === 'string'
    && ['employer', 'crew', 'review', 'shipped'].includes(v.phase) && Number.isInteger(v.round) && Number.isInteger(v.turn)
    && Array.isArray(v.players) && v.players.length >= 1 && Array.isArray(v.ideas) && Array.isArray(v.tasks)
    && v.tasks.every((t: any) => t && typeof t.id === 'string' && isBlock(t.block)) && Number.isInteger(v.goal);
}
