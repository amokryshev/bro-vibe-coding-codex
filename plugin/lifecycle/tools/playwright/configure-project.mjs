import configureSystem from './configure-system.mjs';
import { verifyToolFiles } from './integrity.mjs';
import {select,verify,checkCandidate} from './mcp.mjs';
export default async function run(ctx) {
  if(ctx.mode==='check') return verify(ctx);
  await verifyToolFiles(ctx);
  const canonical = (await ctx.mcpInventory()).find(c => c.name === 'bro-playwright' && c.scope === ctx.project);
  if (canonical && !canonical.owned) return configureSystem(ctx);
  const existing=await select(ctx);
  if(!existing) return {status:'skipped'};
  await checkCandidate(ctx,existing);
  const owned=existing.owned&&existing.scope===ctx.project;
  await ctx.setMcpBinding({name:existing.name,mode:owned?'owned':'borrowed',fingerprint:existing.fingerprint});
  await ctx.configure(owned?{mcp:{'bro-playwright':existing.definition}}:{});
}
