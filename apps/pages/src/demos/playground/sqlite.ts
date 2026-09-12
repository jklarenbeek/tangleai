import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

interface InitializerOptions {
  locateFile: (name: string) => string;
  print: (...args: unknown[]) => void;
  printErr: (...args: unknown[]) => void;
}
export const initializeSqlite = sqlite3InitModule as unknown as
  (options: InitializerOptions) => ReturnType<typeof sqlite3InitModule>;
