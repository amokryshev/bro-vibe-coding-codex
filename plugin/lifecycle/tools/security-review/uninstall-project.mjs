export default async function run(ctx) {
  if (ctx.mode === 'check') return { status: 'skipped', verification: 'not-applicable' };
}
