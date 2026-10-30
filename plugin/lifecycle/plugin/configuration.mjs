import { readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { parse, stringify } from './vendor/smol-toml/index.js';

const hash = text => createHash('sha256').update(text ?? '').digest('hex');
async function read(path) { try { return await readFile(path, 'utf8'); } catch (e) { if(e.code === 'ENOENT') return null; throw e; } }
async function identity(path) {
  try { const s=await lstat(path); if(!s.isFile() || s.nlink!==1) throw Error(`Unsafe native configuration file: ${path}`); return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode]; }
  catch(e) {if(e.code==='ENOENT') return null; throw e;}
}
function parent(doc, keys, create = false, created = []) {
  let at = doc;
  for (const [index,key] of keys.slice(0,-1).entries()) {
    if (['__proto__','constructor','prototype'].includes(key)) throw Error('Invalid configuration key');
    if (!(key in at)) { if (!create) return; at[key] = {}; created.push(keys.slice(0,index+1)); }
    if (!at[key] || typeof at[key] !== 'object' || Array.isArray(at[key])) throw Error(`Configuration conflict: ${keys.join('.')}`);
    at = at[key];
  }
  return at;
}
function prune(doc, paths) {
  for(const keys of [...paths].reverse()) {
    const at=parent(doc,keys), key=keys.at(-1);
    if(at?.[key] && typeof at[key]==='object' && !Object.keys(at[key]).length) delete at[key];
  }
}
function remove(doc, entry, replaceChanged = false) {
  const at=parent(doc,entry.keys), key=entry.keys.at(-1);
  if (!at || !(key in at)) return;
  if ('append' in entry) {
    if (!Array.isArray(at[key])) throw Error(`Owned configuration changed: ${entry.keys.join('.')}`);
    at[key] = at[key].filter(value => !equal(value,entry.append));
    if (!at[key].length && !entry.hadArray) delete at[key];
  } else {
    if (!replaceChanged && !equal(at[key],entry.value)) throw Error(`Owned configuration changed: ${entry.keys.join('.')}`);
    delete at[key];
  }
  prune(doc,entry.parents??[]);
}
function add(doc, entry) {
  const parents=[]; const at=parent(doc,entry.keys,true,parents), key=entry.keys.at(-1);
  if (['__proto__','constructor','prototype'].includes(key)) throw Error('Invalid configuration key');
  if ('append' in entry) {
    const hadArray=key in at;
    if (hadArray && !Array.isArray(at[key])) throw Error(`Configuration conflict: ${entry.keys.join('.')}`);
    if (at[key]?.some(value=>equal(value,entry.append))) return null;
    (at[key]??=[]).push(entry.append);
    return {...entry,hadArray,parents};
  }
  if (key in at && !entry.replace) {
    if (!entry.exclusive && equal(at[key],entry.value)) return null; // Pre-existing equal values remain foreign.
    throw Error(`Configuration conflict: ${entry.keys.join('.')}`);
  }
  if (entry.replace) delete at[key];
  at[key]=entry.value; return {...entry,parents};
}

// One plugin finalizer owns each native file; tools never race to edit shared settings.
export async function settleConfiguration(ctx, scope) {
  const records=ctx.receipt.configurations??=[];
  for(const record of [...records]) {
    if(record.scope !== scope || !record.pending) continue;
    await ctx.noSymlinks(record.path);
    const current=hash(await read(record.path));
    const index=records.indexOf(record);
    if(current===record.pending.afterHash) delete record.pending;
    else if(current===record.pending.beforeHash) {
      if(record.pending.before) records[index]=record.pending.before;
      else records.splice(index,1);
    } else throw Error(`Configuration changed during an unfinished write: ${record.path}`);
    const pending=`${record.path}.bro-pending`;await ctx.noSymlinks(pending);await rm(pending,{force:true});
    await ctx.save();
  }
}

export async function checkConfiguration(ctx,scope) {
  for(const record of ctx.receipt.configurations??[]) {
    if(record.scope!==scope) continue;
    await ctx.noSymlinks(record.path);
    const text=await read(record.path);
    const doc=text===null?{}:record.format==='json'?JSON.parse(text):parse(text);
    for(const entry of record.entries??[]) remove(doc,entry);
  }
}

