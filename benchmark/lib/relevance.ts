/** Labelled retrieval contract. Text stays in inputs; scorecards carry only ids. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { quantile } from '@jarenjs/core/stats';

/** SHA-256 of bytes, including the exact input serialization. @param bytes */
export const sha256 = (bytes: any) => createHash('sha256').update(bytes).digest('hex');
const nonempty = (s: any) => typeof s === 'string' && s.trim() !== '';
const order = (a: any, b: any) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Parse JSONL with useful, text-free diagnostics. @param text @param name */
export function parseJsonl(text: string, name: string) {
  return text.split(/\r?\n/).flatMap((line, i) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch { throw new Error(`${name}: invalid JSON at line ${i + 1}`); }
  });
}

/** Validate ids, judgments and explicit no-answer queries before any model call.
 * @param manifest @param corpus @param queries @param qrels */
export function normalizeDataset(manifest: any, corpus: any[], queries: any[], qrels: any[]) {
  if (manifest?.schemaVersion !== 1 || !nonempty(manifest.id)
    || !['authored', 'real-language', 'synthetic'].includes(manifest.datasetClass)
    || !nonempty(manifest.source) || !nonempty(manifest.license) || !nonempty(manifest.version))
    throw new Error('dataset manifest needs schemaVersion, id, datasetClass, source, license and version');
  const normalize = (rows: any, name: any) => {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`empty ${name} split`);
    const ids = new Set();
    return rows.map((row: any) => {
      const id = row?.id ?? row?._id;
      if (row?.id !== undefined && row?._id !== undefined && row.id !== row._id)
        throw new Error(`${name}: conflicting id and _id`);
      if (!nonempty(id) || ids.has(id)) throw new Error(`${name}: missing or duplicate id`);
      ids.add(id);
      if (!nonempty(row.text) || (row.title !== undefined && typeof row.title !== 'string'))
        throw new Error(`${name}: invalid text for ${id}`);
      if (row.noAnswer !== undefined && typeof row.noAnswer !== 'boolean')
        throw new Error(`${name}: noAnswer must be boolean`);
      return {
        id, text: [row.title, row.text].filter(Boolean).join('\n'),
        ...(row.noAnswer === true ? { noAnswer: true } : {})
      };
    }).sort(order);
  };
  const documents = normalize(corpus, 'corpus');
  const questions = normalize(queries, 'query');
  const docs = new Set(documents.map((d) => d.id));
  const judgments = new Map(questions.map((q) => [q.id, new Map()]));
  for (const row of qrels) {
    const found = judgments.get(row?.queryId);
    if (!found || !docs.has(row?.corpusId)) throw new Error('dangling qrel');
    if (!Number.isInteger(row.relevance) || row.relevance < 0 || row.relevance > 30)
      throw new Error('qrel relevance must be an integer between 0 and 30');
    if (found.has(row.corpusId)) throw new Error('duplicate or conflicting qrel');
    found.set(row.corpusId, row.relevance);
  }
  for (const q of questions) {
    const relevance = Object.fromEntries(judgments.get(q.id)!);
    const gold = Object.keys(relevance).filter((id) => relevance[id] > 0);
    if ((gold.length === 0) !== (q.noAnswer === true))
      throw new Error(`query ${q.id}: missing positive qrels or conflicting noAnswer declaration`);
    Object.assign(q, { gold, relevance });
  }
  // Class and provenance belong in the identity, so relabelling invalidates caches.
  const hash = sha256(JSON.stringify({ manifest, documents, questions }));
  return { manifest, hash, documents, questions };
}

/** Load three checksum-pinned neutral JSONL inputs. @param path */
export function loadDataset(path: string) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const root = dirname(resolve(path));
  const inputs = ['corpus', 'queries', 'qrels'].map((name) => {
    const entry = manifest.files?.[name];
    if (!entry || !nonempty(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw new Error(`manifest: ${name} needs path and SHA-256`);
    const target = resolve(root, entry.path);
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('dataset path escapes manifest directory');
    const bytes = readFileSync(target);
    if (sha256(bytes) !== entry.sha256) throw new Error(`${name}: checksum mismatch`);
    return parseJsonl(bytes.toString('utf8'), name);
  });
  return normalizeDataset(manifest, inputs[0], inputs[1], inputs[2]);
}

/** Standard macro recall, reciprocal rank and graded nDCG. Empty judgments are
 * excluded from relevance means and scored separately for abstention.
 * @param questions @param rankings @param [ks] */
export function relevanceMetrics(questions: any[], rankings: string[][], ks: number[] = [1, 5, 10]) {
  if (!questions.length || questions.length !== rankings.length || !ks.length
    || new Set(ks).size !== ks.length
    || ks.some((k) => !Number.isInteger(k) || k < 1)) throw new Error('invalid scoring inputs');
  const recall = Object.fromEntries(ks.map((k) => [k, 0]));
  const hitRate = { ...recall };
  let mrr = 0, ndcg10 = 0, answerable = 0, noAnswer = 0, abstained = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i], ranked = rankings[i];
    if (!Array.isArray(ranked) || new Set(ranked).size !== ranked.length
      || ranked.some((id) => !nonempty(id))) throw new Error('rankings must contain distinct string ids');
    const gold = new Set(q.gold);
    if (!gold.size) {
      if (q.noAnswer !== true) throw new Error('unjudged query is not a no-answer query');
      noAnswer++;
      if (!ranked.length) abstained++;
      continue;
    }
    answerable++;
    for (const k of ks) {
      const hits = ranked.slice(0, k).filter((id) => gold.has(id)).length;
      recall[k] += hits / gold.size;
      hitRate[k] += Number(hits > 0);
    }
    const rank = ranked.slice(0, Math.max(...ks)).findIndex((id) => gold.has(id));
    if (rank >= 0) mrr += 1 / (rank + 1);
    const gains = q.relevance ?? Object.fromEntries(q.gold.map((id: any) => [id, 1]));
    const dcg = (values: any) => values.slice(0, 10).reduce((sum: any, gain: any, r: any) => sum + (2 ** gain - 1) / Math.log2(r + 2), 0);
    ndcg10 += dcg(ranked.map((id) => Object.hasOwn(gains, id) ? gains[id] : 0)) / dcg(Object.values(gains).sort((a: any, b: any) => Number(b) - Number(a)));
  }
  const mean = (v: any) => answerable ? v / answerable : null;
  return {
    recall: Object.fromEntries(ks.map((k) => [k, mean(recall[k])])),
    hitRate: Object.fromEntries(ks.map((k) => [k, mean(hitRate[k])])),
    mrr: mean(mrr), ndcg10: mean(ndcg10), answerable,
    noAnswer: {
      queries: noAnswer, abstained, falseAnswers: noAnswer - abstained,
      accuracy: noAnswer ? abstained / noAnswer : null
    }
  };
}

/** Score the real policy and retain only ids for reproducibility. @param policy @param questions */
export async function scoreRelevance(policy: any, questions: any[]) {
  const rankings: any[] = [], times: any[] = [];
  for (const q of questions) {
    const start = performance.now();
    rankings.push(await policy.run(q, 10));
    times.push(performance.now() - start);
  }
  return {
    policy: policy.key, ...relevanceMetrics(questions, rankings),
    latencyMs: { p50: quantile(times, 0.5, { method: 'nearest-rank' }), p95: quantile(times, 0.95, { method: 'nearest-rank' }) },
    rankings: questions.map((q: any, i) => ({ queryId: q.id, ids: rankings[i] }))
  };
}
