import { verifyResult } from './verify.mjs';
import { mkdtemp, cp, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function read(path) { try { return await readFile(path,'utf8'); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } }

export async function launchTerminal(args) {
  const session = await mkdtemp(join(tmpdir(),'bro-setup-'));
  // Verification remains runnable after native uninstall removes this plugin.
  await cp(import.meta.dirname,join(session,'verify'),{recursive:true});
  const result = join(session,'result.json'), exit = join(session,'exit'), started = join(session,'started');
  const installedVerifier = fileURLToPath(new URL('./verify.mjs', import.meta.url));
  const temporaryVerifier = join(session, 'verify/verify.mjs');
  const verificationCommand = path => [process.execPath, path, '--result-file', result].map(quote).join(' ');
  const script = join(session,'BRO Setup.command');
  const command = [process.execPath,fileURLToPath(new URL('./install.mjs',import.meta.url)),'--interactive',...args,'--result-file',result].map(quote).join(' ');
  const exported = ['PATH','HOME','CODEX_HOME','CLAUDE_CONFIG_DIR','GIT_CONFIG_COUNT',...Object.keys(process.env).filter(key=>/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key))];
  await writeFile(script,'#!/bin/sh\n' + exported.filter(key=>process.env[key]!==undefined).map(key=>`export ${key}=${quote(process.env[key])}\n`).join('') +
    `cd ${quote(process.cwd())} || exit 1\ntrap ${quote(`printf '130\\n' > ${quote(exit)}; exit 130`)} HUP INT TERM\nprintf '%s\\n' "$$" > ${quote(started)}\n${command}\nbro_status=$?\nprintf '%s\\n' "$bro_status" > ${quote(exit)}\nexit "$bro_status"\n`,{mode:0o700});
  await chmod(script,0o700);
  console.log(`Installer result: ${result}\nVerification command (while plugin remains installed): ${verificationCommand(installedVerifier)}\nVerification command (after system uninstall): ${verificationCommand(temporaryVerifier)}`);
  let launch;
  if (platform() === 'darwin') launch = spawnSync('open',['-a','Terminal',script],{encoding:'utf8'});
  else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    const candidates = [['x-terminal-emulator',['-e',script]],['gnome-terminal',['--',script]],['konsole',['-e',script]],['xterm',['-e',script]]];
    for (const [bin,argv] of candidates) {
      const state = {status:0};
      const child = spawn(bin,argv,{detached:true,stdio:'ignore'});
      child.on('error',error=>{state.error=error;});
      child.on('exit',code=>{state.status=code;}); child.unref();
      await setTimeout(250); launch=state;
      if(!state.error && state.status===0) break;
    }
  }
  if (!launch || launch.error || launch.status !== 0) {
    console.log(`Автоматический запуск терминала недоступен. Выполните в своём терминале:\n${quote(script)}\nЗатем вернитесь к агенту для проверки результата.`);
    return 2;
  }
  console.log('Мастер открыт в отдельном терминале. Выбирайте действия там; агент ожидает завершения.');
  const deadline = Date.now()+30000;
  while (!await read(started)) {
    if(launch.error || launch.status !== 0) { console.log(`Терминал не запустил мастер. Выполните: ${quote(script)}`); return 2; }
    if(Date.now() > deadline) { console.log(`Терминал ещё не запустил мастер. Команда для ручного запуска: ${quote(script)}`); return 2; }
    await setTimeout(250);
  }
  while (true) {
    const status = await read(exit);
    if (status !== null) {
      const report = await read(result);
      if (!report || JSON.parse(report).status !== 'completed') {
        console.error(report ? `Мастер завершился: ${JSON.parse(report).status}` : 'Мастер прерван без результата.');
        return Number(status.trim()) || 1;
      }
      await verifyResult(JSON.parse(report));
      console.log(`Verification command: ${verificationCommand(await read(installedVerifier) === null ? temporaryVerifier : installedVerifier)}`);
      return Number(status.trim());
    }
    const pid = Number((await read(started))?.trim());
    try { process.kill(pid,0); } catch(e) { if(e.code === 'ESRCH') throw Error('Терминал закрыт до завершения мастера'); throw e; }
    await setTimeout(500);
  }
}
