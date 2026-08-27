/**
 * Loading LoCoMo, and refusing to pretend about it.
 *
 * The dataset arrives as a git submodule (`benchmark/locomo`, the
 * upstream `snap-research/locomo` repository) rather than as a committed
 * copy or a download script, for three reasons that are all licence or
 * honesty reasons rather than convenience ones:
 *
 *  - the data is **CC BY-NC 4.0**, and a submodule is a POINTER — this
 *    repository (MIT) never redistributes it;
 *  - a submodule pins an exact upstream commit, so "which LoCoMo" is a
 *    hash in `.gitmodules` instead of a sentence in a README;
 *  - the release ships `data/locomo10.json` in the repository itself,
 *    so there is no dataset URL to guess and nothing to checksum against
 *    a number somebody typed.
 *
 * Two rules hold in this file. **An absent submodule is a value, not a
 * throw** — a checkout without `--recurse-submodules` is the normal case
 * in CI, and every instrument must be able to say "skipped, and here is
 * the command" instead of failing. And **nothing is repaired.** The
 * malformed evidence ids are counted and reported, never rewritten,
 * because a benchmark that quietly fixes its own ground truth is a
 * benchmark that cannot be compared with the published numbers.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { JarenValidator } from '@jarenjs/validate';
import { compileDateParser } from '@jarenjs/core/dates/parse';
import { epochOfRFC3339Parts } from '@jarenjs/core/dates/rfc3339';
import type { DateNames } from '@jarenjs/core/dates/format';

import SCHEMA from '../schemas/locomo10.schema.json' with { type: 'json' };

/** Where the submodule sits, relative to the repository root. */
export const LOCOMO_DIR = 'benchmark/locomo';
/** The released dataset inside it. */
export const LOCOMO_DATASET = join(LOCOMO_DIR, 'data/locomo10.json');

/** The command that fixes an absent submodule. Printed, never run for the caller. */
export const INIT_COMMAND = 'git submodule update --init benchmark/locomo';

// ---------------------------------------------------------------------------
// the dataset, as it is
// ---------------------------------------------------------------------------

export interface LocomoTurn {
  speaker: string;
  dia_id: string;
  text: string;
  img_url?: string | string[];
  blip_caption?: string;
  query?: string;
}

export interface LocomoQa {
  question: string;
  /** Absent on 444 of the 446 adversarial questions; an integer on six. */
  answer?: string | number;
  adversarial_answer?: string;
  evidence?: string[];
  category: 1 | 2 | 3 | 4 | 5;
}

export interface LocomoSample {
  sample_id: string;
  conversation: Record<string, unknown> & { speaker_a: string, speaker_b: string };
  qa: LocomoQa[];
  observation?: Record<string, unknown>;
  session_summary?: Record<string, unknown>;
  event_summary?: Record<string, unknown>;
}

/** One session, flattened out of the `session_<n>` / `session_<n>_date_time` pair. */
export interface LocomoSession {
  /** The chronological number in the key name. */
  number: number;
  /** The raw upstream string, e.g. `1:56 pm on 8 May, 2023`. */
  dateText: string;
  /** Epoch milliseconds, or `null` when the string did not parse. */
  at: number | null;
  turns: LocomoTurn[];
}

export type LoadOutcome =
  | { available: false, reason: string, hint: string }
  | { available: true, samples: LocomoSample[], bytes: number, sha256: string, valid: true }
  | { available: true, samples: LocomoSample[], bytes: number, sha256: string, valid: false, errors: string[] };

// ---------------------------------------------------------------------------
// instants — the one date format, parsed by the suite's kernel
// ---------------------------------------------------------------------------

/** The names the LDML `MMMM` and `a` tokens need. LoCoMo is English, and
 * the pattern uses neither `MMM` nor a weekday token, so only these two
 * members are supplied. `meridiem` is a two-tuple in the published type. */
const NAMES: DateNames = {
  months: ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'],
  meridiem: ['am', 'pm'],
};

/**
 * Every one of the 288 session timestamps in the release has the same
 * shape — `1:56 pm on 8 May, 2023` — so one compiled LDML parser reads
 * all of them, strictly: a string that does not match answers `null`
 * rather than a guessed instant.
 *
 * The parts carry no zone (`offset: null`), because LoCoMo names none.
 * Reading them as UTC is a stated CONVENTION of this harness, not a fact
 * about the data; every conversation is read under the same one, so
 * intervals stay comparable across sessions and samples.
 */
export const SESSION_DATE_PATTERN = 'h:mm a on d MMMM, yyyy';
const readSessionDate = compileDateParser(SESSION_DATE_PATTERN, NAMES);

