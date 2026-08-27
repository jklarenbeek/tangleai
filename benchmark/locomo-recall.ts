/* eslint-disable no-console */
/**
 * LoCoMo evidence recall — the keyless ceiling.
 *
 * Ingests the ten conversations through the real pipeline (one store
 * per conversation, one run per session), retrieves k memories for each
 * of the 1,540 scorable questions, and scores the official `recall_acc`
 * per category at k ∈ {5, 10, 20} — for two gate rows that prove the
 * scorer, a recency baseline, and the pipeline with its policies off and
 * on. The report is a validated document; the Markdown is derived from
 * it. Nothing here reads a clock, and two runs are byte-identical.
 *
 *   node benchmark/locomo-recall.ts                          # Markdown to stdout
 *   node benchmark/locomo-recall.ts --json PATH --md PATH    # write the report and its rendering
 *   node benchmark/locomo-recall.ts --samples conv-26,conv-30 --dims 128
 *   node benchmark/locomo-recall.ts --novelty 0.9 --crystallize 0.85 --contradiction 0.75
 *   node benchmark/locomo-recall.ts --require                # exit 1 if the submodule is absent
 *
 * Exit 1 with the row named when a gate row fails, or when the report
 * does not validate against `schemas/locomo-recall.schema.json`; the
 * files are never written in either case. Elapsed time goes to stderr.
 */

import { writeFile } from 'node:fs/promises';

import { JarenValidator } from '@jarenjs/validate';

import { parseArgs } from './lib/args.ts';
import { loadLocomo } from './lib/locomo.ts';
import { renderMarkdown, runLocomoRecall, type RecallRunOptions } from './lib/locomo-recall.ts';
import SCHEMA from './schemas/locomo-recall.schema.json' with { type: 'json' };

const args = parseArgs(process.argv.slice(2), {
  flags: ['require'],
  values: ['samples', 'dims', 'seed', 'novelty', 'contradiction', 'crystallize', 'json', 'md'],
});

const dataset = await loadLocomo();
if (!dataset.available) {
  console.log(`# LoCoMo evidence recall\n\n**Skipped** — ${dataset.reason}.\n`);
  console.log(`The dataset is a git submodule and is not vendored here (it is CC BY-NC 4.0).`);
  console.log(`Fetch it with:\n\n    ${dataset.hint}\n`);
  process.exit(args.flags.has('require') ? 1 : 0);
}
if (!dataset.valid) {
  console.error('the release no longer matches benchmark/schemas/locomo10.schema.json — run the census; nothing is scored against a dataset that moved');
  for (const error of dataset.errors) console.error(`  ${error}`);
  process.exit(1);
}

const number = (name: string): number | undefined => {
  const raw = args.values.get(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number, got '${raw}'`);
  return value;
};

const thresholds: RecallRunOptions['thresholds'] = {};
const novelty = number('novelty');
const contradiction = number('contradiction');
const crystallize = number('crystallize');
if (novelty !== undefined) thresholds.novelty = novelty;
if (contradiction !== undefined) thresholds.contradiction = contradiction;
if (crystallize !== undefined) thresholds.crystallize = crystallize;

const started = performance.now();
let last = started;
const report = await runLocomoRecall(dataset, {
  dims: number('dims'),
  seed: number('seed'),
  thresholds,
  samples: args.values.get('samples')?.split(',').map((s) => s.trim()).filter((s) => s !== ''),
  onProgress: (message) => {
    const now = performance.now();
    console.error(`  ${message} — ${(now - last).toFixed(0)} ms`);
    last = now;
  },
});
console.error(`  total ${(performance.now() - started).toFixed(0)} ms (diagnostic only; the report carries no timing)`);

// the document is validated before anything is written or printed
const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
const validate = validator.compile(SCHEMA as Record<string, unknown>);
const outcome = validate(report);
if (!outcome.valid) {
  console.error('the report does not validate against benchmark/schemas/locomo-recall.schema.json:');
  for (const error of (outcome.errors ?? []).slice(0, 20)) console.error(`  ${JSON.stringify(error)}`);
  process.exit(1);
}

if (!report.gate.passed) {
  console.error('GATE FAILED — the scorer is not proven, so no number is published:');
  for (const failure of report.gate.failures) console.error(`  ${failure}`);
  process.exit(1);
}

const markdown = renderMarkdown(report);
console.log(markdown);

const jsonPath = args.values.get('json');
if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const mdPath = args.values.get('md');
if (mdPath !== undefined) await writeFile(mdPath, `${markdown}\n`);
