import type { GmplCatalogDocument } from '@tangleai/gmpl';
import document from '../artifacts/catalog.json' with { type: 'json' };
import { immutableGroundingJson } from './identity.ts';
export const groundingArtifacts = immutableGroundingJson(document as GmplCatalogDocument);
