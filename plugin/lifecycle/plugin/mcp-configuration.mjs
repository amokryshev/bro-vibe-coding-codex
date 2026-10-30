// Host configuration mechanics only. Service identity/compatibility belongs to each Tool.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from './vendor/smol-toml/index.js';
import { resolveProfile } from './profile.mjs';

async function document(path, format) {
  try { const text = await readFile(path, 'utf8'); return format === 'toml' ? parse(text) : JSON.parse(text); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
export function transport(definition) {
  const keys = ['url', 'command', 'args', 'env', 'cwd', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'headers'];
  return Object.fromEntries(keys.filter(key => definition[key] !== undefined).map(key => [key, definition[key]]));
}
export const fingerprint = definition => createHash('sha256').update(JSON.stringify(transport(definition))).digest('hex');
export function bindingFor(bindings, tool, scope) {
  return bindings?.find(b => b.tool === tool && b.scope === scope)
    ?? bindings?.find(b => b.tool === tool && b.scope === 'system');
}
export async function mcpInventory(context) {
  const { agent, agentHome, home, scope, receipt = {} } = context;
  const profile = resolveProfile(context);
  const project = scope === 'system' ? context.invocationProject : scope;
  const key = agent === 'codex' ? 'mcp_servers' : 'mcpServers';
  const layers = [];
  const add = async (path, format, keys, layerScope) => {
    const doc = await document(path, format);
    const servers = keys.reduce((at, key) => at?.[key], doc) ?? {};
    for (const [name, definition] of Object.entries(servers)) layers.push({ name, definition, path, format, keys: [...keys, name], scope: layerScope });
    return doc;
  };
  const user = await add(profile.mcpConfigPath, agent === 'codex' ? 'toml' : 'json', [key], 'system');
  let projectSettings = {};
  const policyDocuments = agent === 'claude' ? [await document(join(agentHome,'settings.json'),'json')] : [];
  if (project) {
    if (agent === 'codex') await add(join(project, '.codex/config.toml'), 'toml', [key], project);
    else {
      await add(join(project, '.mcp.json'), 'json', [key], project);
      await add(profile.mcpConfigPath, 'json', ['projects', project, key], project);
      projectSettings = await document(join(project, '.claude/settings.json'), 'json');
      policyDocuments.push(projectSettings,await document(join(project,'.claude/settings.local.json'),'json'));
    }
  }
  const effective = new Map();
  for (const item of layers) {
    const prior = effective.get(item.name);
    // A Codex policy-only layer inherits a transport; it is not a second server.
    const hasTransport = item.definition.url || item.definition.command;
    if (!hasTransport && prior) effective.set(item.name, { ...prior, definition: { ...prior.definition, ...item.definition } });
    else if (hasTransport) effective.set(item.name, item);
  }
  const disabled = new Set([...(user.projects?.[project]?.disabledMcpServers ?? []), ...policyDocuments.flatMap(doc=>doc.disabledMcpServers??[])]);
  return [...effective.values()].map(item => {
    const entry = receipt.configurations?.find(r => r.path === item.path && r.scope === item.scope)?.entries?.find(e => isDeepStrictEqual(e.keys, item.keys));
    const owned = !!entry && isDeepStrictEqual(transport(entry.value ?? {}), transport(item.definition));
    return { ...item, fingerprint: fingerprint(item.definition), owned, deniedPermissions:policyDocuments.flatMap(doc=>doc.permissions?.deny??[]),
      enabled: item.definition.enabled !== false && !disabled.has(item.name) };
  });
}

// Native host policy mechanics; each Tool chooses which capabilities it needs.
export function mcpToolAllowed(candidate, tool) {
  const definition=candidate.definition;
  if(!candidate.enabled || definition.disabled_tools?.includes(tool) || definition.tools?.[tool]?.enabled===false) return false;
  if(definition.enabled_tools && !definition.enabled_tools.includes(tool)) return false;
  if(definition.default_tools_enabled===false && definition.tools?.[tool]?.enabled!==true) return false;
  const name=candidate.name.replace(/[^a-zA-Z0-9_-]/g,'_');
  const permission=`mcp__${name}__${tool}`;
  return !(candidate.deniedPermissions??[]).some(rule=>{
    if(rule===`mcp__${name}`)return true;
    const pattern=rule.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    return new RegExp(`^${pattern}$`).test(permission);
  });
}
