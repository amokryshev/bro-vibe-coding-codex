import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { prepareEmailEnvironmentFile, loadEmailEnvironment } from './environment.mjs';
import { createEmailConnectionProbe } from './connection-probe.mjs';
import { verifyVendoredEmailRuntime } from './verify-vendor.mjs';
import { probeRuntime } from './runtime.mjs';
import { createEmailInteraction } from './setup-interaction.mjs';

// The protocol and terminal seams allow offline tests without a CLI bypass of checks.
export async function configureEmail(ctx, {
  connectionProbe = createEmailConnectionProbe(), processEnvironment = process.env,
  interaction = createEmailInteraction(),
} = {}) {
  const skipped = () => ({ status: 'skipped' });
  if (processEnvironment.BRO_EMAIL_SETUP === 'skip') return skipped();
  if (Object.keys(ctx.settings ?? {}).length) throw Error('Email: настройки из JSON больше не поддерживаются. Используйте окружение или .env проекта.');
  const payload = join(ctx.root, 'plugin/payload/email');
  const runtimeHome = join(ctx.dataDirectory, 'runtime');
  const legacy = join(ctx.dataDirectory, 'account.json');
  if (await interaction.choose({ stage: 'prepare', title: 'Настройка Email: подготовить .env проекта?', proceed: 'Продолжить' }) === 'skip') return skipped();
  for (;;) {
    let account;
    try {
      await ctx.checkOwnedFiles([legacy]);
      await prepareEmailEnvironmentFile(ctx.project);
      account = await loadEmailEnvironment(ctx.project, processEnvironment);
    } catch (error) {
      if (!interaction.interactive) throw error;
      if (await interaction.choose({ stage: 'fill', title: error.message, proceed: 'Файл исправлен — проверить подключение' }) === 'skip') return skipped();
      continue;
    }
    const config = { project: ctx.project, ...account, runtimeHome };
    const result = await interaction.check(async signal => {
      try { await verifyVendoredEmailRuntime(join(payload, 'vendor')); }
      catch { return { ok: false, reason_code: 'email-runtime-verification-failed' }; }
      if (signal.aborted) return { status: 'skipped' };
      return connectionProbe.test({
        target_id: `target:sha256:${createHash('sha256').update(ctx.project).digest('hex')}`,
        configuration: account.environment,
        destination_policy: { private_endpoints: account.privateEndpoints },
        runtime: { start: signal => probeRuntime(config, signal) },
      }, { signal });
    });
    if (result.status === 'skipped') return skipped();
    if (!result.ok) {
      const message = `Email connection verification failed: ${result.reason_code}`;
      if (!interaction.interactive) throw Error(message);
      if (await interaction.choose({ stage: 'retry', title: message, proceed: 'Повторить после исправления .env' }) === 'skip') return skipped();
      continue;
    }
    if (await interaction.choose({ stage: 'finish', title: 'Подключение Email проверено.', proceed: 'Завершить настройку' }) === 'skip') return skipped();
    // Editing the file while checking must not activate an untested account.
    let current;
    try { current = await loadEmailEnvironment(ctx.project, processEnvironment); }
    catch (error) { if (!interaction.interactive) throw error; continue; }
    if (!isDeepStrictEqual(current, account)) continue;
    await ctx.checkOwnedFiles([legacy]);
    await ctx.ownDirectory(runtimeHome, join(payload, 'empty-runtime-home'));
    await chmod(runtimeHome, 0o700);
    await ctx.configure({ mcp: { 'bro-email': {
      command: process.execPath,
      args: [join(payload, 'launch.mjs'), '--project', ctx.project, '--runtime-home', runtimeHome],
    } } });
    if (await ctx.exists(legacy)) {
      // Only after native publication succeeds, and only with ownership evidence.
      ctx.afterConfiguration(() => ctx.removeOwned([legacy]));
    }
    return { status: 'configured' };
  }
}
