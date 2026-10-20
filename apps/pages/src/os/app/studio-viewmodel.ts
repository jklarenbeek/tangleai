/**
 * What the studio's windows show that is derived from the state but is
 * not state: thread lists with names, the board's cards with their
 * blocked flags and the lines between their centres, the page being read
 * cut into sentences with the spoken one marked, the crew's round in
 * words and the app it is building, the arcade's shelf, the coach's
 * step. Pure, and memoized by the identity of what each part reads.
 */

import { threadSummaries, unreadCount, FOLDERS } from '../kernel/mail.ts';
import { blockedCards, BOARD_LIMITS } from '../kernel/board.ts';
import { sentences } from '../kernel/library.ts';
import { describeBlock, buildApp } from '../kernel/blocks.ts';
import { currentEmployer, projectApp, IDEAS_PER_TURN, CREW } from '../kernel/crew.ts';
import { currentStep, QUESTS } from '../kernel/coach.ts';
import { rankOf } from '../kernel/ladder.ts';
import { SHOTS } from '../engine/director.ts';
import { ART, BUDGETS } from './studio-state.ts';
import { PALETTE } from './state.ts';
import { seatName } from '../kernel/studio.ts';

function memo1<A, R>(fn: (a: A) => R): (a: A) => R {
  let last: A | undefined;
  let value: R | undefined;
  let primed = false;
  return (a) => {
    if (!primed || a !== last) { last = a; value = fn(a); primed = true; }
    return value as R;
  };
}

/** A card's colour: the palette's brights (index 0 is paper, kept for notes that want none). */
const cardColor = (i: number) => PALETTE[i] ?? PALETTE[1];

const boardOf = memo1((board: { cards: any[], links: any[], seq: number }) => {
  const blocked = blockedCards(board);
  const at = new Map(board.cards.map((c) => [c.id, c]));
  return {
    cards: board.cards.map((c) => ({ ...c, fill: cardColor(c.color), blocked: blocked.has(c.id), todo: c.kind === 'todo', label: c.ref?.label ?? '' })),
    links: board.links.flatMap((l) => {
      const a = at.get(l.from);
      const b = at.get(l.to);
      if (!a || !b) return [];
      return [{ ...l, x1: a.x + BOARD_LIMITS.cardW / 2, y1: a.y + BOARD_LIMITS.cardH / 2, x2: b.x + BOARD_LIMITS.cardW / 2, y2: b.y + BOARD_LIMITS.cardH / 2 }];
    }),
    width: BOARD_LIMITS.width,
    height: BOARD_LIMITS.height,
  };
});

const mailOf = memo1((mail: { threads: any[], seq: number, folder: string, open: string | null }) => {
  const open = mail.open ? mail.threads.find((t) => t.id === mail.open) ?? null : null;
  return {
    unread: unreadCount(mail),
    folders: ['all', ...FOLDERS].map((id) => ({
      id, active: id === (mail.folder ?? 'all'),
      unread: mail.threads.filter((t) => id === 'all' || t.folder === id).reduce((n, t) => n + t.unread, 0),
    })),
    threads: threadSummaries(mail, mail.folder).map((t) => ({ ...t, who: t.people.map(seatName).join(', '), active: t.id === mail.open })),
    open: open && {
      id: open.id,
      subject: open.subject,
      messages: open.messages.map((m: any) => ({
        ...m,
        who: seatName(m.from),
        mine: m.from === 'human',
        toolText: m.tool ? `${m.tool.name}${m.tool.chunks && m.tool.chunks > 1 ? ` · ${m.tool.chunks} chunks` : ''}${m.tool.chars ? ` · ${m.tool.chars} chars` : ''}${m.tool.ok ? '' : ' · refused'}` : '',
      })),
    },
  };
});

/** The page being read, its sentences numbered as `speechOf` speaks them. */
const pageOf = memo1((lib: { page: any, sentence: number }) => {
  if (!lib.page) return null;
  let n = 0;
  return {
    ...lib.page,
    sections: lib.page.sections.map((s: any) => {
      if (s.code) return { ...s, headingSpoken: false, parts: [] };
      const heading = n++;
      const parts = sentences(s.text).map((text) => ({ text, n: n++ }));
      return { ...s, headingSpoken: heading === lib.sentence, parts: parts.map((p) => ({ ...p, spoken: p.n === lib.sentence })) };
    }),
  };
});

