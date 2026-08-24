/**
 * The Tangle database model — a `jaren-model` 0.1 document for
 * @jarenjs/db `openStore`.
 *
 * Six collections, one decision each:
 *
 *   memories  — the MemoryUnit records. The db-level schema is
 *               deliberately minimal: the REAL write gate is
 *               `MEMORY_UNIT_SCHEMA`, enforced by `createDbMemoryStore`
 *               at the MemoryStore boundary (same rule as the in-memory
 *               store). Validating twice with two schemas invites drift.
 *   runs      — one record per pipeline run: kind, status, summary.
 *   events    — one record per DAG node record per run; this is the
 *               "historical DAG state" the desktop surface renders.
 *   chats     — the conversation transcript with citations.
 *   documents — folder-sync state: content hash per file, so an
 *               unchanged file is skipped on re-sync.
 *   settings  — key/value host configuration (folder, provider).
 *
 * Keys are JSON Pointers into the document (`key: '/id'`), so the id
 * lives IN the record — a row is self-describing when exported.
 */

import type { JsonSchema } from '@tangleai/core/schemas/memory';

const ID: JsonSchema = { type: 'string', minLength: 1 };

export const TANGLE_DB_MODEL = {
  $model: '0.1',
  collections: {
    memories: {
      schema: { type: 'object', required: ['id'], properties: { id: ID } },
      key: '/id',
    },
    runs: {
      schema: {
        type: 'object',
        required: ['id', 'kind', 'startedAt', 'status'],
        properties: {
          id: ID,
          kind: { type: 'string' },
          startedAt: { type: 'string' },
          finishedAt: { type: ['string', 'null'] },
          status: { enum: ['running', 'ok', 'error'] },
          summary: {},
        },
      },
      key: '/id',
    },
    events: {
      schema: {
        type: 'object',
        required: ['id', 'runId', 'seq', 'node', 'status', 'at'],
        properties: {
          id: ID,
          runId: { type: 'string' },
          seq: { type: 'integer' },
          node: { type: 'string' },
          status: { type: 'string' },
          ms: { type: 'number' },
          at: { type: 'string' },
        },
      },
      key: '/id',
    },
    chats: {
      schema: {
        type: 'object',
        required: ['id', 'role', 'text', 'at'],
        properties: {
          id: ID,
          role: { enum: ['user', 'assistant'] },
          text: { type: 'string' },
          at: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } },
          provider: { type: ['string', 'null'] },
        },
      },
      key: '/id',
    },
    documents: {
      schema: {
        type: 'object',
        required: ['path', 'hash', 'chunks', 'ingestedAt'],
        properties: {
          path: { type: 'string', minLength: 1 },
          hash: { type: 'string' },
          chunks: { type: 'integer' },
          ingestedAt: { type: 'string' },
        },
      },
      key: '/path',
    },
    settings: {
      schema: {
        type: 'object',
        required: ['key'],
        properties: { key: ID, value: {} },
      },
      key: '/key',
    },
  },
} as const;
