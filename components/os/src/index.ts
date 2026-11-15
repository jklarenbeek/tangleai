/**
 * @tangleai/os — the browser operating system for Tangle suites.
 *
 * The root entry is headless: manifests, the kernel, window state, themes and
 * the message catalogue. The DOM shell is `@tangleai/os/shell`; an application
 * page joins a desktop with `@tangleai/os/module`; a host bundles
 * `@tangleai/os/module-host` once as a classic script for document modules.
 */
export { MODULE_MANIFEST_SCHEMA, validateManifest, localized } from './manifest.ts';
export type { ModuleManifest, ModuleHost, ContractDocument, LocalizedText, ManifestIssue, ManifestVerdict } from './manifest.ts';
export { createKernel } from './kernel.ts';
export type { Kernel, Layer, JournalEntry, LedgerEntry, MailEnvelope, Outcome, KernelEvent, ContractClient, ServedContract } from './kernel.ts';
export { OS_CONTRACT, MODULE_CONTRACT, systemContracts, CONNECT, HELLO, KEY, FOCUS, PROTOCOL } from './contracts.ts';
export type { ConnectMessage } from './contracts.ts';
export {
  emptyDesktop, openWindow, focusWindow, closeWindow, moveWindow, resizeWindow, toggleMaximize, minimizeWindow, setTitle, setViewport, stacked, fit,
} from './windows.ts';
export type { Desktop, WindowState, WindowRequest, Rect } from './windows.ts';
export { DEFAULT_THEMES, AURORA, checkTheme } from './theme.ts';
export { weaveSvg, weaveBackground, PATTERNS, patternBackground } from './wallpaper.ts';
export { THEME_KITS, composeTheme } from './themes.ts';
export type { ThemeKit, ThemeCustom, Corners, Spacing } from './themes.ts';
export type { WeaveOptions, PatternOptions } from './wallpaper.ts';
export type { ThemeDocument } from './theme.ts';
export { osMessagesEn, createOsMessages, format } from './messages.ts';
export type { OsMessageKey, OsCatalogue } from './messages.ts';
