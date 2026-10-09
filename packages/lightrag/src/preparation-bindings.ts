/** Large write plans bind retained preparation without repeating its payload. */
import { equalsJson } from '@jarenjs/core/object';
import type { GraphContributionPlan, GraphPreparationBindings, GraphProjection, ProjectionWritePlan } from './contracts.gen.ts';
import { lightragRevisionOf } from './identity.ts';
import { lightragReject } from './errors.ts';

export type ProjectionPreparationSources = Pick<ProjectionWritePlan, 'request' | 'priorProjections'>;
const withoutPreparation = ({ prepared: _prepared, ...row }: GraphProjection): GraphProjection => row;

export async function bindProjectionPreparations(request: GraphProjection, priorProjections: GraphProjection[], contribution: GraphContributionPlan) {
    const preparations: GraphPreparationBindings = { prior: [] };
    for (const row of priorProjections) if (row.prepared)
        preparations.prior.push({ id: row.id, revision: await lightragRevisionOf(row.prepared) });
    if (request.prepared && equalsJson(request.prepared.plan, contribution)) {
        const { plan: _plan, ...metadata } = request.prepared;
        preparations.request = metadata;
        request = withoutPreparation(request);
    }
    return { request, priorProjections: priorProjections.map(withoutPreparation), preparations };
}

/** Resolve only inside the transaction that verifies and applies the plan. */
export async function resolveProjectionPreparations(plan: ProjectionWritePlan, actual: readonly GraphProjection[]): Promise<ProjectionPreparationSources> {
    const bindings = plan.preparations;
    if (!bindings) return plan;
    const revisions = new Map(bindings.prior.map(row => [row.id, row.revision]));
    if (revisions.size !== bindings.prior.length || bindings.prior.some(row => !plan.priorProjections.some(prior => prior.id === row.id)))
        lightragReject('TLRAG1002', '/preparations/prior', 'Preparation bindings must name distinct prior projections.');
    const retained = new Map(actual.map(row => [row.id, row]));
    const priorProjections: GraphProjection[] = [];
    for (const row of plan.priorProjections) {
        if (row.prepared !== undefined) lightragReject('TLRAG1002', '/priorProjections', 'A compact prior snapshot cannot repeat preparation bytes.');
        const revision = revisions.get(row.id);
        if (revision === undefined) {
            if (retained.get(row.id)?.prepared !== undefined)
                lightragReject('TLRAG1006', '/preparations/prior', 'A retained preparation is missing its snapshot binding.');
            priorProjections.push(row); continue;
        }
        const prepared = retained.get(row.id)?.prepared;
        if (!prepared || await lightragRevisionOf(prepared) !== revision)
            lightragReject('TLRAG1006', '/preparations/prior', 'Retained preparation changed after the write plan was prepared.');
        priorProjections.push(Object.freeze({ ...row, prepared }));
    }
    if (bindings.request && plan.request.prepared !== undefined)
        lightragReject('TLRAG1002', '/preparations/request', 'A compact request cannot repeat its preparation plan.');
    const request = bindings.request ? Object.freeze({ ...plan.request,
        prepared: Object.freeze({ ...bindings.request, plan: plan.contribution }) }) : plan.request;
    return { request, priorProjections };
}
