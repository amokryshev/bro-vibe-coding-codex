import configureSystem from './configure-system.mjs';
import { verifyToolFiles } from './integrity.mjs';
import { endpoint, select, checkCandidate, verify } from './mcp.mjs';
export default async function run(ctx) {
  if (ctx.mode === 'check') return verify(ctx);
  await verifyToolFiles(ctx);
  const canonical = (await ctx.mcpInventory()).find(c => c.name === 'bro-atlassian' && c.scope === ctx.project);
  if (canonical && !canonical.owned) return configureSystem(ctx);
  const { chosen, duplicates, preserved } = await select(ctx, await endpoint(ctx));
  if (!chosen) return { status: 'skipped' };
  await checkCandidate(ctx, chosen);
  const mode = chosen.owned && chosen.scope === ctx.project ? 'owned' : 'borrowed';
  await ctx.setMcpBinding({ name: chosen.name, mode, fingerprint: chosen.fingerprint });
  await ctx.configure(mode === 'owned' ? { mcp: { 'bro-atlassian': chosen.definition } } : {});
  return { status: 'configured', details: { selected: chosen.name, cleanup: duplicates.map(candidate => candidate.name), preserved } };
}
