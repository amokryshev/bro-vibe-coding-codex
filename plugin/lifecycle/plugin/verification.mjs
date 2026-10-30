import { readFile, lstat, realpath, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse } from './vendor/smol-toml/index.js';
import * as host from './host.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch(e) { if(e.code === 'ENOENT') return false; throw e; } };
const document = async record => { const text = await readFile(record.path,'utf8'); return record.format === 'json' ? JSON.parse(text) : parse(text); };
const valueAt = (doc,keys) => keys.reduce((at,key)=>at?.[key],doc);

export async function verifyReceipt(receipt, scope) {
  for (const resource of receipt.resources.filter(r=>r.scope === scope && r.kind !== 'parent')) {
    if (resource.resetPending) throw Error(`Incomplete project setup: ${resource.path}`);
    if (!await exists(resource.path)) throw Error(`Missing managed resource: ${resource.path}`);
    const files = resource.kind === 'directory' ? Object.entries(resource.files ?? {}).map(([name,hash])=>[join(resource.path,name),hash]) : [[resource.path,resource.hash]];
    for (const [path,hash] of files) {
      if (hash?.startsWith('link:')) { if(await readlink(path) !== hash.slice(5)) throw Error(`Managed symlink differs: ${path}`); continue; }
      if ((await lstat(path)).isSymbolicLink()) throw Error(`Managed file became a symbolic link: ${path}`);
      if (hash && digest(await readFile(path)) !== hash) throw Error(`Managed file differs: ${path}`);
    }
  }
  for (const record of receipt.configurations ?? []) {
    if (record.scope !== scope) continue;
    if (record.pending) throw Error(`Incomplete native configuration: ${record.path}`);
    const doc = await document(record);
    for (const entry of record.entries) {
      const value = valueAt(doc,entry.keys);
      if ('append' in entry ? !Array.isArray(value) || !value.some(v=>equal(v,entry.append)) : !equal(value,entry.value)) throw Error(`Missing or changed native setting: ${record.path}: ${entry.keys.join('.')}`);
    }
  }
}

export function removalEvidence(receipt, scopes) {
  return {
    files:receipt.resources.filter(r=>scopes.includes(r.scope) && r.kind !== 'parent').flatMap(r=>r.kind === 'directory' && r.files ? Object.keys(r.files).map(name=>join(r.path,name)) : [r.path]),
    settings:(receipt.configurations ?? []).filter(r=>scopes.includes(r.scope)).flatMap(r=>r.entries.map(e=>({path:r.path,format:r.format,keys:e.keys,...('append' in e ? {appendHash:digest(JSON.stringify(e.append))} : {})}))),
  };
}
export async function verifyRemoval(evidence) {
  for (const path of [...evidence.files,...(evidence.nativePaths ?? [])]) if (await exists(path)) throw Error(`Managed resource remains after removal: ${path}`);
  for (const entry of evidence.settings) {
    if (!await exists(entry.path)) continue;
    const value = valueAt(await document(entry),entry.keys);
    if (entry.appendHash ? Array.isArray(value) && value.some(v=>digest(JSON.stringify(v)) === entry.appendHash) : value !== undefined) throw Error(`Managed setting remains after removal: ${entry.path}`);
  }
}
export async function verifyResetRegistration(step) {
  // Some hosts repair missing caches even during list commands. Check saved paths first.
  if (!step.nativeInstallation?.marketplaceRoot || !await exists(step.nativeInstallation.marketplaceRoot)) throw Error('Reset marketplace checkout is missing');
  const sourcePlugin = step.nativePluginPath ?? await host.installedPluginDirectory(step);
  const skill = await readFile(join(sourcePlugin, 'skills/setup-bro/SKILL.md'), 'utf8');
  if (!/^name: setup-bro$/m.test(skill)) throw Error('Reset plugin does not expose setup-bro');
  const actual = await host.inspectInstallation({ ...step, sourcePlugin });
  for (const key of ['repository', 'commit', 'version', 'selector', 'marketplace', 'marketplaceRoot']) {
    if (actual[key] !== step.nativeInstallation?.[key]) throw Error(`Reset plugin identity differs: ${key}`);
  }
  return actual;
}
export async function verifyResult(report) {
  if (report.schema !== 'bro.installer-result/v1' || report.status !== 'completed' || !report.steps?.length) throw Error('Installer has not completed successfully');
  for (const step of report.steps) {
    if (!step) throw Error('Installer returned no verification evidence');
    const reset=report.removalMode==='reset' && step.action==='uninstall-system';
    if (step.removed) await verifyRemoval(reset?{...step.removed,nativePaths:[]}:step.removed);
    if (step.action === 'uninstall-system') {
      if (await exists(step.root)) throw Error('Installation root remains after system removal');
      if (reset) {
        const actual = await verifyResetRegistration(step);
        // Older reports recorded a fresh registration; new resets retain it.
        const registration = step.preserved ?? step.restored;
        if (!registration || registration.commit !== actual.commit) throw Error('Reset registration has not been verified');
      } else {
        if (await host.isInstalled(step)) throw Error('Native plugin remains registered');
        if(step.nativeInstallation && step.removed?.nativePaths?.includes(step.nativeInstallation.marketplaceRoot)) await host.verifyMarketplaceRemoved(step);
      }
    } else if (!step.alreadyRemoved) {
      const receipt = JSON.parse(await readFile(join(step.root,'ownership.json'),'utf8'));
      if (step.action !== 'uninstall-project') {
        if (!await host.isInstalled(step)) throw Error('Native plugin is not registered');
        await verifyReceipt(receipt,step.project ?? 'system');
        const {run}=await import('./runtime.mjs');
        await run(step.action,{home:step.home,root:step.root,project:step.project,mode:'check','agent-home':step.agentHome});
      } else if (receipt.projects.includes(step.project)) throw Error('Project remains registered');
    }
  }
  console.log('Проверка пройдена: ресурсы и штатная регистрация соответствуют выполненным действиям.');
}
