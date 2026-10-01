/** Pure state planning. Stores supply retained records and apply one revision. */
import type { GroundingSession, SessionStatus, OptimizerCheckpoint, GroundingExecution, GroundingIssue } from './contracts.gen.ts';
import { equalsJson } from '@jarenjs/core/object';
import { groundingIssue, type StoreOutcome } from './errors.ts';
import { immutableGroundingJson } from './identity.ts';
import { validateGroundingShape } from './schema.ts';

export type SessionCommand =
    | { kind: 'start'; session: GroundingSession }
    | { kind: 'triage' }
    | { kind: 'recordOptimization'; optimization: OptimizerCheckpoint }
    | { kind: 'attachExecution'; execution: GroundingExecution }
    | { kind: 'askClarification' }
    | { kind: 'answerClarification'; fields: Record<string, string> }
    | { kind: 'plan'; intentId: string; planId: string }
    | { kind: 'retrieve' }
    | { kind: 'reconcile' }
    | { kind: 'answer'; answerId?: string }
    | { kind: 'refuse'; answerId?: string }
    | { kind: 'fail'; reason: string; issue?: GroundingIssue }
    | { kind: 'refresh'; reason: string; execution?: GroundingExecution };
export type SessionTransition = { ok: true; next: GroundingSession } | Extract<StoreOutcome<never>, { ok: false }>;
const terminal: SessionStatus[] = ['answered', 'refused', 'failed'];
const transitions: Record<Exclude<SessionCommand['kind'], 'start' | 'answer' | 'recordOptimization' | 'attachExecution'>, { from: SessionStatus[]; to: SessionStatus }> = {
    triage: { from: ['open'], to: 'triaging' },
    askClarification: { from: ['triaging'], to: 'awaiting_clarification' },
    answerClarification: { from: ['awaiting_clarification'], to: 'triaging' },
    plan: { from: ['triaging'], to: 'planning' },
    retrieve: { from: ['planning'], to: 'retrieving' },
    reconcile: { from: ['retrieving'], to: 'reconciling' },
    refuse: { from: ['triaging', 'retrieving', 'reconciling', 'generating'], to: 'refused' },
    fail: { from: ['open', 'triaging', 'awaiting_clarification', 'planning', 'retrieving', 'reconciling', 'generating'], to: 'failed' },
    refresh: { from: terminal, to: 'triaging' },
};
const keys: Record<SessionCommand['kind'], string[]> = {
    start: ['kind', 'session'], triage: ['kind'], askClarification: ['kind'], answerClarification: ['kind', 'fields'],
    recordOptimization: ['kind', 'optimization'],
    attachExecution: ['kind', 'execution'],
    plan: ['kind', 'intentId', 'planId'], retrieve: ['kind'], reconcile: ['kind'], answer: ['kind', 'answerId'],
    refuse: ['kind', 'answerId'], fail: ['kind', 'reason', 'issue'], refresh: ['kind', 'reason', 'execution'],
};
export function planSessionTransition(current: GroundingSession | undefined, command: SessionCommand): SessionTransition {
    if (!command || typeof command !== 'object' || !Object.hasOwn(keys, command.kind) || Object.keys(command).some(key => !keys[command.kind].includes(key)))
        return { ok: false, issue: groundingIssue('TGRD1001', '/command', 'Invalid session command.') };
    if (current) {
        const shape = validateGroundingShape('groundingSession', current);
        if (!shape.valid) return { ok: false, issue: shape.issues[0]! };
    }
    if (command.kind === 'start') {
        if (current) return { ok: false, issue: groundingIssue('TGRD1003', '/status', `Illegal status pair '${current.status}' -> 'open'.`) };
        const shape = validateGroundingShape('groundingSession', command.session);
        if (!shape.valid) return { ok: false, issue: shape.issues[0]! };
        if (shape.value.status !== 'open' || shape.value.revision !== 1 || shape.value.turn !== 0 || shape.value.intentId || shape.value.planId || shape.value.answerIds.length)
            return { ok: false, issue: groundingIssue('TGRD1003', '/status', 'A start creates an open session at revision 1 with no prior work.') };
        return { ok: true, next: shape.value };
    }
    const rule = command.kind === 'attachExecution'
        ? { from: ['open', 'triaging'], to: current?.status ?? 'open' }
        : command.kind === 'recordOptimization'
        ? { from: ['triaging', 'awaiting_clarification', 'planning'], to: current?.status ?? 'triaging' }
        : command.kind === 'answer'
        ? command.answerId === undefined ? { from: ['reconciling'], to: 'generating' as const } : { from: ['generating'], to: 'answered' as const }
        : transitions[command.kind];
    if (!current || !rule.from.includes(current.status)) return { ok: false, issue: groundingIssue('TGRD1003', '/status', `Illegal status pair '${current?.status ?? 'absent'}' -> '${rule.to}'.`) };
    if ((command.kind === 'refresh' || command.kind === 'fail') && (typeof command.reason !== 'string' || !command.reason.trim()))
        return { ok: false, issue: groundingIssue('TGRD1001', '/reason', 'This command requires an explicit reason.') };
    const next: GroundingSession = { ...current, status: rule.to, revision: current.revision + 1 };
    if (command.kind === 'attachExecution') {
        if (current.execution && !equalsJson(current.execution, command.execution) || command.execution.cycle !== 0 || command.execution.previousRunId !== null)
            return { ok: false, issue: groundingIssue('TGRD1002', '/execution', 'An attached execution is immutable; refresh creates its successor.') };
        next.execution = command.execution;
    }
    if (command.kind === 'recordOptimization') next.optimization = command.optimization;
    if (command.kind === 'answerClarification') {
        if (!command.fields || typeof command.fields !== 'object' || Array.isArray(command.fields)) return { ok: false, issue: groundingIssue('TGRD1001', '/fields', 'A clarification response must name fields.') };
        next.userContext = { ...current.userContext, ...command.fields };
        next.turn++;
    }
    if (command.kind === 'plan') { next.intentId = command.intentId; next.planId = command.planId; }
    if ((command.kind === 'answer' || command.kind === 'refuse') && command.answerId !== undefined) next.answerIds = [...current.answerIds, command.answerId];
    if (command.kind === 'fail' && command.issue) next.failure = command.issue;
    if (command.kind === 'refresh') {
        if (current.execution && (!command.execution || command.execution.previousRunId !== current.execution.runId
            || command.execution.runId === current.execution.runId || command.execution.cycle !== current.execution.cycle + 1
            || command.execution.originalQuery !== current.execution.originalQuery || command.execution.reason !== command.reason))
            return { ok: false, issue: groundingIssue('TGRD1002', '/execution', 'Refresh must identify a new successor of the current immutable run.') };
        if (!current.execution && command.execution) return { ok: false, issue: groundingIssue('TGRD1002', '/execution', 'Attach the first execution before refreshing.') };
        delete next.intentId; delete next.planId; delete next.optimization; delete next.failure; next.turn = 0;
        if (command.execution) next.execution = command.execution;
    }
    const shape = validateGroundingShape('groundingSession', next);
    return shape.valid ? { ok: true, next: immutableGroundingJson(shape.value) } : { ok: false, issue: shape.issues[0]! };
}
