/** Hash-verified original annotations; licensed conversation text stays in its submodule. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { isValidGeoJson } from '@jarenjs/core/geo';
import { loadLocomo, type LocomoSample } from './locomo.ts';
import { conversationCorpus, transcriptUnits, type TurnRecord } from './locomo-corpus.ts';
import { requirePlaceShape } from './place-validation.ts';
import type { FixtureManifest, GazetteerFile, MentionsFile, QuestionsFile, ProvenanceFile, WrongControlsFile, Question } from './place-report.types.ts';

export const PLACE_FIXTURE_PATH = 'benchmark/fixtures/place';
export const PLACE_MEMBERS = ['gazetteer.json', 'mentions.json', 'provenance.json', 'questions.json',
  'refusals/no-spatial-operator.json', 'refusals/planar-degrees.json', 'refusals/prefix-as-proximity.json', 'refusals/wrong-controls.json'] as const;
export const placeHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export type PlaceInput<T = Question> = T extends { expected: unknown } ? Omit<T, 'expected'> : never;
export interface PlaceTurn extends TurnRecord { sampleId: string; text: string; }
export interface PlaceFixture {
  manifest: FixtureManifest; entries: GazetteerFile['entries']; mentions: MentionsFile['rows']; questions: QuestionsFile['rows'];
  provenance: ProvenanceFile; wrongControls: WrongControlsFile['rows']; gateDocuments: Record<string, unknown>;
}
export type PlaceCorpus = { status: 'unavailable'; detail: string; unresolvedMentions: 0 } |
  { status: 'available'; detail: null; unresolvedMentions: 0; samples: LocomoSample[]; turns: Map<string, PlaceTurn> };
export interface LoadedPlaceFixture { fixture: PlaceFixture; fixtureHash: string; corpus: PlaceCorpus; }

export async function loadPlaceFixture(options: { root?: string; corpusRoot?: string } = {}): Promise<LoadedPlaceFixture> {
  const root = options.root ?? process.cwd(), path = join(root, PLACE_FIXTURE_PATH);
  const manifest = requirePlaceShape<FixtureManifest>(JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')));
  if (manifest.document !== 'place-fixture' || canonicalizeJson(manifest.files.map(f => f.path).sort()) !== canonicalizeJson([...PLACE_MEMBERS])) throw new Error('place fixture member inventory differs');
  const files = new Map<string, unknown>();
  for (const member of manifest.files) {
    const bytes = await readFile(join(path, member.path));
    if (placeHash(bytes) !== member.sha256) throw new Error(`place fixture hash drift: ${member.path}`);
    files.set(member.path, JSON.parse(bytes.toString('utf8')));
  }
  const entries = requirePlaceShape<GazetteerFile>(files.get('gazetteer.json')).entries;
  const mentions = requirePlaceShape<MentionsFile>(files.get('mentions.json')).rows;
  const questions = requirePlaceShape<QuestionsFile>(files.get('questions.json')).rows;
  const provenance = requirePlaceShape<ProvenanceFile>(files.get('provenance.json'));
  const wrongControls = requirePlaceShape<WrongControlsFile>(files.get('refusals/wrong-controls.json')).rows;
  const gateDocuments = Object.fromEntries(PLACE_MEMBERS.filter(p => p.startsWith('refusals/') && !p.endsWith('wrong-controls.json')).map(p => [p, files.get(p)]));
  const fixture = { manifest, entries, mentions, questions, provenance, wrongControls, gateDocuments };
  validateInventory(fixture);
  const fixtureHash = await canonicalSha256(manifest), corpus = await loadLocomo(options.corpusRoot ?? root);
  if (!corpus.available) return { fixture, fixtureHash, corpus: { status: 'unavailable', detail: `${corpus.reason}; ${corpus.hint}`, unresolvedMentions: 0 } };
  if (!corpus.valid || corpus.sha256 !== manifest.source.sha256) throw new Error('place source corpus is invalid or its registered hash moved');
  const turns = new Map<string, PlaceTurn>();
  for (const sample of corpus.samples) {
    const conversation = conversationCorpus(sample), texts = new Map(transcriptUnits(conversation).map(u => [u.id, u.text]));
    for (const turn of conversation.turns) turns.set(turn.address, { ...turn, sampleId: sample.sample_id, text: texts.get(turn.diaId)! });
  }
  let unresolved = 0;
  for (const mention of mentions) {
    const turn = turns.get(`${mention.sampleId}/${mention.diaId}`);
    if (!turn || mention.subject !== `${mention.sampleId}/${turn.speaker}` || mention.start >= mention.end || mention.end > turn.text.length ||
      await canonicalSha256(turn.text.slice(mention.start, mention.end)) !== mention.quoteSha256) unresolved++;
  }
  if (unresolved) throw new Error(`unresolved-mention: ${unresolved}; exact source spans must verify before measurement`);
  if (turns.size !== manifest.census.turns) throw new Error('place source turn census differs');
  return { fixture, fixtureHash, corpus: { status: 'available', detail: null, unresolvedMentions: 0, samples: corpus.samples, turns } };
}

function validateInventory(f: PlaceFixture): void {
  const { manifest: m, entries, mentions, questions, provenance } = f;
  const ids = new Set(entries.map(e => e.id)), mentionIds = new Set(mentions.map(v => v.id));
  if (ids.size !== entries.length || mentionIds.size !== mentions.length || new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('duplicate place fixture identity');
  for (const e of entries) {
    if (!isValidGeoJson(e.geometry) || e.geometry.coordinates.length !== 2 || e.geometry.coordinates[0] !== e.sourceLatLon.lon || e.geometry.coordinates[1] !== e.sourceLatLon.lat) throw new Error(`place source coordinate differs: ${e.id}`);
    if (provenance.coordinates.filter(p => p.entryId === e.id).length !== 1) throw new Error('place coordinate provenance is incomplete');
  }
  if (provenance.coordinates.length !== entries.length) throw new Error('foreign coordinate provenance');
  for (const v of mentions) if ((v.status === 'grounded') !== (v.entryId !== null) || v.entryId !== null && !ids.has(v.entryId) || v.candidates.some(id => !ids.has(id)) || v.status === 'ambiguous' && v.candidates.length < 2 || v.positionEligible && v.status !== 'grounded') throw new Error('inconsistent place mention');
  const coverage = { mentionSites: mentions.length, grounded: mentions.filter(v => v.status === 'grounded').length,
    ungrounded: mentions.filter(v => v.status === 'ungrounded').length, ambiguous: mentions.filter(v => v.status === 'ambiguous').length,
    personas: new Set(mentions.filter(v => v.positionEligible).map(v => v.subject)).size, positions: mentions.filter(v => v.positionEligible).length };
  if (canonicalizeJson(coverage) !== canonicalizeJson(m.coverage) || entries.length !== m.census.entries || questions.length !== m.census.questions) throw new Error('place census does not reconcile');
  for (const [kind, count] of Object.entries(m.census.byKind)) if (questions.filter(q => q.kind === kind).length !== count) throw new Error('place question census does not reconcile');
  const locationConversations = new Set(questions.filter(q => q.kind === 'location-at-event').map(q => q.sampleId)).size;
  const movementConversations = new Set(questions.filter(q => q.kind === 'movement-distance').map(q => q.sampleId)).size;
  const fraction = coverage.grounded / coverage.mentionSites;
  if (m.floor.groundedFraction !== fraction || m.floor.locationConversations !== locationConversations || m.floor.movementConversations !== movementConversations || m.floor.unsourcedEntries !== 0 || m.floor.passed !== (fraction >= .8 && locationConversations >= 6 && movementConversations >= 4)) throw new Error('place floor does not reconcile');
  if (m.registration.k > m.registration.candidatePool || new Set(m.registration.rows.map(r => `${r.row}/${r.backend}`)).size !== m.registration.rows.length) throw new Error('invalid place registration');
}
