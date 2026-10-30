import { realpath, readFile, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// A native marketplace clone, not the mutable branch head, defines this installation.
export async function nativeSource({ marketplaceRoot, repository, sourcePlugin, installedPlugin }) {
  if (!repository || !marketplaceRoot || !installedPlugin) throw Error('Native BRO Git installation was not found');
  if (await realpath(sourcePlugin) !== await realpath(installedPlugin)) throw Error('Run setup-bro from the plugin installed by the agent');
  const result = spawnSync('git', ['-C', marketplaceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0 || !/^[a-f0-9]{40,64}$/.test(result.stdout.trim())) throw Error('Cannot identify the installed release Git commit');
  const commit = result.stdout.trim();
  // A marketplace may have been updated since this version was cached. Never bind
  // an old plugin to a new platform payload just because the repository is the same.
  const release = spawnSync('git', ['-C', marketplaceRoot, 'show', `${commit}:plugin/release.json`], { encoding: 'utf8' });
  if (release.status !== 0 || release.stdout !== await readFile(join(sourcePlugin, 'release.json'), 'utf8')) throw Error('Marketplace revision differs from the installed plugin; reload its matching release first');
  const tree = spawnSync('git',['-C',marketplaceRoot,'ls-tree','-rz',commit,'--','plugin'],{encoding:'utf8',maxBuffer:8*1024*1024});
  if (tree.status !== 0) throw Error('Cannot inspect installed release tree');
  for (const item of tree.stdout.split('\0').filter(Boolean)) {
    const [meta,path] = item.split('\t'), [mode,type,oid] = meta.split(' ');
    // A Tool owns validation of its files in its lifecycle, after obtaining any
    // deferred platform payload. Native inspection admits only the common core.
    if (path.startsWith('plugin/payload/') || path.startsWith('plugin/lifecycle/tools/')) continue;
    if (type !== 'blob' || !['100644','100755','120000'].includes(mode)) throw Error('Unsupported plugin tree entry');
    const local = join(sourcePlugin,path.slice('plugin/'.length));
    const info = await lstat(local);
    if (mode === '120000' ? !info.isSymbolicLink() : !info.isFile()) throw Error(`Installed plugin differs from release: ${path}`);
    const bytes = mode === '120000' ? Buffer.from(await readlink(local)) : await readFile(local);
    const object = createHash(oid.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (object !== oid) throw Error(`Installed plugin differs from release: ${path}`);
  }
  return { repository, commit, marketplacePath: marketplaceRoot, marketplaceRoot: await realpath(marketplaceRoot) };
}
