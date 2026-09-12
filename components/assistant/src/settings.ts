import { PROVIDERS } from '@tangleai/models/providers';
export const PROVIDER_OPTIONS = Object.entries(PROVIDERS)
  .map(([value, preset]) => ({ value, label: preset.label, local: preset.local }));

export function isConfigured(s: any) {
  if (s.model.trim() === '') return false;
  if (s.provider === 'custom') return s.baseUrl.trim() !== '';
  if (s.provider === 'openrouter') return s.apiKey.trim() !== '';
  return true; // local runtimes (Ollama, LM Studio) need no key
}
