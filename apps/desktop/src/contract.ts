/**
 * The desktop API as a @jarenjs/contract document.
 *
 * One document is the whole wire: the server serves it (`serveHttp` →
 * `toNodeHandler`), the browser client validates against it before
 * sending, `/.well-known/jaren-contract` describes it, and the SSE
 * stream (`dag.live`) rides the same declaration. The UI bundle imports
 * this same constant — server and client cannot drift apart without a
 * typecheck or a JC2053 saying so.
 *
 * Commands are all `idempotency: none` (no ledger) on purpose: every
 * command here is either naturally re-runnable (sync skips unchanged
 * files by content hash) or append-only chat, and the desktop is a
 * single-user surface.
 */

const MEMORY_SUMMARY = {
  type: 'object',
  required: ['id', 'text', 'evidence', 'tags', 'at', 'kind'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    evidence: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    at: { type: 'string' },
    kind: { type: 'string' },
    confidence: { type: 'number' },
    supersededBy: { type: 'string' },
    supersededReason: { type: 'string' },
    mergedFrom: { type: 'array', items: { type: 'string' } },
    hasEmbedding: { type: 'boolean' },
    embeddedBy: {
      type: 'object',
      properties: { model: { type: 'string' }, dims: { type: 'integer' } },
    },
  },
} as const;

const RUN = {
  type: 'object',
  required: ['id', 'kind', 'startedAt', 'status'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    startedAt: { type: 'string' },
    finishedAt: { type: ['string', 'null'] },
    status: { type: 'string' },
    summary: {},
  },
} as const;

const CHAT_MESSAGE = {
  type: 'object',
  required: ['id', 'role', 'text', 'at'],
  properties: {
    id: { type: 'string' },
    role: { enum: ['user', 'assistant'] },
    text: { type: 'string' },
    at: { type: 'string' },
    citations: { type: 'array', items: { type: 'string' } },
    provider: { type: ['string', 'null'] },
  },
} as const;

export const SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    folder: { type: ['string', 'null'] },
    chat: {
      type: 'object',
      properties: {
        provider: { enum: ['ollama', 'openrouter', 'lmstudio', 'custom', null] },
        baseUrl: { type: ['string', 'null'] },
        model: { type: ['string', 'null'] },
        apiKey: { type: ['string', 'null'] },
      },
    },
    embed: {
      type: 'object',
      properties: {
        provider: { enum: ['builtin', 'ollama', 'lmstudio', 'openrouter', 'custom'] },
        baseUrl: { type: ['string', 'null'] },
        model: { type: ['string', 'null'] },
        apiKey: { type: ['string', 'null'] },
      },
    },
    documents: {
      type: 'object',
      properties: {
        chunker: { enum: ['recursive', 'semantic-boundary', 's2'] },
        maxTokens: { type: 'integer', minimum: 16, maximum: 4000 },
        overlapTokens: { type: 'integer', minimum: 0, maximum: 1000 },
      },
    },
    browser: {
      type: 'object',
      properties: {
        mode: { enum: ['disabled', 'webview', 'remote'] },
        endpoint: { type: ['string', 'null'] },
        token: { type: ['string', 'null'] },
        allowUnsafeLocal: { type: 'boolean' },
      },
    },
    search: {
      type: 'object',
      properties: { searxngUrl: { type: ['string', 'null'] } },
    },
  },
} as const;

const DOCUMENT_SOURCE = {
  type: 'object',
  required: ['id', 'requestedUrl', 'finalUrl', 'canonicalUrl', 'title', 'mimeType', 'fetchMode', 'status', 'fetchedAt'],
  properties: {
    id: { type: 'string' },
    requestedUrl: { type: 'string' },
    finalUrl: { type: 'string' },
    canonicalUrl: { type: 'string' },
    title: { type: ['string', 'null'] },
    mimeType: { type: 'string' },
    fetchMode: { type: 'string' },
    status: { type: 'string' },
    fetchedAt: { type: 'string' },
    activeVersionId: { type: 'string' },
    error: { type: 'string' },
  },
} as const;

const DOCUMENT_VERSION = {
  type: 'object',
  required: ['id', 'sourceId', 'contentHash', 'extractionVersion', 'chunkerVersion', 'chunkerConfig', 'embeddedBy', 'status', 'fetchedAt', 'metrics'],
  properties: {
    id: { type: 'string' },
    sourceId: { type: 'string' },
    contentHash: { type: 'string' },
    extractionVersion: { type: 'string' },
    chunkerVersion: { type: 'string' },
    chunkerConfig: {
      type: 'object',
      required: ['maxTokens', 'overlapTokens'],
      properties: { maxTokens: { type: 'integer' }, overlapTokens: { type: 'integer' } },
    },
    embeddedBy: { type: 'object' },
    status: { type: 'string' },
    fetchedAt: { type: 'string' },
    activatedAt: { type: 'string' },
    metrics: { type: 'object' },
  },
} as const;

