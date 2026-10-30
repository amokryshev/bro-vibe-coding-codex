import { cp, mkdir, mkdtemp, readFile, readlink, lstat, rename, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Packaged separately into each Tool. Only that Tool's lifecycle calls this code.
const tool = basename(import.meta.dirname);
const sourcePlugin = resolve(import.meta.dirname, '../../..');
const roots = [`payload/${tool}`, `lifecycle/tools/${tool}`];
async function safeParents(path, plugin) {
  for (let at = path; at !== dirname(plugin); at = dirname(at)) {
    try { if ((await lstat(at)).isSymbolicLink()) throw Error(`${tool}: symbolic link in release path: ${at}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function verifyToolFiles(ctx, plugin = sourcePlugin) {
  const path = `lifecycle/tools/${tool}/integrity.json`;
  await safeParents(join(plugin, path), plugin);
  const text = await readFile(join(plugin, path), 'utf8');
  const source = ctx.releaseSource;
  if (source?.marketplaceRoot) {
    const result = spawnSync('git', ['-C', source.marketplaceRoot, 'show', `${source.commit}:plugin/${path}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0 || result.stdout !== text) throw Error(`${tool}: release inventory differs from the installed commit: ${path}`);
  }
  const inventory = JSON.parse(text);
  if (inventory.tool !== tool || !inventory.files || !Object.keys(inventory.files).length) throw Error(`${tool}: invalid release inventory: ${path}`);
  for (const [name, expected] of Object.entries(inventory.files)) {
    if (!roots.some(root => name.startsWith(root + '/')) || name.includes('\\') || name.split('/').some(part => !part || part === '..' || part === '.')) throw Error(`${tool}: invalid release path: ${name}`);
    const local = join(plugin, name);
    try {
      await safeParents(dirname(local), plugin);
      const info = await lstat(local);
      const matches = 'link' in expected
        ? info.isSymbolicLink() && await readlink(local) === expected.link
        : info.isFile() && createHash('sha256').update(await readFile(local)).digest('hex') === expected.sha256;
      if (!matches) throw Error('content or file type differs');
    } catch (error) { throw Error(`${tool}: invalid or missing release file ${name}: ${error.message}`, { cause: error }); }
  }
}

export async function installToolFiles(ctx) {
  // This inventory contains the already delivered Tool scripts and common files,
  // never the platform payload that the Tool may still need to obtain below.
  await verifyToolFiles(ctx);
  const destination = join(ctx.root, 'plugin');
  if (destination !== sourcePlugin && ctx.installed === false) {
    // Retry a failed install from the repaired source. Only the Tool's private
    // distribution files are replaced; project files and configuration are separate.
    for (const path of roots) {
      const target = join(destination, path);
      await safeParents(target, destination);
      await mkdir(dirname(target), { recursive: true });
      const temporary = await mkdtemp(join(dirname(target), `.${tool}-install-`));
      try {
        await cp(join(sourcePlugin, path), join(temporary, 'next'), { recursive: true, verbatimSymlinks: true });
        try { await rename(target, join(temporary, 'previous')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await rename(join(temporary, 'next'), target);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  }
  await verifyToolFiles(ctx, destination);
}
