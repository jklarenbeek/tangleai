/** Independent Tangle-authored expectations. No runtime temporal import is allowed here. */
export type FixtureJson = null | boolean | number | string | FixtureJson[] | { [key: string]: FixtureJson };
export interface StrictTemporalOutcome {
  status: 'success' | 'refused' | 'fallback'; reason: string | null;
  claimIds: string[]; sourceIds: string[]; value: FixtureJson;
}
export interface TemporalFixtureSource {
  id: string; text: string; observed: number | string; knownAt?: number | string;
  scope?: string; sessionOrdinal?: number; turnOrdinal?: number;
}
export interface TemporalFixtureClaim {
  id: string; source: string; subject: string; series: string; value: string;
  kind: 'state' | 'event' | 'unknown'; from?: number | string; until?: number | string | null;
  precision?: 'millisecond' | 'minute' | 'day' | 'month' | 'year';
}
export interface TemporalFixture {
  id: string; description: string;
  action: 'select' | 'duplicate' | 'citation' | 'axes' | 'date' | 'resolve' | 'elapsed' | 'projection' | 'prepare';
  sources: TemporalFixtureSource[]; claims: TemporalFixtureClaim[];
  input: { [key: string]: FixtureJson }; expected: StrictTemporalOutcome;
}
const success = (claimIds: string[] = [], sourceIds: string[] = [], value: FixtureJson = null): StrictTemporalOutcome =>
  ({ status: 'success', reason: null, claimIds, sourceIds, value });
const refused = (reason: string): StrictTemporalOutcome => ({ status: 'refused', reason, claimIds: [], sourceIds: [], value: null });
const source: TemporalFixtureSource = { id: 's1', text: 'Alex lives on Elm from epoch 0 up to epoch 10.', observed: 0 };
const state: TemporalFixtureClaim = { id: 'c1', source: 's1', subject: 'alex', series: 'address', value: 'Elm', kind: 'state', from: 0, until: 10 };
function selection(id: string, description: string, at: number, expected: StrictTemporalOutcome, claims = [state], sources = [source], input: TemporalFixture['input'] = {}): TemporalFixture {
  return { id, description, action: 'select', sources, claims, input: { at, subject: 'alex', series: 'address', operation: 'at', ...input }, expected };
}
function operation(id: string, description: string, action: TemporalFixture['action'], input: TemporalFixture['input'], expected: StrictTemporalOutcome,
  sources: TemporalFixtureSource[] = [], claims: TemporalFixtureClaim[] = []): TemporalFixture {
  return { id, description, action, input, expected, sources, claims };
}
const events: TemporalFixtureSource[] = [
  { id: 'start', text: 'Recovery completed today, January 19, 2023.', observed: '2023-01-19T00:00:00Z' },
  { id: 'end', text: 'The tenth jog happened today, April 10, 2023.', observed: '2023-04-10T00:00:00Z' },
];
const eventClaims: TemporalFixtureClaim[] = events.map((s, i) => ({ id: i ? 'finish' : 'begin', source: s.id, subject: 'alex', series: i ? 'jog' : 'recovery',
  value: i ? 'jog' : 'recovery', kind: 'event', from: s.observed, precision: 'day' }));

