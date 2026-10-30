import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from './vendor/smol-toml/index.js';
import { resolveProfile } from './profile.mjs';
import { bindingFor } from './mcp-configuration.mjs';

function matches(pattern, name) {
  const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(name);
}

export async function nativeConfiguration({agent, agentHome, home, explicitProfile, root, scope, fragments, bindings = [], removal = false}) {
  const system=scope==='system';
  const serverName = name => bindingFor(bindings, name.replace(/^bro-/,''), scope)?.name ?? name;
  const mcpConfigPath = home ? resolveProfile({agent, agentHome, home, explicitProfile}).mcpConfigPath : join(agentHome,agent === 'codex'?'config.toml':'.claude.json');
  const selected=structuredClone(fragments.filter(f=>f.scope===scope)).sort((a,b)=>Number(!!a.value.permissions)-Number(!!b.value.permissions)||a.owner.localeCompare(b.owner));
  let localServers={};
  if(agent==='claude' && !system) {
    try { localServers=JSON.parse(await readFile(mcpConfigPath,'utf8')).projects?.[scope]?.mcpServers??{}; }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  const files=[];
  function entry(path,format,keys,value,append=false,exclusive=keys[0]==='mcp_servers' || keys[0]==='mcpServers') {
    let file=files.find(f=>f.path===path);
    if(!file) files.push(file={path,format,entries:[]});
    const replace = exclusive && ((keys.length === 2 && ['mcp_servers','mcpServers'].includes(keys[0])) || (keys.length === 4 && keys[0] === 'projects' && keys[2] === 'mcpServers')) && ['bro-atlassian','bro-playwright','bro-email'].includes(keys.at(-1));
    file.entries.push({keys,...(replace ? {replace:true}:{}),...(exclusive ? {exclusive:true}:{}),...(append?{append:value}:{value})});
  }
  const config=agent==='codex'?join(system?agentHome:join(scope,'.codex'),'config.toml'):join(system?agentHome:join(scope,'.claude'),'settings.json');
  for (const {value} of selected) {
    for (const command of value.commandPermissions ?? []) {
      if (agent !== 'claude') throw Error('Shell permission settings require the Claude host');
      entry(config, 'json', ['permissions', 'allow'], `Bash(${command} *)`, true);
    }
    for(const [logicalName,definition] of Object.entries(value.mcp??{})) {
      if(bindingFor(bindings,logicalName.replace(/^bro-/,''),scope)?.mode === 'borrowed') continue;
      const name=serverName(logicalName);
      if(!name.startsWith('bro-')) throw Error('BRO MCP servers must use the bro- namespace');
      if(agent==='codex') entry(config,'toml',['mcp_servers',name],definition);
      else if(!system && Object.hasOwn(localServers,name)) entry(mcpConfigPath,'json',['projects',scope,'mcpServers',name],definition.url?{type:'http',...definition}:{type:'stdio',...definition},false,true);
      else entry(system?mcpConfigPath:join(scope,'.mcp.json'),'json',['mcpServers',name],definition.url?{type:'http',...definition}:{type:'stdio',...definition});
    }
    for(const [event,hooks] of Object.entries(value.hooks??{})) {
      const path=agent==='codex'?join(system?agentHome:join(scope,'.codex'),'hooks.json'):config;
      for(const hook of hooks) entry(path,'json',['hooks',event],hook,true);
    }
    if(value.permissions) {
      if(system) throw Error('Permissions belong to a project');
      // Native transports must exist: permission-only Codex MCP tables are invalid.
      let existing={};
      const layers=[];
      if(agent==='codex') {
        for(const path of [join(agentHome,'config.toml'),config]) {
          try {
            const layer=parse(await readFile(path,'utf8')).mcp_servers??{};
            layers.push({path,servers:layer});
            for(const [name,value] of Object.entries(layer)) existing[name]={...existing[name],...value};
          } catch(e) {if(e.code!=='ENOENT') throw e;}
        }
      } else {
        for(const path of [join(agentHome,'settings.json'),config,join(scope,'.claude/settings.local.json')]) {
          try { layers.push(JSON.parse(await readFile(path,'utf8'))); }
          catch(e) {if(e.code!=='ENOENT') throw e;}
        }
      }
      const declared=Object.assign({},...selected.map(f=>f.value.mcp??{}));
      for(const [logicalName,policy] of Object.entries(value.permissions)) {
        const server=serverName(logicalName);
        const { claude_ask_patterns = [], ...nativePolicy } = policy;
        for(const pattern of claude_ask_patterns) {
          if(typeof pattern!=='string' || !/^[a-zA-Z0-9_*]+$/.test(pattern)
            || Object.entries(policy.tools??{}).some(([name,rule])=>rule.approval_mode==='approve' && matches(pattern,name)))
            throw Error(`Conflicting permission pattern: ${logicalName}`);
        }
        if(agent==='codex') {
          if(!(existing[server]?.url||existing[server]?.command||declared[logicalName])) continue;
          // Removal only identifies owned keys; it must not authorize new grants.
          for(const layer of removal ? [] : layers) {
            // The replaced registration's embedded policy is replaced with it.
            // Independent policy layers remain authoritative.
            if(files.some(file=>file.path===layer.path && file.entries.some(entry=>entry.replace && entry.keys.length===2 && entry.keys[0]==='mcp_servers' && entry.keys[1]===server))) continue;
            const prior=layer.servers[server];
            if(!prior) continue;
            if(['prompt','deny'].includes(prior.default_tools_approval_mode)
              && nativePolicy.default_tools_approval_mode !== prior.default_tools_approval_mode)
              throw Error(`Permission conflict: ${server} has a stricter default rule`);
            for(const [tool,rule] of Object.entries(policy.tools??{})) {
              const previous=prior.tools?.[tool]?.approval_mode ?? prior.default_tools_approval_mode;
              if(rule.approval_mode==='approve' && (previous==='prompt' || previous==='deny'))
                throw Error(`Permission conflict: ${server}.${tool} has a stricter ${previous} rule`);
              if(prior.enabled===false || prior.disabled_tools?.includes(tool) || prior.tools?.[tool]?.enabled===false
                || (prior.enabled_tools && !prior.enabled_tools.includes(tool))
                || (prior.default_tools_enabled===false && prior.tools?.[tool]?.enabled!==true))
                throw Error(`Permission conflict: ${server}.${tool} is disabled`);
            }
          }
          // When a tool in this scope owns the whole server, merge before recording ownership.
          const owned=files.flatMap(f=>f.entries).find(e=>e.keys.join('.')===`mcp_servers.${server}`);
          if(owned) Object.assign(owned.value,nativePolicy);
          else {
            for(const [key,val] of Object.entries(nativePolicy)) {
              if(key==='tools') {
                for(const [tool,rule] of Object.entries(val)) for(const [field,value] of Object.entries(rule))
                  entry(config,'toml',['mcp_servers',server,'tools',tool,field],value,false,false);
              } else entry(config,'toml',['mcp_servers',server,key],val,false,false);
            }
          }
        } else {
          if(!bindingFor(bindings,logicalName.replace(/^bro-/,''),scope)&&!declared[logicalName]) continue;
          const prefix = `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;
          for(const [tool,rule] of Object.entries(policy.tools??{})) {
            if(rule.approval_mode==='approve') for(const layer of removal ? [] : layers) {
              const strict=[...(layer.permissions?.deny??[]),...(layer.permissions?.ask??[])];
              if(strict.some(pattern=>pattern===prefix.slice(0,-2) || matches(pattern,prefix+tool)))
                throw Error(`Permission conflict: ${server}.${tool} has a stricter ask/deny rule`);
            }
            const list = { approve: 'allow', prompt: 'ask' }[rule.approval_mode];
            if(list) entry(config,'json',['permissions',list],prefix+tool,true);
          }
          for(const pattern of claude_ask_patterns) entry(config,'json',['permissions','ask'],prefix+pattern,true);
        }
      }
    }
  }
  return files;
}
