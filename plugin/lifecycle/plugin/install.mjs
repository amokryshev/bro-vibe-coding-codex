import { verifyResult } from './verify.mjs';
import { run } from './runtime.mjs';
import { selectOption, selectTools } from './select-tools.mjs';
import { parseArgs } from 'node:util';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { removeSystem } from './system-removal.mjs';

const actions = [
  {value:'install', label:'Установка на компьютер'},
  {value:'uninstall-system', label:'Удаление с компьютера'},
  {value:'configure-project', label:'Настройка текущего проекта'},
  {value:'uninstall-project', label:'Удаление из текущего проекта'},
];
const yesNo = title => selectOption(title, [{value:false,label:'Нет'}, {value:true,label:'Да'}]);
let report, resultPath;
const save = async () => {
  if (!resultPath || !report) return;
  await writeFile(resultPath + '.pending', JSON.stringify(report, null, 2) + '\n', {mode:0o600});
  await rename(resultPath + '.pending', resultPath);
};
try {
  const args = process.argv.slice(2);
  // Explicit legacy lifecycle clients retain their command contract.
  if (args.length && !args.some(a => ['--launch','--interactive','--action','--help'].includes(a))) {
    await run('install');
  } else {
    const { values } = parseArgs({options:{
      launch:{type:'boolean'}, interactive:{type:'boolean'}, help:{type:'boolean'}, action:{type:'string'},
      tools:{type:'string'}, home:{type:'string'}, root:{type:'string'}, 'agent-home':{type:'string'},
      project:{type:'string'}, tracker:{type:'string'}, settings:{type:'string'},
      'setup-project':{type:'string'}, 'result-file':{type:'string'}, yes:{type:'boolean'}, 'removal-mode':{type:'string'},
    }});
    if (values.help) console.log('BRO setup: node install.mjs --launch [--project PATH]\nIn your terminal: node install.mjs --interactive\nAutomation: --action install|uninstall-system|configure-project|uninstall-project --tools id,id|none --setup-project yes|no --tracker AGREEMENT --result-file PATH. Removal requires --yes. System removal: --removal-mode full|reset (default: full).');
    else if (values.launch) {
      const { launchTerminal } = await import('./terminal.mjs');
      process.exitCode = await launchTerminal(args.filter(a => a !== '--launch'));
    } else {
      if (values.action && !actions.some(a => a.value === values.action)) throw Error('Unknown installer action');
      if (values['removal-mode'] && !['full','reset'].includes(values['removal-mode'])) throw Error('--removal-mode must be full or reset');
      if (values['setup-project'] && !['yes','no'].includes(values['setup-project'])) throw Error('--setup-project must be yes or no');
      const release = JSON.parse(await readFile(new URL('../../release.json', import.meta.url), 'utf8'));
      const root = resolve(values.root ?? join(values.home ?? homedir(), '.local/share/bro-vibe-coding', release.agent));
      const project = resolve(values.project ?? process.cwd());
      resultPath = values['result-file'];
      report = {schema:'bro.installer-result/v1',status:'running',agent:release.agent,root,project,steps:[],startedAt:new Date().toISOString()};
      await save();
      let action = values.action ?? await selectOption('Выберите действие', actions);
      if (values['removal-mode'] && action !== 'uninstall-system') throw Error('--removal-mode requires uninstall-system');
      let receipt;
      try { receipt = JSON.parse(await readFile(join(root,'ownership.json'),'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      if (action === 'install' && receipt) throw Error('BRO уже установлен. Сначала выполните удаление с компьютера (полное или сброс), затем новую установку.');
      report.action = action; await save();
      const removalMode = action === 'uninstall-system' ? values['removal-mode'] ?? (values.action ? 'full' : await selectOption('Выберите режим удаления',[
        {value:'full',label:'Полное удаление'},
        {value:'reset',label:'Сброс до начального состояния (сохранить регистрацию и setup-bro)'},
      ])) : undefined;
      if (removalMode) { report.removalMode=removalMode; await save(); }
      const removalPrompt = action === 'uninstall-system'
        ? (removalMode === 'reset' ? 'Сбросить настройки BRO на компьютере и во всех настроенных проектах, сохранив регистрацию плагина?\n' : 'Удалить BRO с компьютера и всех настроенных проектов?\n') + (receipt?.projects ?? []).join('\n')
        : 'Удалить BRO из текущего проекта?';
      if (action.startsWith('uninstall') && !(values.action ? values.yes : await yesNo(removalPrompt))) throw Object.assign(Error('Удаление отменено'),{code:'BRO_CANCELLED'});
      let selected = values.tools;
      if (action === 'install' && selected === undefined) selected = (await selectTools(release.tools)).join(',') || 'none';
      const options = {...values,tools:selected,project,root,native:true,resetProject:true,onBackup:async path=>{ (report.backups ??= []).push(path); await save(); }};
      const step = async operation => { report.activeStep=operation; await save(); report.steps.push(await run(operation,options)); delete report.activeStep; await save(); };
      if (action === 'uninstall-system') report = await removeSystem(options,removalMode,report,resultPath);
      else await step(action);
      if (action === 'install') {
        await step('configure-system');
        const setup = values['setup-project'] === undefined ? await yesNo('После установки настроить текущую папку как проект?\n' + project) : values['setup-project'] === 'yes';
        if (setup) await step('configure-project');
      }
      report.status = 'completed'; await verifyResult(report); report.finishedAt = new Date().toISOString(); await save();
      console.log('Готово. Вернитесь к агенту для проверки и следующего шага.');
    }
  }
} catch (error) {
  if (error.removalReport) report=error.removalReport;
  if (report) { report.status = error.code === 'BRO_CANCELLED' ? 'cancelled' : 'failed'; report.error = error.message; await save(); }
  console.error(error.message); process.exitCode = error.code === 'BRO_CANCELLED' ? 130 : 1;
}
