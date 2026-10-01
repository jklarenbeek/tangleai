/** A contribution recomputes only supplied affected canonicals and preserves withdrawn evidence. */
import { cloneJson, equalsJson as same } from '@jarenjs/core/object';
import type { GraphEntity, GraphRelation, GraphEntityClaim, GraphRelationClaim, GraphContributionInput, GraphContributionPlan } from './contracts.gen.ts';
import { validateLightRagShape } from './schema.ts';
import { validateGraphClaim, validateCanonicalEntity, validateCanonicalRelation } from './integrity.ts';
import { canonicalGraphRevisionOf, canonicalRelationIdOf, lightragRevisionOf, immutableLightRagJson } from './identity.ts';
import { lightragMust, lightragReject, lightragFailure, type LightRagOutcome } from './errors.ts';
const ids = (values: readonly string[]): string[] => [...new Set(values)].sort();
const sorted = <T extends { id: string }>(rows: Iterable<T>): T[] => [...rows].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
async function stamp<T extends object>(row: T): Promise<T & { revision: string }> {
    return { ...row, revision: await canonicalGraphRevisionOf(row) };
}
function keyed<T extends { id: string }>(rows: readonly T[], path: string): Map<string, T> {
    const out = new Map<string, T>();
    for (const row of rows) {
        if (out.has(row.id)) lightragReject('TLRAG1001', path, 'A plan cannot contain duplicate record addresses.');
        out.set(row.id, cloneJson(row));
    }
    return out;
}
function claimUnion<T extends GraphEntityClaim | GraphRelationClaim>(old: T[], incoming: T[]): Map<string,T> {
    const values = keyed(old, '/existing/claims');
    for (const row of keyed(incoming, '/claims').values()) {
        if (values.has(row.id) && !same(values.get(row.id), row)) lightragReject('TLRAG1002', '/claims', 'An immutable claim address has different bytes.');
        values.set(row.id, row);
    }
    return values;
}
/** Profile text is accepted only with its complete current claim basis. */
function profileFor(input: GraphContributionInput, kind: 'entity' | 'relation', row: GraphEntity | GraphRelation, support: string[]): string {
    if (!support.length) return '';
    const updates = input.profileUpdates.filter(value => value.kind === kind && value.id === row.id);
    if (updates.length > 1) lightragReject('TLRAG1001', '/profileUpdates', 'A canonical has more than one prepared profile.');
    if (updates.length) {
        if (!same(ids(updates[0].claimIds), support)) lightragReject('TLRAG1003', '/profileUpdates', 'A profile must bind every current supporting claim and no withdrawn claim.');
        return updates[0].profile;
    }
    const originals = kind === 'entity' ? [...input.candidates.entities, ...input.existing.canonicals.entities] : [...input.candidates.relations, ...input.existing.canonicals.relations];
    const exact = originals.find(value => value.id === row.id && same(ids(value.supportClaimIds), support));
    if (!exact) lightragReject('TLRAG1003', '/profileUpdates', 'Changed support requires a profile prepared from exactly the resulting claims.');
    return exact.profile;
}
function reviewed(input: GraphContributionInput, a: string, b: string, decision: 'merge' | 'keep-apart'): boolean {
    return input.reviews.some(row => row.decision === decision && row.claimIds.includes(a) && row.claimIds.includes(b));
}
/** Names and evidence determine permitted groups; vectors never decide a merge. */
function checkGrouping(input: GraphContributionInput, entities: GraphEntity[], claims: Map<string, GraphEntityClaim>): void {
    const before = new Map<string,string>();
    for (const row of input.existing.canonicals.entities.filter(row => row.status === 'active')) for (const claim of row.supportClaimIds) before.set(claim, row.id);
    const groups = entities.filter(row => row.status === 'active');
    for (let i = 0; i < groups.length; i++) for (let j = i; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (a.normalizedName !== b.normalizedName || a.types[0] !== b.types[0]) continue;
        for (const left of a.supportClaimIds) for (const right of b.supportClaimIds) {
            if (left >= right && i === j) continue;
            const x = claims.get(left)!, y = claims.get(right)!;
            if (x.description === y.description && i === j) continue;
            if (before.has(left) && before.has(right) && (before.get(left) === before.get(right)) === (i === j)) continue;
            if (!reviewed(input, left, right, i === j ? 'merge' : 'keep-apart'))
                lightragReject('TLRAG1006', '/reviews', 'A changed same-name and same-type grouping needs an explicit co-reference decision over its claims.');
        }
    }
}
export async function planContribution(value: GraphContributionInput): Promise<LightRagOutcome<GraphContributionPlan>> {
    try {
        const input = lightragMust(validateLightRagShape('graphContributionInput', value));
        if (new Set(input.chunks.map(chunk => chunk.id)).size !== input.chunks.length) lightragReject('TLRAG1003', '/chunks', 'Supplied chunk addresses must be unique.');
        const entityClaims = claimUnion(input.existing.claims.entities, input.claims.entities), relationClaims = claimUnion(input.existing.claims.relations, input.claims.relations);
        for (const claim of entityClaims.values()) lightragMust(await validateGraphClaim('entity', claim, input.chunks));
        for (const claim of relationClaims.values()) lightragMust(await validateGraphClaim('relation', claim, input.chunks));
        const retired = new Set(input.retiredClaimIds);
        for (const id of retired) if (!entityClaims.has(id) && !relationClaims.has(id)) lightragReject('TLRAG1003', '/retiredClaimIds', 'A withdrawn claim must be present in the supplied evidence.');
        for (const claim of [...input.claims.entities, ...input.claims.relations]) if (retired.has(claim.id)) lightragReject('TLRAG1006', '/claims', 'One transition cannot both introduce and withdraw the same claim.');
        for (const review of input.reviews) {
            const support = review.claimIds.map(id => entityClaims.get(id));
            if (support.some(row => row === undefined)) lightragReject('TLRAG1003', '/reviews', 'A co-reference decision names absent claims.');
            if (support.some(row => row!.normalizedName !== support[0]!.normalizedName || row!.type !== support[0]!.type))
                lightragReject('TLRAG1006', '/reviews', 'A co-reference decision cannot cross normalized names or types.');
        }
        for (let i = 0; i < input.reviews.length; i++) for (let j = i + 1; j < input.reviews.length; j++)
            if (input.reviews[i].decision !== input.reviews[j].decision && input.reviews[i].claimIds.filter(id => input.reviews[j].claimIds.includes(id)).length > 1)
                lightragReject('TLRAG1006', '/reviews', 'Contradictory co-reference decisions cannot enter one contribution.');
        for (const profile of input.profiles) {
            const chunk = input.chunks.find(row => row.id === profile.chunkId);
            if (!chunk || chunk.versionId !== profile.versionId) lightragReject('TLRAG1003', '/profiles', 'A chunk profile must resolve to its supplied version.');
        }
        if (new Set(input.profiles.map(row => row.chunkId)).size !== input.profiles.length) lightragReject('TLRAG1001', '/profiles', 'Chunk profiles must have unique addresses.');
        const previousEntities = keyed(input.existing.canonicals.entities, '/existing/entities'), previousRelations = keyed(input.existing.canonicals.relations, '/existing/relations');
        for (const row of previousEntities.values()) lightragMust(await validateCanonicalEntity(row, [...entityClaims.values()], { previous: row, expectedEmbeddedBy: input.embeddedBy }));
        for (const row of previousRelations.values()) lightragMust(await validateCanonicalRelation(row, [...relationClaims.values()], [...previousEntities.values()], { expectedEmbeddedBy: input.embeddedBy }));
        const entities = new Map([...previousEntities].map(([id, row]) => [id, cloneJson(row)])), relations = new Map([...previousRelations].map(([id, row]) => [id, cloneJson(row)]));
        for (const candidate of keyed(input.candidates.entities, '/candidates/entities').values()) {
            if (candidate.status !== 'active') lightragReject('TLRAG1006', '/candidates', 'Only active canonical candidates can enter a contribution.');
            if (candidate.supportClaimIds.some(id => !input.claims.entities.some(claim => claim.id === id)))
                lightragReject('TLRAG1003', '/candidates/entities', 'A prepared source candidate can contain only its incoming entity claims.');
            lightragMust(await validateCanonicalEntity(candidate, [...entityClaims.values()], { previous: previousEntities.get(candidate.id), expectedEmbeddedBy: input.embeddedBy }));
            const old = entities.get(candidate.id);
            if (old?.status === 'merged') lightragReject('TLRAG1006', '/candidates', 'A merged identity must be resolved through its retained survivor.');
            entities.set(candidate.id, { ...candidate, supportClaimIds: ids([...(old?.supportClaimIds ?? []), ...candidate.supportClaimIds]) });
        }
        const redirects = new Map<string,string>();
        for (const group of input.merges) {
            const ordered = ids(group), members = ordered.map(id => entities.get(id));
            if (members.some(row => row === undefined || row.status !== 'active')) lightragReject('TLRAG1006', '/merges', 'A merge needs distinct active canonical candidates.');
            const survivor = members[0]!;
            if (members.some(row => row!.normalizedName !== survivor.normalizedName || row!.types[0] !== survivor.types[0]))
                lightragReject('TLRAG1006', '/merges', 'A merge cannot cross normalized names or types.');
            if (ordered.some(id => redirects.has(id) || [...redirects.values()].includes(id))) lightragReject('TLRAG1006', '/merges', 'Overlapping merge groups must be resolved before planning.');
            for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++)
                for (const left of members[i]!.supportClaimIds) for (const right of members[j]!.supportClaimIds)
                    if (!retired.has(left) && !retired.has(right) && !reviewed(input, left, right, 'merge'))
                        lightragReject('TLRAG1006', '/merges', 'Merging distinct identities requires an explicit claim-bound decision.');
            survivor.supportClaimIds = ids(members.flatMap(row => row!.supportClaimIds));
            entities.set(survivor.id, survivor);
            for (const row of members.slice(1) as GraphEntity[]) {
                const historic = previousEntities.get(row.id)?.status === 'active' ? previousEntities.get(row.id)! : input.candidates.entities.find(candidate => candidate.id === row.id)!;
                redirects.set(row.id, survivor.id); entities.set(row.id, await stamp({ ...historic, status: 'merged' as const, mergedInto: survivor.id }));
            }
        }
        for (const [id, row] of entities) {
            if (row.status === 'merged') continue;
            const supportClaimIds = ids(row.supportClaimIds.filter(claim => !retired.has(claim))), supporting = supportClaimIds.map(claim => entityClaims.get(claim)!);
            const next = await stamp({ ...row, supportClaimIds, supportChunkIds: ids(supporting.map(claim => claim.chunkId)),
                aliases: ids(supporting.map(claim => claim.name).filter(name => name !== row.name)),
                profile: profileFor(input, 'entity', row, supportClaimIds), status: supportClaimIds.length ? 'active' as const : 'retracted' as const });
            entities.set(id, next);
        }
        checkGrouping(input, [...entities.values()], entityClaims);
        for (const candidate of keyed(input.candidates.relations, '/candidates/relations').values()) {
            if (candidate.status !== 'active') lightragReject('TLRAG1006', '/candidates', 'Only active relation candidates can enter a contribution.');
            if (candidate.supportClaimIds.some(id => !input.claims.relations.some(claim => claim.id === id)))
                lightragReject('TLRAG1003', '/candidates/relations', 'A prepared source candidate can contain only its incoming relation claims.');
            // Candidate endpoints may merge in this same plan; validate their pre-merge addresses first.
            const endpointRows = [...new Map([...previousEntities.values(), ...input.candidates.entities].map(row => [row.id, row])).values()];
            lightragMust(await validateCanonicalRelation(candidate, [...relationClaims.values()], endpointRows, { expectedEmbeddedBy: input.embeddedBy }));
            const old = relations.get(candidate.id);
            if (old?.status === 'merged') lightragReject('TLRAG1006', '/candidates', 'A merged relation must be resolved through its retained successor.');
            relations.set(candidate.id, { ...candidate, supportClaimIds: ids([...(old?.supportClaimIds ?? []), ...candidate.supportClaimIds]) });
        }
        for (const row of [...relations.values()]) {
            if (row.status !== 'active') continue;
            const sourceEntityId = redirects.get(row.sourceEntityId) ?? row.sourceEntityId, targetEntityId = redirects.get(row.targetEntityId) ?? row.targetEntityId;
            const id = await canonicalRelationIdOf(sourceEntityId, targetEntityId, row.themes);
            if (id === row.id) continue;
            const existing = relations.get(id);
            relations.set(id, { ...row, id, sourceEntityId, targetEntityId, supportClaimIds: ids([...row.supportClaimIds, ...(existing?.supportClaimIds ?? [])]) });
            const historic = previousRelations.get(row.id)?.status === 'active' ? previousRelations.get(row.id)! : input.candidates.relations.find(candidate => candidate.id === row.id)!;
            relations.set(row.id, await stamp({ ...historic, status: 'merged' as const, mergedInto: id }));
        }
        for (const [id, row] of relations) {
            if (row.status === 'merged') continue;
            const supportClaimIds = ids(row.supportClaimIds.filter(claim => !retired.has(claim))), supporting = supportClaimIds.map(claim => relationClaims.get(claim)!);
            relations.set(id, await stamp({ ...row, supportClaimIds, supportChunkIds: ids(supporting.map(claim => claim.chunkId)),
                profile: profileFor(input, 'relation', row, supportClaimIds), strength: supporting.length ? Math.max(...supporting.map(claim => claim.strength)) : 0,
                status: supportClaimIds.length ? 'active' as const : 'retracted' as const }));
        }
        const incoming = new Set([...input.claims.entities, ...input.claims.relations].map(row => row.id));
        for (const update of input.profileUpdates) {
            const row = (update.kind === 'entity' ? entities : relations).get(update.id), before = (update.kind === 'entity' ? previousEntities : previousRelations).get(update.id);
            if (!row || row.status !== 'active') lightragReject('TLRAG1003', '/profileUpdates', 'A prepared profile must name a resulting active canonical.');
            if (before && same(ids(before.supportClaimIds), ids(row.supportClaimIds)) && !row.supportClaimIds.some(id => incoming.has(id)))
                lightragReject('TLRAG1006', '/profileUpdates', 'An unrelated unchanged canonical cannot be reprofiled by this contribution.');
        }
        const activeEntityOwners = new Map<string,string>(), activeRelationOwners = new Map<string,string>();
        for (const [rows, owners] of [[entities, activeEntityOwners], [relations, activeRelationOwners]] as const) for (const row of rows.values()) if (row.status === 'active') for (const claim of row.supportClaimIds) {
            if (owners.has(claim)) lightragReject('TLRAG1006', '/supportClaimIds', 'A claim cannot support two active canonical identities.');
            owners.set(claim, row.id);
        }
        for (const [incoming, owners] of [[input.claims.entities, activeEntityOwners], [input.claims.relations, activeRelationOwners]] as const)
            for (const claim of incoming) if (!owners.has(claim.id)) lightragReject('TLRAG1003', '/claims', 'Every incoming claim needs an active canonical.');
        for (const old of previousEntities.values()) if (old.status === 'active') for (const claim of old.supportClaimIds) {
            if (!retired.has(claim) && activeEntityOwners.get(claim) !== (redirects.get(old.id) ?? old.id))
                lightragReject('TLRAG1006', '/supportClaimIds', 'An existing entity claim can move only through an explicit merge.');
        }
        for (const row of entities.values()) lightragMust(await validateCanonicalEntity(row, [...entityClaims.values()], { previous: previousEntities.get(row.id), expectedEmbeddedBy: input.embeddedBy }));
        for (const row of relations.values()) lightragMust(await validateCanonicalRelation(row, [...relationClaims.values()], [...entities.values()], { expectedEmbeddedBy: input.embeddedBy }));
        const body = { input, canonicals: { entities: sorted(entities.values()), relations: sorted(relations.values()) },
            touchedEntityIds: sorted(entities.values()).filter(row => !same(previousEntities.get(row.id) ?? null, row)).map(row => row.id),
            touchedRelationIds: sorted(relations.values()).filter(row => !same(previousRelations.get(row.id) ?? null, row)).map(row => row.id) };
        return { valid: true, value: immutableLightRagJson({ ...body, revision: await lightragRevisionOf(body) }) };
    } catch (cause) { return lightragFailure(cause); }
}
