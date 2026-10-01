import type { AuthorityTier, GroundingProfile } from './contracts.gen.ts';
import { groundingRefuse, type GroundingOutcome } from './errors.ts';
import { profileRevisionOf } from './identity.ts';
import { validateGroundingShape } from './schema.ts';

export async function loadGroundingProfile(document: unknown): Promise<GroundingOutcome<GroundingProfile>> {
    const shape = validateGroundingShape('groundingProfile', document);
    if (!shape.valid) return shape;
    const profile = shape.value;
    if (await profileRevisionOf(profile) !== profile.revision) return groundingRefuse('TGRD1002', '/revision', 'Profile revision differs from its canonical payload.');
    const patterns = [...profile.emergency.patterns, ...profile.outOfScope.flatMap(rule => rule.patterns)];
    if (patterns.some(pattern => !normalized(pattern))) return groundingRefuse('TGRD1001', '/patterns', 'Policy phrases cannot be empty after normalization.');
    const ids = [...profile.outOfScope.map(r => r.id), ...profile.expansions.map(r => r.id), ...profile.clarification.requiredFields.map(r => 'clarify-' + r.id)];
    if (new Set(ids).size !== ids.length || ids.includes('emergency-route')) return groundingRefuse('TGRD1002', '/id', 'Profile rule identities must be distinct.');
    if (profile.userContext.persistable.some(field => !profile.userContext.collectable.includes(field))) return groundingRefuse('TGRD1001', '/userContext/persistable', 'Persistable fields must be collectable.');
    if (profile.clarification.maxTurns > profile.budgets.clarificationTurns) return groundingRefuse('TGRD1007', '/clarification/maxTurns', 'Clarification exceeds its declared turn ceiling.');
    const hosts = new Set<string>();
    for (const [index, rule] of profile.authority.hosts.entries()) {
        const key = rule.host + (rule.pathPrefix ?? '/');
        if (hosts.has(key)) return groundingRefuse('TGRD1002', `/authority/hosts/${index}`, 'A host/path authority rule is ambiguous.');
        hosts.add(key);
    }
    return shape;
}
const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim();
function phraseMatches(input: string, pattern: string): boolean {
    const phrase = normalized(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, 'u').test(input);
}
export interface ProfileRuleEvaluation {
    emergency: string | null; outOfScope: string | null;
    expansions: Array<{ ruleId: string; queries: string[] }>;
    authorityOf(url: string): { tier: AuthorityTier; ruleId: string; institution: string } | null;
}
/** Phrase and exact-host policy only; this never infers clinical or user facts. */
export function evaluateProfileRules(profile: GroundingProfile, input: { text: string; intents?: string[] }): ProfileRuleEvaluation {
    const text = normalized(input.text);
    const intents = new Set((input.intents ?? []).map(normalized));
    return {
        emergency: profile.emergency.patterns.some(p => phraseMatches(text, p)) ? 'emergency-route' : null,
        outOfScope: profile.outOfScope.find(rule => rule.patterns.some(p => phraseMatches(text, p)))?.id ?? null,
        expansions: profile.expansions.filter(rule => rule.when.intents.some(intent => intents.has(normalized(intent)))).map(rule => ({ ruleId: rule.id, queries: [...rule.addQueries] })),
        authorityOf(inputUrl) {
            let url: URL;
            try { url = new URL(inputUrl); } catch { return null; }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash) return null;
            const path = url.pathname;
            const matches = profile.authority.hosts.map((rule, index) => ({ rule, index })).filter(({ rule }) => {
                const prefix = rule.pathPrefix ?? '/';
                return url.hostname === rule.host && (prefix === '/' || path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));
            }).sort((a, b) => (b.rule.pathPrefix?.length ?? 1) - (a.rule.pathPrefix?.length ?? 1) || a.index - b.index);
            const match = matches[0];
            return match ? { tier: match.rule.tier, institution: match.rule.institution, ruleId: `authority:${match.rule.host}${match.rule.pathPrefix ?? '/'}` } : null;
        },
    };
}
