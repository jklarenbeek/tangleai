/**
 * The desktop API as a @jarenjs/contract document.
 *
 * One document is the whole wire: the server serves it (`serveHttp` →
 * `toNodeHandler`), the browser client validates against it before
 * sending, `/.well-known/jaren-contract` describes it, and the SSE
 * streams ride the same declaration. The UI bundle imports this same
 * constant — server and client cannot drift apart without a typecheck
 * or a JC2053 saying so.
 *
 * Every live thing here is addressed: `runs.live` streams the run
 * table, `run.live` one named run's frames with replay by seq. A
 * subscriber names what it watches and resumes where it stopped; no
 * operation answers "whatever is running now".
 *
 * Commands are all `idempotency: none` (no ledger) on purpose: every
 * command here is either naturally re-runnable (sync skips unchanged
 * files by content hash) or append-only chat, and the desktop is a
 * single-user surface.
 */

import { FRAME_KINDS } from '@tangleai/store';

import manifest from '../package.json' with { type: 'json' };

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

/** One evolution run as the surface lists it: addresses and bounds, never a trajectory. */
const SKILL_RUN = {
  type: 'object',
  required: ['id', 'scopeKey', 'mode', 's0Id', 'status'],
  properties: {
    id: { type: 'string' },
    scopeKey: { type: 'string' },
    mode: { type: 'string' },
    s0Id: { type: 'string' },
    status: { type: 'string' },
    seed: { type: 'integer' },
    bMerge: { type: 'integer' },
    lMax: { type: 'integer' },
    supportThreshold: { type: 'integer' },
    spend: { type: 'object', properties: { calls: { type: 'integer' }, tokens: { type: 'integer' } } },
  },
} as const;