export async function applyConfiguration(ctx, scope, specifications) {
  const records=ctx.receipt.configurations??=[];
  const paths=new Set([...records.filter(r=>r.scope===scope).map(r=>r.path), ...specifications.map(s=>s.path)]);
  const plans=[];
  for(const path of paths) {
    await ctx.noSymlinks(path);
    let old=records.find(r=>r.scope===scope && r.path===path);
    const recorded=old, recovering=!!old?.pending;
    const pendingPath=`${path}.bro-pending`;
    await ctx.noSymlinks(pendingPath);
    const pendingText=await read(pendingPath);
    if(pendingText!==null && !recovering) throw Error(`Foreign temporary configuration file: ${pendingPath}`);
    const beforeIdentity=await identity(path), text=await read(path);
    if(ctx.expectedHashes && path in ctx.expectedHashes && (text === null ? null : hash(text)) !== ctx.expectedHashes[path]) throw Error(`Native configuration changed since project backup: ${path}`);
    if(old?.pending) {
      const current=hash(text);
      if(current===old.pending.beforeHash) old=old.pending.before;
      else if(current!==old.pending.afterHash) throw Error(`Configuration changed during an unfinished write: ${path}`);
    }
    const spec=specifications.find(s=>s.path===path), format=spec?.format??old?.format??recorded?.format;
    if (!format) continue;
    const doc=text===null?{}:format==='json'?JSON.parse(text):parse(text);
    for(const entry of [...(old?.entries??[])].reverse()) remove(doc,entry,ctx.replaceChanged || spec?.entries.some(next => next.replace && equal(next.keys,entry.keys)));
    const entries=[];
    for(const entry of spec?.entries??[]) { const owned=add(doc,entry); if(owned) entries.push(owned); }
    const created=old?.created??recorded?.created??text===null;
    const result=(created || text===null) && !Object.keys(doc).length ? null : format==='json'?JSON.stringify(doc,null,2)+'\n':stringify(doc);
    plans.push({path,format,scope,entries,created,text,result,old,recovering,pendingText,beforeIdentity});
  }
  // Preflight every file before mutating the first one.
  for(const plan of plans) {
    const {path,format,scope,entries,created,text,result,old,recovering,pendingText,beforeIdentity}=plan;
    if(text===result && !old && !entries.length && !recovering) continue;
    if(result!==null) await ctx.ensureParents(path,scope,'plugin-configuration');
    let index=records.findIndex(r=>r.path===path && r.scope===scope);
    const next={path,format,scope,entries,created,pending:{beforeHash:hash(text),afterHash:hash(result),before:old?{...old,pending:undefined}:null}};
    if(index<0) { records.push(next); index=records.length-1; } else records[index]=next;
    await ctx.save();
    const pending=`${path}.bro-pending`;
    await ctx.noSymlinks(pending);
    if(pendingText!==null && recovering) await rm(pending);
    let temporaryCreated=false, changed=false;
    const unchanged=async()=>{
      await ctx.noSymlinks(path);
      if(!equal(await identity(path),beforeIdentity) || await read(path)!==text) throw Error(`Native configuration changed during write: ${path}`);
    };
    try {
      if(result===null) { await unchanged(); await rm(path,{force:true}); }
      else { await writeFile(pending,result,{mode:beforeIdentity ? beforeIdentity.at(-1)&0o777 : 0o600,flag:'wx'}); temporaryCreated=true;
        await unchanged(); await rename(pending,path); }
      changed=true;
    } catch(error) {
      // No native write occurred: discard only this intent, retaining prior ownership.
      if(!changed) { const at=records.indexOf(next); if(old) records[at]=old; else records.splice(at,1); await ctx.save(); }
      throw error;
    } finally { if(temporaryCreated) await rm(pending,{force:true}); }
    delete next.pending;
    if(!entries.length) records.splice(records.indexOf(next),1);
    await ctx.save();
  }
}
