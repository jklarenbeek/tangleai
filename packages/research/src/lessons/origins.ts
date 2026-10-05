/** Source classes come from native committed records, never a proposal's label. */
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { compileJSONPointer, JSONPOINTER_NOTHING } from '@jarenjs/json/pointer';
import type { DocumentElement } from '@tangleai/documents';
import type { ArtifactAdmission, EvidenceCard, ResearchLessonV2, ResearchGateResponse } from '../contracts.gen.ts';
import type { ResearchRecordKind, ResearchRecordMap } from '../records.ts';
import { validateResearchRecord } from '../records.ts';
import { researchRevisionOf } from '../identity.ts';
import type { ResearchTransaction } from '../store.ts';
import type { LessonStoreAccess } from './access.ts';
import { resolveEvidenceCard } from '../stages/cards.ts';
import { researchInterventionReport, researchCommandResponse } from '../commands.ts';
import { validateResearchShape } from '../schema.ts';

export interface CheckedLessonOrigin {
  proposal: ResearchLessonV2;
  corroborating: ResearchLessonV2[];
  topicIds: string[];
  topicContentHashes: string[];
}
interface RecordEnvelope { kind?: string; value?: unknown[]; intervention?: unknown; responseKey?: unknown; response?: unknown }

type OriginKind = ResearchLessonV2['origin']['kind'];
type OriginArtifact = ResearchLessonV2['origin']['envelope']['artifacts'][number];
export const LESSON_ORIGIN_KINDS: readonly OriginKind[] = ['attempt', 'decision', 'review', 'intervention', 'verification', 'retrieved-web'];
export interface LessonOriginSource {
  artifact: OriginArtifact;
  evidence: Array<{ selector: string; quote: string }>;
}

