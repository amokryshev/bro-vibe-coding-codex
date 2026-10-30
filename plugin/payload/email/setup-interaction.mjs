import { emitKeypressEvents } from 'node:readline';

// Email owns its dialogue. Closing a prompt releases stdin for the next tool.
export function createEmailInteraction(input = process.stdin, output = process.stdout) {
  const interactive = Boolean(input.isTTY && output.isTTY);
  function prompt(title, proceed) {
    const choices = [...(proceed ? [{ value: 'continue', label: proceed }] : []), { value: 'skip', label: 'Пропустить настройку' }];
    let position = 0, finish;
    const wasRaw = input.isRaw;
    const promise = new Promise(resolve => {
      let closed = false;
      finish = value => {
        if (closed) return;
        closed = true;
        input.removeListener('keypress', keypress);
        input.removeListener('end', ended);
        input.removeListener('error', ended);
        input.setRawMode(wasRaw); input.pause();
        resolve(value);
      };
      const ended = () => finish('skip');
      const paint = () => output.write('\x1b[2J\x1b[HEmail\n\n' + title + '\n\n' + choices.map((choice, i) => `${i === position ? '›' : ' '} ${choice.label}`).join('\n') + '\n\n↑/↓ — выбор, Enter — продолжить, Esc / Ctrl+C — пропустить\n');
      const keypress = (text, key = {}) => {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) finish('skip');
        else if (key.name === 'return') finish(choices[position].value);
        else if (key.name === 'up' || key.name === 'down') { position = (position + 1) % choices.length; paint(); }
      };
      emitKeypressEvents(input); input.setRawMode(true); input.resume();
      input.on('keypress', keypress); input.once('end', ended); input.once('error', ended);
      paint();
    });
    return { promise, close: () => finish('closed') };
  }
  return {
    interactive,
    async choose({ title, proceed }) {
      return interactive ? prompt(title, proceed).promise : 'continue';
    },
    async check(operation) {
      const controller = new AbortController();
      if (!interactive) return operation(controller.signal);
      const pending = prompt('Проверяем подключение IMAP/SMTP…');
      let skipped = false;
      const choice = pending.promise.then(value => {
        if (value === 'skip') { skipped = true; controller.abort(); }
      });
      try {
        const result = await operation(controller.signal);
        return skipped ? { status: 'skipped' } : result;
      } catch (error) {
        if (skipped) return { status: 'skipped' };
        throw error;
      } finally { pending.close(); await choice; }
    },
  };
}
