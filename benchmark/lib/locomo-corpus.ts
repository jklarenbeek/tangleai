/**
 * LoCoMo turns as Tangle observations — the ingest side of the recall
 * instrument.
 *
 * The settled rules, each of which is a line below:
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

import type { MemoryUnit } from '@tangleai/core/schemas/memory';
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

// ---------------------------------------------------------------------------
// the transcript as a request — the long-context row
// ---------------------------------------------------------------------------

/**
 * Every ingestible turn as a memory unit whose id is its `dia_id`, in
 * transcript order and never embedded. This is what the long-context
 * row puts in the request: the same `[id] (date) speaker: text` line
 * the ranked rows use, so a citation resolves the same way, but with
 * the release's own turn id in the brackets — the whole conversation
 * needs no content hash to be addressable.
 */
export function transcriptUnits(corpus: ConversationCorpus): MemoryUnit[] {
  const units: MemoryUnit[] = [];
  const prefix = `${corpus.sampleId}/`;
  for (const session of corpus.sessions) {
    for (const input of session.inputs) {
      units.push({
        id: input.evidence.startsWith(prefix) ? input.evidence.slice(prefix.length) : input.evidence,
        text: input.text,
        evidence: input.evidence,
        tags: input.tags ?? [],
        at: input.at,
        kind: input.kind ?? 'event',
      });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// the release's two derived corpora — the paper's other RAG databases
// ---------------------------------------------------------------------------

/**
 * What a derived corpus holds and how much of it resolved. Nothing is
 * repaired: an entry the release wrote badly is counted under the
 * column that says how, and left out only when it cannot be a memory
 * at all (no text, or no session instant to stamp it with).
 */
export interface AuxCensus {
  /** `session_<n>_observation` / `session_<n>_summary` blocks in the release. */
  blocks: number;
  /** Blocks naming a session with no ingestible transcript — skipped, counted. */
  orphanBlocks: number;
  /** Entries with no text — skipped, counted. */
  empty: number;
  /** Texts that became inputs. */
  entries: number;
  /** Turn references the inputs carry: an observation's dia_ids, a summary's whole session. */
  references: number;
  /** Inputs carrying more than one reference (an observation's `dia_id` list, every summary). */
  listReferences: number;
  /** References that resolve to no turn of the conversation. */
  unresolved: number;
  /** Inputs whose content-addressed id repeats an earlier input's. */
  collapsed: number;
  chars: number;
}

export function emptyAuxCensus(): AuxCensus {
  return { blocks: 0, orphanBlocks: 0, empty: 0, entries: 0, references: 0, listReferences: 0, unresolved: 0, collapsed: 0, chars: 0 };
}

export function addAuxCensus(into: AuxCensus, from: AuxCensus): void {
  for (const key of Object.keys(into) as Array<keyof AuxCensus>) into[key] += from[key];
}

/** A derived corpus of one conversation, in the shape the shared ingest takes. */
export interface AuxCorpus {
  sampleId: string;
  kind: 'observation' | 'summary';
  /** Chronological; every session block whose transcript session has an instant. */
  sessions: CorpusSession[];
  /** The conversation's last session instant — the same clock as the turns. */
  lastAt: number;
  census: AuxCensus;
}

/**
 * The dia_ids one observation cites. The release writes them as a
 * string, as a comma-joined string, or as an array; all three are read,
 * none is rewritten.
 */
export function observationReferences(raw: unknown): { ids: string[], list: boolean } {
  if (typeof raw === 'string') {
    const ids = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    return { ids, list: ids.length > 1 };
  }
  if (Array.isArray(raw)) {
    const ids = raw.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter((s) => s !== '');
    return { ids, list: true };
  }
  return { ids: [], list: false };
}

/**
 * The release's `observation` corpus as Tangle inputs: one memory per
 * observation, `evidence` the dia_ids it was written from (scoped, and
 * joined with `; ` exactly as a crystallized survivor joins its own),
 * tagged by speaker and session, stamped with the session instant. The
 * paper's finding is that this corpus retrieves differently from the
 * dialog; here it enters the same pipeline, the same ranker and the
 * same prompt, so the only thing that differs IS the corpus.
 */
export function observationCorpus(sample: LocomoSample, turns: ConversationCorpus): AuxCorpus {
  const census = emptyAuxCensus();
  const bySession = new Map(turns.sessions.map((s) => [s.number, s]));
  const sessions: CorpusSession[] = [];
  const ids = new Set<string>();
  for (const [key, block] of Object.entries(sample.observation ?? {})) {
    const match = /^session_(\d+)_observation$/.exec(key);
    if (match === null) continue;
    census.blocks++;
    const session = bySession.get(Number(match[1]));
    if (session === undefined) { census.orphanBlocks++; continue; }
    const inputs: MemoryUnitInput[] = [];
    for (const [speaker, entries] of Object.entries((block ?? {}) as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!Array.isArray(entry)) continue;
        const text = typeof entry[0] === 'string' ? entry[0].trim() : '';
        if (text === '') { census.empty++; continue; }
        const refs = observationReferences(entry[1]);
        if (refs.list) census.listReferences++;
        census.references += refs.ids.length;
        for (const id of refs.ids) if (!turns.addresses.has(addressOf(sample.sample_id, id))) census.unresolved++;
        const id = memoryId(text);
        if (ids.has(id)) census.collapsed++;
        ids.add(id);
        census.entries++;
        census.chars += text.length;
        inputs.push({
          text,
          // an observation citing nothing still names where it came from — the block — so the evidence rule holds and `addressesOf` credits nothing
          evidence: refs.ids.length === 0 ? `${sample.sample_id}/${key}` : refs.ids.map((d) => addressOf(sample.sample_id, d)).join('; '),
          tags: [speaker, `session:${session.number}`],
          at: session.atText,
          kind: 'fact',
        });
      }
    }
    sessions.push({ number: session.number, at: session.at, atText: session.atText, inputs });
  }
  sessions.sort((a, b) => a.number - b.number);
  return { sampleId: sample.sample_id, kind: 'observation', sessions, lastAt: turns.lastAt, census };
}

/**
 * The release's `session_summary` corpus as Tangle inputs: one memory
 * per session summary, its `evidence` every turn of the session it
 * summarizes. That is the honest evidence — the summary was generated
 * from exactly those turns — and it is also what makes the row's
 * ceiling a SESSION-level number: a retrieved summary counts as holding
 * every turn of its session, whether or not the summary kept the fact.
 * The published table says so beside the row.
 */
export function summaryCorpus(sample: LocomoSample, turns: ConversationCorpus): AuxCorpus {
  const census = emptyAuxCensus();
  const bySession = new Map(turns.sessions.map((s) => [s.number, s]));
  const sessions: CorpusSession[] = [];
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(sample.session_summary ?? {})) {
    const match = /^session_(\d+)_summary$/.exec(key);
    if (match === null) continue;
    census.blocks++;
    const session = bySession.get(Number(match[1]));
    if (session === undefined || session.inputs.length === 0) { census.orphanBlocks++; continue; }
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '') { census.empty++; continue; }
    const addresses = session.inputs.map((input) => input.evidence);
    census.references += addresses.length;
    if (addresses.length > 1) census.listReferences++;
    const id = memoryId(text);
    if (ids.has(id)) census.collapsed++;
    ids.add(id);
    census.entries++;
    census.chars += text.length;
    sessions.push({
      number: session.number,
      at: session.at,
      atText: session.atText,
      inputs: [{ text, evidence: addresses.join('; '), tags: [`session:${session.number}`], at: session.atText, kind: 'summary' }],
    });
  }
  sessions.sort((a, b) => a.number - b.number);
  return { sampleId: sample.sample_id, kind: 'summary', sessions, lastAt: turns.lastAt, census };
}
