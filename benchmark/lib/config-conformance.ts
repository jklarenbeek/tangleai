/**
 * The config conformance instrument — the identity census BEFORE the
 * capability.
 *
 * Today the repository has no way to state which exact model, endpoint,
 * prompt, tool, embedder, policy component and budget produced a result
 * row, and no instrument that could detect two different stacks
 * colliding under one name. This library is that instrument's core: it
 * freezes the current construction paths (the one chat/embed factory
 * pair, the two live host inputs, the three run producers, the four
 * result artifacts), exercises current public behavior through imports
 * and injected in-memory stores, and measures every registered case in
 * `test/fixtures/config-conformance.json` — equivalence, sensitivity,
 * refusal and legacy families — against the campaign-required end
 * state. A defect is published as a `gap`, never encoded as expected
 * behavior; a case no instrument can measure yet is `pending`, never
 * silently passed.
 *
 * Keyless and clock-free by construction: no fetch, no probe, no model
 * call, no Date. Two runs over the same tree render byte-identical
 * JSON; the report's `gate` counters are literal zeros in the schema,
 * so a report of a run that made a call cannot validate at all.
 *
 * Secrets: probes that need a credential-shaped value use an in-memory
 * sentinel; the fixture and every serialized output carry only the
 * `[redacted sentinel]` marker, and `assertRedacted` refuses any text
 * that contains the real bytes.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { applyJSONPatch } from '@jarenjs/json';
import { resolveEndpoint } from '@tangleai/models/providers';
import { compileContract } from '@jarenjs/contract';
import { createScheduler } from '@jarenjs/core/schedule';
import { publicProjection } from '@jarenjs/contract/project';
import {
  profileRegistrySchema,
  resolveProfile,
  runIdentitySchema,
  validateIdentityEnvelope,
  validateRegistry,
} from '@tangleai/config';
import { createDbMemoryStore, createDocumentStore, createIdentityRepository, createRunLog, openTangleDb } from '@tangleai/store';

import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  chatWireConfigured,
  type Settings,
} from '../../apps/desktop/src/settings.ts';
import { settingsStack } from '../../apps/desktop/src/ai-host.ts';
import { createChatEngine } from '../../apps/desktop/src/chat.ts';
import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { readAiEnv, GUARD_DEFAULTS, AI_ENV } from './ai-env.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import configConformanceSchema from '../schemas/config-conformance.schema.json' with { type: 'json' };
import type { ConfigConformance, Fixture, MeasuredCase, RegisteredCase } from './config-conformance.types.ts';

const exec = promisify(execFile);

/** The secret-shaped bytes probes hold in memory. Never serialized. */
export const SECRET_SENTINEL = 'sk-sentinel-cafebabe5eed';
/** What the fixture and every serialized document carry instead. */
export const SENTINEL_MARKER = '[redacted sentinel]';

export const FIXTURE_PATH = 'test/fixtures/config-conformance.json';
export const CONTRACT_FIXTURE_PATH = 'test/fixtures/desktop-contract-pre-config.json';
export const REPORT_PATH = 'benchmark/results/config-conformance.json';

// ---------------------------------------------------------------------------
// the explicit source manifest — what this instrument's behavior reads
// ---------------------------------------------------------------------------

/**
 * Every file whose bytes decide what this report says: the probed
 * product sources, the schemas and their generated types, the fixture,
 * the four result artifacts the census reads, and the instrument
 * itself. The report's own output is deliberately absent — a report
 * inside its own digest could never reproduce.
 */
export const SOURCE_MANIFEST: readonly string[] = [
  'apps/desktop/src/ai-host.ts',
  'apps/desktop/src/chat.ts',
  'apps/desktop/src/contract.ts',
  'apps/desktop/src/handlers.ts',
  'apps/desktop/src/settings.ts',
  'benchmark/config-conformance.ts',
  'benchmark/lib/ai-env.ts',
  'benchmark/lib/config-conformance.ts',
  'benchmark/lib/config-conformance.types.ts',
  'benchmark/lib/report-envelope.ts',
  'benchmark/lib/validate.ts',
  'benchmark/results/locomo-policy.json',
  'benchmark/results/locomo-qa-live.json',
  'benchmark/results/locomo-qa.json',
  'benchmark/results/locomo-recall.json',
  'benchmark/schemas/config-conformance.schema.json',
  'packages/config/schemas/profile-registry.schema.json',
  'packages/config/schemas/run-identity.schema.json',
  'packages/config/src/contracts.gen.ts',
  'packages/config/src/identity.ts',
  'packages/config/src/index.ts',
  'packages/config/src/inheritance.ts',
  'packages/config/src/resolve.ts',
  'packages/config/src/schema.ts',
  'packages/store/src/identities.ts',
  'packages/store/src/model.ts',
  'packages/store/src/runs.ts',
  'test/fixtures/config-conformance.json',
];