/** Epoch milliseconds for one upstream session timestamp, or `null`. */
export function sessionInstant(dateText: string): number | null {
  const parts = readSessionDate(dateText);
  if (parts === null) return null;
  const epoch = epochOfRFC3339Parts(parts as never);
  return Number.isFinite(epoch) ? epoch : null;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

/**
 * Read and validate the dataset. Never throws for a missing submodule or
 * a schema failure — both are outcomes the caller reports.
 */
export async function loadLocomo(root = process.cwd()): Promise<LoadOutcome> {
  let text: string;
  try {
    text = await readFile(join(root, LOCOMO_DATASET), 'utf8');
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return {
      available: false,
      reason: `${LOCOMO_DATASET} is not present (${why})`,
      hint: INIT_COMMAND,
    };
  }

  const samples = JSON.parse(text) as LocomoSample[];
  // the identity of the bytes a number was measured over — what
  // `sha256sum data/locomo10.json` prints, so a reader can check it
  const sha256 = createHash('sha256').update(text).digest('hex');
  // `collectErrors: true` makes the compiled validator answer
  // `{ valid, errors }` rather than a boolean — the same shape
  // `@tangleai/memory`'s store boundary reads.
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  const validate = validator.compile(SCHEMA as Record<string, unknown>);
  const outcome = validate(samples);
  if (outcome.valid) return { available: true, samples, bytes: text.length, sha256, valid: true };

  const errors = (outcome.errors ?? []).slice(0, 20).map((error) => {
    const e = error as { dataPath?: string, message?: string, msgid?: string };
    return `${e.dataPath ?? '/'} — ${e.message ?? e.msgid ?? 'invalid'}`;
  });
  return { available: true, samples, bytes: text.length, sha256, valid: false, errors };
}

/** The sessions of one sample, in chronological order. */
export function sessionsOf(sample: LocomoSample): LocomoSession[] {
  const sessions: LocomoSession[] = [];
  for (const key of Object.keys(sample.conversation)) {
    const match = /^session_(\d+)$/.exec(key);
    if (match === null) continue;
    const number = Number(match[1]);
    const dateText = sample.conversation[`session_${number}_date_time`];
    const text = typeof dateText === 'string' ? dateText : '';
    sessions.push({
      number,
      dateText: text,
      at: text === '' ? null : sessionInstant(text),
      turns: (sample.conversation[key] as LocomoTurn[]) ?? [],
    });
  }
  return sessions.sort((a, b) => a.number - b.number);
}

/**
 * The dialog ids of one sample. Scoped deliberately: `dia_id` repeats
 * across samples (every conversation restarts at `D1:1`), so a global
 * set would silently resolve one sample's evidence against another's
 * turns.
 */
export function dialogIdsOf(sample: LocomoSample): Set<string> {
  const ids = new Set<string>();
  for (const session of sessionsOf(sample)) {
    for (const turn of session.turns) ids.add(turn.dia_id);
  }
  return ids;
}


/**
 * Session numbers that carry a `session_<n>_date_time` stamp but no
 * `session_<n>` transcript. `conv-26` has sixteen of them (sessions
 * 20–35): the release timestamps them and ships no turns.
 *
 * They are reported rather than dropped because they change what a
 * timeline MEANS. A harness that builds its sessions from the stamps
 * gets sixteen empty sessions and a conversation that appears to run
 * months longer than its transcript does; a harness that builds from the
 * transcripts — which is what `sessionsOf` does — gets the truth and has
 * to say that the truth is shorter than the stamps claim.
 */
export function orphanStamps(sample: LocomoSample): number[] {
  const arrays = new Set<number>();
  const stamps = new Set<number>();
  for (const key of Object.keys(sample.conversation)) {
    const transcript = /^session_(\d+)$/.exec(key);
    if (transcript !== null) { arrays.add(Number(transcript[1])); continue; }
    const stamp = /^session_(\d+)_date_time$/.exec(key);
    if (stamp !== null) stamps.add(Number(stamp[1]));
  }
  return [...stamps].filter((n) => !arrays.has(n)).sort((a, b) => a - b);
}

/** The session number an evidence id names, or `null` if it is malformed. */
export function sessionOfDiaId(id: string): number | null {
  const match = /^D(\d+):\d+$/.exec(id);
  return match === null ? null : Number(match[1]);
}

/** The shape a well-formed evidence id has. Anything else is malformed. */
export const DIA_ID = /^D\d+:\d+$/;

/** The five QA categories, numbered as the release numbers them. */
export const CATEGORY_NAMES: Record<number, string> = {
  1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop', 5: 'adversarial',
};

/** The categories the parity scorer reads; 5 is excluded (see the census). */
export const SCORABLE_CATEGORIES = [1, 2, 3, 4] as const;
