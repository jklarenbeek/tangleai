/** Measured corpus denominators and effective source identity for the strict instrument. */
import { loadLocomo } from './locomo.ts';
import { loadLongMemEval, censusLongMemEval } from './longmemeval.ts';
import { qualifyLongMemEvalCode } from './longmemeval-source.ts';
import { registerTemporal } from './temporal-registration.ts';
import { sourceManifest } from './source-manifest.ts';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { TemporalConformanceContext } from './temporal-conformance.ts';

export async function temporalConformanceContext(root: string): Promise<TemporalConformanceContext> {
  const source = await sourceManifest(root, ['package.json', 'package-lock.json', 'test/fixtures/temporal.ts', 'benchmark/temporal-conformance.ts', 'benchmark/temporal-eval.ts', 'benchmark/longmemeval-qa.ts', 'benchmark/longmemeval-roundtrip.ts', 'benchmark/temporal-native.ts', 'benchmark/receipts/temporal-native.json', 'benchmark/scripts/longmemeval-parity-fixtures.py'],
    ['benchmark/lib', 'benchmark/schemas', 'benchmark/scripts', 'packages/core', 'packages/memory', 'packages/store', 'packages/models']);
  const locomo = await loadLocomo(root), lme = await loadLongMemEval(root), code = await qualifyLongMemEvalCode(root);
  if (lme.status === 'failed' || code.status === 'failed') throw new Error(lme.status === 'failed' ? lme.reason : code.status === 'failed' ? code.reason : 'source failure');
  if (locomo.available && !locomo.valid) throw new Error('LoCoMo source schema failed');
  const samples = locomo.available ? locomo.samples : [];
  const questions = samples.flatMap(s => s.qa), census = lme.status === 'available' && code.status === 'available' ? censusLongMemEval(lme.value) : null;
  // A commit changes provenance, not effective code bytes. This pin survives
  // green work-order commits and still invalidates on every included file edit.
  return { sourceHash: await canonicalSha256({ files: source.files }),
    registrationHash: census && lme.status === 'available' ? registerTemporal(lme.value, samples.map(s => s.sample_id)).sha256 : null,
    lme: { status: census ? 'available' : 'unavailable', qa: census?.questions ?? null, retrieval: census ? census.questions - census.abstentions : null, futureGoldQuestions: census?.futureGoldQuestions ?? null },
    locomo: { status: locomo.available ? 'available' : 'unavailable', scorable: locomo.available ? questions.filter(q => q.category !== 5).length : null,
      adversarial: locomo.available ? questions.filter(q => q.category === 5).length : null, anchoredQuestions: locomo.available ? 0 : null },
  };
}
