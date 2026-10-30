import { rm, rmdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export async function cleanupNativeFiles(ctx, { removeMarketplace }) {
  const installation=ctx.nativeInstallation;
  const cache=join(ctx.agentHome,'plugins/cache',installation.marketplace,'bro-vibe-coding',installation.version);
  const paths=[cache];
  if(removeMarketplace) paths.push(installation.marketplaceRoot);
  for(const path of paths) {
    const within=relative(ctx.agentHome,path);
    if(!within || within === '..' || within.startsWith('..'+sep) || within.startsWith(sep)) throw Error(`Native artifact is outside this profile: ${path}`);
    await ctx.noSymlinks(path); await rm(path,{recursive:true,force:true});
  }
  for(const path of [join(cache,'..'),join(cache,'../..')]) {
    await ctx.noSymlinks(path);
    try { await rmdir(path); } catch(e) { if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code)) throw e; }
  }
  return paths;
}
