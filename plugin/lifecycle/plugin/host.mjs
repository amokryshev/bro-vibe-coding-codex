export { cleanupHookTrust } from './cleanup-hook-trust.mjs';
import { mkdir, writeFile, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupNativeFiles } from './native-cleanup.mjs';
import { nativeSource } from './native-source.mjs';
import { nativeEnvironment } from './profile.mjs';

export const agent = 'codex';
export const profileDirectory = '.codex';
export const profileEnvironment = 'CODEX_HOME';
export const skillsDirectory = ({ project, home }) => join(project ?? home, '.agents/skills');
const marketplace = 'bro-vibe-coding-codex';
const selector = `bro-vibe-coding@${marketplace}`;
function native(ctx, args) {
  const result = spawnSync('codex', args, { encoding: 'utf8', env: nativeEnvironment({ ...ctx, agent }) });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`codex ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
export async function checkNewInstallation(ctx) {
  if (!await ctx.exists(ctx.agentHome)) return;
  const markets = native(ctx, ['plugin', 'marketplace', 'list', '--json']).marketplaces;
  const plugins = native(ctx, ['plugin', 'list', '--json']).installed;
  if (markets.some(m => m.name === marketplace) || plugins.some(p => p.pluginId === selector)) throw Error('Existing BRO native registration has no ownership record; remove that installation first');
}
export async function inspectInstallation(ctx) {
  const market = native(ctx, ['plugin', 'marketplace', 'list', '--json']).marketplaces.find(m => m.name === marketplace);
  const plugin = native(ctx, ['plugin', 'list', '--json']).installed.find(p => p.pluginId === selector);
  if (!plugin || market?.marketplaceSource?.sourceType !== 'git') throw Error('Install BRO through the agent from its Git marketplace first');
  const installedPlugin = join(ctx.agentHome, 'plugins/cache', marketplace, 'bro-vibe-coding', plugin.version);
  return { ...(await nativeSource({ marketplaceRoot: market.root, repository: market.marketplaceSource.source,
    sourcePlugin: ctx.sourcePlugin, installedPlugin })), selector, marketplace, version: plugin.version, ref:market.marketplaceSource.ref };
}
export async function install(ctx) {
  const marketPath = join(ctx.root, '.agents/plugins');
  await mkdir(marketPath, { recursive: true });
  await writeFile(join(marketPath, 'marketplace.json'), JSON.stringify({ name: marketplace, plugins: [{ name: 'bro-vibe-coding', source: { source: 'local', path: './plugin' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }, null, 2) + '\n');
  const market = native(ctx, ['plugin', 'marketplace', 'list', '--json']).marketplaces.find(m => m.name === marketplace);
  if (market && market.marketplaceSource?.source !== ctx.root) throw Error('BRO marketplace now belongs to another installation');
  if (!market) native(ctx, ['plugin', 'marketplace', 'add', ctx.root, '--json']);
  if (!native(ctx, ['plugin', 'list', '--json']).installed.some(p => p.pluginId === selector)) native(ctx, ['plugin', 'add', selector, '--json']);
}
export async function uninstall(ctx) {
  if (ctx.nativeInstallation) {
    const market = native(ctx, ['plugin', 'marketplace', 'list', '--json']).marketplaces.find(m => m.name === marketplace);
    if (market && market.marketplaceSource?.source !== ctx.nativeInstallation.repository) throw Error('BRO marketplace now belongs to another installation');
    const plugins = native(ctx, ['plugin', 'list', '--json']).installed;
    if (plugins.some(p=>p.pluginId === selector && p.version !== ctx.nativeInstallation.version)) throw Error('Another BRO version is registered');
    if (plugins.some(p => p.pluginId === selector)) native(ctx, ['plugin', 'remove', selector, '--json']);
    const removeMarketplace = !plugins.some(p => p.marketplaceName === marketplace && p.pluginId !== selector);
    if (market && removeMarketplace) native(ctx, ['plugin', 'marketplace', 'remove', marketplace, '--json']);
    return await cleanupNativeFiles(ctx,{removeMarketplace});
  }
  const market = native(ctx, ['plugin', 'marketplace', 'list', '--json']).marketplaces.find(m => m.name === marketplace);
  if (market && market.marketplaceSource?.source !== ctx.root) throw Error('BRO marketplace now belongs to another installation');
  native(ctx, ['plugin', 'remove', selector, '--json']);
  if (market) native(ctx, ['plugin', 'marketplace', 'remove', marketplace, '--json']);
  const cache = join(ctx.agentHome, 'plugins/cache', marketplace);
  await ctx.noSymlinks(cache);
  if (await ctx.exists(cache)) await rmdir(cache);
}

export async function isInstalled(ctx) { return native(ctx, ['plugin', 'list', '--json']).installed.some(p => p.pluginId === selector); }

export async function installedPluginDirectory(ctx) {
  const plugin = native(ctx, ['plugin', 'list', '--json']).installed.find(p => p.pluginId === selector);
  if (!plugin) throw Error('Native BRO plugin is not registered');
  return join(ctx.agentHome, 'plugins/cache', marketplace, 'bro-vibe-coding', plugin.version);
}

export async function verifyMarketplaceRemoved(ctx) { if(native(ctx,['plugin','marketplace','list','--json']).marketplaces.some(m=>m.name===marketplace)) throw Error('Native BRO marketplace registry remains'); }

export async function removalPaths(ctx) {
  const plugins=native(ctx,['plugin','list','--json']).installed;
  return [join(ctx.agentHome,'plugins/cache',marketplace,'bro-vibe-coding',ctx.nativeInstallation.version),
    ...(!plugins.some(p=>p.marketplaceName===marketplace&&p.pluginId!==selector)?[ctx.nativeInstallation.marketplaceRoot]:[])];
}
