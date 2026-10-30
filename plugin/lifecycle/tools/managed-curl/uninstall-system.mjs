export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    return { status: 'completed', verification: 'passed' };
  }
  await ctx.removeOwned();
}
