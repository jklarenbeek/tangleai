/**
 * @tangleai/os — the browser operating system for Tangle suites.
 *
 * The root entry is headless: manifests, the kernel, window state, themes and
 * the message catalogue. The DOM shell is `@tangleai/os/shell`; an application
 * page joins a desktop with `@tangleai/os/module`; a host bundles
 * `@tangleai/os/module-host` once as a classic script for document modules.
 */
export { MODULE_MANIFEST_SCHEMA, validateManifest, localized } from './manifest.ts';
export type { ModuleManifest, ModuleHost, ModuleSettings, ContractDocument, LocalizedText, ManifestIssue, ManifestVerdict } from './manifest.ts';
export { createKernel, toolName, DOCK_CONTRACT, FILES_CONTRACT, WEB_CONTRACT, JOBS_CONTRACT, webPageText, RESERVED_IDS } from './kernel.ts';
export { CAPABILITY_SCHEMA, capabilityIssues, checkCapabilities, capabilityPrompt, capabilitiesPrompt, composeCapabilities } from './capability.ts';
export type { CapabilityDocument, CapabilityPrompt, CapabilityOrigin, CapabilityIssue } from './capability.ts';
export { fileLocationContract, memoryLocation, browserLocation, serveFileLocation, fileAnswer, typeOfName, MAX_INLINE_BYTES, FILE_ENTRY_SCHEMA, fileBytesToBase64, fileBase64ToBytes } from './files.ts';
export type { FileEntry, FileContent, FileLocationHandlers } from './files.ts';
export type { Kernel, Layer, JournalEntry, LedgerEntry, MailEnvelope, Outcome, KernelEvent, ContractClient, ServedContract, GrantedOperation, ToolBuilder, SettingsStore, StateOption, StateStatus, Proposal, Decider, WebBudget } from './kernel.ts';
export { STATE_CONTRACT, memoryStore, webStorageStore, contractStore } from './state.ts';
export { APPS_KEY, scopesOf, originOf, isLocalOrigin, consentNeeded } from './consent.ts';
export type { Consent, InstalledApp } from './consent.ts';
export type { DesktopStore, StateDocument, StateScope } from './state.ts';
export { OS_CONTRACT, MODULE_CONTRACT, PROPOSAL_SCHEMA, DECISION_SCHEMA, systemContracts, CONNECT, HELLO, KEY, FOCUS, PROTOCOL } from './contracts.ts';
export type { ConnectMessage } from './contracts.ts';
export { DOCK_SCHEMA, emptyDock, dockIcons, folderTitles, normalizeDock, arrangeDock, moveInDock, hideInDock, showInDock, groupInDock, renameDockFolder, dockChanges } from './dock.ts';
export type { DockLayout, DockFolder, DockIcon, DockView } from './dock.ts';
export { HEADER_SCHEMA, HEADER_CONTRACT, HEADER_GLYPHS, headerItems, headerFor, activateHeader, duplicateHeaderId, fitHeader } from './header.ts';
export type { Header, HeaderItem, HeaderButton, HeaderToggle, HeaderMenu, HeaderMenuEntry, HeaderSearch, HeaderTabs, HeaderGlyph, HeaderActivation, HeaderHandler } from './header.ts';
export {
  emptyDesktop, openWindow, focusWindow, closeWindow, moveWindow, resizeWindow, resizeWindowFrom, toggleMaximize, minimizeWindow, setTitle, setViewport, setCompact, resizeDesktop, isVisible, stacked, fit,
} from './windows.ts';
export type { Desktop, WindowState, WindowRequest, Rect, ResizeEdge } from './windows.ts';
export { DEFAULT_THEMES, AURORA, checkTheme } from './theme.ts';
export { weaveSvg, weaveBackground, PATTERNS, patternBackground } from './wallpaper.ts';
export { THEME_KITS, composeTheme } from './themes.ts';
export type { ThemeKit, ThemeCustom, Corners, Spacing } from './themes.ts';
export type { WeaveOptions, PatternOptions } from './wallpaper.ts';
export type { ThemeDocument } from './theme.ts';
export { osMessagesEn, createOsMessages, format } from './messages.ts';
export type { OsMessageKey, OsCatalogue } from './messages.ts';
export { MENU_SCHEMA, checkMenu } from './menu.ts';
export type { MenuDocument, MenuItem, MenuPoint } from './menu.ts';
export { WEB_READER_CONTRACT, WEB_PAGE_SCHEMA, WEB_CODES, unconfiguredWebReader } from './web.ts';
export type { WebReader, WebPage, WebBlock, WebLink, WebResult } from './web.ts';
export { httpWebReader } from './web-client.ts';
export { JOB_QUEUE_CONTRACT, JOB_ITEM_SCHEMA, JOB_CODES, unconfiguredJobQueue, httpJobQueue, combinedJobQueue } from './jobs.ts';
export type { JobQueue, JobItem, JobCounts, JobSchedule, JobState, JobEvent, JobRuntimeHealth, RegisteredJob, JobScope } from './jobs.ts';
export { watchJobs, withinHours, SILENT_AFTER_MS } from './job-watch.ts';
export type { JobWatchOptions, WorkingHours, Weekday } from './job-watch.ts';
export { jobsModule, describeRule, nextRuns, scheduledRuns, STATE_ORDER } from './jobs-app.ts';
export type { JobsOptions, JobsSimulation, NextRun, ScheduledRun } from './jobs-app.ts';
