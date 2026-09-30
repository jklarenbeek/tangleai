/** Installed consumers read immutable JSON; prompt source compilation is a build step. */
import document from '../artifacts/catalog.json' with { type: 'json' };
import { immutableHeraJson } from './identity.ts';
import type { GmplCatalogDocument } from '@tangleai/gmpl';
export const heraArtifacts: Readonly<GmplCatalogDocument> = immutableHeraJson(document) as unknown as GmplCatalogDocument;
