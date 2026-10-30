import { verifyToolFiles } from './integrity.mjs';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    if (!(await ctx.inspectState()).configured) return { status: 'skipped', verification: 'not-configured' };
    await verifyToolFiles(ctx);
    return { status: 'completed', verification: 'passed' };
  }

  await verifyToolFiles(ctx);
  const skills = join(ctx.root, 'plugin/payload/bro-matt/skills');
  const entries = (await readdir(skills, { withFileTypes: true })).filter(e => e.isDirectory()).map(entry => ({ path: join(ctx.skillsDirectory, entry.name), source: join(skills, entry.name) }));
  await ctx.checkDirectories(entries);
  let tracker = ctx.settings.tracker;
  const configPath = join(dirname(ctx.skillsDirectory), 'bro-vibe-coding/project.md');
  if (!await ctx.exists(join(ctx.project, 'docs/agents/issue-tracker.md')) && !await ctx.exists(configPath)) {
    tracker ??= await ctx.ask('Issue tracker agreement for this project (provider/project, or local files):');
    if (!tracker.trim()) throw Error('Tracker agreement is required');
  }
  // Each host owns its fallback settings; shared repository agreements remain user-owned.
  await ctx.ensureDocument(configPath, `# Bro project settings\n\nExisting project instructions and docs/agents agreements take precedence.\n\n## Issue tracker\n\n${tracker ?? 'Use the existing docs/agents/issue-tracker.md agreement.'}\n\n## Triage\n\nUse needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix unless the project defines another mapping.\n\n## Domain\n\nRead CONTEXT.md when present and relevant docs/adr decisions before domain changes.\n`);
  await ctx.ownDirectories(entries);
}
