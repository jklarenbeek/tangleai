/**
 * The coach: the OS teaching itself, one quest at a time. A quest is a
 * few steps, each a sentence and a check — a query document over a small
 * set of signals the OS keeps (counts of notes and links, the council's
 * sessions and verdicts, and marks the actions leave: an app opened, a
 * sentence listened to, a project shipped). When a step's check holds,
 * the coach moves on, awards experience on the ladder (`ladder.ts`) and
 * picks the next quest the way the arcade picks a level: the unfinished
 * one closest to two-in-three odds for this player.
 *
 * Quests are a JSON document (`quests.json`) — what the coach teaches is
 * data a model could extend — and every check is compiled once.
 */

import { compileJsonQuery } from '@jarenjs/json/query';
import questDoc from '../documents/quests.json' with { type: 'json' };
import { award, rate, pickChallenge } from './ladder.ts';
import type { Profile } from './ladder.ts';

export type QuestStep = { text: string, target: string, check: any };
export type Quest = { id: string, title: string, skill: string, difficulty: number, xp: number, steps: QuestStep[] };
export type Coach = { quest: string | null, step: number, done: string[], marks: Record<string, number>, open: boolean };

/** Every quest, in teaching order. */
export const QUESTS: readonly Quest[] = Object.freeze(questDoc.quests as Quest[]);

/**
 * The signals the checks read, as a query document over the OS state —
 * the app runtime evaluates it on every change and hands the result to
 * the coach, so a check never sees more of the state than this.
 */
export const COACH_SIGNALS = Object.freeze({
  marks: '$.coach.marks',
  sessions: '$.council.session',
  verdicts: { $count: '$.council.log[*]' },
  notes: { $count: '$.board.cards[*]' },
  links: { $count: '$.board.links[*]' },
  ticked: { $count: { $for: { c: '$.board.cards[*]' }, $where: '$c.done', $return: '$c.id' } },
});

const compiled = new Map<string, ReturnType<typeof compileJsonQuery>>();

function checkOf(step: QuestStep) {
  const key = JSON.stringify(step.check);
  let q = compiled.get(key);
  if (!q) {
    q = compileJsonQuery(step.check);
    compiled.set(key, q);
  }
  return q;
}

/** A coach at the first quest. */
export function emptyCoach(): Coach {
  return { quest: QUESTS[0].id, step: 0, done: [], marks: {}, open: true };
}

/** The step the coach is on, with where it sits in its quest. */
export function currentStep(coach: Coach): { quest: Quest, step: QuestStep, index: number, total: number } | null {
  const quest = QUESTS.find((q) => q.id === coach.quest);
  if (!quest) return null;
  const step = quest.steps[coach.step];
  return step ? { quest, step, index: coach.step, total: quest.steps.length } : null;
}

/** Whether a step's check holds over the signals. */
export function stepDone(step: QuestStep, signals: any) {
  try {
    return checkOf(step).ebv(signals) === true;
  }
  catch {
    return false;
  }
}

/**
 * Move the coach on as far as the signals allow — several steps at once
 * when the player got ahead of it — awarding each step's share of its
 * quest's experience and rating the quest's skill when it completes.
 */
export function advanceCoach(coach: Coach, profile: Profile, signals: any): { coach: Coach, profile: Profile, events: Array<{ kind: 'step' | 'quest' | 'rank', text: string }> } {
  const events: Array<{ kind: 'step' | 'quest' | 'rank', text: string }> = [];
  let c = coach;
  let p = profile;
  for (let guard = 0; guard < 32; guard++) {
    const at = currentStep(c);
    if (!at || !stepDone(at.step, signals)) break;
    const share = Math.round(at.quest.xp / at.total);
    const earned = award(p, share);
    p = earned.profile;
    if (earned.rankUp) events.push({ kind: 'rank', text: 'You climbed a rank.' });
    if (at.index + 1 < at.total) {
      c = { ...c, step: at.index + 1 };
      events.push({ kind: 'step', text: at.quest.steps[at.index + 1].text });
      continue;
    }
    p = rate(p, { skill: at.quest.skill, correct: true, difficulty: at.quest.difficulty }).profile;
    p = award(p, 0, `quest:${at.quest.id}`).profile;
    const done = [...c.done, at.quest.id];
    const next = pickChallenge(p, QUESTS.filter((q) => !done.includes(q.id)));
    c = { ...c, done, quest: next?.id ?? null, step: 0 };
    events.push({ kind: 'quest', text: next ? `Quest complete: ${at.quest.title}. Next: ${next.title}.` : `Quest complete: ${at.quest.title}. That was the last one — the studio is yours.` });
  }
  return { coach: c, profile: p, events };
}

/** Whether a value is a coach this OS can restore. */
export function isCoach(v: any): v is Coach {
  return Boolean(v) && (v.quest === null || typeof v.quest === 'string') && Number.isInteger(v.step) && v.step >= 0
    && Array.isArray(v.done) && v.done.every((d: unknown) => typeof d === 'string')
    && v.marks && typeof v.marks === 'object' && Object.values(v.marks).every((n) => Number.isInteger(n))
    && typeof v.open === 'boolean';
}
