/**
 * LoCoMo turns as Tangle observations — the ingest side of order 02.
 *
 * The settled rules (TODO 02), each of which is a line below:
 *
 *  - **A memory is a turn, and its evidence is its address.** One
 *    `MemoryUnitInput` per turn. `text` is the turn text; a turn that
 *    carries an image appends its `blip_caption` (counted, so a reader
 *    knows how many memories are part caption). `evidence` is
 *    `<sample_id>/<dia_id>` — SCOPED, because every conversation
 *    restarts at `D1:1` and 02a pins that they collide. `tags` carry the
 *    speaker and the session number. `at` is the session instant.
 *  - **Turns of one session share an instant.** LoCoMo stamps sessions,
 *    not turns; a per-turn time would be fabricated evidence. Order
 *    inside a session is `seq`, kept HERE in the corpus index — the
 *    memory record has no such member, and adding one would be a memory
 *    claiming a precision its source does not have.
 *  - **Nothing is repaired.** A session whose stamp does not parse has
 *    no instant, so its turns cannot be ingested honestly; they are
 *    counted in `refused` and left out. The pinned release parses
 *    272 of 272, so the count is 0 — but it is a count, not an
 *    assumption.
 *
 * One property of the pipeline is measured here rather than discovered
 * downstream: memory ids are content-addressed (`memoryId(text)`), so
 * two turns with identical text in one conversation are ONE memory —
 * "Take care, bye!" said in session 16 and again in session 17
 * collapses, and the earlier address is gone from the store. The
 * release has five such pairs, none of them evidence for any question;
 * `collapsed` reports them so the number stays visible if that changes.
 */

import { memoryId, type MemoryUnitInput } from '@tangleai/memory';

import { sessionsOf, type LocomoSample, type LocomoTurn } from './locomo.ts';

/** The scoped evidence address of one turn. */
export function addressOf(sampleId: string, diaId: string): string {
  return `${sampleId}/${diaId}`;
}

/** What a turn says, with its image caption appended when it carries one. */
export function turnText(turn: LocomoTurn): string {
  const caption = turn.blip_caption?.trim();
  return caption === undefined || caption === '' ? turn.text : `${turn.text} [image: ${caption}]`;
}

export interface TurnRecord {
  address: string;
  diaId: string;
  session: number;
  /** Position in the whole conversation, 0-based, transcript order. */
  seq: number;
  speaker: string;
  /** Epoch milliseconds of the session. */
  at: number;
  image: boolean;
}

export interface CorpusSession {
  number: number;
  /** Epoch milliseconds. */
  at: number;
  /** The same instant as RFC 3339 — the memory record's contract. */
  atText: string;
  inputs: MemoryUnitInput[];
}

export interface ConversationCorpus {
  sampleId: string;
  /** Chronological, every session whose stamp parsed. */
  sessions: CorpusSession[];
  /** Every ingested turn, in `seq` order. */
  turns: TurnRecord[];
  /** The addresses a retrieval can ever return for this conversation. */
  addresses: Set<string>;
  /** Sessions with a stamp that did not parse — their turns are not here. */
  refused: number;
  imageTurns: number;
  /** Inputs whose content-addressed id repeats an earlier input's. */
  collapsed: number;
  /** The last session instant — the pipeline's clock for this conversation. */
  lastAt: number;
}

/** Build the observation corpus of one conversation. */
export function conversationCorpus(sample: LocomoSample): ConversationCorpus {
  const sessions: CorpusSession[] = [];
  const turns: TurnRecord[] = [];
  const addresses = new Set<string>();
  const ids = new Set<string>();
  let refused = 0;
  let imageTurns = 0;
  let collapsed = 0;
  let lastAt = Number.NEGATIVE_INFINITY;

  for (const session of sessionsOf(sample)) {
    if (session.at === null) { refused++; continue; }
    const atText = new Date(session.at).toISOString();
    const inputs: MemoryUnitInput[] = [];
    for (const turn of session.turns) {
      const text = turnText(turn);
      const address = addressOf(sample.sample_id, turn.dia_id);
      const image = turn.img_url !== undefined;
      if (image) imageTurns++;
      const id = memoryId(text);
      if (ids.has(id)) collapsed++;
      ids.add(id);
      inputs.push({
        text,
        evidence: address,
        tags: [turn.speaker, `session:${session.number}`],
        at: atText,
        kind: 'event',
      });
      turns.push({ address, diaId: turn.dia_id, session: session.number, seq: turns.length, speaker: turn.speaker, at: session.at, image });
      addresses.add(address);
    }
    sessions.push({ number: session.number, at: session.at, atText, inputs });
    if (session.at > lastAt) lastAt = session.at;
  }

  return { sampleId: sample.sample_id, sessions, turns, addresses, refused, imageTurns, collapsed, lastAt };
}

/**
 * The turn addresses a stored memory cites, in the order its `evidence`
 * names them. A freshly ingested turn cites one; a crystallized survivor
 * cites its own and then every absorbed record's (`applyCrystallization`
 * joins them with `; `); a contradiction resolution cites memory ids and
 * a reason, which is not a turn address at all and answers `[]`.
 *
 * Scoped to the conversation, so a foreign address — which the
 * per-conversation store cannot hold anyway — is never credited.
 */
export function addressesOf(evidence: string, sampleId: string): string[] {
  const own = new RegExp(`^${sampleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/D\\d+:\\d+$`);
  return evidence.split('; ').filter((part) => own.test(part));
}
