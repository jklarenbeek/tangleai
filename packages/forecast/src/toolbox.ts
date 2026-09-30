/** A fixed read-only registry, scoped to one retained checkpoint and cutoff. */
import { createToolbox } from '@tangleai/agents';
import type { ToolDef } from '@tangleai/agents/toolbox';
import { cloneJson, deepFreeze, equalsJson } from '@jarenjs/core/object';
import { boundedForecastText } from './text.ts';
import { DocumentError } from '@tangleai/documents/contracts';
import type { SafeStaticFetcher } from '@tangleai/documents/fetch';
import type { extractDocument } from '@tangleai/documents/extract';
import type { SearxngClient } from '@tangleai/search';
import { forecastGet, type ForecastStore } from './store.ts';
import { forecastMust, ForecastRefusal, reject } from './errors.ts';
import { checkShape, checkTime } from './schema.ts';
import { forecastRevision, sealForecastRecord, validateForecastRecord } from './identity.ts';
import { admitEvidence, sha256Bytes } from './evidence.ts';
import type { ForecastCheckpoint, ForecastEvidence, ForecastHarnessVersion } from './contracts.gen.ts';

import type { ForecastSnapshot, ForecastCutoffPolicy } from './contracts.gen.ts';
export type { ForecastSnapshot, ForecastCutoffPolicy } from './contracts.gen.ts';
export interface ForecastToolboxOptions {
  store: ForecastStore; checkpoint: ForecastCheckpoint; harness: ForecastHarnessVersion | null;
  cutoffPolicy: ForecastCutoffPolicy; now: () => string; signal?: AbortSignal;
  search?: SearxngClient; fetcher?: Pick<SafeStaticFetcher, 'fetch'>; extract?: typeof extractDocument;
  limits?: { excerptChars?: number; searchResults?: number; maxSourceBytes?: number };
}
export interface ForecastToolRefusal { code: string; detail: string; citationId: string | null; }
export const FORECAST_EXECUTOR_TOOL_NAMES = ['web_search', 'web_read', 'harness_read', 'evidence_read'] as const;
const closed = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const text = { type: 'string', minLength: 1, pattern: '\\S' };
const tokens = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

function toolLimits(input: ForecastToolboxOptions['limits'] = {}) {
  const limits = { excerptChars: 4000, searchResults: 8, maxSourceBytes: 4 * 1024 * 1024, ...input };
  if (Object.keys(input).some(key => !['excerptChars','searchResults','maxSourceBytes'].includes(key)) || Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 1)) reject('TFCT1001', 'Forecast toolbox limits must be positive integers.');
  return limits;
}
/** The same descriptor bytes are used before sealing a checkpoint and by its runtime registry. */
export async function forecastExecutorToolset(treatment: ForecastCheckpoint['treatment'], input: ForecastToolboxOptions['limits'] = {}) {
  const limits = toolLimits(input), usesHarness = ['static-harness','evolving-harness'].includes(treatment);
  const definitions = [
    { name: 'web_search', description: 'Search the host-scoped evidence sources. Search snippets are discovery metadata; read a source before citing it.', inputSchema: closed({ query: { ...text, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: limits.searchResults } }, ['query']) },
    { name: 'web_read', description: 'Read a source at the recorded cutoff and retain evidence with its immutable citation id.', inputSchema: closed({ url: text }) },
    ...(usesHarness ? [{ name: 'harness_read', description: 'Load the immutable input harness. It supplies procedural guidance and grants no new tools.', inputSchema: closed({}) }] : []),
    { name: 'evidence_read', description: 'Read already captured admitted evidence by its citation id.', inputSchema: closed({ citationId: text }) },
  ];
  const revision = await forecastRevision(await Promise.all([...definitions].sort((a,b) => a.name.localeCompare(b.name)).map(async tool => ({ name: tool.name, description: tool.description, inputSchemaRevision: await forecastRevision(tool.inputSchema) }))));
  return { revision,definitions: deepFreeze(definitions),names: definitions.map(d => d.name) };
}

