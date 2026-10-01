/** Grounding uses the native MAS worker and queue lease/recovery protocol. */
import { MasInfrastructureCrash, segmentJobIdOf } from '@tangleai/mas';
import type { GroundingSegmentHost } from '@tangleai/grounding';
import type { JobOutcome } from '@jarenjs/db';
import type { TangleDb } from './db.ts';
import { createMasStore } from './mas-store.ts';
import { createMasSegmentWorker, enqueueMasSegment, ensurePendingMasSegments } from './mas-jobs.ts';
export function createGroundingSegmentHost(db: TangleDb, options: {
    now: () => string; deadlineFor: (afterMs: number) => string; jobClock: () => number;
}): GroundingSegmentHost {
    if (!db.jobs) throw new TypeError('Grounding sessions require the native jobs store.');
    const store = createMasStore(db, { now: options.now });
    return { store, deadlineFor: options.deadlineFor, async execute(runtime, runId) {
        let run = await store.getRun(runId);
        if (!run || run.workflowVersionId !== runtime.workflow.versionId || run.executableRevision !== runtime.plan.executableRevision)
            throw Error('The grounding worker requires its retained execution identity.');
        if (['completed', 'failed', 'waiting_for_input'].includes(run.status)) return;
        if (run.status === 'resume_pending') { await ensurePendingMasSegments(db, store); run = (await store.getRun(runId))!; }
        if (run.segment === 0) await enqueueMasSegment(db, { runId, segment: 0, workflowVersionId: run.workflowVersionId,
            registryRevision: run.registryRevision, executableRevision: run.executableRevision });
        const id = segmentJobIdOf(runId, run.segment), job = await db.jobs!.get(id);
        if (!job) throw Error('The grounding segment has no queue record.');
        if (job.state === 'leased' && (job.leaseUntil ?? Infinity) > options.jobClock() || job.runAt > options.jobClock()) return;
        if (['dead', 'cancelled'].includes(job.state)) throw Error('The grounding segment needs explicit queue recovery.');
        if (job.state === 'done') return;
        let failure: unknown;
        let settle!: (event: JobOutcome) => void;
        const outcome = new Promise<JobOutcome>(resolve => { settle = resolve; });
        const worker = createMasSegmentWorker(db, store, { executableRevisions: [run.executableRevision], owner: 'grounding:' + runId,
            concurrency: 1, pollInterval: 1000, leaseMs: Math.max(60000, runtime.workflow.limits.ms + 1000),
            backoffBase: 1, backoffCap: 1,
            execute: async segment => {
                if (segment.run.id !== runId) throw new MasInfrastructureCrash('A differently bound grounding run reached this worker.');
                try { await runtime.executeSegment(segment); } catch (cause) { failure = cause; throw cause; }
            }, onOutcome: event => { if (event.jobId === id) settle(event); } });
        worker.start();
        // A competing process may claim after our read. The native worker owns
        // polling; this bounded wait cannot hang forever waiting for its event.
        const deadline = AbortSignal.timeout(runtime.workflow.limits.ms + 1000);
        let expire!: () => void;
        const elapsed = new Promise<null>(resolve => { expire = () => resolve(null); deadline.addEventListener('abort', expire, { once: true }); });
        let result: JobOutcome | null;
        try { result = await Promise.race([outcome, elapsed]); }
        finally { deadline.removeEventListener('abort', expire); await worker.stop({ graceMs: 1000 }); }
        if (result === null) return;
        if (result.outcome !== 'completed') throw failure ?? new MasInfrastructureCrash(result.reason ?? 'The native segment did not settle.');
    } };
}
