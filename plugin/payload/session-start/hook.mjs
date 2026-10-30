import {readFile} from 'node:fs/promises';
const chunks=[];for await(const chunk of process.stdin) chunks.push(chunk);
const event=JSON.parse(Buffer.concat(chunks).toString()||'{}');
if(event.hook_event_name!=='SessionStart') process.exit(0);
const additionalContext=await readFile(new URL('./prompt.md',import.meta.url),'utf8');
console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext}}));
