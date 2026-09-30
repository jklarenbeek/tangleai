/** Host-retained history enters the suite's backward as-of join. */
import { asOfJoin } from '@jarenjs/core/series';
import { checkTime } from './schema.ts';
import { visibleHarness } from './transitions.ts';
import { forecastMust, failure, reject, type ForecastCommandResult } from './errors.ts';
import { validateForecastRecord } from './identity.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastHarnessVersion } from './contracts.gen.ts';

export async function selectForecastHarness(question: ForecastQuestion, treatment: ForecastCheckpoint['treatment'], versions: ForecastHarnessVersion[], scheduledAt: string): Promise<ForecastCommandResult<ForecastHarnessVersion | null>> {
  try {
    checkTime(scheduledAt); await validateForecastRecord('questions',question);
    if (!['no-harness','static-harness','scaffold-no-harness','evolving-harness'].includes(treatment)) reject('TFCT1001','Unknown forecast treatment.');
    if (treatment === 'no-harness' || treatment === 'scaffold-no-harness') return { ok: true,value: null,writes: 0 };
    const retained = await Promise.all(versions.map(version => validateForecastRecord('harnesses',version)));
    const visible = retained.filter(version => version.scopeKey === question.scopeKey && visibleHarness(question,version).ok);
    const latest = (history: ForecastHarnessVersion[]) => {
      const rows = [...history].sort((a,b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)).map(version => ({ at: version.recordedAt,value: null,version }));
      return asOfJoin([{ at: scheduledAt,value: null }],rows)[0].right?.version as ForecastHarnessVersion | undefined;
    };
    const provisional = treatment === 'evolving-harness' ? latest(visible.filter(h => h.questionId === question.id && h.status === 'provisional')) : undefined;
    const checked = treatment === 'evolving-harness' ? latest(visible.filter(h => h.status === 'checked-ref')) : undefined;
    const selected = provisional ?? checked ?? latest(visible.filter(h => h.provenance.seed));
    if (!selected) reject('TFCT1012','No visible input harness exists at the scheduled instant.');
    forecastMust(visibleHarness(question,selected));
    return { ok: true,value: selected,writes: 0 };
  } catch (error) { return failure(error); }
}