const crewOf = memo1((project: any) => {
  if (!project) return null;
  const employer = currentEmployer(project);
  const phaseText = {
    employer: `${employer.name === 'You' ? 'Your' : `${employer.name}’s`} turn: add up to ${IDEAS_PER_TURN} ideas, then end your turn.`,
    crew: 'The crew is at work…',
    review: 'Your review: try what the crew built, then approve it into the app or veto it.',
    shipped: `Shipped in ${project.round} round${project.round === 1 ? '' : 's'}.`,
  }[project.phase as 'employer' | 'crew' | 'review' | 'shipped'];
  const approved = project.tasks.filter((t: any) => t.status === 'approved').length;
  return {
    id: project.id,
    title: project.title,
    brief: project.brief,
    phase: project.phase,
    phaseText,
    round: project.round,
    employer: employer.name,
    employerColor: employer.color,
    canAdd: project.phase === 'employer' && project.added < IDEAS_PER_TURN,
    progress: { approved, goal: project.goal, pct: Math.round(Math.min(1, approved / project.goal) * 100) },
    players: project.players.map((p: any, i: number) => ({ ...p, active: project.phase === 'employer' && i === project.turn })),
    crew: CREW.map((c) => ({ id: c.id, name: c.name, points: project.points[c.id] ?? 0 })),
    ideas: project.ideas.map((i: any) => ({ ...i, who: project.players.find((p: any) => p.id === i.by)?.name ?? '' })),
    review: project.tasks.filter((t: any) => t.status === 'review').map((t: any) => ({
      id: t.id, who: seatName(t.by), what: describeBlock(t.block), idea: project.ideas.find((i: any) => i.id === t.idea)?.text ?? '',
    })),
    built: project.tasks.filter((t: any) => t.status !== 'review').map((t: any) => ({ id: t.id, status: t.status, who: seatName(t.by), what: describeBlock(t.block) })),
    stars: project.stars,
    app: projectApp(project),
  };
});

const madeOf = memo1((made: any[]) => made.map((m) => ({ id: m.id, title: m.title, stars: m.stars, count: m.blocks.length, app: buildApp(m.blocks, { title: m.title }) })));

/** The studio's part of the view model; `games` is the arcade's shelf. */
export function studioUi(state: any, games: ReadonlyArray<{ id: string, title: string, blurb: string }>) {
  const step = currentStep(state.coach);
  const rank = rankOf(state.profile.xp);
  const made = madeOf(state.crew.made);
  const preview = state.crew.preview ? made.find((m) => m.id === state.crew.preview) ?? null : null;
  return {
    paused: state.studio.paused,
    art: ART.map((a) => ({ ...a, active: a.id === state.settings.art })),
    budgets: BUDGETS.map((b) => ({ id: b, active: b === state.settings.ai.budget })),
    shots: Object.keys(SHOTS).map((id) => ({ id, active: id === state.studio.shot })),
    hourText: `${String(Math.floor(state.settings.light.hour)).padStart(2, '0')}:${String(Math.round((state.settings.light.hour % 1) * 60)).padStart(2, '0')}`,
    mail: mailOf(state.mail),
    board: boardOf(state.board),
    library: { page: pageOf(state.library) },
    crew: crewOf(state.crew.project),
    made,
    preview,
    arcade: {
      games: games.map((g) => ({ ...g, best: state.arcade.saves?.[g.id]?.best ?? null, active: g.id === state.arcade.game })),
      game: games.find((g) => g.id === state.arcade.game) ?? null,
      phase: state.arcade.flow.current,
    },
    coach: {
      open: state.coach.open,
      quest: step ? step.quest.title : null,
      text: step ? step.step.text : 'Every quest is done. The studio is yours.',
      target: step ? step.step.target : null,
      progress: step ? `${step.index + 1} of ${step.total}` : '',
      quests: QUESTS.map((q) => ({ id: q.id, title: q.title, done: state.coach.done.includes(q.id), active: q.id === state.coach.quest })),
      rank: rank.title,
      next: rank.next,
      xp: state.profile.xp,
      pct: Math.round(rank.progress * 100),
    },
  };
}
