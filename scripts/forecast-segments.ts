/** An explicitly started, bounded worker pass; importing this module starts nothing. */
import { setTimeout as delay } from 'node:timers/promises';
import { createMasSegmentWorker, enqueueMasSegment, ensurePendingMasSegments, type TangleDb } from '@tangleai/store';
import type { MasStore } from '@tangleai/mas';
import type { ForecastSegments } from '@tangleai/forecast';

export function forecastWorkerSegments(db: TangleDb, store: MasStore): ForecastSegments {
  return {
    enqueue: run => enqueueMasSegment(db,{ runId: run.id,segment: 0,workflowVersionId: run.workflowVersionId,registryRevision: run.registryRevision,executableRevision: run.executableRevision }),
    reconcile: () => ensurePendingMasSegments(db,store),
    async drain(runtime) {
      const worker = createMasSegmentWorker(db,store,{ executableRevisions: [runtime.plan.executableRevision],execute: segment => runtime.executeSegment(segment),owner: 'forecast-tick',concurrency: 1,pollInterval: 10,leaseMs: 60000 });
      const deadline = performance.now() + runtime.workflow.limits.ms + 1000;
      worker.start();
      try {
        for (;;) {
          const stats = worker.stats();
          if (stats.failures || stats.claimErrors || stats.lostSettlements) throw Error('TFCT1012: Forecast worker did not complete its admitted segment; inspect the retained MAS run and job.');
          if (stats.polls > 0 && stats.inFlight === 0 && stats.claims === stats.completions) break;
          if (performance.now() > deadline) throw Error('TFCT1012: Forecast worker exceeded its bounded pass.');
          await delay(5);
        }
      } finally {
        const stopped = await worker.stop({ graceMs: 1000 });
        if (!stopped.drained) throw Error('TFCT1012: Forecast worker could not drain before shutdown.');
      }
    },
  };
}
