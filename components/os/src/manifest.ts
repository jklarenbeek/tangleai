/**
 * The module manifest: one JSON document saying what a module is called, how
 * it is hosted (shipped component, sandboxed document, or an application on
 * its own origin), which contracts it serves and needs, its stylesheet and
 * its window. Validation is closed: an undeclared member is refused, so a key
 * or a script has nowhere to hide in a manifest.
 */
import { JarenValidator } from '@jarenjs/validate';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';
import moduleSchema from '../schemas/module.schema.json' with { type: 'json' };

export { moduleSchema as MODULE_MANIFEST_SCHEMA };

export type LocalizedText = { en: string } & Partial<Record<'ar' | 'de' | 'es' | 'fr' | 'ja' | 'ko' | 'nl' | 'pt' | 'ru' | 'tr' | 'zh-TW', string>>;
export type ModuleHost =
  | { kind: 'shipped', mount: string }
  | { kind: 'document', app: Record<string, unknown> }
  | { kind: 'origin', url: string };
export type ContractDocument = { $contract: string, id: string, operations: Record<string, unknown>, [member: string]: unknown };
export type ModuleManifest = {
  $module: '0.1';
  id: string;
  version: string;
  title: LocalizedText;
  description?: LocalizedText;
  icon?: { glyph: string, hue?: number };
  category?: 'system' | 'productivity' | 'development' | 'data' | 'communication' | 'suite' | 'play' | 'custom';
  host: ModuleHost;
  provides?: ContractDocument[];
  requires?: { contract: string, operations?: string[] }[];
  styles?: string;
  window?: { width?: number, height?: number, minWidth?: number, minHeight?: number, singleton?: boolean, resizable?: boolean };
  settings?: ModuleSettings;
  /** The kinds of proposal it files in the desktop's inbox. */
  proposals?: { kind: string, title?: LocalizedText }[];
  /**
   * Launch entries: each is its own dock icon that opens this module at one of
   * its screens (an application whose screens live inside one page). Without
   * entries the module is one icon.
   */
  entries?: { id: string, title: LocalizedText, icon?: { glyph: string, hue?: number }, screen?: string, folder?: string }[];
  /**
   * Where its icons go in a dock the person has not arranged yet: `folder`
   * for the module's own icon, and the titles of the folders it (or its
   * entries) name. A suite's manifests share folder ids.
   */
  dock?: { folder?: string, folders?: { id: string, title: LocalizedText }[] };
  /**
   * Its files, for the desktop's Files: the contract it serves as a file
   * location (built with `fileLocationContract`, declared in `provides`), the
   * location's title, and `assistant: false` to keep the assistant out of it.
   */
  files?: { contract: string, title?: LocalizedText, assistant?: boolean };
  /** The kinds of file it opens (`text/calendar`, `image/*`): Files offers it for them, and hands it the file. */
  opens?: { type: string, title?: LocalizedText }[];
};
/** Where a module's settings live in the desktop's Settings (see the schema's `settings`). */
export type ModuleSettings = { title?: LocalizedText, keywords?: string[] } & (
  | { kind: 'mount', mount: string }
  | { kind: 'page', url: string }
  | { kind: 'form', schema: Record<string, unknown> });

export type ManifestIssue = { code: string, path: string, message: string };
export type ManifestVerdict = { ok: true, manifest: ModuleManifest } | { ok: false, issues: ManifestIssue[] };

const HOST_KINDS = ['shipped', 'document', 'origin'];
let validateShape: ((value: unknown) => { valid: boolean, errors?: { instancePath?: string, message?: string, keyword?: string, params?: any }[] }) | null = null;

function shape() {
  if (validateShape === null) {
    const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
    validateShape = validator.compile(moduleSchema as Record<string, unknown>) as any;
  }
  return validateShape!;
}

