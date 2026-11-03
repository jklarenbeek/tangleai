import { PROVIDERS } from '@tangleai/models/providers';
export const PROVIDER_OPTIONS = Object.entries(PROVIDERS)
  .map(([value, preset]) => ({ value, label: preset.label, local: preset.local }));
export { isConfigured } from './state.ts';
