import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export function compatible(ctx,candidate) {
  const { command,args=[] }=candidate.definition;
  const at=args.indexOf('--project');
  return !!command && args.some(a=>typeof a==='string'&&/\/payload\/email\/launch\.mjs$/.test(a))
    && at>=0 && args[at+1]===ctx.project && args.includes('--runtime-home');
}
export async function select(ctx) {
  const inventory=await ctx.mcpInventory();
  const canonical = inventory.find(c => c.name === 'bro-email' && c.scope === (ctx.project ?? 'system'));
  // The canonical name is reserved for this Tool in the configured scope.
  if (canonical && !canonical.owned) return undefined;
  const candidates=inventory.filter(c=>compatible(ctx,c));
  const unknown=inventory.some(candidate=>{
    const args=candidate.definition.args??[],at=args.indexOf('--project');
    const knownOtherProject=args.some(arg=>typeof arg==='string'&&/\/payload\/email\/launch\.mjs$/.test(arg))
      &&at>=0&&typeof args[at+1]==='string'&&args[at+1]!==ctx.project;
    return /email|mail/i.test(candidate.name)&&!knownOtherProject&&!compatible(ctx,candidate);
  });
  if(!candidates.length&&unknown&&ctx.settings.createNewMcp!==true)throw Error('Existing Email MCP compatibility is unknown; select a compatible server, skip this Tool, or explicitly set createNewMcp to create a separate registration');
  const saved=ctx.mcpBinding();
  let chosen=canonical ?? (saved&&candidates.find(c=>c.name===saved.name&&c.fingerprint===saved.fingerprint));
  if(saved&&!chosen&&saved.mode==='borrowed'&&!ctx.settings.mcpServer) throw Error('Selected Email MCP changed or disappeared');
  if(ctx.settings.mcpServer) {
    chosen=candidates.find(c=>c.name===ctx.settings.mcpServer);
    if(!chosen)throw Error('Requested Email MCP is not a compatible visible server');
  } else if(!chosen) {
    const external=candidates.filter(c=>!c.owned),choices=external.length?external:candidates;
    if(choices.length===1) chosen=choices[0];
    else if(choices.length>1) {
      const name=await ctx.ask('Select existing Email MCP: '+choices.map(c=>c.name).join(', '));
      chosen=choices.find(c=>c.name===name);if(!chosen)throw Error('Ambiguous Email MCP selection');
    }
  }
  if(chosen&&!chosen.enabled)throw Error('Selected Email MCP is disabled; enable it in the host');
  if(chosen&&!chosen.owned&&[chosen.definition.command,...(chosen.definition.args??[])].some(value=>typeof value==='string'&&value.startsWith(ctx.root+'/')))throw Error('Unowned Email MCP depends on this installation; repair its ownership or select an independent runtime');
  for(const duplicate of candidates.filter(c=>c.owned&&c.scope===ctx.project&&c.name!==chosen?.name)) if(ctx.mcpReferenced(duplicate))throw Error(`Email duplicate ${duplicate.name} is referenced by another project`);
  return chosen;
}
export async function checkCandidate(ctx,candidate) {
  if(!candidate.enabled)throw Error('Email MCP is disabled');
  if(!ctx.mcpToolAllowed(candidate,'list_accounts'))throw Error('Email MCP list_accounts is denied by the host policy');
  const payload=join(ctx.root,'plugin/payload/email');
  const {loadEmailEnvironment}=await import(pathToFileURL(join(payload,'environment.mjs')));
  const {createEmailConnectionProbe}=await import(pathToFileURL(join(payload,'connection-probe.mjs')));
  const environment=ctx.nativeEnvironment();
  const account=await loadEmailEnvironment(ctx.project,environment);
  const effective=await loadEmailEnvironment(ctx.project,{...environment,...candidate.definition.env});
  if(!isDeepStrictEqual(effective,account))throw Error('Existing Email MCP uses a different account or destination policy; choose its configuration explicitly');
  const discovered=await ctx.discoverMcp(candidate.name);
  if(ctx.agent==='claude'?!discovered?.connected:!discovered?.serverInfo||discovered.toolsError||!Object.keys(discovered.tools??{}).length)throw Error('Email MCP is unavailable in native host discovery');
  const {initialized,results}=await ctx.probeMcp(candidate.definition,[{method:'tools/list'},{method:'tools/call',params:{name:'list_accounts',arguments:{}}}]);
  if(!/email/i.test(initialized.serverInfo?.name??'')||!results[0]?.tools?.some(t=>t.name==='list_accounts')||results[1]?.isError)throw Error('Email MCP protocol/account check failed');
  const accounts=results[1]?.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??'';
  if(!accounts.split('\n').some(line=>/^• [^:]+: (\S+)(?: \(.*\))?$/.exec(line)?.[1]===account.environment.MCP_EMAIL_ADDRESS))throw Error('Email MCP account catalog differs from the selected project account');
  const result=await createEmailConnectionProbe().test({target_id:'target:sha256:'+createHash('sha256').update(ctx.project).digest('hex'),configuration:account.environment,destination_policy:{private_endpoints:account.privateEndpoints},runtime:{start:async()=>{}}});
  if(!result.ok)throw Error(`Email connection verification failed: ${result.reason_code}`);
}
export async function verify(ctx) {
  await ctx.checkState();
  const binding=ctx.mcpBinding();
  if(!binding){
    if((await ctx.inspectState()).configured)throw Error('Email configuration has no saved MCP binding; configure it first');
    return {status:'skipped',verification:'not-configured'};
  }
  const candidates=(await ctx.mcpInventory()).filter(c=>compatible(ctx,c));
  const candidate=candidates.find(c=>c.name===binding.name);
  if(!candidate||candidate.fingerprint!==binding.fingerprint)throw Error('Email MCP binding is missing or changed');
  if(candidates.some(c=>c.owned&&c.scope===ctx.project&&c.name!==binding.name))throw Error('Owned Email MCP duplicates remain');
  await checkCandidate(ctx,candidate);
  return {status:'completed',verification:'passed'};
}