/** A structural or semantic verdict on a staged directory. */
const SKILL_CHECK = {
  type: 'object',
  required: ['valid', 'issues'],
  properties: { valid: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object' } } },
} as const;

/** One page of a directory: its address and size, never its bytes. */
const SKILL_FILE_ENTRY = {
  type: 'object',
  required: ['path', 'sha256', 'size'],
  properties: { path: { type: 'string' }, sha256: { type: 'string' }, size: { type: 'integer' } },
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

/**
 * One thing a run did, addressed by `(runId, seq)`. `body` is an open
 * object on the wire: the closed shape per kind is the store's write
 * gate, and putting the same branching in the public projection would
 * make every new kind a wire change.
 */
const FRAME = {
  type: 'object',
  required: ['id', 'runId', 'seq', 'at', 'kind', 'body'],
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    seq: { type: 'integer' },
    at: { type: 'string' },
    kind: { enum: [...FRAME_KINDS] },
    body: { type: 'object' },
  },
} as const;

/** The resolvable citation target of one document chunk — closed, so a fabricated member can never ride along. */
const DOCUMENT_CITATION_TARGET = {
  type: 'object',
  required: ['chunkId', 'sourceId', 'url', 'title', 'headingPath', 'elementIds'],
  additionalProperties: false,
  properties: {
    chunkId: { type: 'string' },
    sourceId: { type: 'string' },
    url: { type: 'string' },
    title: { type: ['string', 'null'] },
    page: { type: 'number' },
    headingPath: { type: 'array', items: { type: 'string' } },
    elementIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * One returned document citation: an answer-used ranked chunk (vector
 * omitted), its source, its score and its resolvable citation target.
 * Closed at every level — the measured contract, not a projection of
 * whatever the store held.
 */
const DOCUMENT_CITATION = {
  type: 'object',
  required: ['chunk', 'source', 'score', 'citation'],
  additionalProperties: false,
  properties: {
    chunk: {
      type: 'object',
      required: ['id', 'sourceId', 'versionId', 'elementIds', 'text', 'tokenCount', 'order', 'headingPath', 'embeddedBy'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        sourceId: { type: 'string' },
        versionId: { type: 'string' },
        elementIds: { type: 'array', items: { type: 'string' } },
        text: { type: 'string' },
        tokenCount: { type: 'number' },
        order: { type: 'number' },
        headingPath: { type: 'array', items: { type: 'string' } },
        pageStart: { type: 'number' },
        pageEnd: { type: 'number' },
        bbox: {
          type: 'object',
          required: ['x', 'y', 'w', 'h'],
          additionalProperties: false,
          properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
        },
        parentId: { type: 'string' },
        previousId: { type: 'string' },
        nextId: { type: 'string' },
        embeddedBy: {
          type: 'object',
          required: ['model', 'dims'],
          additionalProperties: false,
          properties: { model: { type: 'string' }, dims: { type: 'number' } },
        },
      },
    },
    source: {
      type: 'object',
      required: ['id', 'requestedUrl', 'finalUrl', 'canonicalUrl', 'title', 'mimeType', 'fetchMode', 'status', 'fetchedAt'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        requestedUrl: { type: 'string' },
        finalUrl: { type: 'string' },
        canonicalUrl: { type: 'string' },
        title: { type: ['string', 'null'] },
        mimeType: { type: 'string' },
        fetchMode: { enum: ['static', 'bun-webview', 'remote-playwright'] },
        status: { enum: ['ready', 'failed', 'blocked', 'dynamic-unavailable'] },
        fetchedAt: { type: 'string' },
        etag: { type: 'string' },
        lastModified: { type: 'string' },
        activeVersionId: { type: 'string' },
        error: { type: 'string' },
      },
    },
    score: { type: 'number' },
    citation: DOCUMENT_CITATION_TARGET,
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
    profile: { type: ['string', 'null'], minLength: 1, maxLength: 128 },
    chat: {
      type: 'object',
      properties: {
        provider: { enum: ['ollama', 'openrouter', 'lmstudio', 'custom', null] },
        baseUrl: { type: ['string', 'null'] },
        model: { type: ['string', 'null'] },
        apiKey: { type: ['string', 'null'] },
        maxTokens: { type: ['integer', 'null'], minimum: 1 },
        maxTokensField: { enum: ['max_tokens', 'max_completion_tokens'] },
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

/**
 * What a settings READ returns: the same shape the browser always knew,
 * with every credential value null (the fields stay nullable for the
 * compatibility window; handlers never return a value), plus the
 * additive slot statuses and the validation issues a corrupt stored row
 * produced. Replacing a secret is write-only; clearing needs the
 * explicit flag on `settings.set`.
 */
export const PUBLIC_SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    ...SETTINGS_SCHEMA.properties,
    slots: {
      type: 'object',
      required: ['chatKey', 'embedKey', 'browserToken'],
      properties: {
        chatKey: { type: 'boolean' },
        embedKey: { type: 'boolean' },
        browserToken: { type: 'boolean' },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'path', 'detail'],
        properties: {
          code: { type: 'string' },
          path: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
} as const;

/** What asked for a folder pass: a click, a start scan, or what the watcher saw. */
const SYNC_TRIGGERS = ['manual', 'start', 'change', 'overflow', 'tick'] as const;

const CONFIG_ISSUE = {
  type: 'object',
  required: ['code', 'path', 'detail'],
  properties: {
    code: { type: 'string' },
    path: { type: 'string' },
    detail: { type: 'string' },
  },
} as const;

/** One thing a reply cited, offered as something a verdict can be about. */
const FEEDBACK_EVIDENCE = {
  type: 'object',
  required: ['sourceId', 'kind', 'ref', 'label'],
  properties: {
    sourceId: { type: 'string' },
    kind: { type: 'string' },
    ref: { type: 'string' },
    label: { type: 'string' },
  },
} as const;

/** One instrument THIS host is willing to run; never a claim about quality. */
const INSTRUMENT = {
  type: 'object',
  required: ['id', 'title', 'entry', 'schemaId', 'keyless', 'acceptsBudget'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    entry: { type: 'string' },
    schemaId: { type: 'string' },
    keyless: { type: 'boolean' },
    acceptsBudget: { type: 'boolean' },
  },
} as const;

/** A stored report as a list shows it: the identity and where it came from, never the document. */
const REPORT_SUMMARY = {
  type: 'object',
  required: ['reportId', 'instrument', 'schemaId', 'at', 'runId', 'bytes'],
  properties: {
    reportId: { type: 'string' },
    instrument: { type: 'string' },
    schemaId: { type: 'string' },
    at: { type: 'string' },
    runId: { type: 'string' },
    bytes: { type: 'integer' },
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
  version: manifest.version,
  // The releases whose clients this surface still accepts. Nothing was
  // removed or narrowed since the freeze, so a client built at that
  // release can still speak here and the gate refuses silence about it.
  compat: ['0.28.0'],
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
      output: PUBLIC_SETTINGS_SCHEMA,
      http: { method: 'GET', path: '/api/settings' },
    },
    'settings.set': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['settings'],
        properties: {
          settings: SETTINGS_SCHEMA,
          clearChatKey: { type: 'boolean' },
          clearEmbedKey: { type: 'boolean' },
          clearBrowserToken: { type: 'boolean' },
        },
      },
      output: PUBLIC_SETTINGS_SCHEMA,
      http: { method: 'POST', path: '/api/settings' },
    },
    'config.inspect': {
      kind: 'read',
      // a named profile previews the selection the operator has not saved
      // yet: the same resolution a save would run, over the same host
      // facts, writing nothing
      input: { type: 'object', properties: { profile: { type: 'string', minLength: 1, maxLength: 128 } } },
      output: {
        type: 'object',
        required: ['registry', 'request', 'resolution', 'slots'],
        properties: {
          registry: {
            type: 'object',
            required: ['revision', 'tags', 'profiles'],
            properties: {
              revision: { type: 'string' },
              tags: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['tag', 'intent', 'candidates', 'limitations'],
                  properties: {
                    tag: { type: 'string' },
                    intent: { type: 'string' },
                    candidates: { type: 'integer' },
                    limitations: { type: 'string' },
                  },
                },
              },
              profiles: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'kind'],
                  properties: {
                    id: { type: 'string' },
                    kind: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          request: { type: 'object' },
          resolution: {
            type: 'object',
            required: ['state', 'issues'],
            properties: {
              state: { enum: ['ready', 'refused', 'provisional'] },
              issues: { type: 'array', items: CONFIG_ISSUE },
            },
          },
          identity: { type: ['object', 'null'] },
          preview: {
            type: ['object', 'null'],
            required: ['profile', 'state', 'issues'],
            properties: {
              profile: { type: 'string' },
              state: { enum: ['ready', 'refused', 'provisional'] },
              issues: { type: 'array', items: CONFIG_ISSUE },
              identity: { type: ['object', 'null'] },
            },
          },
          slots: {
            type: 'object',
            required: ['chatKey', 'embedKey', 'browserToken'],
            properties: {
              chatKey: { type: 'boolean' },
              embedKey: { type: 'boolean' },
              browserToken: { type: 'boolean' },
            },
          },
          hostObservation: { type: ['object', 'null'] },
        },
      },
      http: { method: 'GET', path: '/api/config' },
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
              removed: { type: 'integer' },
              truncated: { type: 'integer' },
              orphanedUnits: { type: 'integer' },
            },
          },
          trigger: { enum: [...SYNC_TRIGGERS] },
          report: {},
        },
      },
      errors: {
        'no-folder': { status: 409 },
        'bad-folder': { status: 409 },
        'sync-busy': { status: 409 },
        'config-refused': { status: 409 },
      },
      http: { method: 'POST', path: '/api/folder/sync' },
    },

    /** What the host's watcher has observed — counts and named states, never a health badge. */
    'folder.watch.get': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['enabled', 'folder', 'mode', 'events', 'windows', 'scans', 'overflows', 'refused', 'unscanned', 'lastRunId', 'lastError', 'issues'],
        properties: {
          enabled: { type: 'boolean' },
          folder: { type: ['string', 'null'] },
          mode: { enum: ['recursive', 'tick', 'unavailable'] },
          startedAt: { type: ['string', 'null'] },
          events: { type: 'integer' },
          windows: { type: 'integer' },
          scans: {
            type: 'object',
            required: ['start', 'change', 'overflow', 'tick'],
            additionalProperties: false,
            properties: {
              start: { type: 'integer' }, change: { type: 'integer' },
              overflow: { type: 'integer' }, tick: { type: 'integer' },
            },
          },
          overflows: { type: 'integer' },
          refused: {
            type: 'object',
            required: ['queue-full', 'closed', 'cancelled', 'deadline'],
            additionalProperties: false,
            properties: {
              'queue-full': { type: 'integer' }, closed: { type: 'integer' },
              cancelled: { type: 'integer' }, deadline: { type: 'integer' },
            },
          },
          unscanned: {
            type: 'object',
            required: ['no-folder', 'bad-folder', 'config-refused', 'failed'],
            additionalProperties: false,
            properties: {
              'no-folder': { type: 'integer' }, 'bad-folder': { type: 'integer' },
              'config-refused': { type: 'integer' }, failed: { type: 'integer' },
            },
          },
          lastRunId: { type: ['string', 'null'] },
          lastError: { type: ['string', 'null'] },
          issues: { type: 'array', items: CONFIG_ISSUE },
        },
      },
      http: { method: 'GET', path: '/api/folder/watch' },
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
      errors: { 'ingest-failed': { status: 422 }, 'config-refused': { status: 409 } },
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
      errors: { 'config-refused': { status: 409 } },
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
          frames: { type: 'integer' },
          // the stored configuration this run resolved, read by reference;
          // a list carries the status only, never an identity per row
          identity: { type: ['object', 'null'] },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/runs/detail' },
    },
    'runs.live': {
      kind: 'subscribe',
      input: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      output: {
        type: 'object',
        required: ['rows'],
        properties: { rows: { type: 'array', items: RUN } },
      },
      policy: { stream: { resume: 'snapshot', heartbeatMs: 15000, maxPatchBytes: 65536 } },
      http: { method: 'GET', path: '/api/runs/live' },
    },
    'run.live': {
      kind: 'subscribe',
      input: { type: 'object', required: ['runId'], properties: { runId: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['rows'],
        properties: { rows: { type: 'array', items: FRAME } },
      },
      policy: { stream: { resume: 'replay', heartbeatMs: 15000, maxPatchBytes: 65536 } },
      errors: { 'not-found': { status: 404 }, overflow: { status: 507 } },
      http: { method: 'GET', path: '/api/runs/live/frames' },
    },
    'runs.cancel': {
      kind: 'command',
      input: { type: 'object', required: ['runId'], properties: { runId: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['runId', 'status', 'cancelled', 'issues'],
        properties: {
          runId: { type: 'string' },
          status: { type: 'string' },
          cancelled: { type: 'boolean' },
          issues: { type: 'array', items: CONFIG_ISSUE },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'POST', path: '/api/runs/cancel' },
    },
    /**
     * What THIS host can run. A build with no measurement workspace
     * beside it answers an empty list and the reason — which is the
     * honest state of that build, not a failure of this request.
     */
    'reports.instruments': {
      kind: 'read',
      input: { type: 'object', properties: {} },
      output: {
        type: 'object',
        required: ['instruments', 'issues'],
        properties: {
          instruments: { type: 'array', items: INSTRUMENT },
          issues: { type: 'array', items: CONFIG_ISSUE },
        },
      },
      http: { method: 'GET', path: '/api/reports/instruments' },
    },
    /**
     * Run one registered instrument and keep what it produced under the
     * identity the instrument itself computed. `budget` is declared so a
     * request for spend is a DECLARED refusal rather than an unknown
     * member: no registered instrument accepts it, and no path to a
     * provider exists behind it. The exit code is a counted value; there
     * is no verdict here, and a report is never a gate.
     */
    'reports.run': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
          budget: {
            type: 'object',
            properties: {
              maxCalls: { type: 'integer', minimum: 0 },
              maxTokens: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      output: {
        type: 'object',
        required: ['runId', 'reportId', 'stored', 'exitCode', 'issues'],
        properties: {
          runId: { type: 'string' },
          reportId: { type: ['string', 'null'] },
          stored: { enum: ['new', 'unchanged', 'none'] },
          exitCode: { type: ['integer', 'null'] },
          issues: { type: 'array', items: CONFIG_ISSUE },
        },
      },
      errors: {
        'not-found': { status: 404 },
        busy: { status: 429 },
        refused: { status: 409 },
      },
      http: { method: 'POST', path: '/api/reports/run' },
    },
    'reports.list': {
      kind: 'read',
      input: {
        type: 'object',
        properties: {
          instrument: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      output: {
        type: 'object',
        required: ['rows'],
        properties: { rows: { type: 'array', items: REPORT_SUMMARY } },
      },
      http: { method: 'GET', path: '/api/reports' },
    },
    /**
     * One stored report, with its identity re-derived from the stored
     * bytes. A document that no longer hashes to the identity it is
     * filed under answers `verified: false` and what it actually hashes
     * to; it is neither hidden nor repaired.
     */
    'reports.get': {
      kind: 'read',
      input: { type: 'object', required: ['reportId'], properties: { reportId: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['reportId', 'instrument', 'schemaId', 'at', 'runId', 'bytes', 'verified', 'recomputed', 'document'],
        properties: {
          ...REPORT_SUMMARY.properties,
          verified: { type: 'boolean' },
          recomputed: { type: 'string' },
          source: { type: ['object', 'null'] },
          document: { type: 'object' },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/reports/detail' },
    },
    'skills.runs.list': {
      kind: 'read',
      input: {
        type: 'object',
        properties: { scopeKey: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
      },
      output: { type: 'array', items: SKILL_RUN },
      http: { method: 'GET', path: '/api/skills/runs' },
    },
    'skills.runs.get': {
      kind: 'read',
      input: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['run', 'counts', 'candidateIds', 'evaluationIds'],
        properties: {
          run: SKILL_RUN,
          counts: {
            type: 'object',
            required: ['rollouts', 'analyses', 'patches', 'merges', 'candidates', 'evaluations'],
            properties: {
              rollouts: { type: 'integer' }, analyses: { type: 'integer' }, patches: { type: 'integer' },
              merges: { type: 'integer' }, candidates: { type: 'integer' }, evaluations: { type: 'integer' },
            },
          },
          candidateIds: { type: 'array', items: { type: 'string' } },
          evaluationIds: { type: 'array', items: { type: 'string' } },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/skills/runs/detail' },
    },
    'skills.candidates.get': {
      kind: 'read',
      input: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['candidate', 'files'],
        properties: {
          candidate: {
            type: 'object',
            required: ['id', 'runId', 'scopeKey', 'bundleId', 'parentId', 'finalPatchId', 'churn', 'diffSummary', 'structural', 'semantic'],
            properties: {
              id: { type: 'string' }, runId: { type: 'string' }, scopeKey: { type: 'string' },
              bundleId: { type: 'string' }, parentId: { type: ['string', 'null'] }, finalPatchId: { type: 'string' },
              churn: { type: 'number' },
              diffSummary: {
                type: 'object',
                required: ['filesAdded', 'filesChanged', 'linesAdded', 'linesRemoved'],
                properties: {
                  filesAdded: { type: 'integer' }, filesChanged: { type: 'integer' },
                  linesAdded: { type: 'integer' }, linesRemoved: { type: 'integer' },
                },
              },
              structural: SKILL_CHECK,
              semantic: SKILL_CHECK,
            },
          },
          files: { type: 'array', items: SKILL_FILE_ENTRY },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/skills/candidates' },
    },
    'skills.merges.get': {
      kind: 'read',
      input: { type: 'object', required: ['runId'], properties: { runId: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['levels', 'groups', 'withheld', 'nodes'],
        properties: {
          levels: { type: 'integer' }, groups: { type: 'integer' }, withheld: { type: 'integer' },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'level', 'groupIndex', 'inputPatchIds', 'outputPatchId', 'supportCount', 'unique', 'duplicates', 'withheld'],
              properties: {
                id: { type: 'string' }, level: { type: 'integer' }, groupIndex: { type: 'integer' },
                inputPatchIds: { type: 'array', items: { type: 'string' } },
                outputPatchId: { type: ['string', 'null'] }, supportCount: { type: 'integer' },
                unique: { type: 'integer' }, duplicates: { type: 'integer' }, withheld: { type: 'integer' },
              },
            },
          },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/skills/merges' },
    },
    'skills.evaluations.get': {
      kind: 'read',
      input: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['id', 'runId', 'scopeKey', 'baselineBundleId', 'candidateBundleId', 'meanDelta', 'eligible', 'results', 'issues', 'failures', 'skips', 'leakage'],
        properties: {
          id: { type: 'string' }, runId: { type: 'string' }, scopeKey: { type: 'string' },
          baselineBundleId: { type: 'string' }, candidateBundleId: { type: 'string' },
          meanDelta: { type: 'number' }, costDelta: { type: ['number', 'null'] },
          eligible: { type: 'boolean' }, policyVersion: { type: 'string' },
          failures: { type: 'integer' }, skips: { type: 'integer' }, leakage: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              required: ['taskId', 'baselineScore', 'candidateScore', 'label'],
              properties: {
                taskId: { type: 'string' }, baselineScore: { type: 'number' },
                candidateScore: { type: 'number' }, label: { type: 'string' },
              },
            },
          },
          issues: { type: 'array', items: { type: 'object' } },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/skills/evaluations' },
    },
    'skills.head.get': {
      kind: 'read',
      input: { type: 'object', required: ['scopeKey'], properties: { scopeKey: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['scopeKey', 'versionId', 'revision', 'bundle', 'files', 'root'],
        properties: {
          scopeKey: { type: 'string' },
          versionId: { type: ['string', 'null'] },
          revision: { type: 'integer' },
          bundle: {
            type: ['object', 'null'],
            properties: {
              id: { type: 'string' }, mode: { type: 'string' }, origin: { type: 'string' },
              status: { type: 'string' }, parentId: { type: ['string', 'null'] },
            },
          },
          files: { type: 'array', items: SKILL_FILE_ENTRY },
          root: { type: ['string', 'null'] },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/skills/head' },
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
          documentCitations: { type: 'array', items: DOCUMENT_CITATION },
          provider: { type: ['string', 'null'] },
        },
      },
      errors: { busy: { status: 429 } },
      http: { method: 'POST', path: '/api/chat' },
    },
    'chat.start': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 8000 } },
      },
      output: {
        type: 'object',
        required: ['runId', 'messageId'],
        properties: { runId: { type: 'string' }, messageId: { type: 'string' } },
      },
      errors: { busy: { status: 429 } },
      http: { method: 'POST', path: '/api/chat/start' },
    },
    /** What a verdict on this reply may say, and what it can be about. */
    'feedback.open': {
      kind: 'read',
      input: { type: 'object', required: ['messageId'], properties: { messageId: { type: 'string', minLength: 1 } } },
      output: {
        type: 'object',
        required: ['messageId', 'eligible', 'decisionId', 'verdicts', 'evidence', 'noteAllowed', 'constraints', 'submitted', 'issues'],
        properties: {
          messageId: { type: 'string' },
          eligible: { type: 'boolean' },
          decisionId: { type: ['string', 'null'] },
          verdicts: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: FEEDBACK_EVIDENCE },
          noteAllowed: { type: 'boolean' },
          constraints: {
            type: 'object',
            required: ['reasonMinChars', 'reasonMaxChars', 'maxEvidence'],
            properties: {
              reasonMinChars: { type: 'integer' },
              reasonMaxChars: { type: 'integer' },
              maxEvidence: { type: 'integer' },
            },
          },
          submitted: { type: ['object', 'null'] },
          issues: { type: 'array', items: CONFIG_ISSUE },
        },
      },
      errors: { 'not-found': { status: 404 } },
      http: { method: 'GET', path: '/api/feedback' },
    },
    /**
     * Record the operator's verdict on this reply. The bounds below are
     * declared but not enforced on the wire: a bare, short or uncited
     * submission is a REFUSAL this surface counts, not a malformed
     * request the binding turns away before anyone sees it.
     */
    'feedback.submit': {
      kind: 'command',
      input: {
        type: 'object',
        required: ['messageId'],
        properties: {
          messageId: { type: 'string', minLength: 1 },
          verdict: { type: 'string' },
          reason: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              required: ['kind', 'ref'],
              properties: { kind: { type: 'string' }, ref: { type: 'string' } },
            },
          },
          note: { type: ['string', 'null'], maxLength: 4000 },
        },
      },
      output: {
        type: 'object',
        required: ['messageId', 'decisionId', 'resolutionId', 'scoreId', 'projectionReceiptId', 'outcome', 'utility', 'applied', 'missing', 'changedMemoryWrites', 'replayed', 'writes', 'issues'],
        properties: {
          messageId: { type: 'string' },
          decisionId: { type: 'string' },
          resolutionId: { type: 'string' },
          scoreId: { type: 'string' },
          projectionReceiptId: { type: 'string' },
          outcome: { type: 'string' },
          utility: { type: 'number' },
          applied: { type: 'integer' },
          missing: { type: 'integer' },
          changedMemoryWrites: { type: 'integer' },
          replayed: { type: 'boolean' },
          writes: { type: 'integer' },
          issues: { type: 'array', items: CONFIG_ISSUE },
        },
      },
      errors: { 'not-found': { status: 404 }, refused: { status: 409 } },
      http: { method: 'POST', path: '/api/feedback' },
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
