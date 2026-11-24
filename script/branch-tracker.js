import { TDDLogBDAdapter } from './TDDLogBDAdapter.js';
import { captureGitContext } from './gitContext.js';

async function main(store = new TDDLogBDAdapter()) {
  try {
    await store.initialize();
    const context = captureGitContext();

    if (context.branchName && context.headSha) {
      await store.upsertBranch({
        name: context.branchName,
        forkCommitSha: context.headSha
      });
    }

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('Error en branch-tracker.js:', error.message);
    try {
      await store.close();
    } catch (closeError) {
      console.error('Error al cerrar branch-tracker.js:', closeError.message);
    }
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  main().catch((error) => {
    console.error('Error en branch-tracker.js:', error.message);
    process.exit(1);
  });
}

export { TDDLogBDAdapter, main };