/**
 * Validate a module manifest. Returns a frozen copy on success, so a caller
 * holding the input cannot change an installed module behind the kernel's
 * back; refusals carry a JSON pointer and a code (`OS0001` shape, `OS0002`
 * host kind, `OS0003` duplicate contract, `OS0004` settings that do not fit
 * the module, `OS0005` a launch entry or a folder named twice, `OS0006` a file
 * location whose contract the module does not provide).
 */
export function validateManifest(value: unknown): ManifestVerdict {
  const issues: ManifestIssue[] = [];
  const host = (value as any)?.host;
  if (host !== null && typeof host === 'object' && !HOST_KINDS.includes(host.kind)) {
    issues.push({ code: 'OS0002', path: '/host/kind', message: `the host kind must be one of ${HOST_KINDS.join(', ')}` });
    return { ok: false, issues };
  }
  const outcome = shape()(value);
  if (!outcome.valid) {
    const seen = new Set<string>();
    for (const error of outcome.errors ?? []) {
      const path = error.instancePath ?? '';
      const message = error.keyword === 'additionalProperties'
        ? `undeclared member '${error.params?.additionalProperty ?? ''}'`
        : error.message ?? 'does not match the module manifest schema';
      const key = `${path} ${message}`;
      if (!seen.has(key)) { seen.add(key); issues.push({ code: 'OS0001', path, message }); }
    }
    return { ok: false, issues: issues.slice(0, 16) };
  }
  const settings = (value as ModuleManifest).settings, kind = (value as ModuleManifest).host.kind;
  if (settings) {
    const fits = { mount: 'shipped', page: 'origin', form: 'document' } as const;
    if (fits[settings.kind] !== kind) issues.push({ code: 'OS0004', path: '/settings/kind', message: `'${settings.kind}' settings belong to a ${fits[settings.kind]} module, not a ${kind} one` });
    else if (settings.kind === 'page') {
      // a settings page comes from the application's own origin, never another site in the desktop's chrome
      let same = false;
      try { same = new URL(settings.url).origin === new URL((value as any).host.url).origin; } catch { same = false; }
      if (!same) issues.push({ code: 'OS0004', path: '/settings/url', message: "a settings page must be on the application's own origin" });
    } else if (settings.kind === 'form' && /"writeOnly"\s*:\s*true|"format"\s*:\s*"password"/.test(JSON.stringify(settings.schema)))
      issues.push({ code: 'OS0004', path: '/settings/schema', message: 'the desktop keeps no secret: a form has no writeOnly or password member' });
  }
  const twice = (list: { id: string }[] | undefined, path: string, what: string) => {
    const seen = new Set<string>();
    for (const [index, item] of (list ?? []).entries()) {
      if (seen.has(item.id)) issues.push({ code: 'OS0005', path: `${path}/${index}/id`, message: `the ${what} '${item.id}' is named twice` });
      seen.add(item.id);
    }
  };
  twice((value as ModuleManifest).entries, '/entries', 'launch entry');
  const files = (value as ModuleManifest).files;
  if (files && !((value as ModuleManifest).provides ?? []).some(c => c.id === files.contract))
    issues.push({ code: 'OS0006', path: '/files/contract', message: `the file location '${files.contract}' must be one of the contracts the module provides` });
  twice((value as ModuleManifest).dock?.folders, '/dock/folders', 'folder');
  const ids = new Set<string>();
  for (const [index, contract] of ((value as ModuleManifest).provides ?? []).entries()) {
    if (ids.has(contract.id)) issues.push({ code: 'OS0003', path: `/provides/${index}/id`, message: `the contract '${contract.id}' is provided twice` });
    ids.add(contract.id);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: deepFreeze(cloneJson(value)) as ModuleManifest };
}

/** The text for a locale, falling back to English. */
export function localized(text: LocalizedText | undefined, locale: string): string {
  if (text === undefined) return '';
  return (text as Record<string, string>)[locale] ?? (text as Record<string, string>)[locale.split('-')[0]] ?? text.en;
}
