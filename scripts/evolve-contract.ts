/**
 * Bundle the evolve read contract once; the wire has no second DTO tree.
 *
 * Three operations, all `read`. There is deliberately no operation that
 * merges, promotes, approves, runs, cancels or stops an experiment: the
 * authority to land a change is absent from this surface rather than
 * defended inside a handler, and adding one would show up as a breaking
 * contract diff against the frozen baseline rather than as a quiet commit.
 */
import { readFile, writeFile } from 'node:fs/promises';
import schema from '../packages/evolve/schemas/evolve.schema.json' with { type: 'json' };

const id = { type: 'string', minLength: 1 };

/** Query and result shapes. The records themselves come from the schema. */
const contractDefs = {
  experimentsListQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      repository: id,
      baseRevision: { $ref: '#/$defs/revision40' },
      status: { $ref: '#/$defs/status' },
      decision: { $ref: '#/$defs/decision' },
      // Bounded on purpose: a read operation that can ask for everything
      // is a denial-of-service surface with a friendly name.
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
  },
  experimentsListResult: {
    type: 'object',
    required: ['experiments', 'truncated'],
    additionalProperties: false,
    properties: {
      experiments: { type: 'array', items: { $ref: '#/$defs/evolveExperiment' } },
      /** True when the bound cut the answer, so a caller never infers "none left". */
      truncated: { type: 'boolean' },
    },
  },
  experimentGetQuery: {
    type: 'object',
    required: ['experimentId'],
    additionalProperties: false,
    properties: { experimentId: id },
  },
  experimentGetResult: {
    type: 'object',
    required: ['experiment', 'recordIds'],
    additionalProperties: false,
    properties: {
      experiment: { $ref: '#/$defs/evolveExperiment' },
      /** The ids of every record this experiment produced, in order. */
      recordIds: { type: 'array', items: id },
    },
  },
  reviewGetQuery: {
    type: 'object',
    required: ['experimentId'],
    additionalProperties: false,
    properties: { experimentId: id },
  },
  reviewGetResult: {
    type: 'object',
    required: ['bundle'],
    additionalProperties: false,
    properties: {
      // The bundle carries the diff DIGEST and its byte count, never the
      // diff text and never what the gate printed. A reviewer reads those
      // from the branch the experiment left behind, where they are
      // attributable, rather than from a payload that could be edited on
      // the way past.
      bundle: { $ref: '#/$defs/evolveReviewBundle' },
    },
  },
} as const;

const operations = {
  'evolve.experiments.list': {
    kind: 'read',
    input: { $ref: '#/$defs/experimentsListQuery' },
    output: { $ref: '#/$defs/experimentsListResult' },
  },
  'evolve.experiment.get': {
    kind: 'read',
    input: { $ref: '#/$defs/experimentGetQuery' },
    output: { $ref: '#/$defs/experimentGetResult' },
  },
  'evolve.review.get': {
    kind: 'read',
    input: { $ref: '#/$defs/reviewGetQuery' },
    output: { $ref: '#/$defs/reviewGetResult' },
  },
};

const bytes = JSON.stringify({
  $contract: '0.1',
  id: 'tangle-evolve',
  version: '1',
  $defs: { ...schema.$defs, ...contractDefs },
  operations,
}, null, 2) + '\n';

const path = new URL('../packages/evolve/schemas/evolve.contract.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) {
    throw Error('EVOLVE contract bundle is stale; run npm run emit:evolve-contract');
  }
} else await writeFile(path, bytes);