/** The inventory and guarded staging share the exact native-record classifier. */
async function sourceSelectors(access: LessonStoreAccess, tx: ResearchTransaction, projectId: string, kind: OriginKind,
  descriptors?: readonly OriginArtifact[]) {
  const receipts = await access.receipts(tx, projectId), artifacts = await access.origins(tx, projectId);
  const eligible = new Map<string, { artifact: OriginArtifact; document: RecordEnvelope; prefixes: string[] }>();
  let nonRecordArtifacts = 0;
  function fail(path: string, detail: string): never { return access.refuse('TRSH2002', path, detail); }
  const selected = descriptors ?? artifacts.filter(row => row.admission.artifact.verification === 'verified').map(row => ({
    id: row.admission.artifact.id, kind, locator: row.admission.id, digest: row.admission.artifact.id.slice(4),
  }));
  for (const descriptor of selected) {
    const retained = artifacts.find(row => row.admission.id === descriptor.locator && row.admission.artifact.id === descriptor.id);
    if (!retained) fail('/origin/artifactIds', 'The origin has no exact committed artifact admission.');
    const admission = retained.admission;
    const owners = receipts.filter(receipt => receipt.artifactAdmissionIds.includes(admission.id));
    const prefixes: string[] = [];
    let document: RecordEnvelope;
    try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(retained.bytes)); }
    catch {
      if (descriptors) fail('/origin/envelope', 'Reusable lesson evidence must resolve a native JSON record envelope.');
      nonRecordArtifacts++; continue;
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      if (descriptors) fail('/origin/envelope', 'A native record envelope is required.');
      nonRecordArtifacts++; continue;
    }
    async function record<K extends ResearchRecordKind>(kind: K, value: unknown): Promise<ResearchRecordMap[K] | null> {
      const shape = validateResearchRecord(kind, value);
      if (!shape.valid || Array.isArray(shape.value) || !('id' in shape.value)) return null;
      const id = shape.value.id;
      if (!owners.some(receipt => receipt.recordIds.includes(id))) return null;
      const row = await access.record(tx, projectId, kind, id);
      return row && equalsJson(row, shape.value) ? row : null;
    }
    if (Array.isArray(document.value)) for (const [index, value] of document.value.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as { kind?: string; value?: unknown }, prefix = '/value/' + index + '/value';
      if (kind === 'decision' && document.kind === 'analysis-records' && item.kind === 'ResearchDecision') {
        const row = await record('ResearchDecision', item.value);
        if (row && ['Refine', 'Pivot'].includes(row.kind)) prefixes.push(prefix + '/reason', prefix + '/details');
      }
      if (kind === 'review' && document.kind === 'writing-records' && item.kind === 'Review') {
        const row = await record('Review', item.value);
        if (row?.findings.length) prefixes.push(prefix + '/findings', ...(row.retainedFindings?.length ? [prefix + '/retainedFindings'] : []));
      }
      if (kind === 'verification' && document.kind === 'writing-records' && item.kind === 'ResearchDraftVerification') {
        const row = await record('ResearchDraftVerification', item.value);
        if (row?.state === 'refused' && row.issues.length) prefixes.push(prefix + '/issues');
      }
      if (kind === 'attempt' && document.kind === 'execution-records' && item.kind === 'ExperimentRun') {
        const row = await record('ExperimentRun', item.value);
        if (row?.status === 'failed' && row.error && owners.some(receipt => receipt.attempt.stage === 'EXECUTE'
          && receipt.attempt.stopReason === 'failed' && receipt.attempt.error))
          prefixes.push(prefix + '/error', prefix + '/trace');
      }
      if (kind === 'retrieved-web' && document.kind === 'discovery-records' && item.kind === 'EvidenceCard') {
        const card = await record('EvidenceCard', item.value);
        if (card && await boundCard(card, admission)) prefixes.push(prefix + '/excerpt');
      }
    }
    async function boundCard(card: EvidenceCard, admission: ArtifactAdmission): Promise<boolean> {
      const { id, ...body } = card;
      if (id !== 'card-' + await researchRevisionOf(body) || card.artifactId !== 'art-' + card.contentHash) return false;
      const source = artifacts.find(row => row.admission.artifact.id === card.artifactId && row.admission.artifact.verification === 'verified');
      if (!source) return false;
      const matchingReceipt = owners.find(receipt => receipt.artifactAdmissionIds.includes(admission.id)
        && receipt.artifactAdmissionIds.includes(source.admission.id));
      if (!matchingReceipt) return false;
      let sourceBound = false;
      for (const retained of artifacts.filter(row => matchingReceipt.artifactAdmissionIds.includes(row.admission.id)
        && row.admission.artifact.verification === 'verified' && row.admission.artifact.mediaType === 'application/json')) {
        let projection: { kind?: string; value?: unknown[] };
        try { projection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(retained.bytes)); }
        catch { fail('/origin/versionId', 'The committed JSON source projection cannot be decoded.'); }
        if (projection?.kind !== 'source-versions' || !Array.isArray(projection.value)) continue;
        const version = projection.value.find(value => value && typeof value === 'object' && (value as { id?: string }).id === card.versionId) as
          { id: string; sourceId: string; contentHash: string; elements: DocumentElement[] } | undefined;
        if (!version || typeof version.sourceId !== 'string' || !Array.isArray(version.elements)) continue;
        const resolved = await resolveEvidenceCard(card, { getVersion: async () => version, listElements: async () => version.elements }, async id => {
          if (id !== source.admission.artifact.id) throw new TypeError('The retained source address changed.');
          return source.bytes;
        });
        if (resolved.valid) sourceBound = true;
      }
      if (!sourceBound) return false;
      for (const raw of document.value ?? []) {
        const item = raw as { kind?: string; value?: unknown } | null;
        if (item?.kind !== 'SourceAcquisition') continue;
        const acquisition = await record('SourceAcquisition', item.value);
        if (!acquisition || !matchingReceipt.recordIds.includes(acquisition.id)) continue;
        const { id: acquisitionId, ...acquisitionBody } = acquisition;
        if (acquisitionId !== 'acquisition-' + await researchRevisionOf(acquisitionBody)) continue;
        if (acquisition.status === 'resolved' && acquisition.literatureId === card.literatureId
          && acquisition.versionId === card.versionId && acquisition.contentHash === card.contentHash && acquisition.artifactId === card.artifactId) return true;
      }
      return false;
    }
    if (kind === 'intervention' && document.intervention) {
      const row = await record('Intervention', document.intervention);
      const response = validateResearchShape<ResearchGateResponse>('ResearchGateResponse', document.response);
      if (row?.substantive && response.valid && document.responseKey === row.id && owners.some(receipt => receipt.attempt.interventions.includes(row.id))) {
        try { researchInterventionReport([row]); }
        catch { fail('/origin/intervention', 'The retained intervention has inconsistent action or actor attribution.'); }
        const value = response.value, action = value.decision === 'guide' ? 'guidance' : value.decision;
        if (action === row.action && value.actor === row.actor && value.approvedManifestHash === row.reviewedManifestHash
          && (!value.command || value.command.id === row.id && equalsJson(value, researchCommandResponse(value.command)))) {
          if (action === 'guidance' && row.effect?.guidanceHash === await researchRevisionOf({ text: value.note })) prefixes.push('/response/note');
          if (action === 'reject' && row.effect?.kind === 'retry') prefixes.push('/response/note');
          if (action === 'edit' && row.effect?.editedArtifactId && artifacts.some(item => item.admission.artifact.id === row.effect!.editedArtifactId
            && item.admission.artifact.verification === 'verified')) prefixes.push('/response/command/patch', '/response/patch');
        }
      }
    }
    if (kind === 'attempt' && document.kind === 'native-writing-failure'
      && admission.artifact.mediaType === 'application/vnd.tangleai.research-native-writing-failure+json'
      && owners.some(receipt => receipt.attempt.stopReason === 'failed' && receipt.attempt.error !== null))
      prefixes.push('/issue', '/failure', '/attempts');
    eligible.set(descriptor.id, { artifact: descriptor, document, prefixes });
  }
  return { eligible, nonRecordArtifacts };
}

