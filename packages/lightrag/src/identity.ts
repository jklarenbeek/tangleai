import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
import { foldEntityName, foldThemes } from './normalize.ts';
/** Validate JSON before cloning, preserving immutability across injected seams. */
export function immutableLightRagJson<T>(value: T): T {
    return deepFreeze(JSON.parse(canonicalizeJson(value))) as T;
}
export const lightragRevisionOf = (value: unknown): Promise<string> => canonicalSha256(value);
/** Membership belongs to the projection; it cannot participate in its own claim hash. */
export function claimIdOf<T extends object>(claim: T): Promise<string> {
    const { id: _id, ...payload } = claim as T & { id?: string };
    return canonicalSha256({ domain: 'lightrag-claim/1', payload });
}
/** A supporting claim distinguishes a reviewed same-name collision without guessing a merge. */
export function canonicalEntityIdOf(name: string, type: string, identityClaimId?: string): Promise<string> {
    return canonicalSha256({ domain: 'lightrag-entity/1', normalizedName: foldEntityName(name), type, ...(identityClaimId === undefined ? {} : { identityClaimId }) });
}
export function canonicalRelationIdOf(sourceEntityId: string, targetEntityId: string, themes: readonly string[]): Promise<string> {
    return canonicalSha256({ domain: 'lightrag-relation/1', sourceEntityId, targetEntityId, themes: foldThemes(themes) });
}
export function projectionIdOf(sourceId: string, versionId: string, contributionRevision: string): Promise<string> {
    return canonicalSha256({ domain: 'lightrag-projection/1', sourceId, versionId, contributionRevision });
}

/** Mutable canonical projections retain an exact content revision beside their stable address. */
export function canonicalGraphRevisionOf<T extends object>(value: T): Promise<string> {
    const { revision: _revision, ...body } = value as T & { revision?: string };
    return canonicalSha256(body);
}

/** The recurring source contribution excludes mutable heads and other sources' projections. */
export function contributionRevisionOf(value: { sourceId: string; versionId: string; claims: import('./contracts.gen.ts').GraphClaimSet;
    profiles: import('./contracts.gen.ts').GraphChunkProfile[]; identities: import('./contracts.gen.ts').LightRagIdentities }): Promise<string> {
    return canonicalSha256({ domain: 'lightrag-contribution/1', sourceId: value.sourceId, versionId: value.versionId,
        claims: { entities: [...value.claims.entities].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
            relations: [...value.claims.relations].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) },
        profiles: [...value.profiles].sort((a,b) => a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0), identities: value.identities });
}
