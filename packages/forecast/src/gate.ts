/** Bounded, deterministic screening of question facts before reusable guidance. */
import { isDateOnlyRFC3339 } from '@jarenjs/core/dates';
import { deepFreeze, cloneJson } from '@jarenjs/core/object';
import { createStructuredOutput } from '@tangleai/models';
import { createForecastMeter, type ForecastBudget, type ForecastChatClient } from './meter.ts';
import { VOLATILE_FACT_PROMPT, VOLATILE_FACT_SCHEMA } from './prompts.ts';
import { forecastRevision } from './identity.ts';
import { checkShape } from './schema.ts';
import { reject } from './errors.ts';
import type { CommittedGuidance, HarnessRevision, VolatileFactVerdict, Json } from './contracts.gen.ts';
export type VolatileKind = 'date' | 'named-entity' | 'exact-outcome' | 'number-with-unit' | 'copied-evidence' | 'identifier';
export interface VolatileContext { questionPrompt: string; adapterOptions: string[]; evidenceExcerpts: string[]; toolResultExcerpts: string[]; questionId: string; checkpointIds: string[]; }
export const normalizeForecastProcedure = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
const procedureWords = new Set(('A An And At Before Compare Check Consult Each Evidence For How If In Independent It List Never Observe Only Record Revisit Separate Source State The Then This Track Treat Use What When Whether Which Will With Always').toLowerCase().split(' '));
const tokens = (text: string) => normalizeForecastProcedure(text).split(' ').filter(Boolean);
const contains = (whole: string, part: string) => (' ' + whole + ' ').includes(' ' + part + ' ');
export function volatileFactGate(text: string, context: VolatileContext, shingle = 8) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 32768) throw new TypeError('Guidance screening requires bounded text.');
  context = captureVolatileContext(context);
  if (!Number.isSafeInteger(shingle) || shingle < 2 || shingle > 32) throw new TypeError('A shingle bound from two to thirty-two is required.');
  const findings: { kind: VolatileKind; span: string; detail: string }[] = [];
  const add = (kind: VolatileKind,span: string) => { if (!findings.some(f => f.kind === kind && f.span === span)) findings.push({ kind,span,detail: 'Question-specific ' + kind + ' cannot enter reusable guidance.' }); };
  const normalized = normalizeForecastProcedure(text), own = [context.questionPrompt,...context.adapterOptions,...context.evidenceExcerpts,...context.toolResultExcerpts];
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}(?=\b|[Tt])/g)) if (isDateOnlyRFC3339(match[0])) add('date',match[0]);
  for (const match of text.matchAll(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?\b/gi)) add('date',match[0]);
  const entities = new Set(own.flatMap(s => [...s.matchAll(/\b\p{Lu}[\p{L}\p{M}]+\b/gu)].map(m => normalizeForecastProcedure(m[0]))).filter(s => !procedureWords.has(s)));
  for (const match of text.matchAll(/[\p{L}\p{M}]+/gu)) if (entities.has(normalizeForecastProcedure(match[0]))) add('named-entity',match[0]);
  for (const option of context.adapterOptions) if (contains(normalized,normalizeForecastProcedure(option))) add('exact-outcome',option);
  const numbers = new Set(own.flatMap(s => [...s.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m => m[0])));
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) if (numbers.has(match[0])) add('exact-outcome',match[0]);
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\s*(?:%|days?\b|hours?\b|weeks?\b|months?\b|years?\b|minutes?\b|seconds?\b|km\b|kg\b|usd\b|euros?\b|dollars?\b)/gi)) add('number-with-unit',match[0]);
  const index = new Set<string>();
  for (const excerpt of [...context.evidenceExcerpts,...context.toolResultExcerpts]) { const words = tokens(excerpt); for (let i = 0; i <= words.length - shingle; i++) index.add(words.slice(i,i + shingle).join(' ')); }
  const words = tokens(text);
  for (let i = 0; i <= words.length - shingle; i++) { const phrase = words.slice(i,i + shingle).join(' '); if (index.has(phrase)) add('copied-evidence',phrase); }
  for (const match of text.matchAll(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+|\bq\d{2,}(?:-c\d+(?:-[\w-]+)?)?\b|\b(?:at\s+)?checkpoint\s+(?:ordinal\s+)?\d+\b/gi)) add('identifier',match[0]);
  for (const id of [context.questionId,...context.checkpointIds]) if (id && text.toLowerCase().includes(id.toLowerCase())) add('identifier',id);
  return { ok: findings.length === 0,findings };
}
export function captureVolatileContext(input: VolatileContext): VolatileContext {
  if (!input || typeof input.questionPrompt !== 'string' || typeof input.questionId !== 'string' || Object.keys(input).some(k => !['questionPrompt','questionId','adapterOptions','evidenceExcerpts','toolResultExcerpts','checkpointIds'].includes(k))) throw new TypeError('Supply only this question\'s bounded screening context.');
  for (const key of ['adapterOptions','evidenceExcerpts','toolResultExcerpts','checkpointIds'] as const) if (!Array.isArray(input[key]) || input[key].length > 1000 || input[key].some(v => typeof v !== 'string')) throw new TypeError('Screening context collections must be bounded strings.');
  if (new TextEncoder().encode(JSON.stringify(input)).length > 1048576) throw new TypeError('Screening context exceeds its byte bound.');
  return deepFreeze(cloneJson(input));
}
export async function forecastSemanticStage(result: Json): Promise<HarnessRevision['gate']['semantic']> {
  return { stage: 'revision.gate',revision: await forecastRevision({ prompt: VOLATILE_FACT_PROMPT,schema: VOLATILE_FACT_SCHEMA }),result: checkShape('json',result) };
}
/** This optional model stage completes before synchronous guarded validation. */
export function createVolatileFactClassifier(options: { client: ForecastChatClient; now: () => number }) {
  return { async classify(items: readonly CommittedGuidance[], input: VolatileContext, budget: ForecastBudget, signal?: AbortSignal) {
    const context = captureVolatileContext(input), meter = createForecastMeter(options.client,budget,options.now);
    if (!Array.isArray(items) || items.length > 32 || items.some(i => new TextEncoder().encode(i.text).length > 512)) reject('TFCT1001','The classifier requires bounded guidance items.');
    let result: VolatileFactVerdict | null = null, failure: { code: string;detail: string } | null = null;
    try {
      if (items.length === 0) result = { verdicts: [] };
      else {
        const client = { ...meter.client,async complete(request: any) {
          const answer = await meter.client.complete(request);
          if (answer.finishReason !== 'stop' || answer.message.toolCalls?.length) reject('TFCT1001','The classifier did not return a final structured answer.');
          return answer;
        } };
        const generated = await createStructuredOutput({ client,schema: VOLATILE_FACT_SCHEMA,name: 'volatile_fact_verdict',maxRepairs: 1,gate: (value: VolatileFactVerdict) => value.verdicts.length === items.length && new Set(value.verdicts.map(v => v.index)).size === items.length && value.verdicts.every(v => v.index < items.length) }).generate([
          { role: 'system',content: VOLATILE_FACT_PROMPT },{ role: 'user',content: JSON.stringify({ items: items.map((i,index) => ({ index,text: i.text })),context }) },
        ],{ signal });
        if (generated.errors) reject('TFCT1001','The classifier did not cover every guidance item after bounded repair.');
        result = checkShape('volatileFactVerdict',generated.value);
      }
    } catch (error) { failure = { code: 'TFCT1001',detail: error instanceof Error ? error.message : 'Classifier generation failed.' }; }
    return { semantic: await forecastSemanticStage(result ? checkShape<Json>('json',result) : { result: 'refused',code: 'TFCT1001' }),failure,spend: meter.spend(),budgetSpent: meter.budgetSpent(),calls: meter.calls() };
  } };
}
