import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function noSymlinks(path) {
  for (let at = resolve(path); ; at = dirname(at)) {
    if ((await lstat(at)).isSymbolicLink()) throw Error('Symbolic link in managed curl path');
    if (dirname(at) === at) return;
  }
}
export async function fileIdentity(path) {
  await noSymlinks(path);
  const facts = await lstat(path, { bigint: true });
  if (!facts.isFile() || await realpath(path) !== path) throw Error('Executable must be a canonical regular file');
  return { path, content_digest: `sha256:${hash(await readFile(path))}`,
    filesystem: { device: String(facts.dev), inode: String(facts.ino) },
    mode: (Number(facts.mode) & 0o777).toString(8).padStart(4, '0'), owner_uid: String(facts.uid) };
}
export async function directoryIdentity(path) {
  await noSymlinks(path);
  const facts = await lstat(path, { bigint: true });
  if (!facts.isDirectory() || await realpath(path) !== path) throw Error('Project must be a canonical directory');
  return { path, device: String(facts.dev), inode: String(facts.ino) };
}
