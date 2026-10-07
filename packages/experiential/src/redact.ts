/** Inspection views omit secrets and payload locations while retaining record addresses. */
import { deepFreeze } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { EXPERIENTIAL_SECRET_MEMBER } from './privacy.ts';

const hidden = new Set(['storageUri', 'logRefs', 'metricsRef', 'logBody', 'logBodies', 'logs', 'body', 'rawBody']);
const omit = (key: string, event: boolean) => EXPERIENTIAL_SECRET_MEMBER.test(key) || hidden.has(key) || event && key === 'detail';

export function redactExperientialView(value: unknown): unknown {
  const captured: unknown = JSON.parse(canonicalizeJson(value));
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const event = 'document' in value && value.document === 'experiential-event';
    const runtime = 'provider' in value && typeof value.provider === 'string'
      && 'servedModel' in value && typeof value.servedModel === 'string';
    return Object.fromEntries(Object.entries(value).filter(([key]) => !omit(key, event)).map(([key, value]) => {
      if (runtime && key === 'base' && typeof value === 'string') {
        const uri = new URL(value); uri.username = ''; uri.password = ''; uri.search = ''; uri.hash = '';
        return [key, uri.href];
      }
      return [key, walk(value)];
    }));
  }
  return deepFreeze(walk(captured));
}

/** Derive closed view shapes from the record owner, including transitive references. */
export function experientialViewSchema(value: unknown, event = false): unknown {
  if (Array.isArray(value)) return value.map(item => experientialViewSchema(item, event));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, member]) => {
    if (key === '$ref' && typeof member === 'string' && member.startsWith('#/$defs/')) return [key, member + 'View'];
    if (key === 'properties' && member && typeof member === 'object') return [key,
      Object.fromEntries(Object.entries(member).filter(([name]) => !omit(name, event)).map(([name, child]) => [name, experientialViewSchema(child)]))];
    if (key === 'required' && Array.isArray(member)) return [key, member.filter(name => typeof name === 'string' && !omit(name, event))];
    return [key, experientialViewSchema(member, event)];
  }));
}