export const TEMPORAL_FIXTURES: readonly TemporalFixture[] = [
  selection('T01', 'Half-open state includes its start', 0, success(['c1'], ['s1'])),
  selection('T02', 'Half-open state includes the instant before its end', 9, success(['c1'], ['s1'])),
  selection('T03', 'Half-open state excludes its end', 10, refused('no-match')),
  selection('T04', 'The next state includes the shared boundary', 10, success(['c1'], ['s1']), [{ ...state, from: 10, until: 20 }]),
  selection('T05', 'An empty state is invalid, not a point event', 10, refused('invalid-time'), [{ ...state, from: 10, until: 10 }]),
  selection('T05b', 'A reversed state range is invalid', 10, refused('invalid-time'), [{ ...state, from: 20, until: 10 }]),
  selection('T06', 'As-of before the first state has no match', -1, refused('no-match'), [state], [source], { operation: 'as-of' }),
  selection('T07', 'As-of exactly at start selects the state', 0, success(['c1'], ['s1']), [state], [source], { operation: 'as-of' }),
  selection('T08', 'As-of in a validity gap has no match', 15, refused('no-match'), [state, { ...state, id: 'c2', from: 20, until: 30 }], [source], { operation: 'as-of' }),
  selection('T09', 'Overlapping incompatible states are a conflict', 5, refused('conflicting-claims'), [state, { ...state, id: 'c2', value: 'Oak' }]),
  selection('T10', 'An expired newer state cannot hide an older valid state', 50, success(['c1'], ['s1']),
    [{ ...state, until: 100 }, { ...state, id: 'c2', from: 20, until: 30, value: 'Oak' }], [source], { operation: 'as-of' }),
  selection('T11', 'Same dates on another person remain outside the target series', 5, success(['c1'], ['s1']), [state, { ...state, id: 'c2', subject: 'bea', value: 'Oak' }]),
  selection('T12', 'An unspecified subject cannot disambiguate two same-name series', 5, refused('ambiguous-series'), [state, { ...state, id: 'c2', subject: 'other-alex', value: 'Oak' }], [source], { subject: null }),
  operation('T13', 'Repeated text at separate dates remains two occurrences', 'duplicate', {}, success([], ['s1', 's2'], { occurrences: 2 }),
    [source, { ...source, id: 's2', observed: 20 }]),
  operation('T14', 'Repeated source session IDs retain original ordinals', 'duplicate', { sameSessionLocator: true }, success([], ['s1', 's2'], { occurrences: 2 }),
    [{ ...source, sessionOrdinal: 0 }, { ...source, id: 's2', observed: 20, sessionOrdinal: 1 }]),
  operation('T15', 'A citation cannot resolve in a foreign scope', 'citation', { foreignScope: true }, refused('identity-mismatch'), [source], [state]),
  operation('T16', 'Source observation does not replace described event time', 'axes', {}, success(['c1'], ['s1'], { observed: 30, validFrom: 0 }), [{ ...source, observed: 30 }], [state]),
  selection('T17', 'Observed-only legacy memory has unknown validity', 5, refused('unknown-validity'), [{ ...state, kind: 'unknown', from: undefined, until: undefined }]),
  selection('T18', 'A strict cutoff excludes a future source', 5, refused('future-source'), [state], [{ ...source, observed: 30 }], { profile: 'strict-as-of', cutoff: 20 }),
  selection('T19', 'A future event described by an already-known source remains eligible', 100, success(['c1'], ['s1']), [{ ...state, kind: 'event', from: 100, until: undefined }], [source], { profile: 'strict-as-of', cutoff: 20 }),
  operation('T20', 'Retrospective and strict views have distinct identities', 'projection', { mode: 'profiles' }, success([], [], { different: true }), [source], [state]),
  operation('T21', 'Yesterday from March 1 in a leap year means February 29', 'resolve', { operand: 'yesterday', anchor: '2024-03-01T12:00:00Z' },
    success([], [], { from: '2024-02-29T00:00:00.000Z', until: '2024-03-01T00:00:00.000Z', precision: 'day' })),
  operation('T22', 'Relative queries without an anchor refuse', 'resolve', { operand: 'yesterday' }, refused('unanchored-relative')),
  operation('T23', 'The common-year leap day is invalid', 'date', { at: '2023-02-29T00:00:00Z' }, refused('invalid-time')),
  operation('T24', 'Leap-day crossing spans two civil days', 'elapsed', { start: '2024-02-28T00:00:00Z', end: '2024-03-01T00:00:00Z', unit: 'day' }, success(['begin', 'finish'], ['start', 'end'], { whole: 2, remainder: 0, unit: 'day', remainderUnit: 'day' })),
  operation('T25', 'January 19 to April 10 is eleven weeks plus four days', 'elapsed', { start: events[0].observed, end: events[1].observed, unit: 'week' },
    success(['begin', 'finish'], ['start', 'end'], { whole: 11, remainder: 4, unit: 'week', remainderUnit: 'day' }), events, eventClaims),
  operation('T26', 'Different offsets can denote one instant', 'date', { at: '2024-03-01T00:00:00Z', equivalent: '2024-03-01T02:00:00+02:00' }, success([], [], { equal: true })),
  operation('T27', 'Month-only evidence cannot answer an exact-day elapsed query', 'elapsed', { start: '2024-02-01T00:00:00Z', end: '2024-03-01T00:00:00Z', unit: 'day', precision: 'month' }, refused('unknown-validity')),
  operation('T28', 'Reversed elapsed endpoints refuse', 'elapsed', { start: '2024-03-02T00:00:00Z', end: '2024-03-01T00:00:00Z', unit: 'day' }, refused('invalid-time')),
  operation('T29', 'Named-zone/DST requests require an injected zone definition', 'resolve', { operand: 'yesterday', anchor: '2024-03-01T12:00:00Z', zone: 'Europe/Amsterdam' }, refused('invalid-time')),
  operation('T30', 'Wrong weekday in a corpus source stamp refuses', 'date', { sourceStamp: '2024/02/29 (Fri) 12:00' }, refused('invalid-time')),
  selection('T31', 'A complete empty projection is a no-match', 5, refused('no-match'), [], []),
  operation('T32', 'Missing or incomplete projections cannot answer', 'projection', { mode: 'incomplete' }, refused('incomplete-index'), [source], [state]),
  operation('T33', 'An outdated captured head is stale', 'projection', { mode: 'stale' }, refused('stale-projection'), [source], [state]),
  selection('T34', 'An embedding identity mismatch refuses comparison', 5, refused('identity-mismatch'), [state], [source], { wrongEmbedding: true }),
  operation('T35', 'Failed activation never exposes a partial new head', 'projection', { mode: 'failed-activation' }, success([], [], { unchangedHead: true }), [source], [state]),
  operation('T36', 'Reopen preserves exact projection and answer', 'projection', { mode: 'reopen' }, success(['c1'], ['s1'], { equal: true }), [source], [state]),
  operation('T37', 'Identical successful preparation replays with zero additional effects', 'prepare', { mode: 'replay' }, success([], [], { extraCalls: 0, extraWrites: 0, extraActivations: 0 }), [source], [state]),
  operation('T38', 'Concurrent same-key preparation makes one provider purchase', 'prepare', { mode: 'concurrent' }, success([], [], { calls: 1, activations: 1 }), [source], [state]),
  operation('T39', 'An uncited model claim never activates', 'prepare', { mode: 'uncited' }, refused('identity-mismatch'), [source], [state]),
  operation('T40', 'Zero physical request budget makes zero transport calls', 'prepare', { mode: 'zero-budget' }, refused('budget-exhausted'), [source], [state]),
  operation('T41', 'Calendar month arithmetic clamps January 31 to leap February 29', 'elapsed', { start: '2024-01-31T00:00:00Z', end: '2024-02-29T00:00:00Z', unit: 'month' },
    success(['begin', 'finish'], ['start', 'end'], { whole: 1, remainder: 0, unit: 'month', remainderUnit: 'day' })),
  operation('T42', 'A source span cannot split an astral character', 'citation', { splitSurrogate: true }, refused('identity-mismatch'), [{ ...source, text: 'A 😀 rehearsal.' }], [state]),
  operation('T43', 'Previous month means the whole previous calendar month', 'resolve', { operand: 'previous-month', anchor: '2024-03-15T12:00:00Z' },
    success([], [], { from: '2024-02-01T00:00:00.000Z', until: '2024-03-01T00:00:00.000Z', precision: 'month' })),
  operation('T44', 'Previous calendar week starts Monday', 'resolve', { operand: 'previous-week', anchor: '2024-03-06T12:00:00Z' },
    success([], [], { from: '2024-02-26T00:00:00.000Z', until: '2024-03-04T00:00:00.000Z', precision: 'day' })),
  operation('T45', 'An evidenced open state is distinct from an unknown end', 'select', { at: 100, subject: 'alex', series: 'address', operation: 'at' }, success(['c1'], ['s1']), [source], [{ ...state, until: null }]),
].map(f => JSON.parse(JSON.stringify(f)) as TemporalFixture);

/** Deliberate errors, each of which the independent scorer must reject. */
export const TEMPORAL_WRONG_CONTROLS: readonly { name: string; caseId: string; actual: StrictTemporalOutcome }[] = [
  { name: 'closed-end inclusion', caseId: 'T03', actual: success(['c1'], ['s1']) },
  { name: 'observation substituted for validity', caseId: 'T16', actual: success(['c1'], ['s1'], { observed: 30, validFrom: 30 }) },
  { name: 'future knowledge leakage', caseId: 'T18', actual: success(['c1'], ['s1']) },
  { name: 'cross-scope citation', caseId: 'T15', actual: success(['c1'], ['s1']) },
  { name: 'tolerant arithmetic', caseId: 'T25', actual: success(['begin', 'finish'], ['start', 'end'], { whole: 12, remainder: 4, unit: 'week', remainderUnit: 'day' }) },
  { name: 'false empty success', caseId: 'T31', actual: success() },
];
