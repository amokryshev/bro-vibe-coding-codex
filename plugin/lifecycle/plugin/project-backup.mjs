import { readdir, readFile, mkdir, rename, rmdir, writeFile, lstat, readlink } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export async function inventory(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(join(directory,prefix), {withFileTypes:true})) {
    const name = join(prefix,entry.name);
    if (entry.isDirectory()) Object.assign(files,await inventory(directory,name));
    else if (entry.isFile()) files[name] = createHash('sha256').update(await readFile(join(directory,name))).digest('hex');
    else if (entry.isSymbolicLink()) files[name] = 'link:' + await readlink(join(directory,name));
    else throw Error(`Unsupported managed resource: ${join(directory,name)}`);
  }
  return files;
}

export async function pruneEmpty(directory) {
  try { await rmdir(directory); } catch(e) { if (!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code)) throw e; }
}

// Only receipt-owned paths inside this project enter its user-owned archive.
export async function backupProject(ctx, project) {
  const {receipt,exists,noSymlinks,save} = ctx;
  const inside = path => { const rel = relative(project,path); return rel && rel !== '..' && !rel.startsWith('..'+sep) && !rel.startsWith(sep); };
  const resources = receipt.resources.filter(r => r.scope === project && !['parent','staging'].includes(r.kind) && inside(r.path));
  const plans = [], configurationHashes = {};
  for (const resource of resources) {
    await noSymlinks(resource.path);
    if (resource.kind === 'directory') {
      if (!resource.files) throw Error(`Cannot safely identify files in an older owned directory: ${resource.path}`);
      for (const name of Object.keys(resource.files)) {
        const path = join(resource.path,name);
        if (!inside(path)) throw Error('Invalid project ownership path');
        if (await exists(path)) plans.push({path,resource});
      }
    } else if (await exists(resource.path)) plans.push({path:resource.path,resource});
  }
  for (const record of receipt.configurations ?? []) {
    if (record.scope === project && inside(record.path)) {
      configurationHashes[record.path] = null;
      if(await exists(record.path)) plans.push({path:record.path,shared:true});
    }
  }
  // Preflight all sources and the archive root before the first move.
  const archiveRoot = join(project,'obsolette-backup');
  await noSymlinks(archiveRoot);
  for (const plan of plans) {
    await noSymlinks(plan.path);
    const stat = await lstat(plan.path);
    if (!stat.isFile() || stat.nlink !== 1) throw Error(`Unsafe project resource: ${plan.path}`);
  }
  if (!plans.length) return {path:null,configurationHashes};
  const archive = join(archiveRoot,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
  await mkdir(archive,{recursive:true,mode:0o700});
  if (ctx.onBackup) await ctx.onBackup(archive);
  // Shared settings are copied before any owned resource moves.
  for (const plan of plans.filter(p => p.shared)) {
    const target = join(archive,relative(project,plan.path));
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    const bytes = await readFile(plan.path);
    configurationHashes[plan.path] = createHash('sha256').update(bytes).digest('hex');
    await writeFile(target,bytes,{flag:'wx',mode:0o600});
  }
  for (const plan of plans.filter(p => !p.shared)) {
    const target = join(archive,relative(project,plan.path));
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    await rename(plan.path,target);
    if (plan.resource.kind !== 'directory') receipt.resources = receipt.resources.filter(r => r !== plan.resource);
    else plan.resource.resetPending = true;
    await save();
  }
  for (const resource of resources.filter(r => r.kind === 'directory')) {
    resource.resetPending = true;
    const dirs = new Set(Object.keys(resource.files).flatMap(name => {
      const parents = []; for (let path=dirname(join(resource.path,name)); inside(path) && path !== resource.path; path=dirname(path)) parents.push(path); return parents;
    }));
    for (const path of [...dirs].sort((a,b)=>b.length-a.length)) await pruneEmpty(path);
    await pruneEmpty(resource.path);
  }
  await save();
  console.log(`Предыдущие ресурсы BRO сохранены: ${archive}`);
  return {path:archive,configurationHashes};
}
