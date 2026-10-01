import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGroundingStore, planSessionTransition, type GroundingSession, type SessionCommand, type SessionStatus } from '@tangleai/grounding';
import { contractMust, contractProfile } from '../../benchmark/lib/priha-contracts.ts';

describe('grounding pure session planning', async () => {
    const profile = await contractProfile(), store = createMemoryGroundingStore();
    contractMust(await store.putProfile(profile));
    const initial = contractMust(await store.createSession({ conversationId: 'transitions', profileId: profile.id, profileRevision: profile.revision }));
    const statuses: SessionStatus[] = ['open', 'triaging', 'awaiting_clarification', 'planning', 'retrieving', 'reconciling', 'generating', 'answered', 'refused', 'failed'];
    const commands: Array<{ command: Exclude<SessionCommand, { kind: 'start' }>; from: SessionStatus[]; to: SessionStatus }> = [
        { command: { kind: 'triage' }, from: ['open'], to: 'triaging' },
        { command: { kind: 'askClarification' }, from: ['triaging'], to: 'awaiting_clarification' },
        { command: { kind: 'answerClarification', fields: { service: 'voucher desk' } }, from: ['awaiting_clarification'], to: 'triaging' },
        { command: { kind: 'plan', intentId: 'intent', planId: 'plan' }, from: ['triaging'], to: 'planning' },
        { command: { kind: 'retrieve' }, from: ['planning'], to: 'retrieving' },
        { command: { kind: 'reconcile' }, from: ['retrieving'], to: 'reconciling' },
        { command: { kind: 'answer' }, from: ['reconciling'], to: 'generating' },
        { command: { kind: 'answer', answerId: 'answer' }, from: ['generating'], to: 'answered' },
        { command: { kind: 'refuse' }, from: ['triaging', 'retrieving', 'reconciling', 'generating'], to: 'refused' },
        { command: { kind: 'fail', reason: 'Fixture failure.' }, from: statuses.filter(s => !['answered', 'refused', 'failed'].includes(s)), to: 'failed' },
        { command: { kind: 'refresh', reason: 'Explicit refresh.' }, from: ['answered', 'refused', 'failed'], to: 'triaging' },
    ];
    it('refuses every illegal status pair with TGRD1003 and applies one revision per legal command', () => {
        for (const { command, from, to } of commands) for (const status of statuses) {
            const current: GroundingSession = { ...initial, status, revision: 8 };
            const result = planSessionTransition(current, command);
            if (!from.includes(status)) {
                assert.equal(result.ok, false, `${status} -> ${to}`); assert.equal(result.issue.code, 'TGRD1003'); assert.match(result.issue.detail, new RegExp(`'${status}' -> '${to}'`));
            } else { assert.ok(result.ok); assert.equal(result.next.revision, 9); assert.equal(result.next.status, to); }
            assert.equal(current.revision, 8);
        }
    });
    it('starts once and refuses malformed commands before a transition', () => {
        const start = planSessionTransition(undefined, { kind: 'start', session: initial }); assert.ok(start.ok); assert.equal(start.next.revision, 1);
        const repeat = planSessionTransition(initial, { kind: 'start', session: initial }); assert.equal(repeat.ok, false); assert.equal(repeat.issue.code, 'TGRD1003');
        for (const command of [{ kind: 'triage', extra: true }, { kind: 'invented' }, { kind: 'refresh', reason: '' }]) assert.equal(planSessionTransition({ ...initial, status: 'answered' }, command as SessionCommand).ok, false);
    });
    it('counts only human replies and preserves answer history through explicit refresh', () => {
        const response = planSessionTransition({ ...initial, status: 'awaiting_clarification' }, { kind: 'answerClarification', fields: { service: 'voucher desk' } }); assert.ok(response.ok); assert.equal(response.next.turn, 1);
        const refreshed = planSessionTransition({ ...response.next, status: 'answered', intentId: 'old', planId: 'old-plan', answerIds: ['past'] }, { kind: 'refresh', reason: 'New information requested.' }); assert.ok(refreshed.ok);
        assert.deepEqual(refreshed.next.answerIds, ['past']); assert.equal(refreshed.next.planId, undefined); assert.equal(refreshed.next.intentId, undefined); assert.equal(refreshed.next.turn, 0);
    });
});
