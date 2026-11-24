import { LocalTddStore } from './localTddStore.js';
import { TddStore as RemoteTddStore } from './tddStore.js';
import { captureGitContext } from './gitContext.js';

export async function trackBranch(store = null) {
  const own = !store;
  const s = store || new LocalTddStore();
  try {
    await s.initialize();
    const ctx = captureGitContext();
    if (ctx.branchName) {
      await s.upsertBranch({ name: ctx.branchName, forkCommitSha: ctx.headSha || null });
    }
    if (own) {await s.close();}
    return { ok: true, branch: ctx.branchName || null };
  } catch (error) {
    try { if (own) {await s.close();} } catch {}
    throw error;
  }
}

async function main(store = null) {
  if (process.env.HUSKY_SKIP_TRACK === '1') {process.exit(0);}
  try {
    await trackBranch(store);
    process.exit(0);
  } catch (error) {
    console.error('[branch-tracker] Error registrando rama:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('branch-tracker.js')) {
  main().catch((error) => {
    console.error('[branch-tracker] Error registrando rama:', error.message);
    process.exit(1);
  });
}

export { RemoteTddStore as TDDLogBDAdapter, main };

