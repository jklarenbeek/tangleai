/** Host-owned domain schemas and pure evaluators; no provider or domain registry globals. */
import type { Json, AdapterIdentity, Scope, Source, SourceRef, Issue, EvaluationSlot, ProposalReply } from './outcomes.contracts.gen.ts';
import type { RunIdentity } from '@tangleai/config';
export type { EvaluationSlot } from './outcomes.contracts.gen.ts';
export interface OutcomeAdapter {
    readonly identity: AdapterIdentity;
    readonly schemas: {
        input: object;
        output: object;
        resolution: object;
        artifact: object;
    };
    readonly staticPayload: Json;
    score(output: Json, resolution: Json): {
        outcome: 'success' | 'partial' | 'failure';
        diagnostics: Json;
    };
    interpret(input: Json, payload: Json): Json;
    validatePayload(payload: Json): Issue[];
    normalizePayload?(payload: Json): Json;
}
export interface EvidenceResolver {
    readonly revision: string;
    resolve(reference: SourceRef, scope: Scope): Promise<Source | undefined>;
}
export interface OutcomePrincipal {
    id: string;
    authorityId: string;
    approve: boolean;
    reconcile: boolean;
}
export interface OutcomeProposer {
    readonly identity: RunIdentity;
    propose(input: Json, hooks: {
        onDispatch(requestDigest: string): Promise<void>;
    }): Promise<ProposalReply>;
}
export interface OutcomeHost {
    principal?: OutcomePrincipal;
    scope: Scope;
    adapters: readonly OutcomeAdapter[];
    resolver: EvidenceResolver;
    authorizeMemoryIds(ids: readonly string[], scope: Scope): Promise<{
        allowed: boolean;
        authorizationId: string;
    }>;
    evaluationSlot?(slotId: string, versionId: string, scope: Scope): Promise<EvaluationSlot | undefined>;
    proposer?: OutcomeProposer;
    resolveConfiguration?(identityId: string): Promise<RunIdentity | undefined>;
}
