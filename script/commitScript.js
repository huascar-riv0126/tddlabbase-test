import { TddStore } from './tddStore.js';
import {
  captureGitContext,
  getCommitAuthor,
  getCommitDate
} from './gitContext.js';

import path from 'path';

const DB_DIR = '.tddlab';
const DB_FILE = 'tddlab.db';

function main() {
  const store = new TddStore({
    dbPath: path.join(process.cwd(), DB_DIR, DB_FILE)
  });

  try {
    store.initialize();

    const ctx = captureGitContext();

    if (!ctx.inGitRepo || !ctx.headSha) {
      process.exit(0);
    }

    const parents = ctx.parents || [];
    const parentSha = parents.length > 0 ? parents[0] : null;

    const author = getCommitAuthor({ sha: ctx.headSha }) || null;
    const committedAt = getCommitDate({ sha: ctx.headSha }) || null;

    store.upsertCommit({
      sha: ctx.headSha,
      parentSha: parentSha || null,
      branch: ctx.branchName || null,
      author,
      message: ctx.commitMessage || null,
      committedAt
    });

    if (ctx.branchName) {
      store.upsertBranch({
        name: ctx.branchName,
        forkCommitSha: ctx.headSha
      });
    }

    store.close();
    process.exit(0);
  } catch (error) {
    console.error('Error en commitScript.js:', error.message);
    try {
      store.close();
    } catch (e) {
      // Ignorar errores al cerrar
    }
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  try {
    main();
  } catch (e) {
    // Silenciar errores durante import en tests
  }
}

export { TddStore, main };
