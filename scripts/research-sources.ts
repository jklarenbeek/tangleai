/** One development-only inventory for artifact generation and source receipts. */
import { glob } from 'node:fs/promises';
export async function researchPromptFiles(root = process.cwd()): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of glob('prompts/research/*.toml', { cwd: root })) paths.push(path.replaceAll('\\', '/'));
  return paths.sort();
}
