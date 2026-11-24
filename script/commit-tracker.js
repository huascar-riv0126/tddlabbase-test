import { LocalTddStore } from './localTddStore.js';
import { TddStore as RemoteTddStore } from './tddStore.js';
import { captureGitContext, getCommitAuthor, getCommitDate } from './gitContext.js';

export async function trackCommit(store = null) {
  const own = !store;
  const s = store || new LocalTddStore();
  try {
    await s.initialize();
    const ctx = captureGitContext();
    if (!ctx.inGitRepo || !ctx.headSha) {
      if (own) {await s.close();}
      return { skipped: true };
    }
    const parents = ctx.parents || [];
    await s.upsertCommit({
      sha: ctx.headSha,
      parentSha: parents.length > 0 ? parents[0] : null,
      branch: ctx.branchName || null,
      author: getCommitAuthor({ sha: ctx.headSha }) || null,
      message: ctx.commitMessage || null,
      committedAt: getCommitDate({ sha: ctx.headSha }) || null
    });
    if (ctx.branchName) {
      await s.upsertBranch({ name: ctx.branchName, forkCommitSha: ctx.headSha });
    }
    if (own) {await s.close();}
    return { ok: true, sha: ctx.headSha };
  } catch (error) {
    try { if (own) {await s.close();} } catch {}
    throw error;
  }
}

async function main(store = null) {
  if (process.env.HUSKY_SKIP_TRACK === '1') {process.exit(0);}
  try {
    await trackCommit(store);
    process.exit(0);
  } catch (error) {
    console.error('[commit-tracker] Error registrando commit:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('commit-tracker.js')) {
  main().catch((error) => {
    console.error('[commit-tracker] Error registrando commit:', error.message);
    process.exit(1);
  });
}

// Export remote store for backward compatibility with existing tests using pg/mock pool
export { RemoteTddStore as TddStore, main };

