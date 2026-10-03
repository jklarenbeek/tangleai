/** Privileged annotation oracle, independent of the place runtime and question expectations. */
import { geoDistance, geohashEncode, geohashNeighbours } from '@jarenjs/core/geo';
import { asOfJoin } from '@jarenjs/core/series';
import { prefixProximityGate, planarArithmeticGate, spatialOperatorGate } from '@tangleai/jaren/spatial';
import type { LoadedPlaceFixture, PlaceInput } from './place-fixture.ts';
import type { Outcome, Report } from './place-report.types.ts';

export function placeGateFixtures(loaded: LoadedPlaceFixture): Report['gateFixtures'] {
  const gates = [
    { path: 'refusals/prefix-as-proximity.json', code: 'AI0230', gate: prefixProximityGate({ proximity: true }) },
    { path: 'refusals/planar-degrees.json', code: 'AI0231', gate: planarArithmeticGate({ members: ['at', 'here'] }) },
    { path: 'refusals/no-spatial-operator.json', code: 'AI0232', gate: spatialOperatorGate({ spatial: true }) },
  ];
  return gates.map(({ path, code, gate }) => {
    const actual = gate(loaded.fixture.gateDocuments[path]);
    const actualCode: string | null = actual === true ? null : actual.errors[0]?.code ?? null;
    return { path, expectedCode: code, actualCode, passed: actualCode === code };
  });
}

export function placeOracle(loaded: LoadedPlaceFixture, question: PlaceInput): Outcome {
  const { fixture, corpus } = loaded;
  const entry = (id: string) => {
    const found = fixture.entries.find(e => e.id === id);
    if (!found) throw new Error(`oracle received an unknown entry: ${id}`);
    return found;
  };
  if (question.kind === 'nearby') {
    const centre = entry(question.entryId);
    return { entryIds: fixture.entries.filter(e => e.id !== centre.id && geoDistance(centre.geometry, e.geometry)! <= question.radiusMetres).map(e => e.id).sort() };
  }
  if (question.kind === 'false-proximity') {
    const a = entry(question.entryId), b = entry(question.otherEntryId);
    const left = geohashEncode(a.geometry.coordinates[0], a.geometry.coordinates[1], 6), right = geohashEncode(b.geometry.coordinates[0], b.geometry.coordinates[1], 6);
    return { ninecell: geohashNeighbours(left).includes(right) && geoDistance(a.geometry, b.geometry)! <= question.radiusMetres,
      singlePrefix: right.startsWith(left), gate: placeGateFixtures(loaded).find(g => g.expectedCode === 'AI0230')?.actualCode ?? 'not-refused' };
  }
  if (corpus.status !== 'available') throw new Error(corpus.detail);
  if (question.kind === 'ungrounded' || question.kind === 'ambiguous') {
    const mention = fixture.mentions.find(m => m.id === question.mentionId && m.sampleId === question.sampleId && m.subject === question.subject);
    if (!mention) throw new Error('oracle mention operand does not resolve');
    return mention.status === 'grounded' ? { entryId: mention.entryId! } : { refused: mention.status === 'ambiguous' ? 'TPLC1006' : 'TPLC1005' };
  }
  const positions = fixture.mentions.filter(m => m.subject === question.subject && m.positionEligible).map(m => ({ mention: m, turn: corpus.turns.get(`${m.sampleId}/${m.diaId}`)! }));
  const at = (diaId: string): Outcome => {
    const event = corpus.turns.get(`${question.sampleId}/${diaId}`);
    if (!event) throw new Error('oracle event operand does not resolve');
    const match = asOfJoin([{ at: event.at, value: 0 }], positions.map((p, index) => ({ at: p.turn.at, value: index })), { direction: 'backward' })[0];
    if (match.right === null) return { refused: 'TPLC1008' };
    const position = positions[match.right.value!];
    if (position.mention.kind === 'state') return { refused: 'TPLC1009', cause: 'unknown-validity' };
    return position.turn.at === event.at ? { entryId: position.mention.entryId! } : { refused: 'TPLC1008' };
  };
  if (question.kind !== 'movement-distance') return at(question.eventDiaId);
  const from = at(question.fromDiaId), to = at(question.toDiaId);
  if (!('entryId' in from)) return from;
  if (!('entryId' in to)) return to;
  return { fromEntryId: from.entryId, toEntryId: to.entryId, metres: Math.round(geoDistance(entry(from.entryId).geometry, entry(to.entryId).geometry)!) };
}
