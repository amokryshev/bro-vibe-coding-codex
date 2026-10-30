import { cp, mkdir, readFile, writeFile, readdir, rm, rmdir, lstat, realpath, rename, chmod, copyFile, constants, readlink } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import * as host from './host.mjs';
import { applyConfiguration, settleConfiguration, checkConfiguration } from './configuration.mjs';
import { nativeConfiguration } from './native-configuration.mjs';
import { selectTools } from './select-tools.mjs';
import { verifyReceipt, removalEvidence, verifyRemoval } from './verification.mjs';
import { backupProject, inventory, pruneEmpty } from './project-backup.mjs';
import { preparePlatform } from './platform-payload.mjs';
import { resolveProfile, nativeEnvironment } from './profile.mjs';
import { mcpInventory, bindingFor, mcpToolAllowed, fingerprint } from './mcp-configuration.mjs';
import { discoverMcp, callMcpTool } from './host-mcp.mjs';
import { probeMcp } from './mcp-protocol.mjs';

const actions = ['install', 'configure-system', 'uninstall-system', 'configure-project', 'uninstall-project'];
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const digest = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const encode = value => JSON.stringify(value, null, 2) + '\n';
async function canonical(path) {
  const missing = [];
  let at = resolve(path);
  while (!await exists(at)) { missing.unshift(at.slice(dirname(at).length + 1)); at = dirname(at); }
  return join(await realpath(at), ...missing);
}

