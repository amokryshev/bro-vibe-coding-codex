import { run } from './runtime.mjs';
try { await run('configure-system'); } catch (error) { console.error(error.message); process.exitCode = 1; }
