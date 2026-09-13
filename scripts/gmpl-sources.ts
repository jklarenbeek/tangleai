/** One development-only prompt inventory for artifacts and measured source receipts. */
import { glob } from 'node:fs/promises';
export function gmplPromptPaths(paths: readonly string[]): string[] {
  return paths.map(path => path.replaceAll('\\', '/')).filter(path => !path.includes('/outcome/')).sort();
}
export function gmplPromptStage(path: string): string {
  return path.replaceAll('\\', '/').split('/').slice(-2).join('-').replace('.toml', '');
}
export async function gmplPromptFiles(root = process.cwd()): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of glob('prompts/gmpl/**/*.toml', { cwd: root })) paths.push(path);
  return gmplPromptPaths(paths);
}