// Refuse aliases before creating/removing owned paths. Ownership never grants access through a symlink.
async function noSymlinks(path) {
  for (let at = resolve(path); ; at = dirname(at)) {
    if (await exists(at) && (await lstat(at)).isSymbolicLink()) throw Error(`Symbolic link in managed path: ${at}`);
    if (at === dirname(at)) break;
  }
}
async function prompt(question) {
  if (!process.stdin.isTTY) throw Error(`${question} Supply the corresponding option in noninteractive mode.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question + ' '); } finally { rl.close(); }
}

export async function run(action, options) {
  if (!actions.includes(action)) throw Error('Unknown lifecycle action');
  const values = options ?? parseArgs({ options: {
    'release-repo': {type:'string'}, 'release-commit': {type:'string'}, root: { type: 'string' }, home: { type: 'string' }, 'agent-home': { type: 'string' }, project: { type: 'string' },
    settings: { type: 'string' }, tools: { type: 'string' }, tracker: { type: 'string' }, help: { type: 'boolean' }, mode: { type: 'string' },
  } }).values;
  const mode = values.mode ?? 'apply';
  const preserveNativeRegistration = values.preserveNativeRegistration === true;
  if (preserveNativeRegistration && (action !== 'uninstall-system' || !values.native)) throw Error('Preserving native registration requires native system reset');
  if (!['apply','check'].includes(mode)) throw Error('Lifecycle mode must be apply or check');
  if (values.help) { console.log(`${action} [--home USER_HOME] [--root INSTALL_ROOT] [--tools id,id|none] [--project PATH] [--tracker AGREEMENT] [--settings PRIVATE_JSON_FILE]\nAvailable actions: ${actions.join(', ')}`); return; }
  if (!['darwin', 'linux'].includes(platform())) throw Error('Supported systems: macOS and Linux');
  const home = await realpath(resolve(values.home ?? homedir()));
  const agentHome = await canonical(values['agent-home'] ?? (values.home ? join(home, host.profileDirectory) : process.env[host.profileEnvironment] ?? join(home, host.profileDirectory)));
  const root = await canonical(values.root ?? join(home, '.local/share/bro-vibe-coding', host.agent));
  if (root === home || root === '/' || relative(root, home) === '' || !relative(root, home).startsWith('..')) throw Error('Installation root must not contain the user home');
  await noSymlinks(root);
  const sourcePlugin = resolve(import.meta.dirname, '../..');
  // A removal worker survives outside the cache; native identity still belongs to
  // the original host-installed plugin, never to the temporary executor.
  const hostContext = { root, home, agentHome, exists, noSymlinks, sourcePlugin: values.inspectionSource ?? sourcePlugin };
  const settings = values.settings ? await json(resolve(values.settings)) : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Settings must be an object keyed by tool id');
  const receiptPath = join(root, 'ownership.json');
  let receipt = await exists(receiptPath) ? await json(receiptPath) : null;
  const profile = resolveProfile({agent:host.agent,home,agentHome,explicitProfile:receipt?.explicitProfile ?? (values['agent-home'] ? true : undefined)});
  Object.assign(hostContext,profile);
  if(mode === 'check' && !receipt) throw Error('No installation state to check');
  if (receipt && (receipt.root !== root || receipt.home !== home || receipt.agentHome !== agentHome)) throw Error('Installation belongs to another home, profile or path');
  if (receipt) {
    const installedAgent = receipt.agent ?? (await json(join(root, 'plugin/release.json'))).agent;
    if (values.native && !receipt.nativeInstallation) throw Error('This BRO installation uses the previous bootstrap. Remove it through its lifecycle, then install the Git plugin through the agent.');
    if (installedAgent !== host.agent) throw Error(`Installation belongs to ${installedAgent}, not ${host.agent}`);
    if(values.native && (!action.startsWith('uninstall') || await host.isInstalled(hostContext))) {
      const current = await host.inspectInstallation(hostContext);
      if(current.repository !== receipt.nativeInstallation.repository || current.commit !== receipt.nativeInstallation.commit || current.version !== receipt.nativeInstallation.version) throw Error('The native plugin release differs from this BRO installation. Remove the previous installation before changing releases.');
    }
  }
  const save = async () => {
    if(mode === 'check') throw Error('Check mode cannot save installation state');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const pending = join(root, 'ownership.pending.json');
    await writeFile(pending, encode(receipt), { mode: 0o600 });
    await rename(pending, receiptPath);
  };
  const release = await json(join(sourcePlugin, 'release.json'));
  let releaseSource = await exists(join(root,'source.json')) ? await json(join(root,'source.json')) : null;
  let selected = receipt?.tools ?? [];
  if (mode !== 'check' && (action === 'install' || action === 'configure-system')) {
    const choice = values.tools;
    selected = choice === undefined ? await selectTools(release.tools, receipt?.tools ?? []) : choice === 'none' ? [] : choice.split(',').map(x => x.trim()).filter(Boolean);
    if (new Set(selected).size !== selected.length || selected.some(id => !release.tools.includes(id))) throw Error('Invalid tool selection');
    if (receipt && receipt.tools.some(id => !selected.includes(id))) throw Error('To remove installed tools, use uninstall-system. Configure-system can add deferred tools.');
  }
  let project;
  if (action.endsWith('-project')) {
    if (!values.project) throw Error('--project is required');
    project = action === 'uninstall-project' ? await canonical(values.project) : await realpath(resolve(values.project));
    if (await exists(project) && !(await lstat(project)).isDirectory()) throw Error('Project must be a directory');
    if (project === root || !relative(root, project).startsWith('..')) throw Error('Project cannot be inside installation');
  }
  if (!receipt) {
    if (action === 'uninstall-system' || action === 'uninstall-project') {
      if (values.native && !preserveNativeRegistration && action === 'uninstall-system' && await host.isInstalled(hostContext)) {
        const nativeInstallation = await host.inspectInstallation(hostContext);
        const nativePaths = await host.uninstall({...hostContext,nativeInstallation});
        return {action,root,home,agentHome,project,nativeInstallation,alreadyRemoved:true,removed:{files:[],settings:[],nativePaths:nativePaths ?? []}};
      }
      console.log('Already removed');
      return {action,root,home,agentHome,project,alreadyRemoved:true,removed:{files:[],settings:[]}};
    }
    if (action !== 'install') throw Error('Install the plugin first');
    if (await exists(root)) throw Error(`Installation path already exists without BRO ownership: ${root}`);
    const nativeInstallation = values.native ? await host.inspectInstallation(hostContext) : null;
    if (!values.native) await host.checkNewInstallation(hostContext);
    receipt = { id: randomUUID(), agent: host.agent, root, home, agentHome, explicitProfile:profile.explicitProfile, tools: [], installedTools: [], projects: [], resources: [], native: !!nativeInstallation, ...(nativeInstallation ? { nativeInstallation } : {}) };
    await save();
  }
  receipt.installedTools ??= [...receipt.tools];
  if(mode !== 'check') receipt.explicitProfile ??= profile.explicitProfile;
  const removalChecks = new Map();
  async function claimProject() {
    // Asking questions and checking input has no persistent effect.
    if (action === 'configure-project' && !receipt.projects.includes(project)) { receipt.projects.push(project); await save(); }
  }
  async function ensureParents(path, scope, owner) {
    const missing = [];
    for (let at = dirname(path); !await exists(at); at = dirname(at)) missing.unshift(at);
    for (const at of missing) {
      receipt.resources.push({ path: at, scope, owner, kind: 'parent' }); await save();
      await mkdir(at, { mode: 0o700 });
    }
  }
  async function pruneParents(scope) {
    for (const r of [...receipt.resources].reverse().filter(r => r.kind === 'parent' && r.scope === scope)) {
      await noSymlinks(r.path);
      if (await exists(r.path)) { try { await rmdir(r.path); } catch (e) { if (e.code === 'ENOTEMPTY') continue; throw e; } }
      receipt.resources.splice(receipt.resources.indexOf(r), 1); await save();
    }
  }
  async function finalize(scope) {
    await settleConfiguration({receipt,save,noSymlinks},scope);
    if (scope === 'system' && action === 'uninstall-system' && host.cleanupHookTrust) {
      const result = await host.cleanupHookTrust({agentHome,receipt,save,noSymlinks});
      if(result.preserved.length) throw Error('Hook trust could not be removed safely: '+JSON.stringify(result.preserved));
    }
    const specs = await nativeConfiguration({ ...hostContext, agent: host.agent, scope, fragments: receipt.fragments ?? [], bindings:receipt.bindings });
    await applyConfiguration({ receipt, save, noSymlinks, ensureParents, replaceChanged: action === 'configure-project' && !!values.resetProject && scope === project, expectedHashes: backupConfigurationHashes }, scope, specs);
    console.log(`Applied native configuration: ${scope}`);
    if (action.startsWith('uninstall')) await pruneParents(scope);
  }
  const afterConfiguration = [];
  function context(owner, scope, operation = action, contextMode = mode) {
    async function checkDirectory(path, source) {
      await noSymlinks(path);
      const prior = receipt.resources.find(r => r.path === path && r.kind !== 'parent');
      if (prior && (prior.owner !== owner || prior.scope !== scope)) throw Error(`Ownership conflict: ${path}`);
      if (!await exists(path)) return false;
      if (!prior) throw Error(`Refusing to replace an existing resource: ${path}`);
      if (prior.resetPending) {
        for (const name of Object.keys(await inventory(source))) if (await exists(join(path,name))) throw Error(`Foreign file conflicts with fresh setup: ${join(path,name)}`);
        return false;
      }
      async function verify(from, to) {
        for (const entry of await readdir(from, { withFileTypes: true })) {
          const target = join(to, entry.name);
          await noSymlinks(target);
          if (!await exists(target)) throw Error(`Incomplete owned directory: ${target}`);
          if (entry.isSymbolicLink()) { if(await readlink(join(from,entry.name)) !== await readlink(target)) throw Error(`Changed owned symlink: ${target}`); }
          else if (entry.isDirectory()) await verify(join(from, entry.name), target);
          else if (digest(await readFile(target)) !== digest(await readFile(join(from, entry.name)))) throw Error(`Changed owned file: ${target}`);
        }
      }
      await verify(source, path);
      return true;
    }
    async function ownDirectories(entries) {
      const needed = [];
      for (const entry of entries) if (!await checkDirectory(entry.path, entry.source)) needed.push(entry);
      if (!needed.length) return;
      await claimProject();
      // Prepare the entire tool outside host discovery; failed copies never become skills.
      const staging = join(scope === 'system' ? root : scope, `.bro-staging-${randomUUID()}`);
      receipt.resources.push({ path: staging, scope, owner, kind: 'staging' }); await save();
      const attempts = [];
      let destination;
      try {
        await mkdir(staging, { mode: 0o700 });
        for (const [index, entry] of needed.entries()) {
          destination = entry.path;
          await ensureParents(entry.path, scope, owner);
          await cp(entry.source, join(staging, String(index)), { verbatimSymlinks: true, recursive: true });
        }
        for (const [index, entry] of needed.entries()) {
          destination = entry.path;
          await noSymlinks(entry.path);
          const existing = receipt.resources.find(r => r.path === entry.path && r.kind === 'directory');
          const present = await exists(entry.path);
          if (present && !existing?.resetPending) throw Error(`Resource appeared during configuration: ${entry.path}`);
          const files = await inventory(entry.source);
          const record = existing ?? { path: entry.path, scope, owner, kind: 'directory' };
          const attempt = { record, previous: existing ? { ...existing } : null, renamed: false, copied: [] };
          attempts.push(attempt);
          record.files = files;
          if (!existing) receipt.resources.push(record);
          await save();
          if (present) {
            for (const name of Object.keys(record.files)) {
              const target = join(entry.path, name);
              await noSymlinks(target);
              await mkdir(dirname(target), { recursive: true, mode: 0o700 });
              await copyFile(join(staging, String(index), name), target, constants.COPYFILE_EXCL);
              attempt.copied.push(target);
            }
          } else {
            await rename(join(staging, String(index)), entry.path);
            attempt.renamed = true;
          }
          delete record.resetPending; await save();
        }
        await rm(staging, { recursive: true });
        receipt.resources = receipt.resources.filter(r => r.path !== staging); await save();
      } catch (error) {
        // Revert only completed writes and their ownership intents, including a failed rename.
        for (const attempt of attempts.reverse()) {
          const { record, previous, renamed, copied } = attempt;
          if (renamed) {
            await noSymlinks(record.path);
            if (scope === 'system') await rm(record.path, { recursive: true, force: true });
            else {
              for (const name of Object.keys(record.files ?? {})) {
                const path = join(record.path, name);
                await noSymlinks(path);
                await rm(path, { force: true });
              }
              await pruneEmpty(record.path);
            }
          } else {
            for (const path of copied.reverse()) {
              await noSymlinks(path);
              await rm(path, { force: true });
            }
          }
          const index = receipt.resources.indexOf(record);
          if (previous) receipt.resources[index] = previous;
          else receipt.resources.splice(index, 1);
        }
        await rm(staging, { recursive: true, force: true });
        receipt.resources = receipt.resources.filter(r => r.path !== staging); await save();
        if (['EACCES', 'EPERM'].includes(error.code)) {
          const message = [
            `Cannot configure directory ${destination ?? staging}: ${error.message}.`,
            'Check directory ownership, permissions and ACLs.',
            "If an agent sandbox denied access, authorize this lifecycle command through the agent's approval flow.",
            'Retry configuration after restoring access.',
          ].join(' ');
          throw new Error(message, { cause: error });
        }
        throw error;
      }
    }
    async function checkOwnedFile(record) {
      await noSymlinks(record.path);
      if (!await exists(record.path)) return;
      const info = await lstat(record.path);
      if (!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) throw Error(`Unsafe owned file: ${record.path}`);
      if (![record.hash, record.previousHash].includes(digest(await readFile(record.path)))) throw Error(`Owned document was edited; preserve or remove it explicitly: ${record.path}`);
    }
    async function own(path, kind, source, content) {
      await noSymlinks(path);
      const prior = receipt.resources.find(r => r.path === path && r.kind !== 'parent');
      if (prior && (prior.owner !== owner || prior.scope !== scope)) throw Error(`Ownership conflict: ${path}`);
      if (!prior && await exists(path)) throw Error(`Refusing to replace an existing resource: ${path}`);
      if (prior && await exists(path)) return; // Idempotent; user edits are never overwritten by configuration.
      await claimProject();
      await ensureParents(path, scope, owner);
      if (!prior) { receipt.resources.push({ path, scope, owner, kind, ...(content ? { hash: digest(content) } : {}) }); await save(); }
      if (kind === 'directory') await cp(source, path, { verbatimSymlinks: true, recursive: true, errorOnExist: true, force: false });
      else await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    }
    const ctx = {
      root, home, agentHome, agent: host.agent, tool: owner, mode:contextMode, operation, explicitProfile:profile.explicitProfile,
      nativeEnvironment: () => nativeEnvironment({...hostContext,agent:host.agent}),
      inspectState: async () => ({installed:receipt.installedTools.includes(owner),configured:!!(receipt.fragments?.some(f=>f.owner===owner&&f.scope===scope)||receipt.resources.some(r=>r.owner===owner&&r.scope===scope&&r.kind!=='parent')||receipt.bindings?.some(b=>b.tool===owner&&b.scope===scope))}),
      checkState: async () => {
        const pending=receipt.configurations?.find(record=>record.scope===scope&&record.pending);
        if(pending)throw Error(`Incomplete native configuration: ${pending.path}`);
        if(operation.startsWith('uninstall')) {
          const evidence=removalChecks.get(`${owner}:${scope}`);
          if(evidence) await verifyRemoval(evidence);
          else if(receipt.fragments?.some(f=>f.owner===owner&&f.scope===scope)
            ||receipt.resources.some(r=>r.owner===owner&&r.scope===scope&&r.kind!=='parent')
            ||receipt.bindings?.some(b=>b.tool===owner&&b.scope===scope)
            ||scope!=='system'&&receipt.projects.includes(scope)
            ||receipt.configurations?.some(record=>record.scope===scope&&record.entries.length)
            ||scope==='system'&&receipt.installedTools.includes(owner))throw Error('Removal has not completed for this Tool and scope');
          return;
        }
        const specs=await nativeConfiguration({...hostContext,agent:host.agent,scope,fragments:(receipt.fragments??[]).filter(f=>f.owner===owner),bindings:receipt.bindings});
        await verifyReceipt({resources:receipt.resources.filter(r=>r.owner===owner),configurations:specs.map(s=>({...s,scope}))},scope);
      },
      invocationProject: values.project ? resolve(values.project) : undefined,
      mcpInventory: () => mcpInventory({...hostContext,agent:host.agent,scope,receipt,invocationProject:values.project ? resolve(values.project) : undefined}),
      mcpBinding: () => bindingFor(receipt.bindings,owner,scope),
      mcpToolAllowed,
      mcpFingerprint: fingerprint,
      discoverMcp: name => discoverMcp({agent:host.agent,env:nativeEnvironment({...hostContext,agent:host.agent}),cwd:scope==='system'?home:scope,project:scope==='system'?undefined:scope},name),
      callMcpTool: (name,request) => callMcpTool({agent:host.agent,env:nativeEnvironment({...hostContext,agent:host.agent}),cwd:scope==='system'?home:scope,project:scope==='system'?undefined:scope},name,request),
      setMcpBinding: async binding => {
        await claimProject(); receipt.bindings ??= [];
        receipt.bindings=receipt.bindings.filter(b=>!(b.tool===owner&&b.scope===scope));
        if(binding) {
          const candidate=(await mcpInventory({...hostContext,agent:host.agent,scope,receipt})).find(c=>c.name===binding.name&&c.fingerprint===binding.fingerprint);
          receipt.bindings.push({...binding,...(candidate?{source:{path:candidate.path,keys:candidate.keys,scope:candidate.scope}}:{}),tool:owner,scope});
        }
        await save();
      },
      mcpReferenced: candidate => (receipt.bindings??[]).some(b=>b.scope!==scope&&b.name===candidate.name&&b.fingerprint===candidate.fingerprint)
        || (receipt.configurations??[]).some(r=>r.scope!==scope&&r.entries.some(e=>e.keys.includes(candidate.name)||typeof e.append==='string'&&e.append.includes(`__${candidate.name}__`))),
      probeMcp: (definition, requests) => probeMcp(definition,{env:nativeEnvironment({...hostContext,agent:host.agent}),cwd:scope==='system'?home:scope,requests}),
      pluginDirectories: async () => [join(root, 'plugin'), await host.installedPluginDirectory(hostContext)],
      installed: receipt.installedTools.includes(owner),
      releaseSource: { ...releaseSource, marketplaceRoot: receipt.nativeInstallation?.marketplaceRoot },
      platformPayloadDirectory: join(root,'platform_specific',`${platform()}-${arch()}`,owner),
      obtainPlatform: () => preparePlatform(context(owner,'system'),sourcePlugin,releaseSource),
      serverName: id => bindingFor(receipt.bindings,id,scope)?.name ?? `bro-${id}`,
      skillsDirectory: host.skillsDirectory({ project: scope === 'system' ? undefined : scope, home, agentHome }),
      project: scope === 'system' ? undefined : scope,
      projectDirectory: scope === 'system' ? undefined : join(scope, host.agent === 'codex' ? '.agents' : '.claude', 'bro-vibe-coding'),
      dataDirectory: join(root, 'data', owner, scope === 'system' ? 'system' : digest(scope)),
      settings: { ...(owner === 'bro-matt' && values.tracker ? {tracker: values.tracker} : {}), ...(settings[owner] ?? {}) },
      configure: async fragment => {
        await claimProject();
        receipt.fragments ??= [];
        receipt.fragments = receipt.fragments.filter(f => !(f.owner === owner && f.scope === scope));
        if (Object.keys(fragment).length) receipt.fragments.push({owner, scope, value: fragment});
        await save();
      },
      ownFile: async (path, content, options = {}) => {
        await noSymlinks(path);
        const prior = receipt.resources.find(r => r.path === path && r.kind !== 'parent');
        if (prior && (prior.owner !== owner || prior.scope !== scope || prior.kind !== 'file')) throw Error(`Ownership conflict: ${path}`);
        const present = await exists(path);
        if (present && (!prior || ![prior.hash, prior.previousHash].includes(digest(await readFile(path))))) throw Error(`Changed or foreign file: ${path}`);
        if(present) { const info=await lstat(path); if(!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) throw Error(`Unsafe owned file: ${path}`); }
        if (present && digest(await readFile(path)) === digest(content)) { await chmod(path,options.mode ?? 0o600); if(prior.previousHash) { delete prior.previousHash; await save(); } return; }
        await claimProject(); await ensureParents(path, scope, owner);
        const record = prior ?? {path, owner, scope, kind: 'file'};
        record.previousHash = present ? digest(await readFile(path)) : undefined;
        record.hash = digest(content);
        if (!prior) receipt.resources.push(record);
        const pending = `${path}.bro-pending`;
        await noSymlinks(pending);
        let temporary = receipt.resources.find(r => r.path === pending);
        if (temporary && (temporary.kind !== 'temporary' || temporary.owner !== owner || temporary.scope !== scope)) throw Error(`Ownership conflict: ${pending}`);
        if (!temporary && await exists(pending)) throw Error(`Foreign temporary file: ${pending}`);
        if (!temporary) { temporary = {path:pending,kind:'temporary',owner,scope}; receipt.resources.push(temporary); }
        await save();
        await writeFile(pending, content, {mode: options.mode ?? 0o600});
        await chmod(pending,options.mode ?? 0o600);
        const beforeRename=await exists(path) ? digest(await readFile(path)) : undefined;
        if(beforeRename !== record.previousHash) throw Error(`Owned file changed during configuration: ${path}`);
        await rename(pending,path);
        receipt.resources.splice(receipt.resources.indexOf(temporary),1);
        delete record.previousHash; await save();
      },
      exists, ask: prompt, afterConfiguration: fn => afterConfiguration.push(fn),
      checkOwnedFiles: async paths => {
        for (const record of receipt.resources.filter(r => r.owner === owner && r.scope === scope && ['file', 'document'].includes(r.kind) && paths.includes(r.path))) await checkOwnedFile(record);
      },
      checkDirectories: async entries => { for (const entry of entries) await checkDirectory(entry.path, entry.source); },
      ownDirectories,
      ownDirectory: (path, source) => ownDirectories([{ path, source }]),
      ensureDocument: async (path, content) => { if (!await exists(path)) await own(path, 'document', null, content); },
      removeOwned: async paths => {
        for (const r of [...receipt.resources].reverse().filter(r => r.owner === owner && r.scope === scope && r.kind !== 'parent' && (!paths || paths.includes(r.path)))) {
          await noSymlinks(r.path);
          if (await exists(r.path)) {
            if (r.kind === 'parent') {
              try { await rmdir(r.path); } catch (e) { if (e.code !== 'ENOTEMPTY') throw e; }
            } else if (r.kind === 'document' || r.kind === 'file') {
              await checkOwnedFile(r);
              await rm(r.path);
            } else if (scope !== 'system' && r.kind === 'directory' && r.files) {
              for (const name of Object.keys(r.files)) { await noSymlinks(join(r.path,name)); await rm(join(r.path,name),{force:true}); }
              const parents = new Set(Object.keys(r.files).map(name => dirname(join(r.path,name))));
              for (const path of [...parents].sort((a,b)=>b.length-a.length)) await pruneEmpty(path);
              await pruneEmpty(r.path);
            } else await rm(r.path, { recursive: true });
          }
          receipt.resources.splice(receipt.resources.indexOf(r), 1); await save();
        }
      },
    };
    if(contextMode==='check') for(const name of ['configure','setMcpBinding','ownFile','ownDirectory','ownDirectories','ensureDocument','removeOwned','obtainPlatform','afterConfiguration','ask']) ctx[name]=()=>{throw Error(`Check mode cannot mutate or prompt: ${name}`);};
    return ctx;
  }
  if(mode==='check') {
    const toolResults=[];
    for(const id of selected) {
      const script=join(root,'plugin/lifecycle/tools',id,`${action}.mjs`);
      const result=await (await import(pathToFileURL(script))).default(context(id,project??'system',action,'check'));
      toolResults.push({tool:id,operation:action,scope:project??'system',...result});
    }
    return {action,mode,root,home,agentHome,explicitProfile:profile.explicitProfile,project,toolResults};
  }
  const affectedScopes = action === 'uninstall-system' ? ['system',...receipt.projects] : [project ?? 'system'];
  for (const staging of receipt.resources.filter(r=>r.kind === 'staging' && affectedScopes.includes(r.scope))) {
    await noSymlinks(staging.path); await rm(staging.path,{recursive:true,force:true});
    receipt.resources = receipt.resources.filter(r=>r !== staging); await save();
  }
  let backup, backupConfigurationHashes;
  if (action === 'configure-project' && values.resetProject) {
    await settleConfiguration({receipt,save,noSymlinks},project);
    const preserved = await backupProject({receipt,exists,noSymlinks,save,onBackup:values.onBackup},project);
    backup = preserved.path; backupConfigurationHashes = preserved.configurationHashes;
  }
  if (action === 'install') {
    // Files in the owned namespace are inert until selected/configured.
    const installed = join(root, 'plugin');
    if (!await exists(installed)) {
      const pending = join(root, '.plugin-pending');
      await rm(pending, { recursive: true, force: true });
      await cp(sourcePlugin, pending, { verbatimSymlinks: true, recursive: true });
      await rename(pending, installed);
      if(receipt.nativeInstallation) {
        releaseSource={repository:receipt.nativeInstallation.repository,commit:receipt.nativeInstallation.commit};
      } else if(values['release-repo']) {
        if(!/^[0-9a-f]{40,64}$/.test(values['release-commit']??'') || values['release-repo'].startsWith('-')) throw Error('Invalid release repository reference');
        releaseSource={repository:values['release-repo'],commit:values['release-commit']};
      } else releaseSource={directory:resolve(sourcePlugin,'..')};
      await writeFile(join(root,'source.json'),encode(releaseSource),{mode:0o600});
    }

  }
  const toolResults = [];
  const invoke = async (id, operation, scope) => {
    const script = join(operation === 'install' ? sourcePlugin : join(root, 'plugin'), 'lifecycle/tools', id, `${operation}.mjs`);
    let result;
    if(operation.startsWith('uninstall')) {
      const specs=await nativeConfiguration({...hostContext,agent:host.agent,scope,fragments:(receipt.fragments??[]).filter(f=>f.owner===id),bindings:receipt.bindings,removal:true});
      const configurations=(receipt.configurations??[]).filter(r=>r.scope===scope).map(r=>({...r,entries:r.entries.filter(e=>specs.some(s=>s.path===r.path&&s.entries.some(x=>JSON.stringify(x.keys)===JSON.stringify(e.keys))))}));
      removalChecks.set(`${id}:${scope}`,removalEvidence({resources:receipt.resources.filter(r=>r.owner===id),configurations},[scope]));
    }
    try { result = await (await import(pathToFileURL(script))).default(context(id, scope, operation)); }
    catch(error) { throw Error(`${id} ${operation}: ${error.message}`); }
    const status = result?.status ?? 'completed';
    if (!['completed', 'configured', 'skipped'].includes(status)) throw Error(`Invalid lifecycle result: ${id} ${operation}`);
    toolResults.push({ tool: id, operation, scope, status, ...(result?.details?{details:result.details}:{}) });
    if(status !== 'skipped' && operation==='install' && !receipt.installedTools.includes(id)) { receipt.installedTools.push(id); await save(); }
    console.log(`${status === 'skipped' ? 'Skipped' : 'Completed'}: ${id} ${operation}${scope === 'system' ? '' : ' in '+scope}`);
  };
  const removed = action.startsWith('uninstall') ? removalEvidence(receipt,action === 'uninstall-system' ? ['system',...receipt.projects] : [project]) : undefined;
  if(action.startsWith('uninstall')) {
    const scope=project ?? 'system';
    await settleConfiguration({receipt,save,noSymlinks},scope);
    await checkConfiguration({receipt,noSymlinks},scope);
  }
  if (action === 'uninstall-system') {
    for (const path of [...receipt.projects]) {
      await settleConfiguration({receipt,save,noSymlinks},path);
      await checkConfiguration({receipt,noSymlinks},path);
      // A missing project needs no writes; inaccessible paths still fail explicitly.
      for (const id of receipt.tools) await invoke(id, 'uninstall-project', path);
      await finalize(path);
      for(const id of receipt.tools) await (await import(pathToFileURL(join(root,'plugin/lifecycle/tools',id,'uninstall-project.mjs')))).default(context(id,path,'uninstall-project','check'));
      receipt.projects.splice(receipt.projects.indexOf(path), 1); await save();
    }
  }
  if (action === 'install' || action === 'configure-system') { receipt.tools = selected; await save(); }
  for (const id of selected) {
    // Adding a deferred tool remains part of configure-system, not another client action.
    if (action === 'configure-system' && !receipt.installedTools.includes(id)) await invoke(id, 'install', 'system');
    await invoke(id, action, project ?? 'system');
  }
  // Plugin finalization follows all tool actions.
  await finalize(project ?? 'system');
  for (const complete of afterConfiguration) await complete();
  for(const id of selected) {
    const result=await (await import(pathToFileURL(join(root,'plugin/lifecycle/tools',id,`${action}.mjs`)))).default(context(id,project??'system',action,'check'));
    const item=toolResults.findLast(r=>r.tool===id&&r.operation===action); if(item) item.verification=result?.verification;
  }
  if (action === 'install') {
    await noSymlinks(agentHome);
    await mkdir(agentHome, { recursive: true, mode: 0o700 });
    receipt.native = true; await save();
    if (!receipt.nativeInstallation) await host.install(hostContext);
  }
  if (action === 'install' || action === 'configure-system') { receipt.tools = selected; await save(); }
  if (action === 'uninstall-project') { receipt.projects = receipt.projects.filter(p => p !== project); await save(); }
  if (action === 'uninstall-system') {
    // Tool cleanup is finished; subsequent retries need only the plugin's own finalizer.
    for (const scope of new Set(receipt.resources.filter(r=>r.kind==='parent').map(r=>r.scope))) await pruneParents(scope);
    receipt.tools = []; receipt.installedTools = []; await save();
    if (receipt.native && !preserveNativeRegistration) removed.nativePaths = await host.uninstall({ ...hostContext, nativeInstallation: receipt.nativeInstallation }) ?? [];
    const plugin = join(root, 'plugin');
    // Keep the ordinary installed uninstall entry available while payload removal can fail.
    if (await exists(plugin)) {
      for (const entry of await readdir(plugin)) if (entry !== 'lifecycle' && entry !== 'release.json') await rm(join(plugin, entry), { recursive: true });
    }
    for (const entry of await readdir(root)) if (entry !== 'ownership.json' && entry !== 'plugin') await rm(join(root, entry), { recursive: true });
    await rm(plugin, { recursive: true, force: true });
    await rm(receiptPath);
    await rmdir(root);
  }
  if (values.native) { if (removed) await verifyRemoval(removed); else await verifyReceipt(receipt,project ?? 'system'); }
  console.log(`${action}: complete. Restart the agent to refresh discovery.`);
  return { action, root, home, agentHome, explicitProfile:profile.explicitProfile, project, backup, removed, tools: [...receipt.tools], toolResults, ...(receipt.nativeInstallation ? { nativeInstallation: receipt.nativeInstallation } : {}) };
}
