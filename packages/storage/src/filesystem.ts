import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, parse, resolve, sep } from 'node:path';
/** Reject symlinks in every existing path component, not only the final entry. */
export function assertNoSymlinks(path: string): void {
  const absolute = resolve(path); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    // lstat also detects dangling symlinks, unlike existsSync.
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink paths are not permitted'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
export function privateDirectory(path: string): string {
  const absolute = resolve(path); assertNoSymlinks(absolute);
  if (!existsSync(absolute)) {
    const parent = dirname(absolute);
    if (!existsSync(parent)) privateDirectory(parent);
    mkdirSync(absolute, { mode: 0o700 });
  }
  if (!lstatSync(absolute).isDirectory()) throw new Error('Expected a directory');
  chmodSync(absolute, 0o700); return absolute;
}
