// Transport mechanics, with no Tool names or service-specific success conditions.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function probeMcp(definition, { env = process.env, cwd, requests = [], timeout = 15000 } = {}) {
  const initialize = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bro-lifecycle', version: '1' } };
  if (definition.url) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...definition.http_headers, ...definition.headers };
    for (const [key, variable] of Object.entries(definition.env_http_headers ?? {})) if (env[variable]) headers[key] = env[variable];
    if (definition.bearer_token_env_var && env[definition.bearer_token_env_var]) headers.Authorization = `Bearer ${env[definition.bearer_token_env_var]}`;
    let id = 0;
    const call = async (method, params) => {
      const response = await fetch(definition.url, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(timeout), body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      if (!response.ok) throw Error(`MCP HTTP check failed (${response.status}); verify authorization and availability`);
      if (response.headers.get('mcp-session-id')) headers['mcp-session-id'] = response.headers.get('mcp-session-id');
      const text = await response.text();
      const message = response.headers.get('content-type')?.includes('text/event-stream')
        ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))).find(m => m.id === id)
        : JSON.parse(text);
      if (!message?.result || message.error) throw Error('MCP protocol check failed');
      return message.result;
    };
    const initialized = await call('initialize', initialize);
    await fetch(definition.url, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(timeout), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const results = [];
    for (const request of requests) results.push(await call(request.method, request.params ?? {}));
    return { initialized, results };
  }
  const child = spawn(definition.command, definition.args ?? [], { cwd: definition.cwd ?? cwd, env: { ...env, ...definition.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout }), pending = new Map();
  let id = 0;
  const fail = error => { for (const p of pending.values()) p.reject(error); };
  child.on('error', () => fail(Error('MCP process could not start')));
  child.on('exit', code => fail(Error(`MCP process exited (${code})`)));
  child.stdin.on('error', () => fail(Error('MCP input closed')));
  lines.on('line', line => {
    if (line.length > 1024 * 1024) return fail(Error('MCP response too large'));
    try { const message = JSON.parse(line); pending.get(message.id)?.resolve(message); } catch { /* non-protocol output cannot satisfy requests */ }
  });
  async function call(method, params) {
    const key = ++id; let timer;
    try {
      const message = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error(`MCP check timed out: ${method}`)), timeout);
        pending.set(key, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
      });
      if (message.error || !message.result) throw Error('MCP protocol check failed');
      return message.result;
    } finally { clearTimeout(timer); pending.delete(key); }
  }
  try {
    const initialized = await call('initialize', initialize);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const results = [];
    for (const request of requests) results.push(await call(request.method, request.params ?? {}));
    return { initialized, results };
  } finally {
    lines.close(); child.stdin.end(); child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
