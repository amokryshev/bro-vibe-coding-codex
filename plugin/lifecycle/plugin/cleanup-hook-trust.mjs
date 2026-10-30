import { lstat, open, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parse, stringify } from './vendor/smol-toml/index.js';

async function snapshot(path, noSymlinks) {
  await noSymlinks(path);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw Error(`Unsafe hook trust file: ${path}`);
    const text = await handle.readFile('utf8');
    const named = await lstat(path);
    if (named.dev !== info.dev || named.ino !== info.ino) throw Error(`Hook trust file changed: ${path}`);
    return { text, mode: info.mode & 0o777, identity: [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.mode] };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}

async function listHooks(agentHome, home) {
  const child = spawn('codex', ['app-server', '--stdio'], {
    cwd: agentHome,
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: agentHome, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout }), pending = new Map();
  let nextId = 0, failure;
  const fail = error => { failure = error; for (const reject of pending.values()) reject(error); pending.clear(); };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', (code, signal) => fail(Error(`Codex hook discovery exited (${code ?? signal})`)));
  child.stderr.resume();
  const responders = new Map();
  lines.on('line', line => { try { const message = JSON.parse(line); responders.get(message.id)?.(message); } catch {} });
  const call = (method, params) => new Promise((resolveCall, rejectCall) => {
    if (failure) { rejectCall(failure); return; }
    const id = ++nextId;
    const finish = (error, message) => { clearTimeout(timer); pending.delete(id); responders.delete(id); error ? rejectCall(error) : resolveCall(message.result); };
    const timer = setTimeout(() => finish(Error(`Codex ${method} timed out`)), 15000);
    pending.set(id, error => finish(error));
    responders.set(id, message => finish(message.error ? Error(`Codex ${method} failed: ${message.error.message}`) : null, message));
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) finish(error); });
  });
  try {
    await call('initialize', { clientInfo: { name: 'bro_hook_trust_cleanup', version: '1' }, capabilities: { experimentalApi: true } });
    const result = await call('hooks/list', { cwds: [agentHome] });
    const row = result.data?.find(entry => entry.cwd === agentHome);
    if (!row || row.errors?.length) throw Error('Codex could not verify current hook definitions');
    return row.hooks;
  } finally { lines.close(); child.stdin.end(); child.kill(); }
}

// Native /hooks creates these records outside the configuration ledger. Remove only
// trust for a receipt-owned, unchanged live handler; never infer ownership from a key prefix.
export async function cleanupHookTrust({ agentHome, receipt, save, noSymlinks }) {
  const hooksPath = join(agentHome, 'hooks.json'), configPath = join(agentHome, 'config.toml');
  const records = receipt.configurations ?? [];
  const owned = records.filter(record => record.scope === 'system' && record.path === hooksPath);
  const entries = owned.flatMap(record => record.entries ?? []).filter(entry =>
    entry.keys?.length === 2 && entry.keys[0] === 'hooks' && typeof entry.keys[1] === 'string' && Array.isArray(entry.append?.hooks));
  const result = { removed: [], preserved: [] };
  if (!entries.length) return result;
  const before = await snapshot(configPath, noSymlinks);
  if (!before) return result;
  const config = parse(before.text), state = config.hooks?.state;
  if (!state || typeof state !== 'object' || !Object.keys(state).length) return result;
  if (owned.some(record => record.pending)) throw Error('Finish the pending native configuration write before cleaning hook trust');
  const hookFile = await snapshot(hooksPath, noSymlinks);
  if (!hookFile) { result.preserved.push({ reason: 'Owned hooks file is absent; trust ownership cannot be verified' }); return result; }
  const document = JSON.parse(hookFile.text), native = await listHooks(agentHome, receipt.home);
  const remove = new Set();
  for (const entry of entries) {
    const event = entry.keys[1], groups = document.hooks?.[event] ?? [];
    if (!Array.isArray(groups) || groups.filter(group => equal(group, entry.append)).length !== 1) {
      result.preserved.push({ event, reason: 'Owned hook group changed or is ambiguous' }); continue;
    }
    for (const handler of entry.append.hooks) {
      if (handler.type !== 'command' || typeof handler.command !== 'string') continue;
      const liveCount = groups.flatMap(group => group.hooks ?? []).filter(hook => hook.type === 'command' && hook.command === handler.command).length;
      const candidates = native.filter(hook => hook.source === 'user' && resolve(hook.sourcePath) === hooksPath &&
        hook.eventName === event[0].toLowerCase() + event.slice(1) && hook.handlerType === 'command' && hook.command === handler.command);
      if (liveCount !== 1 || candidates.length !== 1) { result.preserved.push({ event, reason: 'Hook command ownership is ambiguous' }); continue; }
      const hook = candidates[0], record = state[hook.key];
      if (!record) continue;
      if (record.trusted_hash !== hook.currentHash || Object.keys(record).some(key => !['trusted_hash', 'enabled'].includes(key))) {
        result.preserved.push({ key: hook.key, reason: 'Hook trust changed or contains unowned fields' }); continue;
      }
      remove.add(hook.key);
    }
  }
  if (!remove.size) return result;
  if (records.some(record => record.pending && record.path === configPath)) throw Error('Finish the pending native configuration write before cleaning hook trust');
  for (const key of remove) delete state[key];
  if (!Object.keys(state).length) delete config.hooks.state;
  if (!Object.keys(config.hooks).length) delete config.hooks;
  const temporary = `${configPath}.bro-hook-trust-${randomUUID()}`;
  let handle, created = false;
  try {
    await noSymlinks(temporary);
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, before.mode);
    created = true;
    await handle.chmod(before.mode); await handle.writeFile(stringify(config)); await handle.sync(); await handle.close(); handle = null;
    // Native metadata and the configuration must describe the same files right up to replacement.
    if (!equal(await snapshot(configPath, noSymlinks), before) || !equal(await snapshot(hooksPath, noSymlinks), hookFile)) throw Error('Native hook configuration changed during trust cleanup');
    await rename(temporary, configPath);
    result.removed = [...remove];
    await save();
    return result;
  } finally { await handle?.close(); if (created) await rm(temporary, { force: true }); }
}
