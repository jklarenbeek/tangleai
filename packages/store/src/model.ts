/**
 * The Tangle database model — a `jaren-model` 0.1 document for
 * @jarenjs/db `openStore`.
 *
 * Ten collections, one decision each:
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
 *   sources / document_versions / document_elements / document_chunks —
 *               the independent, replaceable web-document corpus lane.
 *   settings  — key/value host configuration (folder, provider).
 *   config_identities — the content-addressed, credential-free run
 *               identities runs and chats refer to by id. Stored once
 *               per identity; a run row carries only the reference.
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
          identityId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
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
          identityId: { type: ['string', 'null'] },
          usage: { type: ['object', 'null'] },
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
    sources: {
      schema: {
        type: 'object',
        required: ['id', 'requestedUrl', 'finalUrl', 'canonicalUrl', 'title', 'mimeType', 'fetchMode', 'status', 'fetchedAt'],
        properties: {
          id: ID,
          requestedUrl: { type: 'string' },
          finalUrl: { type: 'string' },
          canonicalUrl: { type: 'string' },
          title: { type: ['string', 'null'] },
          mimeType: { type: 'string' },
          fetchMode: { enum: ['static', 'bun-webview', 'remote-playwright'] },
          status: { enum: ['ready', 'failed', 'blocked', 'dynamic-unavailable'] },
          fetchedAt: { type: 'string' },
          activeVersionId: { type: 'string' },
        },
      },
      key: '/id',
    },
    document_versions: {
      schema: {
        type: 'object',
        required: ['id', 'sourceId', 'contentHash', 'extractionVersion', 'chunkerVersion', 'chunkerConfig', 'embeddedBy', 'status', 'fetchedAt', 'metrics'],
        properties: {
          id: ID,
          sourceId: ID,
          contentHash: { type: 'string' },
          extractionVersion: { type: 'string' },
          chunkerVersion: { type: 'string' },
          chunkerConfig: { type: 'object' },
          embeddedBy: { type: 'object' },
          status: { enum: ['staging', 'active', 'failed', 'superseded'] },
          fetchedAt: { type: 'string' },
          metrics: { type: 'object' },
        },
      },
      key: '/id',
    },
    document_elements: {
      schema: {
        type: 'object',
        required: ['id', 'sourceId', 'versionId', 'text', 'role', 'order', 'headingPath'],
        properties: {
          id: ID,
          sourceId: ID,
          versionId: ID,
          text: { type: 'string' },
          role: { type: 'string' },
          order: { type: 'integer' },
          headingPath: { type: 'array', items: { type: 'string' } },
        },
      },
      key: '/id',
    },
    document_chunks: {
      schema: {
        type: 'object',
        required: ['id', 'sourceId', 'versionId', 'elementIds', 'text', 'tokenCount', 'order', 'headingPath', 'embedding', 'embeddedBy'],
        properties: {
          id: ID,
          sourceId: ID,
          versionId: ID,
          elementIds: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
          tokenCount: { type: 'integer' },
          order: { type: 'integer' },
          headingPath: { type: 'array', items: { type: 'string' } },
          embedding: { type: 'array', items: { type: 'number' } },
          embeddedBy: { type: 'object' },
        },
      },
      key: '/id',
    },
    settings: {
      schema: {
        type: 'object',
        required: ['key'],
        properties: { key: ID, value: {} },
      },
      key: '/key',
    },
    config_identities: {
      schema: {
        type: 'object',
        required: ['id', 'value'],
        properties: {
          id: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          value: { type: 'object' },
        },
      },
      key: '/id',
    },
  },
} as const;