export async function createForecastToolbox(options: ForecastToolboxOptions) {
  if (typeof options.now !== 'function') throw new TypeError('A forecast toolbox requires an injected clock.');
  const limits = toolLimits(options.limits);
  const checkpoint = checkShape<ForecastCheckpoint>('forecastCheckpoint', options.checkpoint), policy = checkShape<ForecastCutoffPolicy>('forecastCutoffPolicy', options.cutoffPolicy);
  const harness = options.harness ? await validateForecastRecord('harnesses', options.harness) : null;
  const retained = forecastMust(await forecastGet(options.store, 'checkpoints', checkpoint.id));
  if (!retained || !equalsJson(retained, checkpoint)) reject('TFCT1002', 'The toolbox checkpoint differs from retained state.');
  const usesHarness = ['static-harness', 'evolving-harness'].includes(checkpoint.treatment);
  if (usesHarness !== !!harness || usesHarness && (checkpoint.inputHarnessVersionId !== harness!.id || checkpoint.inputHarnessDigest !== harness!.digest))
    reject('TFCT1002', 'The toolbox harness differs from its checkpoint treatment or input identity.');
  if (harness && !equalsJson(forecastMust(await forecastGet(options.store,'harnesses',harness.id)),harness)) reject('TFCT1002', 'The toolbox harness differs from retained state.');
  if (policy.kind === 'replay') {
    if (!policy.corpus || policy.snapshots.length > 100 || new Set(policy.snapshots.map(s => s.id)).size !== policy.snapshots.length || new Set(policy.snapshots.map(s => s.url)).size !== policy.snapshots.length)
      reject('TFCT1001', 'Replay needs at most one hundred uniquely addressed snapshots.');
    for (const snapshot of policy.snapshots) {
      if (snapshot.questionId !== checkpoint.questionId) reject('TFCT1003', 'A replay snapshot belongs to another question.');
      forecastMust(admitEvidence(snapshot, checkpoint.cutoffAt));
      if (snapshot.sha256 !== await sha256Bytes(new TextEncoder().encode(snapshot.excerpt))) reject('TFCT1002', 'A replay snapshot differs from its captured bytes.');
    }
  } else if (policy.kind !== 'live') reject('TFCT1001', 'Unknown forecast cutoff policy.');
  const box = createToolbox(), evidence = new Map<string, ForecastEvidence>(), refusals: ForecastToolRefusal[] = [];
  let isClosed = false;
  const refused = (code: string, detail: string, citationId: string | null = null) => {
    refusals.push({ code, detail, citationId }); return { error: detail, code };
  };
  const capture = async (snapshot: ForecastSnapshot) => {
    const prior = evidence.get(snapshot.id); if (prior) return prior;
    const admission = forecastMust(admitEvidence(snapshot, checkpoint.cutoffAt));
    const record = await sealForecastRecord('evidence', { checkpointId: checkpoint.id, kind: 'snapshot', address: { corpus: policy.kind === 'replay' ? policy.corpus : '', snapshotId: snapshot.id },
      availableAt: snapshot.availableAt, fetchedAt: null, claimedPublishedAt: null, sha256: snapshot.sha256, bytes: new TextEncoder().encode(snapshot.excerpt).length,
      excerpt: boundedForecastText(snapshot.excerpt, limits.excerptChars), citationId: snapshot.id, admitted: admission.admitted,
      refusal: admission.admitted ? null : { code: admission.code, reason: admission.reason } });
    evidence.set(snapshot.id, record);
    if (!admission.admitted) refused(admission.code, admission.reason, snapshot.id);
    return record;
  };
  const metadata = await forecastExecutorToolset(checkpoint.treatment,options.limits);
  const descriptor = (name: string) => metadata.definitions.find(d => d.name === name)!;
  const definitions: ToolDef[] = [
    { ...descriptor('web_search'),
      async execute(input: { query: string; limit?: number }) {
        const limit = input.limit ?? limits.searchResults;
        if (policy.kind === 'live') {
          if (!options.search) return refused('TFCT1012', 'No live search client is injected.');
          const result = await options.search.search(input.query, { signal: options.signal });
          const fetchedAt = checkTime(options.now());
          return { results: result.results.slice(0, limit).map(r => ({ url: r.url, title: r.title, snippet: boundedForecastText(r.content ?? '', limits.excerptChars), fetchedAt })) };
        }
        const query = tokens(input.query), ranked: { snapshot: ForecastSnapshot; score: number }[] = [];
        for (const snapshot of policy.snapshots) {
          const admission = forecastMust(admitEvidence(snapshot, checkpoint.cutoffAt));
          if (!admission.admitted) { await capture(snapshot); continue; }
          const words = tokens(snapshot.title + ' ' + snapshot.excerpt), score = [...query].filter(word => words.has(word)).length;
          if (score) ranked.push({ snapshot, score });
        }
        ranked.sort((a,b) => b.score - a.score || a.snapshot.id.localeCompare(b.snapshot.id));
        return { results: ranked.slice(0, limit).map(({ snapshot: s }) => ({ url: s.url, title: s.title, snippet: boundedForecastText(s.excerpt, limits.excerptChars), citationId: s.id, availableAt: s.availableAt })) };
      } },
    { ...descriptor('web_read'),
      async execute(input: { url: string }) {
        if (policy.kind === 'replay') {
          const snapshot = policy.snapshots.find(s => s.url === input.url);
          if (!snapshot) return refused('TFCT1002', 'The URL is outside the registered snapshot pool.');
          const record = await capture(snapshot);
          return record.admitted ? cloneJson(record) : refused('TFCT1006', record.refusal!.reason, record.citationId);
        }
        if (!options.fetcher || !options.extract) return refused('TFCT1012', 'No live fetcher and document extractor are injected.');
        try {
          const fetched = await options.fetcher.fetch(input.url, {}, options.signal);
          if (fetched.status !== 'ok' || !fetched.bytes || !fetched.mimeType) return refused('TFCT1012', 'A live read needs captured source bytes and a MIME type.');
          if (fetched.bytes.length > limits.maxSourceBytes) return refused('response-too-large', 'The captured source exceeds the forecast read bound.');
          const extracted = await options.extract(fetched.bytes, { mimeType: fetched.mimeType, url: fetched.finalUrl });
          const sha256 = await sha256Bytes(fetched.bytes), citationId = 'live:' + await forecastRevision({ url: fetched.finalUrl, sha256 });
          const record = await sealForecastRecord('evidence', { checkpointId: checkpoint.id, kind: 'live', address: { url: fetched.finalUrl }, availableAt: null, fetchedAt: checkTime(fetched.fetchedAt), claimedPublishedAt: null,
            sha256, bytes: fetched.bytes.length, excerpt: boundedForecastText(extracted.elements.map(e => e.text).join('\n'), limits.excerptChars), citationId, admitted: true, refusal: null });
          const prior = evidence.get(citationId);
          if (prior && !equalsJson(prior, record)) return refused('TFCT1010', 'A live citation already names another capture.');
          evidence.set(citationId, record); return cloneJson(record);
        } catch (error) {
          if (error instanceof DocumentError) return refused(error.code, error.message);
          throw error;
        }
      } },
    ...(usesHarness ? [{ ...descriptor('harness_read'), execute: () => cloneJson(harness!.document) }] : []),
    { ...descriptor('evidence_read'),
      execute(input: { citationId: string }) { const record = evidence.get(input.citationId); return record?.admitted ? cloneJson(record) : refused('TFCT1002', 'No admitted evidence has this citation id.', input.citationId); } },
  ];
  for (const definition of definitions) box.add({ ...definition,async execute(input) {
    try { return await definition.execute(input); }
    catch (error) {
      if (error instanceof ForecastRefusal) return refused(error.code,error.message);
      if (error instanceof DocumentError) return refused(error.code,error.message);
      return refused('TFCT1012',error instanceof Error ? error.message : 'The injected read failed.');
    }
  } });
  const expected = FORECAST_EXECUTOR_TOOL_NAMES.filter(name => usesHarness || name !== 'harness_read');
  if (!equalsJson(box.list().map(tool => tool.name), expected)) reject('TFCT1002', 'The forecast tool registry differs from its closed policy.');
  const revision = metadata.revision;
  if (checkpoint.toolsetRevision !== revision) reject('TFCT1002', 'The checkpoint does not pin its actual toolset revision.');
  const execute = async (name: string, input: unknown) => {
    if (isClosed) return refused('TFCT1006','The checkpoint evidence collection is closed.');
    try {
      const current = forecastMust(await forecastGet(options.store, 'checkpoints', checkpoint.id));
      if (!current || current.status !== 'running') return refused('TFCT1006', 'Evidence attaches only while this checkpoint is running.');
      if (!expected.includes(name as typeof expected[number])) return refused('TFCT1003', 'The requested tool is outside the forecast toolbox.');
      const result = await box.execute(name, input);
      if (result?.error && !result.code) return refused('TFCT1001', String(result.error));
      return result;
    } catch (error) {
      if (error instanceof ForecastRefusal) return refused(error.code, error.message);
      if (error instanceof DocumentError) return refused(error.code, error.message);
      return refused('TFCT1012', error instanceof Error ? error.message : 'The injected read failed.');
    }
  };
  return Object.freeze({ checkpointId: checkpoint.id, revision, names: Object.freeze([...expected]), execute,
    list: () => deepFreeze(cloneJson(box.list())), toFunctionTools: () => deepFreeze(cloneJson(box.toFunctionTools())),
    close: () => { isClosed = true; }, evidence: () => cloneJson([...evidence.values()]),
    audit: () => ({ refusals: cloneJson(refusals), postCutoff: [...evidence.values()].filter(e => e.refusal?.reason === 'post-cutoff').length, undated: [...evidence.values()].filter(e => e.refusal?.reason === 'undated').length }),
  });
}
export type ForecastToolbox = Awaited<ReturnType<typeof createForecastToolbox>>;