export const DESKTOP_CONTRACT = {
  $contract: '0.1',
  id: 'tangle-desktop',
  version: '0.1.0',
  operations: {
    'status.get': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['version', 'folder', 'counts'],
        properties: {
          version: { type: 'string' },
          folder: { type: ['string', 'null'] },
          chatConfigured: { type: 'boolean' },
          embedProvider: { type: 'string' },
          counts: {
            type: 'object',
            properties: {
              memories: { type: 'integer' },
              live: { type: 'integer' },
              runs: { type: 'integer' },
              documents: { type: 'integer' },
              sources: { type: 'integer' },
              documentChunks: { type: 'integer' },
            },
          },
        },
      },
      http: { method: 'GET', path: '/api/status' },
    },
    'settings.get': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: SETTINGS_SCHEMA,
      http: { method: 'GET', path: '/api/settings' },
    },
    'settings.set': {
      kind: 'command',
      input: { type: 'object', required: ['settings'], properties: { settings: SETTINGS_SCHEMA } },
      output: SETTINGS_SCHEMA,
      http: { method: 'POST', path: '/api/settings' },
    },
    'folder.sync': {
      kind: 'command',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['runId', 'files'],
        properties: {
          runId: { type: ['string', 'null'] },
          files: {
            type: 'object',
            properties: {
              scanned: { type: 'integer' },
              ingested: { type: 'integer' },
              skipped: { type: 'integer' },
            },
          },
          report: {},
        },
      },
      errors: {
        'no-folder': { status: 409 },
        'bad-folder': { status: 409 },
      },
      http: { method: 'POST', path: '/api/folder/sync' },
    },
    'documents.ingest': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', minLength: 1, maxLength: 4096 },
          strategy: { enum: ['recursive', 'semantic-boundary', 's2'] },
          allowBrowser: { type: 'boolean' },
          force: { type: 'boolean' },
          maxTokens: { type: 'integer', minimum: 16, maximum: 4000 },
          overlapTokens: { type: 'integer', minimum: 0, maximum: 1000 },
        },
      },
      output: {
        type: 'object',
        required: ['status', 'source', 'version', 'browserFallback'],
        properties: {
          status: { enum: ['ingested', 'unchanged'] },
          source: DOCUMENT_SOURCE,
          version: DOCUMENT_VERSION,
          browserFallback: { type: 'boolean' },
        },
      },
      errors: { 'ingest-failed': { status: 422 } },
      http: { method: 'POST', path: '/api/documents/ingest' },
    },
    'documents.ingestbatch': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['urls'],
        properties: {
          urls: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 4096 } },
          strategy: { enum: ['recursive', 'semantic-boundary', 's2'] },
          allowBrowser: { type: 'boolean' },
        },
      },
      output: { type: 'array', items: { type: 'object' } },
      http: { method: 'POST', path: '/api/documents/ingest-many' },
    },
    'documents.list': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: { type: 'array', items: DOCUMENT_SOURCE },
      http: { method: 'GET', path: '/api/documents' },
    },
    'documents.search': {
      kind: 'read',
      input: {
        type: 'object', required: ['q'],
        properties: { q: { type: 'string', minLength: 1, maxLength: 8000 }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
      },
      output: {
        type: 'object', required: ['ranked', 'skipped'],
        properties: { ranked: { type: 'array', items: { type: 'object' } }, skipped: { type: 'integer' } },
      },
      http: { method: 'GET', path: '/api/documents/search' },
    },
    'browser.status': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object', required: ['mode', 'available', 'safeForUntrusted', 'detail'],
        properties: {
          mode: { type: 'string' }, available: { type: 'boolean' }, safeForUntrusted: { type: 'boolean' }, detail: { type: 'string' },
        },
      },
      http: { method: 'GET', path: '/api/browser/status' },
    },
    'web.search': {
      kind: 'read',
      input: {
        type: 'object', required: ['q'],
        properties: { q: { type: 'string', minLength: 1, maxLength: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 20 } },
      },
      output: { type: 'object', required: ['results', 'suggestions'], properties: { results: { type: 'array' }, suggestions: { type: 'array' } } },
      errors: { 'search-unconfigured': { status: 409 } },
      http: { method: 'GET', path: '/api/web/search' },
    },
    'runs.list': {
      kind: 'read',
      input: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      output: { type: 'array', items: RUN },
      http: { method: 'GET', path: '/api/runs' },
    },
    'runs.get': {
      kind: 'read',
      input: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['run', 'events'],
        properties: {
          run: RUN,
          events: { type: 'array', items: { type: 'object' } },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/runs/detail' },
    },
    'dag.get': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['doc', 'mermaid', 'nodes'],
        properties: {
          doc: { type: 'object' },
          mermaid: { type: 'string' },
          nodes: { type: 'array', items: { type: 'string' } },
        },
      },
      http: { method: 'GET', path: '/api/dag' },
    },
    'dag.live': {
      kind: 'subscribe',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['run', 'nodes', 'seq'],
        properties: {
          run: { type: ['object', 'null'] },
          nodes: { type: 'object' },
          seq: { type: 'integer' },
        },
      },
      http: { method: 'GET', path: '/api/dag/live' },
    },
    'memories.list': {
      kind: 'read',
      input: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          tag: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          superseded: { type: 'boolean' },
        },
      },
      output: { type: 'array', items: MEMORY_SUMMARY },
      http: { method: 'GET', path: '/api/memories' },
    },
    'memories.get': {
      kind: 'read',
      input: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
      output: MEMORY_SUMMARY,
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/memories/detail' },
    },
    'chat.history': {
      kind: 'read',
      input: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      output: { type: 'array', items: CHAT_MESSAGE },
      http: { method: 'GET', path: '/api/chat' },
    },
    'chat.send': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 8000 } },
      },
      output: {
        type: 'object',
        required: ['reply', 'citations', 'documentCitations', 'provider'],
        properties: {
          reply: CHAT_MESSAGE,
          citations: { type: 'array', items: MEMORY_SUMMARY },
          documentCitations: { type: 'array', items: { type: 'object' } },
          provider: { type: ['string', 'null'] },
        },
      },
      http: { method: 'POST', path: '/api/chat' },
    },
    'provider.probe': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          models: { type: 'array' },
          status: {},
          error: { type: 'string' },
        },
      },
      http: { method: 'GET', path: '/api/provider/probe' },
    },
    'embed.probe': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          model: { type: 'string' },
          dims: { type: 'integer' },
          status: {},
          error: { type: 'string' },
        },
      },
      http: { method: 'GET', path: '/api/embed/probe' },
    },
  },
} as const;