/** HEAD, cleanliness, and the digest of every manifest file. No clock. */
export async function conformanceSource(root = process.cwd()): Promise<ConfigConformance['source']> {
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const clean = (await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim() === '';
  const files: Array<{ path: string, sha256: string }> = [];
  for (const path of [...SOURCE_MANIFEST].sort()) {
    const bytes = await readFile(join(root, path));
    files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { head, clean, files, sha256: await canonicalSha256({ head, files }) };
}

/** Installed foundation and executed mechanism identities, name-sorted. */
export async function suitePackages(root = process.cwd()): Promise<ConfigConformance['suite']> {
  const dir = join(root, 'node_modules', '@jarenjs');
  const names = (await readdir(dir)).filter((name) => !name.startsWith('.')).sort();
  const packages: Array<{ name: string, version: string }> = [];
  for (const name of names) {
    const manifest = JSON.parse(await readFile(join(dir, name, 'package.json'), 'utf8')) as { version: string };
    packages.push({ name: `@jarenjs/${name}`, version: manifest.version });
  }
  for (const name of ['models', 'context', 'agents']) {
    const manifest = JSON.parse(await readFile(join(root, 'node_modules', '@tangleai', name, 'package.json'), 'utf8')) as { version: string };
    packages.push({ name: `@tangleai/${name}`, version: manifest.version });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return { packages };
}

// ---------------------------------------------------------------------------
// the construction-path census — explicit sites, re-derived by the tests
// ---------------------------------------------------------------------------

/**
 * The registered construction sites. The test suite greps the named
 * files and reconciles every count here, and sweeps the rest of the
 * repo to prove no unregistered consumer exists — so a factory call
 * added without registering it fails the gate, not a review.
 *
 * `benchmark/lib/locomo-policy.ts` holds a local offline embedder maker
 * of the same spelling; it wraps the suite's deliberately offline hash
 * reference for keyless cells, is not a provider wire, and is excluded
 * exactly as the deliberately offline `createHashEmbedder` /
 * `createOfflineEmbedder` reference uses are.
 */
export const CONSTRUCTION_CENSUS: ConfigConformance['census'] = {
  factories: {
    file: 'apps/desktop/src/settings.ts',
    chatFactory: 'chatClientFor',
    embedFactory: 'embedderFor',
    chatConsumers: [
      { file: 'apps/desktop/src/ai-host.ts', count: 1 },
      { file: 'benchmark/locomo-policy.ts', count: 2 },
      { file: 'benchmark/locomo-qa.ts', count: 3 },
    ],
    embedConsumers: [
      { file: 'apps/desktop/src/ai-host.ts', count: 2 },
      { file: 'apps/desktop/src/handlers.ts', count: 2 },
      { file: 'benchmark/locomo-policy.ts', count: 2 },
      { file: 'benchmark/locomo-qa.ts', count: 1 },
    ],
    chatConsumerCalls: 6,
    embedConsumerCalls: 7,
  },
  hostInputs: [
    { file: 'apps/desktop/src/settings.ts', kind: 'desktop-settings', names: ['settings'] },
    {
      file: 'benchmark/lib/ai-env.ts',
      kind: 'environment',
      names: [
        'OPENROUTER_AI_KEY',
        'TANGLE_AI_PROVIDER',
        'TANGLE_AI_BASE_URL',
        'TANGLE_AI_MODEL',
        'TANGLE_AI_MODEL_STRONG',
        'TANGLE_AI_EMBEDDING_MODEL',
        'TANGLE_AI_MAX_CALLS',
        'TANGLE_AI_MAX_CONCURRENCY',
      ],
    },
  ],
  runProducers: [
    { file: 'apps/desktop/src/handlers.ts', operation: 'folder.sync', recordsIdentity: true },
    { file: 'apps/desktop/src/handlers.ts', operation: 'documents.ingest', recordsIdentity: true },
    { file: 'apps/desktop/src/handlers.ts', operation: 'documents.ingestbatch', recordsIdentity: true },
    { file: 'apps/desktop/src/handlers.ts', operation: 'chat.start', recordsIdentity: true },
    // a report runs a keyless child process and resolves no model
    // stack, so it records no identity and is not asked for one
    { file: 'apps/desktop/src/handlers.ts', operation: 'reports.run', recordsIdentity: false },
  ],
  reportArtifacts: [
    { path: 'benchmark/results/locomo-policy.json', identityDiscipline: 'complete', note: 'registration, cell, run and report identities over canonical JSON, plus the shared envelope stating its keyless screen rows analytic' },
    { path: 'benchmark/results/locomo-qa.json', identityDiscipline: 'complete', note: 'the shared envelope states the keyless answer rows analytic; nothing here bought a provider answer' },
    { path: 'benchmark/results/locomo-qa-live.json', identityDiscipline: 'complete', note: 'the shared envelope keeps the paid historic rows as stated legacy-unrecorded absences; no old row is backfilled and new live rows must carry full identities' },
    { path: 'benchmark/results/locomo-recall.json', identityDiscipline: 'complete', note: 'the shared envelope states the analytic recall/ceiling rows not-run' },
  ],
  desktopContract: { operations: 0, revision: '0'.repeat(64) },
  summary: {
    hostInputs: 2,
    runProducers: 5,
    runProducersRecordingIdentity: 4,
    reportArtifacts: 4,
    reportArtifactsWithIdentities: 4,
  },
};

// ---------------------------------------------------------------------------
// sentinel handling
// ---------------------------------------------------------------------------

/** Replace the serialized marker with the in-memory sentinel, deeply. */
export function substituteSentinel<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll(SENTINEL_MARKER, SECRET_SENTINEL) as T;
  if (Array.isArray(value)) return value.map((item) => substituteSentinel(item)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) out[key] = substituteSentinel(member);
    return out as T;
  }
  return value;
}

/** Refuse any text that carries the real sentinel bytes. */
export function assertRedacted(text: string, where: string): void {
  if (text.includes(SECRET_SENTINEL)) {
    throw new Error(`the secret sentinel leaked into ${where}`);
  }
}

// ---------------------------------------------------------------------------
// case measurement — current behavior, honestly
// ---------------------------------------------------------------------------

interface Measurement {
  status: MeasuredCase['status'];
  observed: string;
}

type Patch = Array<{ op: 'add' | 'remove' | 'replace', path: string, value?: unknown }>;

/** The case's three documents: the fixture base with its edits applied. */
function editedDocuments(item: RegisteredCase, base: Fixture['base']): { registry: unknown, request: unknown, host: unknown } {
  const input = item.input;
  if (input.kind !== 'edits') throw new Error(`${item.id}: expected an edits input`);
  const apply = (document: unknown, edits: Patch | null | undefined): unknown => {
    if (edits === null || edits === undefined) return structuredClone(document);
    const substituted = substituteSentinel(structuredClone(edits)) as Patch;
    const whole = substituted.find((edit) => edit.path === '');
    if (whole !== undefined) return structuredClone(whole.value);
    return applyJSONPatch(structuredClone(document), substituted);
  };
  return {
    registry: apply(base.registry, input.registry as Patch | null),
    request: apply(base.request, input.request as Patch | null),
    host: apply(base.host, input.host as Patch | null),
  };
}

/**
 * The identity-level equivalence check: both endpoint spellings are
 * normalized the way the host adapter normalizes them (through the
 * suite's `resolveEndpoint`), each becomes a host-manifest entry, and
 * the resolver must produce ONE identity for both.
 */
async function endpointPair(item: RegisteredCase, base: Fixture['base']): Promise<Measurement> {
  const input = item.input;
  if (input.kind !== 'documents' || input.right === null) throw new Error(`${item.id}: expected a documents pair`);
  const left = input.left as { provider: string, baseUrl: string | null };
  const right = input.right as { provider: string, baseUrl: string | null };
  const a = resolveEndpoint({ provider: left.provider, baseUrl: left.baseUrl ?? undefined, model: 'probe' });
  const b = resolveEndpoint({ provider: right.provider, baseUrl: right.baseUrl ?? undefined, model: 'probe' });
  if (a.base !== b.base) {
    return { status: 'gap', observed: `suite normalization disagrees: ${a.base} versus ${b.base}` };
  }

  const identityFor = async (normalizedBase: string): Promise<string> => {
    const registry = structuredClone(base.registry) as { candidates: any[], profiles: any[] };
    registry.candidates[1] = {
      id: 'chat-beta',
      kind: 'chat',
      provider: left.provider,
      model: 'probe',
      baseUrl: left.provider === 'custom' ? normalizedBase : null,
      credentialSlot: null,
      features: [],
      rateCard: null,
    };
    registry.profiles[0].roles.answer = {
      ...registry.profiles[0].roles.answer,
      capability: null,
      candidate: 'chat-beta',
    };
    const host = structuredClone(base.host) as { providers: any[] };
    host.providers = host.providers.filter((entry: { provider: string }) => entry.provider !== left.provider);
    host.providers.push({ provider: left.provider, base: normalizedBase, models: ['probe'], features: [] });
    const resolution = await resolveProfile({ registry, request: base.request, host });
    if (!resolution.ok) throw new Error(`${item.id}: the probe stack did not resolve — ${JSON.stringify(resolution.issues[0])}`);
    return resolution.identity.identityId;
  };
  const identityA = await identityFor(a.base);
  const identityB = await identityFor(b.base);
  return identityA === identityB
    ? { status: 'holds', observed: `both spellings normalize to ${a.base} and resolve to one effective identity` }
    : { status: 'gap', observed: 'the normalized spellings resolved to different identities' };
}

/** A sensitivity case: the base resolves, the edited input resolves, and the identities differ. */
async function sensitivityPair(item: RegisteredCase, base: Fixture['base']): Promise<Measurement> {
  const baseline = await resolveProfile(structuredClone(base) as { registry: unknown, request: unknown, host: unknown });
  if (!baseline.ok) return { status: 'gap', observed: 'the fixture base stack did not resolve' };
  const edited = await resolveProfile(editedDocuments(item, base));
  if (!edited.ok) {
    const detail = edited.issues.map((entry) => entry.code).join(', ');
    assertRedacted(detail, `${item.id} issues`);
    return { status: 'gap', observed: `the edited stack refused (${detail}) instead of resolving to a different identity` };
  }
  return edited.identity.identityId !== baseline.identity.identityId
    ? { status: 'holds', observed: 'the changed value produces a different effective identity' }
    : { status: 'gap', observed: 'two materially different stacks collided under one identity' };
}

/** A refusal case: the edited input refuses with the pinned issue code. */
async function refusalCase(item: RegisteredCase, base: Fixture['base']): Promise<Measurement> {
  const resolution = await resolveProfile(editedDocuments(item, base));
  const wanted = item.expect.issueCodes ?? [];
  if (resolution.ok) {
    return { status: 'gap', observed: `the resolver accepted a stack that must refuse with ${wanted.join(', ')}` };
  }
  const codes = resolution.issues.map((entry) => entry.code);
  const detail = resolution.issues.map((entry) => `${entry.code} ${entry.path}`).join('; ');
  assertRedacted(detail, `${item.id} issues`);
  return wanted.every((code) => codes.includes(code))
    ? { status: 'holds', observed: `refused as a value with ${detail}` }
    : { status: 'gap', observed: `refused, but with ${codes.join(', ')} instead of ${wanted.join(', ')}` };
}

/** A registry document that must refuse validation with the pinned code. */
function editedRegistryRefused(item: RegisteredCase, base: Fixture['base']): Measurement {
  const { registry } = editedDocuments(item, base);
  const outcome = validateRegistry(registry);
  const wanted = item.expect.issueCodes ?? [];
  if (outcome.ok) return { status: 'gap', observed: 'the registry validation accepted a document it must refuse' };
  const codes = outcome.issues.map((entry) => entry.code);
  const detail = outcome.issues.map((entry) => `${entry.code} ${entry.path}`).join('; ');
  assertRedacted(detail, `${item.id} validation issues`);
  return wanted.every((code) => codes.includes(code))
    ? { status: 'holds', observed: `validation refuses with ${detail}` }
    : { status: 'gap', observed: `validation refuses, but with ${codes.join(', ')} instead of ${wanted.join(', ')}` };
}

/** Reordered members must carry one canonical identity. */
async function reorderCase(item: RegisteredCase): Promise<Measurement> {
  const input = item.input;
  if (input.kind !== 'documents' || input.right === null) throw new Error(`${item.id}: expected a documents pair`);
  const a = await canonicalSha256(input.left);
  const b = await canonicalSha256(input.right);
  return a === b
    ? { status: 'holds', observed: 'reordered members hash to one canonical revision' }
    : { status: 'gap', observed: 'member order leaked into the canonical revision' };
}

async function measureProbe(item: RegisteredCase, root: string): Promise<Measurement> {
  const input = item.input;
  if (input.kind !== 'probe') throw new Error(`${item.id}: expected a probe input`);
  switch (input.probe) {
    case 'unconfigured-offline': {
      const stack = await settingsStack(DEFAULT_SETTINGS);
      if (stack.state !== 'ready') return { status: 'gap', observed: 'default settings did not resolve as the unconfigured legacy stack' };
      // the property is the absence of a wire and the presence of the
      // built-in identity; the built-in's width is a product default this
      // case observes rather than decides
      const offline = stack.chat === null && stack.identity.embedding?.provider === 'builtin';
      return offline
        ? { status: 'holds', observed: `the unconfigured legacy request resolves to no chat wire and the built-in ${stack.identity.embedding?.model} identity at ${stack.identity.embedding?.dims} dimensions (identity ${stack.identity.identityId.slice(0, 12)}…)` }
        : { status: 'gap', observed: 'default settings unexpectedly resolve a wire' };
    }
    case 'custom-without-base': {
      const env = readAiEnv({ TANGLE_AI_PROVIDER: 'custom', TANGLE_AI_MODEL: 'probe', OPENROUTER_AI_KEY: SECRET_SENTINEL });
      let suiteRefuses = false;
      try {
        resolveEndpoint({ provider: 'custom', model: 'probe' });
      } catch {
        suiteRefuses = true;
      }
      const observed = `readAiEnv states '${env.reason ?? ''}' and the suite refuses to resolve custom without a base`;
      assertRedacted(observed, 'custom-without-base observation');
      return env.live === false && suiteRefuses
        ? { status: 'holds', observed }
        : { status: 'gap', observed: 'a custom provider without a base did not refuse' };
    }
    case 'missing-key-skip': {
      const env = readAiEnv({});
      const observed = `live=false with reason '${env.reason ?? ''}'`;
      return env.live === false && (env.reason ?? '').includes(AI_ENV.key) && !observed.includes(SECRET_SENTINEL)
        ? { status: 'holds', observed: `a missing key is a stated skip naming ${AI_ENV.key}; keyless tiers stay runnable` }
        : { status: 'gap', observed: 'the missing-key state did not name its variable as a skip' };
    }
    case 'half-configured-embed': {
      const half: Settings = { ...DEFAULT_SETTINGS, embed: { provider: 'openrouter', baseUrl: null, model: null, apiKey: null } };
      const stack = await settingsStack(half);
      if (stack.state !== 'refused') {
        return { status: 'gap', observed: 'a wire request with no model still resolves instead of refusing; a requested remote is indistinguishable from requested offline' };
      }
      const codes = stack.issues.map((item) => item.code);
      return codes.includes('TCFG1021')
        ? { status: 'holds', observed: `an explicit half-configured embed request refuses as ${codes.join(', ')} naming the missing fields; only the unconfigured legacy state keeps the built-in fallback` }
        : { status: 'gap', observed: `the half-configured request refused with ${codes.join(', ')} instead of TCFG1021` };
    }
    case 'env-integer-parsing': {
      const samples = (input.args as { samples: string[] }).samples;
      const outcomes = samples.map((raw) => readAiEnv({ [AI_ENV.maxCalls]: raw }));
      const allRejected = outcomes.every((env) => env.maxCalls === GUARD_DEFAULTS.maxCalls
        && env.guards.maxCalls === 'rejected' && env.guardIssues.length === 1);
      const explicit = readAiEnv({ [AI_ENV.maxCalls]: '7' });
      const defaulted = readAiEnv({});
      const states = `${samples.map((raw, index) => `'${raw}' -> ${outcomes[index].guards.maxCalls}`).join(', ')}; '7' -> ${explicit.guards.maxCalls} ${explicit.maxCalls}; absent -> ${defaulted.guards.maxCalls}`;
      return allRejected && explicit.maxCalls === 7 && explicit.guards.maxCalls === 'explicit' && defaulted.guards.maxCalls === 'defaulted'
        ? { status: 'holds', observed: `guards are schema-normalized with recorded states: ${states}` }
        : { status: 'gap', observed: `guard normalization is partial: ${states}` };
    }
    case 'corrupt-settings-read': {
      const db = await openTangleDb();
      const settings = createSettingsStore(db);
      const row = (input.args as { row: object }).row;
      await db.collection<{ key: string, value: unknown }>('settings').put({ key: 'settings', value: row });
      const read = await settings.read() as unknown as { chat: { provider: unknown, model: unknown }, documents: { maxTokens: unknown } };
      const leaked = read.chat.provider === 'bogus' && read.chat.model === 17 && read.documents.maxTokens === -9;
      return leaked
        ? { status: 'gap', observed: 'a corrupt stored row structurally merges into typed runtime state: an unknown provider, a numeric model and a negative document budget all survive the read' }
        : { status: 'holds', observed: 'a corrupt stored row is refused or normalized before it becomes typed settings' };
    }
    case 'settings-secret-reflection': {
      const { createDesktop } = await import('../../apps/desktop/src/server.ts');
      const desktop = await createDesktop({});
      try {
        await desktop.dispatcher.dispatch({
          method: 'POST', url: '/api/settings', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ settings: {
            chat: { provider: 'openrouter', baseUrl: null, model: 'probe', apiKey: SECRET_SENTINEL },
            browser: { mode: 'remote', endpoint: 'https://example.com', token: SECRET_SENTINEL, allowUnsafeLocal: false },
          } }),
        });
        const read = await desktop.dispatcher.dispatch({ method: 'GET', url: '/api/settings', headers: {}, body: null });
        const body = String(read.body);
        if (body.includes(SECRET_SENTINEL)) {
          return { status: 'gap', observed: 'the public settings read returns stored credential values verbatim to the browser' };
        }
        const view = JSON.parse(body) as { chat: { apiKey: unknown }, browser: { token: unknown }, slots?: { chatKey?: boolean, browserToken?: boolean } };
        const redacted = view.chat.apiKey === null && view.browser.token === null
          && view.slots?.chatKey === true && view.slots?.browserToken === true;
        const inspect = await desktop.dispatcher.dispatch({ method: 'GET', url: '/api/config', headers: {}, body: null });
        const inspectClean = !String(inspect.body).includes(SECRET_SENTINEL);
        return redacted && inspectClean
          ? { status: 'holds', observed: 'the public settings read returns null for every credential value with slot statuses beside them, and the config inspection carries no secret byte' }
          : { status: 'gap', observed: 'the public settings shape does not expose slot statuses beside redacted values' };
      } finally {
        await desktop.close();
      }
    }
    case 'endpoint-guard-disagreement': {
      const providers = (input.args as { providers: string[] }).providers;
      const disagreements: string[] = [];
      for (const provider of providers) {
        const guard = chatWireConfigured({ provider: provider as 'ollama', baseUrl: null, model: 'probe', apiKey: null });
        const suite = resolveEndpoint({ provider, model: 'probe' });
        if (!guard && suite.base.length > 0) disagreements.push(`${provider} (guard false, suite ${suite.base})`);
      }
      return disagreements.length > 0
        ? { status: 'gap', observed: `chatWireConfigured maintains a provider-default rule beside the suite and disagrees for ${disagreements.join(' and ')}` }
        : { status: 'holds', observed: 'the local guard agrees with the suite endpoint authority for every provider' };
    }
    case 'endpoint-userinfo': {
      const credentialed: Settings = {
        ...DEFAULT_SETTINGS,
        chat: { provider: 'custom', baseUrl: `https://user:${SECRET_SENTINEL}@example.com/v1`, model: 'probe', apiKey: null },
      };
      const stack = await settingsStack(credentialed);
      if (stack.state !== 'refused') {
        return { status: 'gap', observed: 'a credential-bearing base resolved instead of refusing before the suite saw it' };
      }
      const text = JSON.stringify(stack.issues);
      assertRedacted(text, 'endpoint-userinfo issues');
      const env = readAiEnv({ TANGLE_AI_PROVIDER: 'custom', TANGLE_AI_BASE_URL: `https://user:${SECRET_SENTINEL}@example.com/v1`, TANGLE_AI_MODEL: 'probe', OPENROUTER_AI_KEY: 'k' });
      assertRedacted(env.reason ?? '', 'endpoint-userinfo env reason');
      return stack.issues.some((item) => item.code === 'TCFG1013') && env.live === false
        ? { status: 'holds', observed: 'a credential-bearing base is refused as TCFG1013 before suite resolution on both host paths, and the sentinel appears in no issue' }
        : { status: 'gap', observed: 'the userinfo refusal did not carry TCFG1013 on both host paths' };
    }
    case 'run-producer-identity': {
      const db = await openTangleDb();
      let tick = 0;
      const log = createRunLog(db, { now: () => `2026-01-01T00:00:0${tick++}.000Z`, configAwareKinds: ['sync'] });
      const withIdentity = await log.startRun('sync', { identityId: 'a'.repeat(64) });
      const finishedOk = await log.finishRun(withIdentity.id, 'ok', { probe: true });
      const view = (await log.getRun(withIdentity.id))?.run;
      const legacyLike = await log.startRun('legacy-probe');
      const legacyView = (await log.getRun(legacyLike.id))?.run;
      const bare = await log.startRun('sync');
      const refused = await log.finishRun(bare.id, 'ok', { probe: true });
      const bareView = (await log.getRun(bare.id))?.run;
      const holds = finishedOk.ok && view?.identityStatus === 'run' && view.identityId === 'a'.repeat(64)
        && legacyView?.identityStatus === 'legacy-unrecorded'
        && !refused.ok && bareView?.status === 'error';
      return holds
        ? { status: 'holds', observed: 'a run stores its identity reference before work, a row without one reads as legacy-unrecorded and is never backfilled, and a config-aware run cannot finish without saying what stack produced it' }
        : { status: 'gap', observed: 'the run log does not enforce the identity reference discipline' };
    }
    case 'chat-provider-label': {
      const db = await openTangleDb();
      const memoryStore = createDbMemoryStore(db.collection('memories'));
      const documentStore = createDocumentStore(db);
      const identities = createIdentityRepository(db);
      let tick = 0;
      const now = (): string => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`;
      const engine = createChatEngine({
        db,
        memoryStore,
        documentStore,
        settings: async () => structuredClone(DEFAULT_SETTINGS),
        stackFor: (settings) => settingsStack(settings),
        identities,
        runLog: createRunLog(db, { now }),
        inflight: new Map(),
        scheduler: createScheduler({ concurrency: 1, maxQueue: 1 }),
        now,
      });
      const outcome = await engine.send('what does the store hold?');
      const reply = outcome.reply as { identityId?: string | null, usage?: unknown, provider?: string | null };
      const stored = reply.identityId === undefined || reply.identityId === null
        ? undefined
        : await identities.get(reply.identityId);
      return typeof reply.identityId === 'string' && stored !== undefined
        ? { status: 'holds', observed: `a chat answer stores its identity reference (${reply.identityId.slice(0, 12)}…) beside the display label, and the identity is retrievable from the repository` }
        : { status: 'gap', observed: 'a chat answer still carries only a provider display label and no retrievable identity reference' };
    }
    case 'report-artifact-identities': {
      const carrying: string[] = [];
      const missing: string[] = [];
      let reconciled = true;
      for (const artifact of CONSTRUCTION_CENSUS.reportArtifacts) {
        const document = JSON.parse(await readFile(join(root, artifact.path), 'utf8')) as Record<string, unknown>;
        const name = artifact.path.split('/').pop() ?? artifact.path;
        const envelope = document.configIdentities;
        if (envelope === undefined) {
          missing.push(name);
          continue;
        }
        const outcome = validateIdentityEnvelope(envelope);
        if (!outcome.ok) reconciled = false;
        carrying.push(name);
      }
      return missing.length === 0 && reconciled
        ? { status: 'holds', observed: `all ${carrying.length} artifacts carry the shared identity envelope with validated run/not-run/legacy-unrecorded rows` }
        : { status: 'gap', observed: `${missing.length > 0 ? `${missing.join(', ')} carry no identity envelope` : 'an envelope does not validate'}; the shared discipline is incomplete` };
    }
    default:
      throw new Error(`unknown probe '${input.probe}' — register its measurement before registering its case`);
  }
}

/** Refusal cases the registry document validation judges directly. */
const REGISTRY_SCHEMA_CASES: ReadonlySet<string> = new Set([
  'r-registry-duplicate-id',
  'r-registry-unknown-parent',
  'r-registry-kind-mismatch',
  'r-registry-secret-member',
  'r-registry-secret-url',
]);

const ENDPOINT_PAIR_CASES: ReadonlySet<string> = new Set([
  'e-endpoint-default-base',
  'e-endpoint-lmstudio-default',
  'e-endpoint-trailing-slash',
  'e-endpoint-chat-path',
]);

export interface MeasureOptions {
  root?: string;
}

/** Measure every registered case against current behavior. */
export async function measureCases(fixture: Fixture, options: MeasureOptions = {}): Promise<MeasuredCase[]> {
  const root = options.root ?? process.cwd();

  const measured: MeasuredCase[] = [];
  for (const item of fixture.cases) {
    let measurement: Measurement;
    if (ENDPOINT_PAIR_CASES.has(item.id)) {
      measurement = await endpointPair(item, fixture.base);
    } else if (item.id === 'e-reorder-members') {
      measurement = await reorderCase(item);
    } else if (REGISTRY_SCHEMA_CASES.has(item.id)) {
      measurement = editedRegistryRefused(item, fixture.base);
    } else if (item.id === 'r-dangling-identity-row') {
      const input = item.input;
      if (input.kind !== 'documents') throw new Error(`${item.id}: expected a documents input`);
      const outcome = validateIdentityEnvelope(input.left);
      measurement = outcome.ok
        ? { status: 'gap', observed: 'the envelope accepted a run row whose identity is absent from the table' }
        : outcome.issues.some((entry) => entry.code === 'TCFG1018')
          ? { status: 'holds', observed: 'the identity envelope refuses a dangling run-row reference as TCFG1018' }
          : { status: 'gap', observed: `the envelope refused without the pinned code: ${outcome.issues.map((entry) => entry.code).join(', ')}` };
    } else if (item.input.kind === 'probe') {
      measurement = await measureProbe(item, root);
    } else if (item.family === 'sensitivity') {
      measurement = await sensitivityPair(item, fixture.base);
    } else if (item.family === 'refusal') {
      measurement = await refusalCase(item, fixture.base);
    } else {
      throw new Error(`case ${item.id} has no registered measurement`);
    }
    assertRedacted(measurement.observed, `case ${item.id}`);
    measured.push({
      id: item.id,
      family: item.family,
      scope: item.scope,
      title: item.title,
      expect: item.expect,
      status: measurement.status,
      observed: measurement.observed,
    });
  }
  return measured;
}

// ---------------------------------------------------------------------------
// report assembly and rendering
// ---------------------------------------------------------------------------

export interface BuildOptions {
  root?: string;
  /** Injected for deterministic tests; the CLI computes the real one. */
  source?: ConfigConformance['source'];
}

export async function loadFixture(root = process.cwd()): Promise<Fixture> {
  const fixture = JSON.parse(await readFile(join(root, FIXTURE_PATH), 'utf8')) as Fixture;
  const validate = createReportValidator(
    { $ref: 'https://tangleai.dev/schemas/config-conformance#/$defs/fixture' },
    [configConformanceSchema as object],
  );
  const outcome = validate(fixture);
  if (!outcome.valid) {
    throw new Error(`the conformance fixture does not validate: ${describeErrors(outcome, 5).join('; ')}`);
  }
  return fixture;
}

export async function buildReport(options: BuildOptions = {}): Promise<ConfigConformance> {
  const root = options.root ?? process.cwd();
  const fixture = await loadFixture(root);
  const cases = await measureCases(fixture, { root });

  const contract = compileContract(DESKTOP_CONTRACT as unknown as Record<string, unknown>);
  const census: ConfigConformance['census'] = {
    ...CONSTRUCTION_CENSUS,
    desktopContract: {
      operations: Object.keys(DESKTOP_CONTRACT.operations).length,
      revision: await contract.revision(),
    },
  };

  const byFamily = { equivalence: 0, sensitivity: 0, refusal: 0, legacy: 0 };
  const byStatus = { holds: 0, gap: 0, pending: 0 };
  for (const item of cases) {
    byFamily[item.family] += 1;
    byStatus[item.status] += 1;
  }

  const report: ConfigConformance = {
    benchmark: 'config-conformance',
    instrument: { entry: 'benchmark/config-conformance.ts' },
    source: options.source ?? await conformanceSource(root),
    suite: await suitePackages(root),
    census,
    cases,
    counts: { cases: cases.length, byFamily, byStatus },
    gate: { schemaValid: true, transportCalls: 0, probeCalls: 0, modelCalls: 0 },
    reportId: '0'.repeat(64),
  };
  const { reportId: _placeholder, ...rest } = report;
  report.reportId = await canonicalSha256(rest);

  const validate = createReportValidator(configConformanceSchema as object);
  const outcome = validate(report);
  if (!outcome.valid) {
    throw new Error(`the conformance report does not validate: ${describeErrors(outcome, 8).join('; ')}`);
  }
  return report;
}

/** The exact bytes the committed report holds. */
export function renderReport(report: ConfigConformance): string {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  assertRedacted(text, 'the rendered report');
  return text;
}

/** The suite public projection of the current desktop contract. */
export async function contractProjection(): Promise<{ projection: Record<string, unknown>, revision: string }> {
  const compiled = compileContract(DESKTOP_CONTRACT as unknown as Record<string, unknown>);
  return { projection: publicProjection(compiled), revision: await compiled.revision() };
}
