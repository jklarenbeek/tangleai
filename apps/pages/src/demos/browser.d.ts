/** Mount the browser-owned route, file, storage and worker services. */
export function bootDemos(window: Window & typeof globalThis): { dispose(): Promise<void> | undefined };
