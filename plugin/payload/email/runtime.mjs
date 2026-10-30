import { spawn } from 'node:child_process';
import { join } from 'node:path';

export function runtimeEnvironment(config) {
  const environment = config.environment;
  return {
    ...environment,
    HOME: config.runtimeHome,
    XDG_CONFIG_HOME: join(config.runtimeHome, 'config'),
    XDG_DATA_HOME: join(config.runtimeHome, 'data'),
    XDG_STATE_HOME: join(config.runtimeHome, 'state'),
    BRO_EMAIL_RUNTIME_POLICY: JSON.stringify({
      endpoints: [
        { host: environment.MCP_EMAIL_IMAP_HOST, port: Number(environment.MCP_EMAIL_IMAP_PORT) },
        { host: environment.MCP_EMAIL_SMTP_HOST, port: Number(environment.MCP_EMAIL_SMTP_PORT) },
      ], private_endpoints: config.privateEndpoints,
    }),
  };
}

export function startRuntime(config, stdio = 'inherit') {
  return spawn(process.execPath, ['--import', join(import.meta.dirname, 'network-policy.mjs'), join(import.meta.dirname, 'server.mjs')], {
    cwd: import.meta.dirname, env: runtimeEnvironment(config), stdio,
  });
}

export function probeRuntime(config, signal) {
  return new Promise((resolve, reject) => {
    const child = startRuntime(config, ['pipe', 'pipe', 'ignore']);
    let pending = '', done = false, success = false, killTimer;
    const timer = setTimeout(() => finish(false), 10000);
    const finish = ok => {
      if (done) return;
      done = true;
      success = ok;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(false));
    child.once('close', () => {
      if (!done) finish(false);
      clearTimeout(killTimer);
      success ? resolve() : reject(Error('Email runtime did not initialize'));
    });
    child.stdout.on('data', bytes => {
      pending += bytes;
      if (pending.length > 1024 * 1024) return finish(false);
      for (;;) {
        const newline = pending.indexOf('\n');
        if (newline < 0) break;
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        try { const message = JSON.parse(line); if (message.id === 1) finish(Boolean(message.result?.serverInfo)); } catch { finish(false); }
      }
    });
    child.stdin.on('error', () => finish(false));
    if (signal?.aborted) return abort();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bro-email-setup', version: '1' },
    } }) + '\n');
  });
}
