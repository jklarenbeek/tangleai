import type * as R from './contracts.gen.ts';
import { researchRevisionOf, inputManifestHashOf } from './identity.ts';
import { validateResearchShape } from './schema.ts';
import { researchRefuse, type ResearchOutcome } from './errors.ts';

/** Persistence names refer to generated records; no adapter owns another shape. */
export interface ResearchRecordMap {
  ResearchProject: R.ResearchProject;
  ResearchContract: R.ResearchContract;
  Amendment: R.Amendment;
  StageAttempt: R.StageAttempt;
  InputManifest: R.InputManifest;
  ResearchArtifact: R.ResearchArtifact;
  ArtifactAdmission: R.ArtifactAdmission;
  QueryPlan: R.QueryPlan;
  InclusionCriteria: R.InclusionCriteria;
  DiscoveryCandidate: R.DiscoveryCandidate;
  DiscoveryReceipt: R.DiscoveryReceipt;
  SourceAcquisition: R.SourceAcquisition;
  LiteratureRecord: R.LiteratureRecord;
  ScreeningDecision: R.ScreeningDecision;
  EvidenceCard: R.EvidenceCard;
  Synthesis: R.Synthesis;
  ResearchHypothesis: R.ResearchHypothesis;
  HypothesisSet: R.HypothesisSet;
  NoveltyReport: R.NoveltyReport;
  ExperimentPlan: R.ExperimentPlan;
  ExperimentBranch: R.ExperimentBranch;
  WorkspaceManifest: R.WorkspaceManifest;
  ExecutionManifest: R.ExecutionManifest;
  ExperimentRun: R.ExperimentRun;
  MetricObservation: R.MetricObservation;
  ResearchDecision: R.ResearchDecision;
  ResearchClaim: R.ResearchClaim;
  Review: R.Review;
  Intervention: R.Intervention;
  ResearchLesson: R.ResearchLesson;
  ResearchManifest: R.ResearchManifest;
  DisclosureChecklist: R.DisclosureChecklist;
}
export type ResearchRecordKind = keyof ResearchRecordMap;
export type ResearchRecordWrite = { [K in ResearchRecordKind]: { kind: K; value: ResearchRecordMap[K] } }[ResearchRecordKind];
export type ResearchRecordEntry = ResearchRecordWrite & { id: string; projectId: string };
const kinds: Record<ResearchRecordKind, true> = {
  ResearchProject: true, ResearchContract: true, Amendment: true, StageAttempt: true, InputManifest: true,
  ResearchArtifact: true, ArtifactAdmission: true, LiteratureRecord: true, ScreeningDecision: true,
  QueryPlan: true, InclusionCriteria: true, DiscoveryCandidate: true, DiscoveryReceipt: true, SourceAcquisition: true,
  EvidenceCard: true, Synthesis: true, ResearchHypothesis: true, HypothesisSet: true, NoveltyReport: true, ExperimentPlan: true, ExperimentBranch: true,
  WorkspaceManifest: true, ExecutionManifest: true, ExperimentRun: true, MetricObservation: true,
  ResearchDecision: true, ResearchClaim: true, Review: true, Intervention: true, ResearchLesson: true,
  ResearchManifest: true, DisclosureChecklist: true,
};

export function validateResearchRecord<K extends ResearchRecordKind>(kind: K, input: unknown): ResearchOutcome<ResearchRecordMap[K]> {
  if (!Object.hasOwn(kinds, kind)) return researchRefuse('TRSH1001', '/kind', 'Unknown research record kind.');
  return validateResearchShape<ResearchRecordMap[K]>(kind, input);
}
export async function researchRecordIdOf<K extends ResearchRecordKind>(kind: K, record: ResearchRecordMap[K]): Promise<string> {
  if (kind === 'InputManifest') return 'manifest-' + await inputManifestHashOf(record as R.InputManifest);
  if (kind === 'ResearchManifest') return 'manifest-' + (record as R.ResearchManifest).manifestHash;
  if (kind === 'DisclosureChecklist') return 'disclosure-' + await researchRevisionOf(record);
  return (record as { id: string }).id;
}
