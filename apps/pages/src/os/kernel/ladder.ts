/**
 * Grading: the skill ladder every part of the OS reports into. It is the
 * ladder *Monkey Grove* teaches arithmetic with, applied to everything
 * else a person learns here — running the machine, governing the council,
 * contracts, documents, data, apps, working with a language model, and
 * the Turing puzzles: a one-sided Elo rating per skill (items have fixed
 * difficulties and are never re-rated), new skills move fast and settle
 * after twenty attempts, a hinted success counts for less, and the next
 * challenge is aimed where the expected success is about two in three —
 * hard enough to be worth it, easy enough to keep going.
 *
 * Experience points sit on top: every finished step of anything earns
 * some, and ranks named after the life of a street mural mark the way.
 */

/** The ladder's constants. */
export const LADDER = Object.freeze({ start: 600, mastery: 850, masteryAccuracy: 0.8, masteryAttempts: 10, newK: 32, settledK: 16, settledAfter: 20, hinted: 0.7, offset: 108, history: 10 });

/** Developer skills: what the coach's quests teach. */
export const SKILLS: ReadonlyArray<{ id: string, name: string }> = Object.freeze([
  { id: 'machine', name: 'Turing machine' },
  { id: 'council', name: 'Governance' },
  { id: 'contracts', name: 'Contracts' },
  { id: 'documents', name: 'Documents' },
  { id: 'data', name: 'Data' },
  { id: 'apps', name: 'Apps' },
  { id: 'ai', name: 'Working with models' },
  { id: 'turing', name: 'Turing puzzles' },
  { id: 'math', name: 'Arithmetic' },
]);

/** Ranks by experience, in the life of a mural. */
export const RANKS: ReadonlyArray<{ xp: number, title: string }> = Object.freeze([
  { xp: 0, title: 'Chalk' },
  { xp: 60, title: 'Sketch' },
  { xp: 180, title: 'Tag' },
  { xp: 400, title: 'Spray' },
  { xp: 800, title: 'Mural' },
  { xp: 1500, title: 'Subway legend' },
  { xp: 3000, title: 'Radiant' },
]);

export type SkillRating = { r: number, n: number, hist: number[] };
export type Profile = { xp: number, skills: Record<string, SkillRating>, badges: string[] };

/** A newcomer. */
export function emptyProfile(): Profile {
  return { xp: 0, skills: {}, badges: [] };
}

/** The chance a player rated `r` meets an item of difficulty `d`. */
export function expected(r: number, d: number) {
  return 1 / (1 + 10 ** ((d - r) / 400));
}

export function ratingOf(profile: Profile, skill: string): SkillRating {
  return profile.skills[skill] ?? { r: LADDER.start, n: 0, hist: [] };
}

/** Score one attempt. */
export function rate(profile: Profile, attempt: { skill: string, correct: boolean, difficulty: number, hinted?: boolean }): { profile: Profile, delta: number, mastered: boolean } {
  const s = ratingOf(profile, attempt.skill);
  const k = s.n < LADDER.settledAfter ? LADDER.newK : LADDER.settledK;
  const score = attempt.correct ? (attempt.hinted ? LADDER.hinted : 1) : 0;
  const delta = k * (score - expected(s.r, attempt.difficulty));
  const next = { r: s.r + delta, n: s.n + 1, hist: [...s.hist, attempt.correct ? 1 : 0].slice(-LADDER.history) };
  const updated = { ...profile, skills: { ...profile.skills, [attempt.skill]: next } };
  return { profile: updated, delta, mastered: isMastered(next) };
}

export function isMastered(s: SkillRating) {
  return s.r >= LADDER.mastery && s.n >= LADDER.masteryAttempts && s.hist.length >= LADDER.history
    && s.hist.reduce((a, b) => a + b, 0) / s.hist.length >= LADDER.masteryAccuracy;
}

/**
 * The difficulty to aim the next challenge of a skill at: about 65 %
 * expected success.
 */
export function targetDifficulty(profile: Profile, skill: string) {
  return ratingOf(profile, skill).r - LADDER.offset;
}

/** Of a set of challenges, the one closest to the target difficulty. */
export function pickChallenge<T extends { skill: string, difficulty: number }>(profile: Profile, items: readonly T[]): T | null {
  let best: T | null = null;
  let gap = Infinity;
  for (const item of items) {
    const g = Math.abs(item.difficulty - targetDifficulty(profile, item.skill));
    if (g < gap) { gap = g; best = item; }
  }
  return best;
}

/** The rank of an experience total, and how far into the next. */
export function rankOf(xp: number): { title: string, level: number, next: string | null, progress: number } {
  let level = 0;
  while (level + 1 < RANKS.length && xp >= RANKS[level + 1].xp) level++;
  const here = RANKS[level];
  const there = RANKS[level + 1];
  return {
    title: here.title,
    level,
    next: there?.title ?? null,
    progress: there ? Math.max(0, Math.min(1, (xp - here.xp) / (there.xp - here.xp))) : 1,
  };
}

/** Earn experience (and a badge, once). */
export function award(profile: Profile, amount: number, badge?: string): { profile: Profile, rankUp: boolean } {
  const xp = profile.xp + Math.max(0, Math.round(amount));
  const badges = badge && !profile.badges.includes(badge) ? [...profile.badges, badge] : profile.badges;
  return { profile: { ...profile, xp, badges }, rankUp: rankOf(xp).level > rankOf(profile.xp).level };
}

/** Whether a value is a profile this OS can restore. */
export function isProfile(value: any): value is Profile {
  return Boolean(value) && Number.isInteger(value.xp) && value.xp >= 0 && Array.isArray(value.badges)
    && value.badges.every((b: unknown) => typeof b === 'string')
    && value.skills && typeof value.skills === 'object'
    && Object.values(value.skills).every((s: any) => s && Number.isFinite(s.r) && Number.isInteger(s.n) && Array.isArray(s.hist));
}
