import { LocalTddStore } from './localTddStore.js';
import { TddStore as RemoteTddStore } from './tddStore.js';
import { captureGitContext, getCommitAuthor, getCommitDate } from './gitContext.js';

async function main(store = null) {
  const own = !store;
  const s = store || new LocalTddStore();
  try {
    await s.initialize();
    const ctx = captureGitContext();
    if (!ctx.inGitRepo || !ctx.headSha) {
      if (own) {await s.close();}
      process.exit(0);
    }
    const parents = ctx.parents || [];
    const parentSha = parents.length > 0 ? parents[0] : null;
    const author = getCommitAuthor({ sha: ctx.headSha }) || null;
    const committedAt = getCommitDate({ sha: ctx.headSha }) || null;
    await s.upsertCommit({
      sha: ctx.headSha,
      parentSha: parentSha || null,
      branch: ctx.branchName || null,
      author,
      message: ctx.commitMessage || null,
      committedAt
    });
    if (ctx.branchName) {
      await s.upsertBranch({ name: ctx.branchName, forkCommitSha: ctx.headSha });
    }
    if (own) {await s.close();}
    process.exit(0);
  } catch (error) {
    console.error('Error en commitScript.js:', error.message);
    try { if (own) {await s.close();} } catch {}
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  try {
    main().catch((error) => {
      console.error('Error en commitScript.js:', error.message);
      process.exit(1);
    });
  } catch {}
}

export { RemoteTddStore as TddStore, main };
