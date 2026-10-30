import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Native discovery lets the host enforce its configuration and authorization.
// This adapter never opens credential files and never starts a model turn.
export async function discoverMcp(options, name) { return nativeMcp(options, name); }

export async function callMcpTool(options, name, request) {
  return options.agent === 'claude' ? claudeCall(options, name, request) : nativeMcp(options, name, request);
}

async function nativeMcp({ agent, env, cwd, project }, name, request) {
  if (agent === 'claude') {
    const child = spawn('claude', ['mcp', 'get', name], {
      env, cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stderr.resume();
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Native MCP health check timed out')); }, 20000);
      child.stdout.on('data', bytes => {
        output += bytes;
        if (output.length > 1024 * 1024) { child.kill('SIGKILL'); reject(Error('Native MCP health response too large')); }
      });
      child.on('error', () => { clearTimeout(timer); reject(Error('Native MCP health check could not start')); });
      child.on('close', code => { clearTimeout(timer); resolve(code); });
    });
    return { connected: code === 0 && /^\s*Status:\s*[^\n]*\bConnected\b/m.test(output) };
  }
  const child = spawn('codex', ['app-server', '--stdio'], {
    env, cwd, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout }), pending = new Map();
  child.stderr.resume();
  let id = 0;
  const fail = () => { for (const item of pending.values()) item.reject(Error('Native MCP discovery failed')); };
  child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
  lines.on('line', line => {
    if (line.length > 1024 * 1024) return fail();
    try { const message = JSON.parse(line); pending.get(message.id)?.resolve(message); } catch { /* Other host output cannot prove MCP availability. */ }
  });
  async function call(method, params) {
    const key = ++id; let timer;
    try {
      const message = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Native MCP discovery timed out')), 20000);
        pending.set(key, { resolve, reject }); child.stdin.write(JSON.stringify({ id: key, method, params }) + '\n');
      });
      if (message.error || !message.result) throw Error('Native MCP discovery failed');
      return message.result;
    } finally { clearTimeout(timer); pending.delete(key); }
  }
  try {
    await call('initialize', { clientInfo: { name: 'bro_lifecycle', version: '1' }, capabilities: { experimentalApi: true } });
    // Project layers are scoped to a thread in app-server. An ephemeral thread
    // loads them without a persistent conversation or any model turn.
    const thread = project || request ? await call('thread/start', { cwd: project ?? cwd, ephemeral: true, experimentalRawEvents: false }) : null;
    if (request) return await call('mcpServer/tool/call', { threadId: thread.thread.id, server: name, tool: request.tool, arguments: request.arguments ?? {} });
    const result = await call('mcpServerStatus/list', { serverName: name, detail: 'full', ...(thread ? { threadId: thread.thread.id } : {}) });
    return result.data?.find(item => item.name === name);
  } finally {
    lines.close(); child.stdin.end(); child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

async function claudeCall({ env, cwd }, name, request) {
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout }), pending = new Map();
  child.stderr.resume();
  let id = 0;
  const fail = () => { for (const item of pending.values()) item.reject(Error('Native MCP tool call failed or is unsupported')); };
  child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
  lines.on('line', line => {
    if (line.length > 1024 * 1024) return fail();
    try {
      const message = JSON.parse(line);
      if (message.type === 'control_response') pending.get(message.response?.request_id)?.resolve(message.response);
      // No approval is granted by the adapter. An interactive permission request
      // must fail this unattended check, not authorize the tool automatically.
      if (message.type === 'control_request') fail();
    } catch { /* Native diagnostics are not a protocol result. */ }
  });
  async function control(request) {
    const key = String(++id); let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Native MCP tool call timed out')), 20000);
        pending.set(key, { resolve, reject });
        child.stdin.write(JSON.stringify({ type: 'control_request', request_id: key, request }) + '\n');
      });
      if (response.subtype !== 'success') throw Error('Native MCP tool call failed or is unsupported');
      return response.response;
    } finally { clearTimeout(timer); pending.delete(key); }
  }
  try {
    await control({ subtype: 'initialize' });
    return await control({ subtype: 'mcp_call', tool: `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}__${request.tool}`, arguments: request.arguments ?? {} });
  } finally {
    lines.close(); child.stdin.end(); child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
