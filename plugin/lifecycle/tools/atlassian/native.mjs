import { spawn } from 'node:child_process';

export async function native(ctx, action, name = ctx.serverName('atlassian')) {
 if (ctx.mode === 'check') throw Error('Atlassian check cannot change authorization');
 const child=spawn(ctx.agent,['mcp',action,name],{env:ctx.nativeEnvironment(),cwd:ctx.project ?? ctx.home,stdio:'inherit'});
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Atlassian ${action} did not complete. Run the same lifecycle action again when ready.`)));});
}

export async function nativeHealth(ctx, name) {
  const server = await ctx.discoverMcp(name);
  if (ctx.agent === 'claude') {
    if (!server?.connected) throw Error('Atlassian MCP is not connected in the selected Claude profile; check approval, authorization and availability');
  } else if (!server?.serverInfo || server.toolsError || !Object.keys(server.tools ?? {}).length || server.authStatus === 'notLoggedIn') {
    throw Error('Atlassian MCP did not initialize in the selected Codex profile; check authorization and availability');
  }
  const result = await ctx.callMcpTool(name, { tool: 'getAccessibleAtlassianResources', arguments: {} });
  if (!result || result.isError || !Array.isArray(result.content)) throw Error('Atlassian account resource check failed');
  const payloads = [result.structuredContent];
  for (const block of result.content) {
    if (block.type !== 'text') continue;
    try { payloads.push(JSON.parse(block.text)); } catch { /* Plain diagnostic text does not prove account access. */ }
  }
  const resources = payloads.flatMap(value => Array.isArray(value) ? value : value?.resources ?? value?.data ?? []);
  if (!resources.some(resource => typeof resource?.id === 'string' && typeof resource?.url === 'string')) {
    throw Error('Atlassian account has no accessible sites or returned an unsupported resource response');
  }
}
