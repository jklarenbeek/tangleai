/**
 * The dynamic tool-call budget, as a pure model the Arena races.
 *
 * A language model hands its work to the OS through tool calls whose
 * arguments are JSON, and a small model loses its grip on a long
 * argument — a bracket left open, a string cut short — long before a
 * bigger model does. So the OS cuts a big argument into chunks whose
 * size is a per-model setting, the tool-call budget, in five tiers from
 * `tiny` (300 characters a call) to `unlimited` (the whole document in
 * one call). Too small a budget pays the round trip of every call; too
 * large a budget pays for the calls that fail and must be sent again.
 *
 * One call of `chars` characters comes back whole with the chance
 *
 *     P(ok | chars) = 1 / (1 + (chars / c50) ^ k)
 *
 * — even odds at `c50` characters, falling away steeply past it — and
 * costs a base latency (the round trip and the prompt) plus a time per
 * character (the decoding). A failed call is retried; a chunk that fails
 * `MAX_TRIES` times in a row makes the lane give up, as an agent would.
 * `raceToolBudgets` runs one lane per tier delivering the same document
 * and ranks them by when they finished: the race the Arena animates, and
 * the table the OS shows when it tunes a model's budget.
 *
 * Deterministic: every lane draws from the same seeded stream — common
 * random numbers, so two tiers that cut the document the same way meet
 * the same luck and finish together — and no draw is left unseeded.
 */

import { mulberry32 } from '@jarenjs/core/random';

export type TierId = 'tiny' | 'small' | 'medium' | 'large' | 'unlimited';
/** `chars: null` sends everything in one call. */
export type Tier = { id: TierId, chars: number | null };
export type Profile = { id: string, label: string, c50: number, k: number, baseMs: number, charMs: number };
/** One simulated call: start, duration, characters. */
export type Call = { at: number, ms: number, size: number, ok: boolean };
/** `ms`: the simulated time the lane finished or gave up at. */
export type Lane = {
  tier: TierId, budget: number | null, calls: Call[], delivered: number, failures: number,
  finished: boolean, ms: number,
};
/** `ranking`: finishers by time, then the rest by how far they got; `endMs`: when the podium was decided. */
export type BudgetRace = {
  profile: string, chars: number, seed: number, lanes: Lane[], ranking: TierId[],
  recommended: TierId, endMs: number,
};

/** The budget tiers, smallest first: the characters one call may carry. */
export const TIERS: readonly Tier[] = Object.freeze([
  Object.freeze({ id: 'tiny', chars: 300 }),
  Object.freeze({ id: 'small', chars: 600 }),
  Object.freeze({ id: 'medium', chars: 2400 }),
  Object.freeze({ id: 'large', chars: 12000 }),
  Object.freeze({ id: 'unlimited', chars: null }),
]);

/**
 * The model profiles. `c50` is where half the calls of that length fail;
 * the timings are about four characters a token: a mixture-of-experts
 * model with three billion active parameters decodes fast but frays
 * early, a dense 27B model holds a longer argument and decodes slowly, a
 * frontier model holds nearly anything.
 */
export const PROFILES: Readonly<Record<string, Readonly<Profile>>> = Object.freeze({
  'moe-3b-active': Object.freeze({ id: 'moe-3b-active', label: 'MoE 3B active', c50: 700, k: 3, baseMs: 700, charMs: 3 }),
  'dense-27b': Object.freeze({ id: 'dense-27b', label: 'Dense 27B', c50: 4000, k: 3, baseMs: 1200, charMs: 8 }),
  frontier: Object.freeze({ id: 'frontier', label: 'Frontier', c50: 40000, k: 3, baseMs: 1500, charMs: 4 }),
});

/** Tries one chunk gets before its lane gives up on the document. */
export const MAX_TRIES = 8;

/** True when a value names one of the profiles. */
export const isProfile = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(PROFILES, id);

