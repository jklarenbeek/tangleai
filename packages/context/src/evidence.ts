import { JarenValidator } from '@jarenjs/validate';
import { checkOutcome } from '@jarenjs/core/check';
import { CLAIM_EVIDENCE_SCHEMA } from './schemas/evidence.ts';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
const check = new JarenValidator({ collectErrors: true, skipErrors: false }).compile(CLAIM_EVIDENCE_SCHEMA);

/**
 * Validate structure and references, without interpreting prose or making requests.
 * Supplied artifacts are the host's allow-list; matching ids must retain their
 * admitted descriptor. Without an external list, the envelope is self-contained.
 * @param [options]
 */
export function validateClaimEvidence(envelope: any, options: {
  artifacts?: import('./schemas/evidence.ts').ArtifactRecord[];
} = {}) {
  const shape = checkOutcome(check(envelope));
  if (!shape.valid) return shape;
  const errors: any[] = [];
  const add = (code: any, docPath: any, message: any) => errors.push({ code, docPath, instancePath: docPath, message });
  const sets: Record<string, any> = {};
  for (const kind of ['artifacts', 'evidence', 'claims']) {
    const ids = new Set();
    envelope[kind].forEach((record: any, index: any) => {
      if (ids.has(record.id)) add('EVIDENCE_DUPLICATE', `/${kind}/${index}/id`, `duplicate ${kind} id '${record.id}'`);
      ids.add(record.id);
    });
    sets[kind] = ids;
  }
  if (options.artifacts) {
    const admitted = new Map(options.artifacts.map((artifact) => [artifact.id, artifact]));
    envelope.artifacts.forEach((artifact: any, i: any) => {
      const held = admitted.get(artifact.id);
      if (!held || (['kind', 'locator', 'digest'] as const).some((field) => artifact[field] !== held[field]))
        add('EVIDENCE_UNADMITTED', `/artifacts/${i}`, `artifact '${artifact.id}' is not admitted with this descriptor`);
    });
  }
  envelope.evidence.forEach((record: any, i: any) => {
    if (!sets.artifacts.has(record.artifact))
      add('EVIDENCE_ARTIFACT', `/evidence/${i}/artifact`, `unknown artifact '${record.artifact}'`);
  });
  const visible = new Set(envelope.visibleEvidence);
  envelope.visibleEvidence.forEach((id: any, i: any) => {
    if (!sets.evidence.has(id)) add('EVIDENCE_REFERENCE', `/visibleEvidence/${i}`, `unknown evidence '${id}'`);
  });
  envelope.claims.forEach((claim: any, i: any) => {
    if (claim.critical && (claim.status === 'unresolved' || claim.evidence.length === 0))
      add('EVIDENCE_CRITICAL', `/claims/${i}/status`, `critical claim '${claim.id}' is unresolved`);
    claim.evidence.forEach((id: any, j: any) => {
      if (!sets.evidence.has(id)) add('EVIDENCE_REFERENCE', `/claims/${i}/evidence/${j}`, `unknown evidence '${id}'`);
      else if (!visible.has(id)) add('EVIDENCE_HIDDEN', `/claims/${i}/evidence/${j}`, `evidence '${id}' is outside the visible view`);
    });
  });
  errors.sort((a: any, b: any) => a.docPath < b.docPath ? -1 : a.docPath > b.docPath ? 1 : a.code.localeCompare(b.code));
  return { valid: errors.length === 0, errors };
}

/**
 * A second guarded-document consumer: replace or patch a claim envelope using
 * host persistence and an explicit artifact admission list.
 */
export function createClaimRefiner(options: {
  read: () => Promise<any>;
  apply: (document: any, proposal: any) => any;
  validateProposal: (proposal: any) => any;
  commit: (document: any) => Promise<any>;
  artifacts: import('./schemas/evidence.ts').ArtifactRecord[];
  snapshot?: () => Promise<any>;
  restore?: (token: any) => Promise<any>;
}) {
  const artifacts = JSON.parse(JSON.stringify(options.artifacts));
  return createGuardedRefiner({
    ...options,
    validateCandidate: (next: any) => validateClaimEvidence(next, { artifacts }),
    planCommit: (next: any) => next,
  });
}
