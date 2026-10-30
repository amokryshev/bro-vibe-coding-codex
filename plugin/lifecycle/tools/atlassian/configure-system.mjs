import { verifyToolFiles } from './integrity.mjs';
import {join} from 'node:path';
import {native} from './native.mjs';
import { endpoint, select, checkCandidate, verify } from './mcp.mjs';
import { fingerprint } from '../../plugin/mcp-configuration.mjs';
export default async function run(ctx) {
  if (ctx.mode === 'check') return verify(ctx);
  await verifyToolFiles(ctx);
 const definition = await endpoint(ctx);
 const { chosen, duplicates, preserved } = await select(ctx, definition);
 if (chosen && chosen.scope !== 'system') return { status: 'skipped', details: { selected: chosen.name, deferredToProject: chosen.scope, preserved } };
 if (chosen && !await ctx.mcpToolAllowed(chosen, 'getAccessibleAtlassianResources')) throw Error('Atlassian resource discovery is denied by the host policy');
 let connected = false;
 if (chosen) {
   try { await checkCandidate(ctx, chosen); connected = true; }
   catch (error) { if (!chosen.owned || duplicates.length) throw error; }
 }
 const binding = chosen ? { name: chosen.name, mode: chosen.owned ? 'owned' : 'borrowed', fingerprint: chosen.fingerprint }
   : { name: 'bro-atlassian', mode: 'owned', fingerprint: fingerprint(definition) };
 await ctx.setMcpBinding(binding);
 await ctx.configure(binding.mode === 'borrowed' ? {} : {mcp:{'bro-atlassian':chosen?.definition ?? definition}});
 if (duplicates.length) console.log('Atlassian owned registrations selected for cleanup: ' + duplicates.map(candidate => candidate.name).join(', '));
 if (preserved.length) console.log('Atlassian preserved external registrations: ' + preserved.join(', '));
 const result = { status: 'configured', details: { selected: binding.name, cleanup: duplicates.map(candidate => candidate.name), preserved } };
 if (binding.mode === 'borrowed' || connected) return result;
 ctx.afterConfiguration(async()=>{
  await ctx.ownFile(join(ctx.dataDirectory,'authorization.json'),JSON.stringify({server:ctx.serverName('atlassian'),agent:ctx.agent})+'\n');
  await native(ctx,'login');
 });
 return result;
}
