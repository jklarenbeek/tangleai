/** Paired comparisons carry their measured scope and refuse missing scientific denominators. */
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: object, more: object = {}) => ({ type: 'array', items, ...more });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const ref = (name: string) => ({ $ref: '#/$defs/' + name });
const external = (name: string) => ({ $ref: 'https://tangleai.dev/schemas/research-records#/$defs/' + name });
const text = { type: 'string', minLength: 1 }, bool = { type: 'boolean' }, count = { type: 'integer', minimum: 0 };
const score = { type: 'number', minimum: 0, maximum: 1 }, number = { type: 'number' };
const eq = (a: unknown, b: unknown) => ({ $eq: [a, b] });
const size = (path: string) => ({ $count: path });
const cost = Object.fromEntries(['calls', 'tokens', 'ms', 'physical'].map(name => [name, count]));
const eligible = (path: string) => ({ $and: [eq(path + '.purpose', 'superiority'), path + '.comparable', { $ne: [path + '.interval', null] },
  { $gt: [path + '.interval.low', 0] }, eq(path + '.safetyRefusals', 0), path + '.cost.withinBound', path + '.outcomeEligible'] });
export const RESEARCH_ABLATION_REPORT_ID = 'https://tangleai.dev/schemas/research-ablation';
export const RESEARCH_ABLATION_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#', $id: RESEARCH_ABLATION_REPORT_ID,
  ...object({ registration: object({ id: { const: 'research-ablation-v1' }, primary: { const: 'claimSupport*registryAccuracy*preregistrationIntegrity' },
      seed: { const: 17753 }, resamples: { const: 2000 }, level: { const: 0.95 }, direction: { const: 'treatment-minus-baseline' } }),
    rows: array(ref('ResearchAblationRow'), { minItems: 1 }), pairs: array(ref('ResearchAblationPair'), { minItems: 8 }),
    gate: object({ writebackEligible: bool, fullAutoEligible: bool }), limitations: array(text, { minItems: 1 }) }),
  $defs: {
    ResearchAblationBudget: object(Object.fromEntries(Object.keys(cost).map(name => [name, nullable(count)]))),
    ResearchAblationTopic: { ...object({ id: text, hash: external('Sha256'), seeds: array(count, { uniqueItems: true }),
      claimSupport: nullable(score), registryAccuracy: nullable(score), preregistrationIntegrity: nullable(score),
      primary: nullable(score), completion: nullable(bool), source: text }),
      $query: { $or: [{ $and: [eq('$.primary', null), { $or: [eq('$.claimSupport', null), eq('$.registryAccuracy', null), eq('$.preregistrationIntegrity', null)] }] },
        { $and: [...['claimSupport', 'registryAccuracy', 'preregistrationIntegrity'].map(name => ({ $ne: ['$.' + name, null] })),
          eq('$.primary', { $mul: ['$.claimSupport', { $mul: ['$.registryAccuracy', '$.preregistrationIntegrity'] }] })] }] } },
    ResearchAblationRow: object({ id: text, family: { enum: ['core', 'lessons', 'domain', 'probe', 'external'] },
      state: { enum: ['measured', 'not-run', 'refused', 'implementation-missing'] }, scope: text,
      topics: array(ref('ResearchAblationTopic')), identityStatus: { enum: ['run', 'not-run', 'legacy-unrecorded'] },
      identityId: nullable(external('Sha256')), comparisonIdentity: nullable(external('Sha256')),
      promptRevisions: array(external('Sha256'), { uniqueItems: true }), budget: ref('ResearchAblationBudget'), spend: object(cost),
      safetyRefusals: count, outcomeEligible: bool, refusals: array(text), provenance: array(text, { minItems: 1 }), limitations: array(text) }),
    ResearchAblationPair: { ...object({ id: text, purpose: { enum: ['superiority', 'parity'] }, baseline: text, treatment: text,
      comparable: bool, refusals: array(external('ResearchIssue')), topics: array(object({ topicId: text, baseline: score, treatment: score, delta: number })),
      delta: nullable(number), interval: nullable(object({ low: number, high: number })),
      losses: array(object({ topicId: text, delta: { type: 'number', exclusiveMaximum: 0 } })), safetyRefusals: count, outcomeEligible: bool,
      cost: object({ baseline: object(cost), treatment: object(cost), delta: object(Object.fromEntries(Object.keys(cost).map(name => [name, number]))),
        registered: ref('ResearchAblationBudget'), withinBound: bool }), eligible: bool }),
      $query: { $and: [eq('$.comparable', eq(size('$.refusals[*]'), 0)), eq('$.eligible', eligible('$')),
        eq(['$.losses[*].topicId'], ['$.topics[?(@.delta<0)].topicId']), eq(['$.losses[*].delta'], ['$.topics[?(@.delta<0)].delta']),
        { $every: { topic: '$.topics[*]' }, $satisfies: eq('$topic.delta', { $sub: ['$topic.treatment', '$topic.baseline'] }) },
        ...Object.keys(cost).map(name => eq('$.cost.delta.' + name, { $sub: ['$.cost.treatment.' + name, '$.cost.baseline.' + name] })),
        eq('$.cost.withinBound', { $and: Object.keys(cost).flatMap(name => [{ $ne: ['$.cost.registered.' + name, null] },
          { $le: ['$.cost.treatment.' + name, '$.cost.registered.' + name] },
          { $le: ['$.cost.baseline.' + name, '$.cost.registered.' + name] }]) }),
        { $or: [{ $and: [eq('$.comparable', false), eq('$.delta', null), eq('$.interval', null), eq(size('$.topics[*]'), 0)] },
          { $and: [eq('$.comparable', true), { $gt: [size('$.topics[*]'), 0] },
            eq('$.delta', { $div: [{ $sum: '$.topics[*].delta' }, size('$.topics[*]')] }), { $le: ['$.interval.low', '$.interval.high'] }] }] },
      ] } },
  },
  $query: { $and: [
    eq(size('$.rows[*]'), { $count: { $distinct: '$.rows[*].id' } }),
    eq(size('$.pairs[*]'), { $count: { $distinct: '$.pairs[*].id' } }),
    eq('$.gate.writebackEligible', { $some: { pair: '$.pairs[*]' }, $satisfies: { $and: [eq('$pair.id', 'lessons-on-vs-off'), '$pair.eligible'] } }),
    eq('$.gate.fullAutoEligible', { $some: { pair: '$.pairs[*]' }, $satisfies: { $and: [eq('$pair.id', 'gate-only-vs-full-auto'), '$pair.eligible'] } }),
    { $every: { pair: '$.pairs[*]' }, $satisfies: { $some: { baseline: '$.rows[*]' }, $satisfies: { $and: [
      eq('$baseline.id', '$pair.baseline'), { $some: { treatment: '$.rows[*]' }, $satisfies: { $and: [
        eq('$treatment.id', '$pair.treatment'), eq('$pair.safetyRefusals', { $add: ['$baseline.safetyRefusals', '$treatment.safetyRefusals'] }),
      ] } },
    ] } } },
    { $every: { pair: '$.pairs[*]' }, $satisfies: { $and: ['baseline', 'treatment'].map(side =>
      ({ $some: { row: '$.rows[*]' }, $satisfies: { $and: [eq('$row.id', '$pair.' + side),
        eq('$row.spend', '$pair.cost.' + side),
        side === 'baseline' ? eq('$row.budget', '$pair.cost.registered') : eq('$row.outcomeEligible', '$pair.outcomeEligible'),
        { $or: [eq('$pair.comparable', false), { $and: [eq(['$row.topics[*].id'], ['$pair.topics[*].topicId']),
          { $every: { pairedTopic: '$pair.topics[*]' }, $satisfies: { $some: { topic: '$row.topics[*]' }, $satisfies: { $and: [
            eq('$topic.id', '$pairedTopic.topicId'), eq('$topic.primary', '$pairedTopic.' + side),
          ] } } },
        ] }] },
      ] } })) } },
  ] },
};
