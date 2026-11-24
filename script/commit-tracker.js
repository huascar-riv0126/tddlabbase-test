import { TddStore } from './tddStore.js';
import {
  captureGitContext,
  getCommitAuthor,
  getCommitDate
} from './gitContext.js';

async function main(store = new TddStore()) {

  try {
    await store.initialize();

    const ctx = captureGitContext();

    if (!ctx.inGitRepo || !ctx.headSha) {
      process.exit(0);
    }

    const parents = ctx.parents || [];
    const parentSha = parents.length > 0 ? parents[0] : null;

    const author = getCommitAuthor({ sha: ctx.headSha }) || null;
    const committedAt = getCommitDate({ sha: ctx.headSha }) || null;

    await store.upsertCommit({
      sha: ctx.headSha,
      parentSha: parentSha || null,
      branch: ctx.branchName || null,
      author,
      message: ctx.commitMessage || null,
      committedAt
    });

    if (ctx.branchName) {
      await store.upsertBranch({
        name: ctx.branchName,
        forkCommitSha: ctx.headSha
      });
    }

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('Error en commit-tracker.js:', error.message);
    try {
      await store.close();
    } catch (e) {
      // Ignorar
    }
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  try {
    main().catch((error) => {
      console.error('Error en commit-tracker.js:', error.message);
      process.exit(1);
    });
  } catch (e) {
    // Silenciar errores durante import en tests
  }
}

export { TddStore, main };