/** Only selected correction fields leave the store; unrelated artifact bytes stay private. */
export async function readLessonOriginSources(access: LessonStoreAccess, tx: ResearchTransaction, projectId: string, kind: OriginKind) {
  const found = await sourceSelectors(access, tx, projectId, kind), sources: LessonOriginSource[] = [];
  for (const row of found.eligible.values()) {
    const evidence: LessonOriginSource['evidence'] = [];
    for (const selector of row.prefixes) {
      const value = compileJSONPointer(selector)(row.document);
      if (value !== JSONPOINTER_NOTHING) evidence.push({ selector, quote: typeof value === 'string' ? value : canonicalizeJson(value) });
    }
    if (evidence.length) sources.push({ artifact: row.artifact, evidence });
  }
  return { sources, nonRecordArtifacts: found.nonRecordArtifacts };
}

export async function checkLessonOriginClass(access: LessonStoreAccess, tx: ResearchTransaction, lesson: ResearchLessonV2): Promise<void> {
  await access.origin(tx, lesson);
  const { eligible } = await sourceSelectors(access, tx, lesson.projectId, lesson.origin.kind, lesson.origin.envelope.artifacts);
  for (const evidence of lesson.origin.envelope.evidence) {
    const paths = eligible.get(evidence.artifact)?.prefixes ?? [];
    if (!evidence.selector || !paths.some(prefix => evidence.selector === prefix || evidence.selector!.startsWith(prefix + '/')))
      access.refuse('TRSH2002', '/origin/envelope/evidence/' + evidence.id, 'The exact evidence selector does not name a committed eligible record of the declared source class.');
  }
}

/** Web corroboration uses the same checked inventory and adds all training inputs. */
export async function checkedLessonOrigin(access: LessonStoreAccess, tx: ResearchTransaction, lesson: ResearchLessonV2): Promise<CheckedLessonOrigin> {
  await checkLessonOriginClass(access, tx, lesson);
  const corroborating: ResearchLessonV2[] = [];
  if (lesson.origin.kind === 'retrieved-web') {
    if (!lesson.corroboration?.originIds.length) access.refuse('TRSH2006', '/corroboration', 'A web lesson requires an independent non-web correction.');
    for (const id of lesson.corroboration.originIds) {
      const other = await access.proposal(tx, id);
      if (!other || other.origin.kind === 'retrieved-web' || other.origin.runId === lesson.origin.runId
        || !equalsJson(other.scope, lesson.scope) || other.proposal.baseHash !== lesson.proposal.baseHash
        || !equalsJson(other.proposal.edit.operations, lesson.proposal.edit.operations))
        access.refuse('TRSH2006', '/corroboration/originIds', 'Corroboration must independently support this exact reusable edit and scope.');
      await checkLessonOriginClass(access, tx, other); corroborating.push(other);
    }
  }
  return { proposal: lesson, corroborating,
    topicIds: [...new Set([lesson, ...corroborating].flatMap(row => row.origin.topicIds))].sort(),
    topicContentHashes: [...new Set([lesson, ...corroborating].flatMap(row => row.origin.topicContentHashes))].sort() };
}
