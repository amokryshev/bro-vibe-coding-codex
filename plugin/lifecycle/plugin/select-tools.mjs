import { emitKeypressEvents } from 'node:readline';

export async function selectTools(available, installed=[]) {
  if (!available.length) return [];
  if(!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Select tools with --tools id,id or --tools none in noninteractive mode.');
  emitKeypressEvents(process.stdin);
  const selected=new Set(installed); let position=0, painted=false;
  const paint=()=>{
    if(painted) process.stdout.write(`\x1b[${available.length+3}A`);
    process.stdout.write('\x1b[2KChoose tools: ↑/↓ move, Space select, A select all, Enter continue\n');
    for(const [index,id] of available.entries()) process.stdout.write(`\x1b[2K${index===position?'>':' '} [${selected.has(id)?'x':' '}] ${id}${installed.includes(id)?' (installed)':''}\n`);
    process.stdout.write('\x1b[2KAny tool can be deferred. Ctrl+C cancels.\n\x1b[2K\n'); painted=true;
  };
  const wasRaw=process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write('\x1b[?25l'); paint();
  try {
    return await new Promise((resolve,reject)=>{
      const keypress=(text,key={})=>{
        if(key.ctrl && key.name==='c') { finish(); reject(Object.assign(Error('Tool selection cancelled'), {code:'BRO_CANCELLED'})); }
        else if(key.name==='return') { finish(); resolve(available.filter(id=>selected.has(id))); }
        else {
          if(key.name==='up') position=(position+available.length-1)%available.length;
          if(key.name==='down') position=(position+1)%available.length;
          if(text===' ') { const id=available[position]; if(!installed.includes(id)) selected.has(id)?selected.delete(id):selected.add(id); }
          if(key.name==='a') for(const id of available) selected.add(id);
          paint();
        }
      };
      const finish=()=>process.stdin.removeListener('keypress',keypress);
      process.stdin.on('keypress',keypress);
    });
  } finally { process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stdout.write('\x1b[?25h'); }
}

export async function selectOption(title, choices) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Run this command in an interactive terminal.');
  emitKeypressEvents(process.stdin);
  let position = 0;
  const paint = () => process.stdout.write('\x1b[2J\x1b[HBro Vibe Coding\n\n' + title + '\n\n' +
    choices.map((choice, index) => `${index === position ? '›' : ' '} ${choice.label}`).join('\n') + '\n\n↑/↓ — выбор, Enter — продолжить, Ctrl+C — отмена\n');
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume(); paint();
  try {
    return await new Promise((resolve, reject) => {
      const finish = () => process.stdin.removeListener('keypress', keypress);
      const keypress = (text, key = {}) => {
        if (key.ctrl && key.name === 'c') { finish(); reject(Object.assign(Error('Установка отменена'), {code:'BRO_CANCELLED'})); }
        else if (key.name === 'return') { finish(); resolve(choices[position].value); }
        else { if (key.name === 'up') position = (position + choices.length - 1) % choices.length;
          if (key.name === 'down') position = (position + 1) % choices.length; paint(); }
      };
      process.stdin.on('keypress', keypress);
    });
  } finally { process.stdin.setRawMode(wasRaw); process.stdin.pause(); }
}
