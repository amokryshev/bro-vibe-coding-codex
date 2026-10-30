import {mkdtemp,cp,mkdir,readFile,writeFile,rename,lstat,realpath,rmdir} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import * as host from './host.mjs';
import {run} from './runtime.mjs';
import {removalEvidence,verifyResult,verifyRemoval,verifyResetRegistration} from './verify.mjs';
import {resolveProfile} from './profile.mjs';

const json=async path=>JSON.parse(await readFile(path,'utf8'));
const exists=async path=>{try {await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function canonical(path) {
  const missing=[];let at=resolve(path);
  while(!await exists(at)){missing.unshift(at.slice(dirname(at).length+1));at=dirname(at);}
  return join(await realpath(at),...missing);
}
async function noSymlinks(path) {
  for(let at=resolve(path);;at=dirname(at)) {
    if(await exists(at) && (await lstat(at)).isSymbolicLink())throw Error(`Symbolic link in managed path: ${at}`);
    if(at===dirname(at))break;
  }
}
const save=async (path,value)=>{
  await noSymlinks(path);await noSymlinks(path+'.pending');
  await writeFile(path+'.pending',JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(path+'.pending',path);
};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const command=(script,...args)=>[process.execPath,script,...args].map(quote).join(' ');

// The only durable data here describes this removal. It never becomes a new
// installation ledger and never replays a completed deletion over a fresh install.
export async function removeSystem(options,mode,report,resultFile) {
  const home=await realpath(resolve(options.home??homedir()));
  const agentHome=await canonical(options['agent-home']??(options.home?join(home,host.profileDirectory):process.env[host.profileEnvironment]??join(home,host.profileDirectory)));
  const root=await canonical(options.root),sourcePlugin=resolve(import.meta.dirname,'../..');
  const ctx={home,agentHome,root,sourcePlugin,exists,noSymlinks};
  const receipt=await exists(join(root,'ownership.json'))?await json(join(root,'ownership.json')):null;
  Object.assign(ctx,resolveProfile({agent:host.agent,home,agentHome,explicitProfile:receipt?.explicitProfile??(options['agent-home']?true:undefined)}));
  if(!receipt && await exists(root))throw Error('Installation root exists without BRO ownership; preserve it or continue the original removal journal');
  if(receipt && (receipt.root!==root||receipt.home!==home||receipt.agentHome!==agentHome))throw Error('Installation belongs to another home, profile or path');
  const resetIdentity=mode==='reset'&&receipt?.nativeInstallation
    ? await verifyResetRegistration({...ctx,nativeInstallation:receipt.nativeInstallation,nativePluginPath:sourcePlugin}) : null;
  const registered=resetIdentity?true:await host.isInstalled(ctx);
  const nativeInstallation=resetIdentity??(registered?await host.inspectInstallation(ctx):receipt?.nativeInstallation);
  if(mode==='reset'&&(!registered||!nativeInstallation))throw Error('Reset needs the existing native marketplace and plugin registration');
  const session=await realpath(await mkdtemp(join(tmpdir(),'bro-removal-')));
  const plugin=join(session,'plugin'),executor=join(plugin,'lifecycle/plugin');
  const stateFile=join(session,'removal.json');
  resultFile=await canonical(resultFile??join(session,'result.json'));
  // TMPDIR is user-controlled: the executor/journal must survive too, even
  // when --result-file already points outside the installation.
  const removedDirectories=[root,sourcePlugin,nativeInstallation?.marketplaceRoot,
    ...(receipt?.resources??[]).filter(r=>['directory','staging'].includes(r.kind)).map(r=>r.path)].filter(Boolean);
  for(const directory of removedDirectories) for(const path of [session,resultFile]) {
    const within=relative(directory,path);
    if(!(within==='..'||within.startsWith('../')||isAbsolute(within)))throw Error('Removal temporary directory and result must be outside all removed resources; choose another TMPDIR');
  }
  await mkdir(dirname(executor),{recursive:true});
  await cp(import.meta.dirname,executor,{recursive:true,verbatimSymlinks:true});
  await cp(join(sourcePlugin,'release.json'),join(plugin,'release.json'));
  const step={action:'uninstall-system',root,home,agentHome,explicitProfile:ctx.explicitProfile,nativeInstallation,nativePluginPath:sourcePlugin,
    removed:receipt?removalEvidence(receipt,['system',...receipt.projects]):{files:[],settings:[]}};
  if(nativeInstallation&&mode==='full')step.removed.nativePaths=await host.removalPaths({...ctx,nativeInstallation});
  report={...report,root,removalMode:mode,removalJournal:stateFile,steps:[],continuation:command(join(executor,'system-removal.mjs'),'--resume',stateFile),
    verification:command(join(executor,'verify.mjs'),'--result-file',resultFile)};
  const state={schema:'bro.system-removal/v2',phase:'removing',mode,step,receiptId:receipt?.id??null,projects:receipt?.projects??[],sourcePlugin,resultFile,report};
  await save(stateFile,state);await save(resultFile,report);
  console.log(`Removal result: ${resultFile}\nContinue removal: ${report.continuation}\nVerification command: ${report.verification}`);
  const result=spawnSync(process.execPath,[join(executor,'system-removal.mjs'),'--resume',stateFile],{stdio:'inherit'});
  if(result.error)throw result.error;
  const outcome=await json(resultFile);
  if(result.status!==0)throw Object.assign(Error(outcome.error??'Removal interrupted; use the printed continuation command'),{removalReport:outcome});
  return outcome;
}

async function resume(stateFile) {
  const state=await json(stateFile);
  if(state.schema!=='bro.system-removal/v2'||!['full','reset'].includes(state.mode))throw Error('Invalid removal journal; use the executor saved with that journal');
  const {step,report}=state;
  const ctx={...step,exists,noSymlinks,sourcePlugin:state.sourcePlugin};
  const checkpoint=async()=>{await save(stateFile,state);await save(state.resultFile,report);};
  if(state.phase==='completed') {await verifyResult(report);await save(state.resultFile,report);return;}
  try {
    report.status='running';delete report.error;await checkpoint();
    if(state.mode==='reset')await verifyResetRegistration(step);
    if(state.phase==='removing') {
      if(step.nativeInstallation && await host.isInstalled(ctx)) {
        const actual=await host.inspectInstallation(ctx);
        for(const key of ['repository','commit','version']) if(actual[key]!==step.nativeInstallation[key]) throw Error('Another native release replaced the removal target');
      }
      // A new installation must never be adopted by an old continuation.
      const receiptPath=join(step.root,'ownership.json');
      if(await exists(receiptPath)) {
        const receipt=await json(receiptPath);
        if(state.receiptId!==receipt.id)throw Error('Another BRO installation replaced the removal target');
      }
      report.activeStep='uninstall-system';await checkpoint();
      await run('uninstall-system',{home:step.home,'agent-home':step.agentHome,root:step.root,native:true,inspectionSource:state.sourcePlugin,preserveNativeRegistration:state.mode==='reset'});
      // The process can stop between unlinking ownership and rmdir(root).
      // Only an empty directory may be finished using the retained journal.
      if(state.receiptId && await exists(step.root)&&!await exists(receiptPath))await rmdir(step.root);
      // Verify the original inventory, including entries already removed by a
      // previous interrupted attempt, while retaining the registration on reset.
      report.steps=[step];report.status='completed';delete report.activeStep;
      if(state.mode==='reset') {
        await verifyRemoval(step.removed);
        if(await exists(step.root))throw Error('Installation root remains after reset');
      } else await verifyResult(report);
      state.phase='cleaned';report.completedProjects=state.projects;report.remainingProjects=[];report.status='running';await checkpoint();
    }
    if(state.mode==='reset') {
      await verifyRemoval({...step.removed,nativePaths:[]});
      if(await exists(step.root))throw Error('Installation root reappeared after removal');
      report.activeStep='verify-registration';await checkpoint();
      step.preserved=await verifyResetRegistration(step);
    }
    report.status='completed';report.steps=[step];delete report.activeStep;
    await verifyResult(report);
    state.phase='completed';report.finishedAt=new Date().toISOString();await checkpoint();
    console.log(`Verification command: ${report.verification}`);
  }catch(error){
    // A verified completed journal is authoritative even if publishing the
    // separate result file failed. Resume verifies it and retries publication.
    if(state.phase!=='completed') {
      report.status='failed';report.error=error.message;
      const receiptPath=join(step.root,'ownership.json');
      if(await exists(receiptPath)) {
        const remaining=(await json(receiptPath)).projects??[];
        report.completedProjects=state.projects.filter(p=>!remaining.includes(p));
        report.remainingProjects=remaining;
      }
      await checkpoint();
    }
    console.error(`Continue removal: ${report.continuation}`);throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(await realpath(resolve(process.argv[1]))).href){
  try {const {values}=parseArgs({options:{resume:{type:'string'}}});if(!values.resume)throw Error('--resume is required');await resume(resolve(values.resume));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
