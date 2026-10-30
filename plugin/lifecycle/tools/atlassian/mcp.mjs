import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyToolFiles } from './integrity.mjs';
import { nativeHealth } from './native.mjs';

export async function endpoint(ctx) {
  return JSON.parse(await readFile(join(ctx.root, 'plugin/payload/atlassian/endpoint.json'), 'utf8'));
}
export function compatible(candidate, expected) {
  if (typeof candidate.definition?.url !== 'string') return false;
  try {
    const url = new URL(candidate.definition.url), declared = new URL(expected.url);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.href === declared.href) return true;
    return url.protocol === 'https:' && url.hostname === 'mcp.atlassian.com' && !url.port
      && ['/v1/mcp', '/v1/mcp/authv2'].includes(url.pathname);
  } catch { return false; }
}
export async function select(ctx, expected) {
  const inventory=await ctx.mcpInventory();
  const canonical = inventory.find(c => c.name === 'bro-atlassian' && c.scope === (ctx.project ?? 'system'));
  // The canonical name is reserved for this Tool in the configured scope.
  if (canonical && !canonical.owned) return { chosen: undefined, duplicates: [], preserved: inventory.filter(c => c.name !== 'bro-atlassian').map(c => c.name) };
  const candidates = inventory.filter(candidate => compatible(candidate, expected));
  if(!candidates.length&&inventory.some(candidate=>/atlassian/i.test(candidate.name)||String(candidate.definition.url??'').includes('atlassian.com'))&&ctx.settings.createNewMcp!==true)throw Error('Existing Atlassian MCP compatibility is unknown; select a compatible server, skip this Tool, or explicitly set createNewMcp to create a separate registration');
  const saved = ctx.mcpBinding();
  let chosen = canonical;
  if (ctx.settings.mcpServer) {
    chosen = candidates.find(candidate => candidate.name === ctx.settings.mcpServer);
    if (!chosen) throw Error('Requested Atlassian MCP is not a compatible visible server');
  } else if (saved) {
    chosen = candidates.find(candidate => candidate.name === saved.name && candidate.fingerprint === saved.fingerprint);
    if (!chosen && (saved.mode === 'borrowed' || candidates.some(candidate => candidate.name === saved.name))) throw Error('Selected Atlassian MCP changed or disappeared; choose its configuration explicitly');
  }
  if (!chosen) {
    const external = candidates.filter(candidate => !candidate.owned);
    const choices = external.length ? external : candidates;
    if (choices.length === 1) chosen = choices[0];
    else if (choices.length > 1) {
      const name = await ctx.ask('Select existing Atlassian MCP: ' + choices.map(candidate => candidate.name).join(', '));
      chosen = choices.find(candidate => candidate.name === name);
      if (!chosen) throw Error('Ambiguous Atlassian MCP selection');
    }
  }
  if (chosen && !chosen.enabled) throw Error('Selected Atlassian MCP is disabled; enable it in the host before configuring');
  const scope = ctx.project ?? 'system';
  const duplicates = candidates.filter(candidate => candidate.owned && candidate.scope === scope && candidate.name !== chosen?.name);
  for (const duplicate of duplicates) if (ctx.mcpReferenced(duplicate)) throw Error(`Atlassian duplicate ${duplicate.name} is still referenced by another project; preserve it until that project is reconfigured`);
  return { chosen, duplicates, preserved: candidates.filter(candidate => (!candidate.owned || candidate.scope !== scope) && candidate.name !== chosen?.name).map(candidate => candidate.name) };
}
export async function checkCandidate(ctx, candidate) {
  if (!candidate.enabled) throw Error('Atlassian MCP is disabled');
  if (!await ctx.mcpToolAllowed(candidate, 'getAccessibleAtlassianResources')) throw Error('Atlassian resource discovery is denied by the host policy');
  await nativeHealth(ctx, candidate.name);
}
export async function verify(ctx) {
  await ctx.checkState();
  await verifyToolFiles(ctx);
  const binding = ctx.mcpBinding();
  if (!binding) {
    if ((await ctx.inspectState()).configured) throw Error('Atlassian configuration has no saved MCP binding; configure it first');
    return { status: 'skipped', verification: 'not-configured' };
  }
  const expected = await endpoint(ctx), candidates = (await ctx.mcpInventory()).filter(candidate => compatible(candidate, expected));
  const candidate = candidates.find(item => item.name === binding.name && item.fingerprint === binding.fingerprint);
  if (!candidate) throw Error('Atlassian MCP binding is missing or changed');
  const scope = ctx.project ?? 'system';
  const duplicates = candidates.filter(item => item.owned && item.scope === scope && item.name !== binding.name);
  if (duplicates.length) throw Error('Owned Atlassian MCP duplicates remain: ' + duplicates.map(item => item.name).join(', '));
  await checkCandidate(ctx, candidate);
  return { status: 'completed', verification: 'passed', details: { selected: candidate.name, preserved: candidates.filter(item => (!item.owned || item.scope !== scope) && item.name !== binding.name).map(item => item.name) } };
}
