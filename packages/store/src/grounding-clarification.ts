/** One published MAS segment handler over the existing durable queue, bound to one session's workflow. */
import type { GroundingClarificationHost } from '@tangleai/grounding';
import { masJobKindOf, segmentJobIdOf, type MasRuntimeObserver } from '@tangleai/mas';
import type { TangleDb } from './db.ts';
import { createMasStore } from './mas-store.ts';
import { createMasSegmentHandlers, enqueueMasSegment, ensurePendingMasSegments } from './mas-jobs.ts';
export function createGroundingClarificationHost(db: TangleDb, options: {
    now: () => string; deadlineFor: (afterMs: number) => string; observer?: MasRuntimeObserver;
}): GroundingClarificationHost {
    if (!db.jobs) throw new TypeError('A durable grounding clarification host requires jobs.');
    const store = createMasStore(db, { now: options.now });
    return { store, ...options, async execute(runtime, runId) {
        const jobs = db.jobs!;
        let run = await store.getRun(runId);
        if (!run || run.executableRevision !== runtime.plan.executableRevision) throw Error('Grounding MAS run binding differs.');
        if (['completed', 'failed', 'waiting_for_input'].includes(run.status)) return;
        if (run.status === 'resume_pending') { await ensurePendingMasSegments(db, store); run = (await store.getRun(runId))!; }
        if (run.status !== 'queued') throw Error('The grounding MAS segment is already claimed or unavailable.');
        if (run.segment === 0) await enqueueMasSegment(db, { runId, segment: 0, workflowVersionId: run.workflowVersionId,
            registryRevision: run.registryRevision, executableRevision: run.executableRevision });
        const kind = masJobKindOf(run.executableRevision), owner = 'grounding:' + runId;
        const handlers = createMasSegmentHandlers(store, { executableRevisions: [run.executableRevision], owner,
            execute: segment => runtime.executeSegment(segment) });
        // The specialized domain fixes caseId to this session, so no other session
        // shares this executable kind. The native claim and semantic fence remain authoritative.
        const job = await jobs.claim({ kinds: [kind], owner, leaseMs: Math.max(60000, runtime.workflow.limits.ms + 1000) });
        if (!job) throw Error('No unclaimed grounding MAS segment is available.');
        try {
            if (job.id !== segmentJobIdOf(runId, run.segment)) throw Error('The claimed grounding segment belongs to another run.');
            const result = await handlers[kind]!(job.payload, { job, checkpoints: jobs.checkpointsFor(job), signal: new AbortController().signal });
            await jobs.complete(job.lease, result ?? null);
        } catch (cause) { await jobs.fail(job.lease, cause); throw cause; }
    } };
}