/** A profile by id (or the profile itself). */
export function profileOf(profile: string | Profile): Profile {
  if (typeof profile !== 'string') return profile;
  if (!isProfile(profile)) throw new RangeError(`unknown model profile ${profile}`);
  return PROFILES[profile];
}

/** A tier by id. */
export const tierOf = (id: string): Tier | undefined => TIERS.find((t) => t.id === id);

/** The chance one call of `chars` characters comes back whole. */
export function successChance(profile: string | Profile, chars: number): number {
  const p = profileOf(profile);
  if (chars <= 0) return 1;
  return 1 / (1 + Math.pow(chars / p.c50, p.k));
}

/**
 * Whether one call succeeds, for a uniform draw `u` in [0, 1): the
 * reliability curve cut at the draw.
 */
export function callSucceeds(profile: string | Profile, chars: number, u: number): boolean {
  return u < successChance(profile, chars);
}

/** The chunk a tier cuts a document of `chars` characters into. */
export const chunkOf = (tier: Tier, chars: number) => (tier.chars === null ? chars : Math.min(tier.chars, chars));

/**
 * One lane: send the document chunk by chunk, retrying failures, until
 * it is delivered or one chunk has failed `MAX_TRIES` times.
 */
function runLane(profile: Profile, tier: Tier, chars: number, seed: number): Lane {
  const random = mulberry32(seed);
  const chunk = chunkOf(tier, chars);
  const calls: Call[] = [];
  let at = 0;
  let delivered = 0;
  let failures = 0;
  let tries = 0;
  while (delivered < chars && tries < MAX_TRIES) {
    const size = Math.min(chunk, chars - delivered);
    const ms = profile.baseMs + size * profile.charMs;
    const ok = callSucceeds(profile, size, random());
    calls.push({ at, ms, size, ok });
    at += ms;
    if (ok) {
      delivered += size;
      tries = 0;
    }
    else {
      failures += 1;
      tries += 1;
    }
  }
  return { tier: tier.id, budget: tier.chars, calls, delivered, failures, finished: delivered >= chars, ms: at };
}

/**
 * Finishers first, by time; then the lanes that gave up, by how far they
 * got. Ties keep tier order, so of two budgets that did the same the
 * smaller one ranks first — it also cuts the next, bigger document.
 */
function byFinish(a: Lane, b: Lane) {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  return a.finished ? a.ms - b.ms : b.delivered - a.delivered;
}

/**
 * The whole race at once: every tier delivers the same document for the
 * same model, and the best budget is the one that finished first.
 */
export function raceToolBudgets(profile: string | Profile, chars: number, seed: number): BudgetRace {
  const p = profileOf(profile);
  const total = Math.max(1, Math.round(chars));
  const lanes = TIERS.map((tier) => runLane(p, tier, total, seed >>> 0));
  const ranked = lanes.slice().sort(byFinish);
  const finishers = ranked.filter((l) => l.finished);
  // the race is decided once the podium is: the third finisher, or the
  // last one when fewer finish; with no finisher, when the last gives up
  const endMs = finishers.length > 0
    ? finishers[Math.min(2, finishers.length - 1)].ms
    : Math.max(...lanes.map((l) => l.ms));
  return { profile: p.id, chars: total, seed: seed >>> 0, lanes, ranking: ranked.map((l) => l.tier), recommended: ranked[0].tier, endMs };
}

/**
 * How far a lane has carried the document at simulated time `t`, in
 * [0, 1]: the chunks delivered, plus most of the one in flight — a
 * failing call carries its runner forward and then drops it back.
 */
export function laneProgress(lane: Lane, chars: number, t: number) {
  let done = 0;
  for (const call of lane.calls) {
    if (call.at >= t) break;
    if (call.at + call.ms > t) return Math.min(1, (done + call.size * 0.92 * ((t - call.at) / call.ms)) / chars);
    if (call.ok) done += call.size;
  }
  return Math.min(1, done / chars);
}
