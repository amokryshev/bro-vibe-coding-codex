import { access, readFile, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { constants } from 'node:fs';

export function compatible(candidate) {
  const { command, args = [] } = candidate.definition;
  return !!command && (basename(command) === 'playwright-mcp' || args.some(arg =>
    typeof arg === 'string' && (/\/payload\/playwright\/entrypoint\.mjs$/.test(arg) || /\/@playwright\/mcp\/cli\.js$/.test(arg) || /^@playwright\/mcp(?:@[\w.^~+-]+)?$/.test(arg))));
}
export async function select(ctx) {
  const inventory=await ctx.mcpInventory();
  const canonical = inventory.find(c => c.name === 'bro-playwright' && c.scope === (ctx.project ?? 'system'));
  // The canonical name is reserved for this Tool in the configured scope.
  if (canonical && !canonical.owned) return undefined;
  const candidates = inventory.filter(compatible);
  if(!candidates.length&&inventory.some(c=>/playwright/i.test(c.name))&&ctx.settings.createNewMcp!==true)throw Error('Existing Playwright MCP compatibility is unknown; select a compatible server, skip this Tool, or explicitly set createNewMcp to create a separate registration');
  const saved = ctx.mcpBinding();
  let chosen = canonical;
  if (saved && !ctx.settings.mcpServer) {
    const found = candidates.find(c => c.name === saved.name && c.fingerprint === saved.fingerprint);
    if (found) chosen=found;
    if (!found && saved.mode === 'borrowed') throw Error('Selected Playwright MCP changed or disappeared; select its configuration explicitly');
  }
  const external = candidates.filter(c => !c.owned);
  const choices = external.length ? external : candidates;
  if (ctx.settings.mcpServer) {
    chosen = candidates.find(c => c.name === ctx.settings.mcpServer);
    if(!chosen)throw Error('Requested Playwright MCP is not a compatible visible server');
  }
  else if (!chosen && choices.length === 1) chosen = choices[0];
  else if (!chosen && choices.length > 1) {
    const name = await ctx.ask('Select existing Playwright MCP: ' + choices.map(c => c.name).join(', '));
    chosen = choices.find(c => c.name === name);
  }
  if (choices.length && !chosen) throw Error('Ambiguous Playwright MCP selection');
  if (chosen && !chosen.enabled) throw Error('Selected Playwright MCP is disabled; enable it in the host before configuring');
  if(chosen&&!chosen.owned&&[chosen.definition.command,...(chosen.definition.args??[])].some(value=>typeof value==='string'&&value.startsWith(ctx.root+'/')))throw Error('Unowned Playwright MCP depends on this installation; repair its ownership or select an independent runtime');
  for (const duplicate of candidates.filter(c => c.owned && c.scope === (ctx.project ?? 'system') && c.name !== chosen?.name)) {
    if (ctx.mcpReferenced(duplicate)) throw Error(`Playwright duplicate ${duplicate.name} is still referenced by another project`);
  }
  return chosen;
}
export async function checkCandidate(ctx,candidate) {
  if(!candidate.enabled) throw Error('Playwright MCP is disabled');
  if(!ctx.mcpToolAllowed(candidate,'browser_navigate'))throw Error('Playwright MCP browser_navigate is denied by the host policy');
  const args = candidate.definition.args ?? [];
  const launcher = args.findIndex(arg => /\/payload\/playwright\/entrypoint\.mjs$/.test(arg));
  let executable;
  if (launcher >= 0) {
    const config = JSON.parse(await readFile(args[launcher + 1], 'utf8'));
    executable=config.executable;
  } else {
    const option=name=>args.find(arg=>typeof arg==='string'&&arg.startsWith(name+'='))?.slice(name.length+1)??(args.includes(name)?args[args.indexOf(name)+1]:undefined);
    executable=option('--executable-path')??candidate.definition.env?.PLAYWRIGHT_MCP_EXECUTABLE_PATH;
    const configPath=option('--config');
    if(!executable&&configPath) {
      const config=JSON.parse(await readFile(resolve(candidate.definition.cwd??ctx.project??ctx.home,configPath),'utf8'));
      executable=config.browser?.launchOptions?.executablePath;
    }
    if(!executable)throw Error('Existing Playwright MCP browser executable cannot be verified; configure --executable-path or select another server explicitly');
  }
  executable=await realpath(resolve(candidate.definition.cwd??ctx.project??ctx.home,executable));
  await access(executable, constants.X_OK);
  if(ctx.settings.executable&&await realpath(ctx.settings.executable)!==executable)throw Error('Existing Playwright MCP uses a different browser executable; select its configuration explicitly');
  const discovered=await ctx.discoverMcp(candidate.name);
  if(ctx.agent==='claude'?!discovered?.connected:!discovered?.serverInfo||discovered.toolsError||!Object.keys(discovered.tools??{}).length)throw Error('Playwright MCP is unavailable in native host discovery');
  const { initialized, results } = await ctx.probeMcp(candidate.definition, [{ method: 'tools/list' }]);
  if (!/playwright/i.test(initialized.serverInfo?.name ?? '') || !results[0]?.tools?.some(t => t.name === 'browser_navigate')) throw Error('Selected MCP does not provide Playwright browser tools');
}
export async function verify(ctx) {
  await ctx.checkState();
  const binding = ctx.mcpBinding();
  if (!binding) {
    if((await ctx.inspectState()).configured)throw Error('Playwright configuration has no saved MCP binding; configure it first');
    return { status: 'skipped', verification: 'not-configured' };
  }
  const candidate = (await ctx.mcpInventory()).find(c => c.name === binding.name);
  if (!candidate || !compatible(candidate) || candidate.fingerprint !== binding.fingerprint) throw Error('Playwright MCP binding is missing or changed');
  if((await ctx.mcpInventory()).some(c=>compatible(c)&&c.owned&&c.scope===(ctx.project??'system')&&c.name!==binding.name))throw Error('Owned Playwright MCP duplicates remain');
  await checkCandidate(ctx,candidate);
  return { status: 'completed', verification: 'passed' };
}
