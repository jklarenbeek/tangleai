/** Rules decide source eligibility and preference; models may only explain unresolved conflicts. */
import type { EvidenceCandidate, EvidenceConflict, GroundingProfile } from './contracts.gen.ts';
import { groundingIdOf, immutableGroundingJson } from './identity.ts';
import { groundingMust, groundingReject } from './errors.ts';
import { loadGroundingProfile } from './profile.ts';
import { validateGroundingShape } from './schema.ts';

export interface ReconciliationFact {
    jurisdiction?: string;
    versionStatus?: 'active' | 'superseded' | 'staging' | 'failed';
    /** Host-owned atomic predicate groups. Without these, the atomic query is the conservative scope. */
    topics?: string[];
}
export interface ReconciliationContext {
    sessionId: string;
    now: string;
    facts: Record<string, ReconciliationFact>;
    criticalQueries?: string[];
    criticalTopics?: string[];
}
export interface ReconciliationResult {
    admitted: EvidenceCandidate[];
    conflicts: EvidenceConflict[];
    ineligible: Array<{ id: string; reason: string; ruleId: string }>;
    census: { ignoredTimeFacts: number; unofficialNoise: number; comparisons: number };
}
/** Deterministic, side-effect-free projection. Observations and policy are supplied, never fetched. */
export async function reconcileEvidence(profileInput: GroundingProfile, input: readonly EvidenceCandidate[], contextInput: ReconciliationContext): Promise<ReconciliationResult> {
    const profile = groundingMust(await loadGroundingProfile(profileInput));
    const context = immutableGroundingJson(contextInput), raw = immutableGroundingJson(input);
    groundingMust(validateGroundingShape('evidenceTimes', { provenance: 'curator', effectiveAt: context.now }));
    if (!context.sessionId?.trim() || new Set(raw.map(row => row.id)).size !== raw.length)
        groundingReject('TGRD1004', '/evidence', 'Reconciliation requires a session and distinct evidence identities.');
    const census = { ignoredTimeFacts: 0, unofficialNoise: 0, comparisons: 0 };
    // A timestamp with no provenance contributes no time fact, including on direct unpersisted input.
    const candidates = raw.map(row => {
        const times = { ...row.times };
        if (!times.provenance) for (const key of ['publishedAt', 'effectiveAt', 'expiresAt', 'reviewedAt'] as const) {
            if (times[key] !== undefined) { census.ignoredTimeFacts++; delete times[key]; }
        }
        const value = groundingMust(validateGroundingShape('evidenceCandidate', { ...row, times }));
        if (value.sessionId !== context.sessionId || value.profileRevision !== profile.revision)
            groundingReject('TGRD1004', '/evidence', 'Evidence belongs to another session or profile.');
        return value;
    });
    const conflicts: EvidenceConflict[] = [], ineligible: ReconciliationResult['ineligible'] = [], excluded = new Set<string>();
    const critical = (queryId: string, topic: string) => context.criticalQueries?.includes(queryId) || context.criticalTopics?.includes(topic);
    const conflict = async (rows: EvidenceCandidate[], topic: string, issue: EvidenceConflict['issue'], ruleId: string,
        decision: EvidenceConflict['decision'], selected: string[], removed: string[], time: string) => {
        const payload = { sessionId: context.sessionId, queryId: rows[0]!.queryId, topicKey: topic, claimIds: [],
            evidenceIds: rows.map(row => row.id).sort(), issue, comparison: { authority: [...rows].sort((a, b) => a.id.localeCompare(b.id)).map(row => row.authority.tier).join('/'), time },
            severity: critical(rows[0]!.queryId, topic) ? 'critical' as const : 'material' as const,
            decision, ruleIds: [ruleId], modelIdentity: null, selectedEvidenceIds: selected, excludedEvidenceIds: removed };
        conflicts.push(groundingMust(validateGroundingShape('evidenceConflict', { ...payload, id: await groundingIdOf('conflict', payload) })));
    };
    for (const row of candidates) {
        const fact = context.facts[row.id] ?? {}, time = row.times, now = Date.parse(context.now);
        let reason: EvidenceConflict['issue'] | undefined, ruleId = '';
        if (time.provenance && time.expiresAt && Date.parse(time.expiresAt) < now) { reason = 'expired'; ruleId = 'expired-evidence'; }
        else if (fact.versionStatus && fact.versionStatus !== 'active') { reason = 'superseded'; ruleId = 'inactive-version'; }
        else if (time.provenance && time.effectiveAt && Date.parse(time.effectiveAt) > now) { reason = 'not-yet-effective'; ruleId = 'future-effective'; }
        else if (row.lane === 'web' && profile.authority.excludedTiers?.includes(row.authority.tier)) { reason = 'authority-excluded'; ruleId = 'authority-excluded'; }
        else if (fact.jurisdiction !== undefined && fact.jurisdiction !== profile.jurisdiction) { reason = 'jurisdiction'; ruleId = 'jurisdiction-match'; }
        if (reason) {
            ineligible.push({ id: row.id, reason, ruleId }); excluded.add(row.id);
            await conflict([row], row.queryId, reason, ruleId, 'refuse', [], [row.id], reason);
        }
    }
    const groups = new Map<string, { queryId: string; topic: string; rows: EvidenceCandidate[] }>();
    for (const row of candidates.filter(row => !excluded.has(row.id))) {
        const topics = context.facts[row.id]?.topics ?? [row.queryId];
        if (!topics.length || topics.some(topic => !topic.trim()) || new Set(topics).size !== topics.length)
            groundingReject('TGRD1001', '/topics', 'Evidence topics must be distinct nonempty host-owned identifiers.');
        for (const topic of topics) {
            const key = JSON.stringify([row.queryId, topic]), group = groups.get(key) ?? { queryId: row.queryId, topic, rows: [] };
            group.rows.push(row); groups.set(key, group);
        }
    }
    // Compare all eligible pairs before discarding losers; traversal order never decides the winner.
    for (const { topic, rows } of groups.values()) for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!, b = rows[j]!;
        if (a.excerpt === b.excerpt || a.lane === 'local' && b.lane === 'local' && 'versionId' in a.address && 'versionId' in b.address
            && a.address.versionId === b.address.versionId && a.address.parentChunkId && a.address.parentChunkId === b.address.parentChunkId) continue;
        census.comparisons++;
        const officialA = a.authority.tier === 'official', officialB = b.authority.tier === 'official';
        if (officialA !== officialB) {
            const winner = officialA ? a : b, loser = officialA ? b : a; census.unofficialNoise++;
            excluded.add(loser.id);
            await conflict([a, b], topic, 'official-vs-unofficial', 'official-preferred', winner.lane === 'web' ? 'prefer-web' : 'prefer-local', [winner.id], [loser.id], 'authority-before-time');
        } else if (officialA && officialB) {
            const first = a.times.provenance && a.times.effectiveAt ? Date.parse(a.times.effectiveAt) : null;
            const second = b.times.provenance && b.times.effectiveAt ? Date.parse(b.times.effectiveAt) : null;
            if (first !== null && second !== null && first !== second) {
                const winner = first > second ? a : b, loser = first > second ? b : a; excluded.add(loser.id);
                await conflict([a, b], topic, 'stale-vs-newer', 'effective-official', winner.lane === 'web' ? 'prefer-web' : 'prefer-local', [winner.id], [loser.id], 'proven-effective-order');
            } else await conflict([a, b], topic, 'official-vs-official', critical(a.queryId, topic) ? 'official-conflict-critical' : 'official-conflict-caveat', 'unresolved', [], [], 'no-proven-effective-order');
        }
    }
    return immutableGroundingJson({ admitted: candidates.filter(row => !excluded.has(row.id)), conflicts: conflicts.sort((a, b) => a.id.localeCompare(b.id)), ineligible, census });
}
